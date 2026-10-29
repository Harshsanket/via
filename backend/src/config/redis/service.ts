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
  NO_SESSION,
  NO_PEER,
  NO_FILE_SELECTED,
  SESSION_FIELDS,
  createSessionObject,
  peerSessionCountKey,
  peerStorageKey,
  sessionStorageKey,
} from "./constants.js";
import {
  runCompleteTransferScript,
  runJoinSessionScript,
  runLeaveSessionScript,
  runSetStatusScript,
  runStoreMetadataScript,
  type GuardedWriteStatus,
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
    // NX: never overwrite a live mapping. A recovered connection keeps its
    // socket id, and resetting the key here orphaned the peer's session.
    await redisClient.set(peerStorageKey(peerId), NO_SESSION, {
      EX: env.sessionTtlSeconds,
      NX: true,
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

  const sessionTtl = Math.max(
    1,
    Math.min(env.sessionTtlSeconds, remainingLifetime()),
  );
  const peerTtl = Math.max(
    1,
    Math.min(env.refreshSessionTtlSeconds, remainingLifetime()),
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

/**
 * What the session records about its receiver slot. The socket layer uses it
 * to tell a live member from a stale one, and a reloaded page from a third
 * peer.
 */
export const getReceiverSlot = async (
  sessionId: SessionID,
): Promise<{
  peerId: string | null;
  status: SessionStatus | null;
  token: string | null;
}> => {
  assertValidStrings([sessionId], "getReceiverSlot");

  const [peerId, status, token] = await redisClient.hmGet(
    sessionStorageKey(sessionId),
    [F.connectedPeer, F.status, F.receiverToken],
  );

  return {
    peerId: peerId && peerId !== NO_PEER ? peerId : null,
    status:
      status && Object.values(SessionStatus).includes(status as SessionStatus)
        ? (status as SessionStatus)
        : null,
    token: token || null,
  };
};

// join session - [socket] session.ts -> [handleSessions] -> [join-session]
/**
 * Atomic: existence, limit, idempotent rejoin, membership and TTLs are applied
 * inside one Lua script, so it also returns the session's granted TTL.
 *
 * `replaceablePeerId` is a member the new peer may replace: its socket is gone,
 * or the same receiver reloaded the page before the transfer started. It is
 * replaced instead of counting against the limit, so a refreshed page can
 * rejoin at once rather than waiting for the deferred disconnect cleanup.
 */
export const joinSession = async ({
  sessionId,
  peerId,
  replaceablePeerId,
  receiverToken,
}: SessionParams & {
  replaceablePeerId?: string;
  receiverToken?: string;
}): Promise<{ connectedPeers: number; ttlSeconds: number }> => {
  assertValidStrings([sessionId, peerId], "joinSession");

  let result: JoinSessionResult;
  try {
    result = await runJoinSessionScript({
      sessionId,
      peerId,
      replaceablePeerId,
      receiverToken,
      desiredTtlSeconds: env.refreshSessionTtlSeconds,
      maxLifetimeSeconds: remainingLifetime(),
    });
  } catch (error) {
    logRedis("error", "joinSession", "ERROR JOINING SESSION", error);
    throw new ApiError(500, "unable to join session");
  }

  switch (result.status) {
    case "ok":
      if (replaceablePeerId) {
        logRedis("warn", "joinSession", "REPLACED PREVIOUS MEMBER", {
          SESSION: sessionId,
          PREVIOUS_PEER: replaceablePeerId,
          PEER: peerId,
        });
      }
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
    case "own-session":
      logRedis("warn", "joinSession", "CREATOR TRIED TO JOIN OWN SESSION", {
        SESSION: sessionId,
        PEER: peerId,
      });
      throw new ApiError(409, "cannot join your own session");
    case "busy":
      logRedis("warn", "joinSession", "PEER ALREADY IN ANOTHER SESSION", {
        SESSION: sessionId,
        PEER: peerId,
      });
      throw new ApiError(409, "peer already in session");
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
  peerId: PeerID,
  { fileName, mimeType, fileSize }: FileMetaData,
): Promise<FileMetaData> => {
  assertValidStrings([sessionId, peerId], "storeFileMetadata");

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

  // Creator only, once, and never on a session that no longer exists: the
  // receiver accepts the file based on these details.
  let status: GuardedWriteStatus;
  try {
    status = await runStoreMetadataScript({
      sessionId,
      peerId,
      fileName,
      mimeType,
      fileSize,
    });
  } catch (error) {
    logRedis(
      "error",
      "storeFileMetadata",
      "ERROR WHILE STORING METADATA",
      error,
    );
    throw new ApiError(500, "unable to store file metadata");
  }

  assertGuardedWrite(status, "storeFileMetadata", sessionId, {
    forbidden: "only the sender can set file details",
    alreadySet: "file details are already set",
  });

  logRedis(
    "success",
    "storeFileMetadata",
    "STORED METADATA FOR SESSION",
    sessionId,
  );

  return { fileName, mimeType, fileSize };
};

/** Maps a guarded write's outcome to the error the client should see. */
const assertGuardedWrite = (
  status: GuardedWriteStatus,
  context: string,
  sessionId: SessionID,
  messages: { forbidden: string; alreadySet?: string },
): void => {
  if (status === "ok") return;

  logRedis("warn", context, `REFUSED (${status.toUpperCase()})`, sessionId);

  if (status === "not-found") {
    throw new ApiError(404, "session expired or invalid");
  }
  if (status === "already-set") {
    throw new ApiError(409, messages.alreadySet ?? "already set");
  }
  throw new ApiError(403, messages.forbidden);
};

/**
 * Reads a session's remaining lifetime. A session that is already gone is
 * reported as `{ exists: false }`, not as an authorization failure, so a
 * client that polls after expiry gets a clean answer instead of a 403.
 */
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

  if (ttl === -2 || !createdAt) {
    logRedis("error", "getSessionTTL", "SESSION NOT FOUND", sessionId);
    return { exists: false, createdAt: null, ttl: null };
  }

  const isValidPeer = peerId === connectedPeer || peerId === createdBy;
  if (!isValidPeer) {
    logRedis("error", "getSessionTTL", "INVALID PEER", peerId);
    throw new ApiError(403, "invalid request");
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
  requiredPeerId?: PeerID,
): Promise<void> => {
  assertValidStrings([sessionId], "changeTransferStatus");

  let result: GuardedWriteStatus;
  try {
    result = await runSetStatusScript({
      sessionId,
      status: status.toLowerCase(),
      requiredPeerId,
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

  assertGuardedWrite(result, "changeTransferStatus", sessionId, {
    forbidden: "unauthorized session access",
  });

  logRedis("success", "changeTransferStatus", "CHANGED TRANSFER STATUS", {
    STATUS: status,
    SESSION: sessionId,
  });
};

/**
 * The receiver confirms delivery. Returns the stored file name ("" if none)
 * for the server to relay, instead of whatever name the client claimed.
 */
export const completeTransfer = async (
  sessionId: SessionID,
  peerId: PeerID,
): Promise<{ fileName: string; ttlSeconds: number }> => {
  assertValidStrings([sessionId, peerId], "completeTransfer");

  let result: {
    status: GuardedWriteStatus;
    fileName: string;
    ttlSeconds: number;
  };
  try {
    result = await runCompleteTransferScript({
      sessionId,
      peerId,
      status: SessionStatus.COMPLETED,
      completedTtlSeconds: env.completedSessionTtlSeconds,
      maxLifetimeSeconds: env.sessionMaxLifetimeSeconds,
    });
  } catch (error) {
    logRedis(
      "error",
      "completeTransfer",
      "ERROR WHILE COMPLETING TRANSFER",
      error,
    );
    throw new ApiError(500, "unable to change transfer status");
  }

  assertGuardedWrite(result.status, "completeTransfer", sessionId, {
    forbidden: "only the receiver can confirm a transfer",
  });

  logRedis("success", "completeTransfer", "TRANSFER CONFIRMED", sessionId);
  return { fileName: result.fileName, ttlSeconds: result.ttlSeconds };
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
