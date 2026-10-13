import { ApiError } from "../../utils/api-error.js";
import { env } from "../env.js";
import { redisClient } from "./index.js";
import type {
  SessionID,
  PeerID,
  SessionParams,
  FileMetaData,
  TTLMeta,
} from "./types.js";
import { SessionStatus } from "./types.js";
import {
  SESSION_TTL,
  REFRESH_SESSION_TTL,
  NO_SESSION,
  NO_FILE_SELECTED,
  SESSION_FIELDS,
  createSessionObject,
  peerSessionCountKey,
  peerStorageKey,
  sessionStorageKey,
} from "./constants.js";
import {
  runJoinSessionScript,
  runLeaveSessionScript,
  type JoinSessionResult,
  type LeaveSessionResult,
} from "./scripts.js";
import {
  assertValidStrings,
  getPeerSessionId,
  logRedis,
  redisKeyExists,
} from "./utils.js";

const F = SESSION_FIELDS;

/**
 * A session may be extended by activity, but never past the absolute cap: the
 * granted TTL is always the smaller of the requested one and the remaining
 * lifetime.
 */
const remainingLifetime = (): number => env.sessionMaxLifetimeSeconds;

const releasePeerSessionSlot = async (peerId: PeerID): Promise<void> => {
  const key = peerSessionCountKey(peerId);
  if (!(await redisKeyExists(key))) return;

  const remaining = await redisClient.decr(key);
  if (remaining <= 0) await redisClient.del(key);
};

// register peer - [socket] - index -> initSocket -> connection
export const registerPeer = async (peerId: PeerID): Promise<void> => {
  assertValidStrings([peerId], "registerPeer");

  try {
    // Idempotent: a peer re-registering simply gets a fresh placeholder.
    await redisClient.set(peerStorageKey(peerId), NO_SESSION, {
      EX: SESSION_TTL,
    });
    logRedis("success", "registerPeer", "REGISTERED NEW PEER", peerId);
  } catch (error) {
    logRedis("error", "registerPeer", "ERROR WHILE REGISTERING PEER", error);
    throw new ApiError(500, "unable to register peer");
  }
};

// create session - [socket] session.ts -> [handleSessions] -> [create-session]
/** Returns the TTL actually granted to the session, in seconds. */
export const createSession = async ({
  sessionId,
  peerId,
}: SessionParams): Promise<number> => {
  assertValidStrings([sessionId, peerId], "createSession");

  const existingSession = await getPeerSessionId(peerId, "createSession");
  if (existingSession) {
    logRedis(
      "error",
      "createSession::[getPeerSessionId]",
      "PEER ALREADY IN SESSION",
      peerId,
    );
    throw new ApiError(409, "peer already in session");
  }

  // INCR is atomic, so two concurrent creates cannot both pass the limit.
  const ownedSessions = await redisClient.incr(peerSessionCountKey(peerId));
  if (ownedSessions > env.maxActiveSessionsPerPeer) {
    await redisClient.decr(peerSessionCountKey(peerId));
    logRedis(
      "error",
      "createSession::[peerSessionCount]",
      "TOO MANY ACTIVE SESSIONS",
      peerId,
    );
    throw new ApiError(429, "too many active sessions");
  }

  const sessionTtl = Math.max(1, Math.min(SESSION_TTL, remainingLifetime()));
  const peerTtl = Math.max(
    1,
    Math.min(REFRESH_SESSION_TTL, remainingLifetime()),
  );

  try {
    const session = createSessionObject(peerId);
    await redisClient
      .multi()
      .hSet(sessionStorageKey(sessionId), session) // store session details
      .expire(sessionStorageKey(sessionId), sessionTtl) // set session ttl
      .set(peerStorageKey(peerId), sessionId, { EX: peerTtl }) // map peer to session
      .expire(peerSessionCountKey(peerId), peerTtl)
      .exec();

    logRedis("success", "createSession", "SESSION CREATED", {
      SESSION: sessionId,
      PEER: peerId,
      TTL: sessionTtl,
    });

    return sessionTtl;
  } catch (error) {
    // Do not burn the peer's session slot when creation fails.
    await redisClient.decr(peerSessionCountKey(peerId)).catch(() => undefined);
    logRedis("error", "createSession", "ERROR WHILE STORING SESSION", error);
    throw new ApiError(500, "unable to create session");
  }
};

// join session - [socket] session.ts -> [handleSessions] -> [join-session]
/**
 * Atomic: existence, limit, idempotent rejoin, membership and TTLs are applied
 * inside one Lua script, so it also returns the session's granted TTL.
 */
export const joinSession = async ({
  sessionId,
  peerId,
}: SessionParams): Promise<{ connectedPeers: number; ttlSeconds: number }> => {
  assertValidStrings([sessionId, peerId], "joinSession");

  let result: JoinSessionResult;
  try {
    result = await runJoinSessionScript({
      sessionId,
      peerId,
      desiredTtlSeconds: REFRESH_SESSION_TTL,
      maxLifetimeSeconds: remainingLifetime(),
    });
  } catch (error) {
    logRedis("error", "joinSession", "ERROR JOINING SESSION", error);
    throw new ApiError(500, "unable to join session");
  }

  switch (result.status) {
    case "ok":
      logRedis("success", "joinSession", "PEER JOINED SESSION", {
        SESSION: sessionId,
        PEERS: result.connectedPeers,
        TTL: result.ttlSeconds,
      });
      return {
        connectedPeers: result.connectedPeers,
        ttlSeconds: result.ttlSeconds,
      };
    case "full":
      logRedis("error", "joinSession", "SESSION FULL", sessionId);
      throw new ApiError(409, "session is full");
    case "misconfigured":
      logRedis("error", "joinSession", "MAX ALLOWED PEERS INVALID", sessionId);
      throw new ApiError(500, "session is misconfigured");
    case "expired":
      logRedis(
        "error",
        "joinSession",
        "SESSION PAST ITS MAX LIFETIME",
        sessionId,
      );
      throw new ApiError(404, "session expired or invalid");
    default:
      logRedis("error", "joinSession", "SESSION NOT FOUND", sessionId);
      throw new ApiError(404, "session expired or invalid");
  }
};

// get file metadata - [socket] session.ts -> [handleSessions] -> [get-file-metadata]
export const getFileMetadata = async (
  sessionId: SessionID,
): Promise<FileMetaData | null> => {
  assertValidStrings([sessionId], "getFileMetadata");

  const metadata = await redisClient.hGetAll(sessionStorageKey(sessionId));
  if (!metadata || Object.keys(metadata).length === 0) {
    logRedis("warn", "getFileMetadata", "NO SESSION FOUND FOR", sessionId);
    return null;
  }

  const fileName = metadata[F.fileName];
  const mimeType = metadata[F.mimeType];
  const fileSize = Number(metadata[F.fileSize]);

  // A session exists before the sender picks a file. That is "not ready yet",
  // not a corrupted record, and the placeholder must not leak as a filename.
  if (
    !fileName ||
    fileName === NO_FILE_SELECTED ||
    !mimeType ||
    mimeType === NO_FILE_SELECTED ||
    !Number.isFinite(fileSize) ||
    fileSize <= 0
  ) {
    logRedis("warn", "getFileMetadata", "FILE NOT SELECTED YET FOR", sessionId);
    return null;
  }

  return { fileName, mimeType, fileSize };
};

// check session - [webrtc] -> [handleWebRTC] -> [offer] [answer] [ice-candidate]
export const isSessionExist = async (
  sessionId: SessionID,
): Promise<boolean> => {
  assertValidStrings([sessionId], "isSessionExist");
  return redisKeyExists(sessionStorageKey(sessionId));
};

// store file metadata - [socket] session.ts -> [handleSessions] -> [store-file-metadata]
export const storeFileMetadata = async (
  sessionId: SessionID,
  { fileName, mimeType, fileSize }: FileMetaData,
): Promise<FileMetaData> => {
  assertValidStrings([sessionId], "storeFileMetadata");

  if (
    !fileName ||
    !mimeType ||
    typeof fileSize !== "number" ||
    !Number.isFinite(fileSize) ||
    fileSize <= 0
  ) {
    logRedis(
      "error",
      "storeFileMetadata",
      "INVALID METADATA FOR SESSION",
      sessionId,
    );
    throw new ApiError(400, "invalid file metadata");
  }

  try {
    await redisClient
      .multi()
      .hSet(sessionStorageKey(sessionId), F.fileName, fileName)
      .hSet(sessionStorageKey(sessionId), F.mimeType, mimeType)
      .hSet(sessionStorageKey(sessionId), F.fileSize, fileSize.toString())
      .exec();

    logRedis(
      "success",
      "storeFileMetadata",
      "STORED METADATA FOR SESSION",
      sessionId,
    );

    return { fileName, mimeType, fileSize };
  } catch (error) {
    logRedis(
      "error",
      "storeFileMetadata",
      "ERROR WHILE STORING METADATA",
      error,
    );
    throw new ApiError(500, "unable to store file metadata");
  }
};

// check ttl - kept so clients can still ask, but `session:expiring` is the
// supported way to learn about expiry.
export const getSessionTTL = async (
  sessionId: SessionID,
  peerId: PeerID,
): Promise<TTLMeta> => {
  assertValidStrings([sessionId, peerId], "getSessionTTL");

  const [[createdAt, createdBy, connectedPeer], ttl] = await Promise.all([
    redisClient.hmGet(sessionStorageKey(sessionId), [
      F.createdAt,
      F.createdBy,
      F.connectedPeer,
    ]),
    redisClient.ttl(sessionStorageKey(sessionId)),
  ]);

  const isValidPeer = peerId === connectedPeer || peerId === createdBy;
  if (!isValidPeer) {
    logRedis("error", "getSessionTTL", "INVALID PEER", peerId);
    throw new ApiError(403, "invalid request");
  }

  if (ttl === -2 || !createdAt) {
    logRedis("error", "getSessionTTL", "SESSION NOT FOUND", sessionId);
    return { exists: false, createdAt: null, ttl: null };
  }

  logRedis("success", "getSessionTTL", "FETCHING TTL", {
    TTL: ttl,
    SESSION: sessionId,
  });

  return {
    exists: true,
    createdAt,
    ttl: ttl === -1 ? null : ttl,
  };
};

// change transfer status - [socket] session.ts -> [handleSessions] -> [transfer-complete] [transfer-error]
export const changeTransferStatus = async (
  sessionId: SessionID,
  status: SessionStatus,
): Promise<void> => {
  assertValidStrings([sessionId], "changeTransferStatus");

  try {
    await redisClient
      .multi()
      .hSet(sessionStorageKey(sessionId), F.lastActivity, Date.now().toString())
      .hSet(sessionStorageKey(sessionId), F.status, status.toLowerCase())
      .exec();

    logRedis("success", "changeTransferStatus", "CHANGED TRANSFER STATUS", {
      STATUS: status,
      SESSION: sessionId,
    });
  } catch (error) {
    logRedis(
      "error",
      "changeTransferStatus",
      "ERROR WHILE CHANGING TRANSFER STATUS",
      error,
    );
    throw new ApiError(500, "unable to change transfer status");
  }
};

// cleanup session - [socket] - index -> [initsocket] -> [disconnect]
/**
 * Leaving is atomic and idempotent: the creator's departure tears the session
 * down and evicts the member's mapping, a member's departure only frees their
 * slot. Calling it twice for the same peer cannot double count.
 */
export const cleanupOnDisconnect = async (
  peerId: PeerID,
): Promise<LeaveSessionResult & { sessionId: string }> => {
  assertValidStrings([peerId], "cleanupOnDisconnect");

  const sessionId = await getPeerSessionId(peerId, "cleanupOnDisconnect");
  if (!sessionId) {
    // The placeholder is not a session id: just drop the peer key.
    await redisClient.del(peerStorageKey(peerId));
    logRedis("warn", "cleanupOnDisconnect", "PEER HAD NO SESSION", peerId);
    return {
      status: "no-session",
      connectedPeers: 0,
      memberId: "",
      sessionId: "",
    };
  }

  let result: LeaveSessionResult;
  try {
    result = await runLeaveSessionScript({ sessionId, peerId });
  } catch (error) {
    logRedis("error", "cleanupOnDisconnect", "ERROR WHILE CLEANING UP", {
      PEER: peerId,
      error,
    });
    throw new ApiError(500, "unable to clean up peer");
  }

  try {
    if (result.status === "deleted") {
      await releasePeerSessionSlot(peerId);
      logRedis("success", "cleanupOnDisconnect", "SESSION CLOSED BY CREATOR", {
        SESSION: sessionId,
        MEMBER_EVICTED: result.memberId || "(none)",
      });
    } else if (result.status === "left") {
      logRedis("success", "cleanupOnDisconnect", "PEER LEFT SESSION", {
        SESSION: sessionId,
        PEERS: result.connectedPeers,
      });
    } else {
      await releasePeerSessionSlot(peerId);
      logRedis("warn", "cleanupOnDisconnect", "SESSION ALREADY GONE", {
        PEER: peerId,
        SESSION: sessionId,
      });
    }
  } catch (error) {
    // The state change already happened; a bookkeeping failure must not make
    // the disconnect handler report an error to a client that has gone away.
    logRedis("error", "cleanupOnDisconnect", "BOOKKEEPING FAILED", {
      PEER: peerId,
      error,
    });
  }

  return { ...result, sessionId };
};
