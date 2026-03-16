import { redisClient } from "./index.js";
import type {
  SessionID,
  PeerID,
  MaxAllowedPeers,
  CurrentPeers,
  SessionParams,
  SessionData,
  FileMetaData,
  TTLMeta,
} from "./types.js";
import { SessionStatus } from "./types.js";
import {
  SESSION_TTL,
  REFRESH_SESSION_TTL,
  createSessionObject,
  NO_SESSION,
} from "./constants.js";
import {
  assertValidStrings,
  getPeerInfo,
  logRedis,
  redisKeyExists,
} from "./utils.js";

// register peer - [sockt] - index -> initSocket -> connection
export const registerPeer = async (peerId: PeerID): Promise<void> => {
  assertValidStrings([peerId], "registerPeer");

  const isPeerAlreadyExists = await redisKeyExists(peerId);
  if (isPeerAlreadyExists) {
    logRedis(
      "error",
      "registerPeer::[redisKeyExists]",
      "PEER ID ALREADY EXIST",
      peerId,
    );
    throw new Error("peer already exists");
  }

  try {
    await redisClient.set(peerId, NO_SESSION, { EX: SESSION_TTL });
    logRedis("success", "registerPeer", "REGISTERED NEW PEER", peerId);
  } catch (error) {
    logRedis("error", "registerPeer", "ERROR WHILE REGISTERING PEER", error);
    throw new Error("something went wrong");
  }
};

// create session - [socket] session.ts -> [handleSessions] -> [create-session]
export const createSession = async ({
  sessionId,
  peerId,
}: SessionParams): Promise<void> => {
  assertValidStrings([sessionId, peerId], "createSession");

  try {
    const getPeerStatus = await getPeerInfo(peerId, "createSession");
    if (getPeerStatus !== NO_SESSION) {
      logRedis(
        "error",
        "createSession::[getPeerInfo]",
        "PEER ALREADY IN SESSION",
        peerId,
      );
      throw new Error("peer already in session");
    }

    const session = createSessionObject(peerId); // create session obj
    await redisClient
      .multi()
      .hSet(sessionId, session) // store session details
      .expire(sessionId, SESSION_TTL) // set session ttl
      .set(peerId, sessionId, { EX: SESSION_TTL }) // map peer to session with new ttl
      .exec();

    logRedis("success", "createSession", "SESSION CREATED", {
      "SESSION :": sessionId,
      "PEER :": peerId,
    });
  } catch (error) {
    logRedis("error", "createSession", "ERROR WHILE STORING SESSION", error);
    throw error;
  }
};

// join session - [socket] session.ts -> [handleSessions] -> [join-session]
export const joinSession = async ({
  sessionId,
  peerId,
}: SessionParams): Promise<void> => {
  assertValidStrings([sessionId, peerId], "joinSession");

  try {
    // get session data
    const sessionData: SessionData = await redisClient.hGetAll(sessionId);
    if (!sessionData || Object.keys(sessionData).length === 0) {
      logRedis(
        "error",
        "joinSession::[sessionData]",
        "SESSION NOT FOUND FOR",
        sessionData,
      );
      throw new Error("session not found");
    }

    const maxAllowedPeers: MaxAllowedPeers = parseInt(
      sessionData.maxAllowedPeers,
      10,
    );
    if (isNaN(maxAllowedPeers) || maxAllowedPeers <= 0) {
      logRedis(
        "error",
        "joinSession::[maxAllowedPeers]",
        "MAX ALLOWED PEERS INVALID",
        sessionData.maxAllowedPeers,
      );
      throw new Error("peers invalid");
    }

    const currentPeers: CurrentPeers = parseInt(
      sessionData.connectedPeers ?? "0",
      10,
    );
    if (currentPeers >= maxAllowedPeers) {
      logRedis("error", "joinSession::[currentPeers]", "SESSION FULL", {
        "CURRENT PEER COUNT": currentPeers,
        "MAX PEER COUNT": maxAllowedPeers,
      });
      throw new Error("session limit reached");
    }

    await redisClient
      .multi()
      .hSet(sessionId, "connectedPeer", peerId)
      .hSet(sessionId, "lastActivity", Date.now().toString())
      .exec();

    logRedis("success", "joinSession", "PEER JOINED SESSION", sessionId);
  } catch (error) {
    logRedis("error", "joinSession", "ERROR JOINING SESSION", error);
    throw new Error("something went wrong");
  }
};

// refresh ttl - [socket] session.ts -> [handleSessions] -> [join-session]
export const refreshSessionTTL = async (
  sessionId: SessionID,
): Promise<void> => {
  assertValidStrings([sessionId], "refreshSessionTTL");

  const [createdBy, connectedPeer] = await redisClient.hmGet(sessionId, [
    "createdBy",
    "connectedPeer",
  ]);

  if (!createdBy || !connectedPeer) {
    logRedis("error", "refreshSessionTTL", "SESSION NOT FOUND", sessionId);
    throw new Error("session not found");
  }

  const ttl = await redisClient.ttl(sessionId);
  if (ttl <= 0) {
    logRedis("error", "refreshSessionTTL", "SESSION EXPIRED", sessionId);
    throw new Error("session TTL expired");
  }

  try {
    await redisClient
      .multi()
      .hSet(sessionId, "lastActivity", Date.now().toString())
      .expire(sessionId, REFRESH_SESSION_TTL)
      .expire(connectedPeer, REFRESH_SESSION_TTL)
      .expire(createdBy, REFRESH_SESSION_TTL)
      .exec();

    logRedis("success", "refreshSessionTTL", "SESSION REFRESHED", sessionId);
  } catch (error) {
    logRedis("error", "refreshSessionTTL", "ERROR WHILE REFRESHING TTL", error);
    throw new Error("something went wrong");
  }
};

// get file metadata - [socket] session.ts -> [handleSessions] -> [get-file-metadata]
export const getFileMetadata = async (
  sessionId: SessionID,
): Promise<FileMetaData> => {
  assertValidStrings([sessionId], "getFileMetadata");

  try {
    const metadata = await redisClient.hGetAll(sessionId);
    if (!metadata || Object.keys(metadata).length === 0) {
      logRedis(
        "error",
        "getFileMetadata",
        " NO METADATA FOUND FOR SESSION",
        sessionId,
      );
      throw new Error("metadata not found");
    }

    const fileName = metadata.fileName;
    const mimeType = metadata.mimeType;
    const fileSize = Number(metadata.fileSize);

    if (!fileName || !mimeType || !fileSize) {
      logRedis(
        "error",
        "getFileMetadata",
        "INVALID METADATA FOR SESSION",
        sessionId,
      );
      throw new Error("Corrupted metadata");
    }

    logRedis(
      "success",
      "getFileMetadata",
      "METADATA RETRIEVED FOR SESSION",
      sessionId,
    );

    return {
      fileName,
      mimeType,
      fileSize,
    };
  } catch (error) {
    logRedis(
      "error",
      "getFileMetadata",
      "ERROR WHILE FETCHING METADATA",
      sessionId,
    );
    throw new Error("something went wrong");
  }
};

// check session - [webrtc] -> [handleWebRTC] -> [offer] [answer] [ice-candidate]
export const isSessionExist = async (
  sessionId: SessionID,
): Promise<boolean> => {
  assertValidStrings([sessionId], "isSessionExist");
  return (await redisClient.exists(sessionId)) === 1;
};

// store file metadata - [webrtc] -> [handleWebRTC] -> [file-metadata]
export const storeFileMetadata = async (
  sessionId: SessionID,
  { fileName, mimeType, fileSize }: FileMetaData,
): Promise<void> => {
  assertValidStrings([sessionId], "storeFileMetadata");

  if (!fileName || !mimeType || typeof fileSize !== "number" || fileSize <= 0) {
    logRedis(
      "error",
      "storeFileMetadata",
      "INVALID METADATA FOR SESSION",
      sessionId,
    );
    throw new Error("invalid file metadata");
  }

  try {
    await redisClient
      .multi()
      .hSet(sessionId, "fileName", fileName)
      .hSet(sessionId, "mimeType", mimeType)
      .hSet(sessionId, "fileSize", fileSize.toString())
      .exec();

    logRedis(
      "success",
      "storeFileMetadata",
      "STORED METADATA FOR SESSION",
      sessionId,
    );
  } catch (error) {
    logRedis(
      "error",
      "storeFileMetadata",
      "ERROR WHILE STORING METADATA",
      error,
    );
    throw new Error("something went wrong");
  }
};

//check ttl
export const getSessionTTL = async (
  sessionId: SessionID,
  peerId: PeerID,
): Promise<TTLMeta> => {
  assertValidStrings([sessionId, peerId], "getSessionTTL");

  try {
    const [[createdAt, connectedPeer], ttl] = await Promise.all([
      redisClient.hmGet(sessionId, ["createdAt", "connectedPeer"]),
      redisClient.ttl(sessionId),
    ]);

    if (connectedPeer !== peerId) {
      logRedis("error", "getSessionTTL", "INVALID PEER", peerId);
      throw new Error("invalid request");
    }

    logRedis("success", "getSessionTTL", "FETCHING TTL", {
      TTL: ttl,
      SESSION: sessionId,
    });

    if (ttl === -2 || !createdAt) {
      logRedis("error", "getSessionTTL", "SESSION NOT FOUND", sessionId);
      return { exists: false, createdAt: null, ttl: null };
    }

    return {
      exists: true,
      createdAt,
      ttl: ttl === -1 ? null : ttl,
    };
  } catch (error) {
    logRedis(
      "error",
      "getSessionTTL",
      "ERROR WHILE GETTING SESSION TTL",
      error,
    );
    throw new Error("something went wrong");
  }
};

// change transfer status - [webrtc] -> [handleWebRTC] -> [transfer-complete] [transfer-error]
export const changeTransferStatus = async (
  sessionId: SessionID,
  status: SessionStatus,
): Promise<void> => {
  assertValidStrings([sessionId], "changeTransferStatus");

  try {
    await redisClient
      .multi()
      .hSet(sessionId, "lastActivity", Date.now().toString())
      .hSet(sessionId, "status", status.toLowerCase())
      .exec();

    logRedis("success", "changeTransferStatus", "CHANGED TRANSFER STATUS", {
      STAUS: status,
      SESSION: sessionId,
    });
  } catch (error) {
    logRedis(
      "error",
      "changeTransferStatus",
      "ERROR WHILE CHANGING TRANSFER STATUS",
      error,
    );
    throw new Error("something went wrong");
  }
};

// decrease peers count - [webrtc] -> [handleWebRTC] -> [disconnecting]
export const decreasePeersCount = async (
  sessionId: SessionID,
): Promise<void> => {
  assertValidStrings([sessionId], "decreasePeersCount");

  try {
    const isSessionExist = redisKeyExists(sessionId);
    if (!isSessionExist) {
      logRedis("error", "decreasePeersCount", "SESSION NOT FOUND", sessionId);
      throw new Error("Session does not exist");
    }

    const count = await redisClient.hGet(sessionId, "connectedPeers");
    const currentCount = count ? Number(count) : 0;

    if (currentCount < 0) return;

    await redisClient
      .multi()
      .hSet(sessionId, "lastActivity", Date.now().toString())
      .hIncrBy(sessionId, "connectedPeers", -1)
      .exec();
    logRedis(
      "success",
      "decreasePeersCount",
      "DECREASING PEER COUNT FOR SESSION",
      sessionId,
    );
  } catch (error) {
    logRedis(
      "error",
      "decreasePeersCount",
      "ERROR WHILE DECREASING PEER COUNT",
      error,
    );
    throw new Error("something went wrong");
  }
};

// get connected peers
export const getConnectedPeers = async (
  sessionId: SessionID,
): Promise<number> => {
  assertValidStrings([sessionId], "getConnectedPeers");

  try {
    const count = await redisClient.hGet(sessionId, "connectedPeers");
    logRedis(
      "success",
      "getConnectedPeers",
      "FETCHED PEER COUNT FOR ",
      sessionId,
    );
    return count ? Number(count) : 0;
  } catch (error) {
    logRedis("error", "getConnectedPeers", "ERROR GETTING PEERS", error);
    throw new Error("something went wrong");
  }
};

// cleanup session - [socket] - index -> [initsocket] -> [disconnect]
export const cleanupOnDisconnect = async (peerId: PeerID): Promise<void> => {
  assertValidStrings([peerId], "cleanupOnDisconnect");

  try {
    const sessionId = await redisClient.get(peerId);
    if (!sessionId) {
      logRedis(
        "error",
        "cleanupOnDisconnect",
        "SESSION_ID NOT FOUND",
        sessionId,
      );
      throw new Error("sessionId invalid");
    }

    // check who created the session
    const createdBy = await redisClient.hGet(sessionId, "createdBy");
    if (!createdBy) {
      logRedis("error", "cleanupOnDisconnect", "PEER DOES NOT HAVE SESSION", {
        PEER: peerId,
        SESSION: sessionId,
      });
    }

    const pipeline = redisClient.multi();

    // delete session
    if (createdBy === peerId) pipeline.del(sessionId);

    // delete peer mapping
    pipeline.del(peerId);

    await pipeline.exec();

    logRedis(
      "success",
      "cleanupOnDisconnect",
      "CLOSED ALL SESSIONS FOR PEER",
      peerId,
    );
  } catch (error) {
    logRedis(
      "error",
      "cleanupOnDisconnect",
      "ERROR WHILE CLEANING ON DISCONNECT FOR",
      { PEER: peerId, error },
    );
    throw new Error("something went wrong");
  }
};

// delete session
export const deleteSession = async (sessionId: SessionID): Promise<void> => {
  assertValidStrings([sessionId], "deleteSession");

  try {
    await redisClient.hIncrBy(sessionId, "createdSessions", -1);
    await redisClient.del(sessionId);
    logRedis("success", "deleteSession", "SESSION DELETED", sessionId);
  } catch (error) {
    logRedis("error", "deleteSession", "ERROR WHILE DELETING SESSION", error);
    throw new Error("something went wrong");
  }
};
