import { redisClient } from "./index.js";
import { logger } from "../../utils/logger.js";

import {
  SessionStatus,
  SessionId,
  PeerID,
  RedisSession,
  MaxAllowedPeers,
  CurrentPeers,
  CheckSession,
  CheckPeer,
} from "./types.js";
import { SESSION_TTL, REFRESH_SESSION_TTL } from "./constants.js";

// register peer
export const registerPeer = async (peerKey: string) => {
  if (!peerKey) {
    logger.error(`[SOCKET] :: [ERROR] :: PEER KEY NOT FOUND :: ${peerKey}`);
    throw new Error("peerKey required");
  }

  try {
    await redisClient.set(peerKey, "NO_SESSION", {
      EX: SESSION_TTL,
    });
    logger.info(`[SOCKET] :: [CONNECTED] peer :: ${peerKey}`);
  } catch (error) {
    throw error;
  }
};

// create session - [socket] session.ts -> [handleSessions] -> [create-session]
export const createSession = async (
  sessionId: SessionId,
  peer: PeerID,
): Promise<void> => {
  const SESSION_KEY: SessionId = sessionId;
  const PEER_KEY: PeerID = peer;

  // [BUG] here it is an resurrection for ttl in [refreshSessionTTL]
  const session: RedisSession = {
    createdBy: PEER_KEY,
    connectedPeer: "NO_PEER",
    maxAllowedPeers: "1",
    fileName: "NOT_SELECTED",
    mimeType: "NOT_SELECTED",
    fileSize: "NOT_SELECTED",
    status: SessionStatus.WAITING,
    createdAt: Date.now().toString(),
    lastActivity: Date.now().toString(),
  };

  try {
    let checkPeer: CheckPeer = await redisClient.get(PEER_KEY);

    if (checkPeer === null) {
      logger.error(`[REDIS] :: [createSession] :: PEER NOT FOUND`);
      throw new Error("Peer not found or expired");
    }

    if (checkPeer !== "NO_SESSION") {
      logger.error(`[REDIS] :: [createSession] :: PEER ALREADY IN SESSION`);
      throw new Error("Peer already in session");
    }

    // set redis client
    await redisClient.hSet(SESSION_KEY, session);
    // map peer to session
    await redisClient.set(PEER_KEY, SESSION_KEY, { EX: SESSION_TTL });
    // session expiry
    await redisClient.expire(SESSION_KEY, SESSION_TTL);
  } catch (error) {
    logger.error(
      `[REDIS] :: [createSession] :: ERROR WHILE STORING SESSION :: ${error}`,
    );
    throw error;
  }
};

// join session - [socket] session.ts -> [handleSessions] -> [join-session]
export const joinSession = async (
  sessionId: SessionId,
  peerId: PeerID,
): Promise<void> => {
  // check session id
  if (!sessionId) {
    logger.error(
      `[REDIS] :: [joinSession] :: [sessionId] :: SESSION ID INVALID`,
    );
    throw new Error("SessionId invalid");
  }

  try {
    // check session
    let checkSession: CheckSession =
      (await redisClient.exists(sessionId)) === 1;
    if (!checkSession) {
      logger.error(
        `[REDIS] :: [joinSession] :: [checkSession] :: SESSION NOT FOUND`,
      );
      throw new Error("Session does not exist");
    }

    // get max allowed peers
    let maxAllowedPeers: MaxAllowedPeers = await redisClient.hGet(
      sessionId,
      "maxAllowedPeers",
    );
    if (!maxAllowedPeers) {
      logger.error(
        `[REDIS] :: [joinSession] :: [maxAllowedPeers] :: MAX ALLOWED NOT FOUND`,
      );
      throw new Error("Max allowed peer does not exist");
    }
    maxAllowedPeers = Number(maxAllowedPeers);

    // get current peers
    let currentPeers: CurrentPeers = await redisClient.hGet(
      sessionId,
      "connectedPeer",
    );
    if (currentPeers !== 'NO_PEER') {
      logger.warn(
        `[REDIS] :: [joinSession] :: Session full`,
      );
      throw new Error("Session limit reached");
    }

    await redisClient
      .multi()
      .hSet(sessionId, "connectedPeer", peerId)
      .hSet(sessionId, "lastActivity", Date.now().toString())
      .exec();
  } catch (error: any) {
    logger.error(`[REDIS] :: ERROR JOINING SESSION :: ${error}`);
    console.error(error.replies);
    throw error;
  }
};

// refresh ttl - [socket] session.ts -> [handleSessions] -> [join-session]
export const refreshSessionTTL = async (
  sessionId: SessionId,
): Promise<void> => {
  if (!sessionId) {
    logger.error(
      `[REDIS] :: [refreshSessionTTL] :: [sessionId] :: SESSION ID INVALID`,
    );
    throw new Error("SessionId invalid");
  }

  const now = Date.now() + Number(SESSION_TTL);

  // [BUG] session will keep refreshing ttl if users keep leaving and joining to extend session life
  try {
    const [createdBy, createdAt, connectedPeer] = await redisClient.hmGet(
      sessionId,
      ["createdBy", "createdAt", "connectedPeer"],
    );
    if (!createdBy || !createdAt || !connectedPeer) {
      logger.warn(
        `[REDIS] :: SESSION :: ${sessionId} has no createdBy or createdAt`,
      );
      throw new Error("sessionId not found");
    }

    if (now > Number(createdAt)) return;

    await redisClient
      .multi()
      .hSet(sessionId, "lastActivity", Date.now().toString())
      .expire(sessionId, REFRESH_SESSION_TTL)
      .expire(connectedPeer, REFRESH_SESSION_TTL)
      .expire(createdBy, REFRESH_SESSION_TTL)
      .exec();
  } catch (error) {
    logger.error(`[REDIS] :: ERROR WHILE REFRESHING SESSION :: ${error}`);
    throw error;
  }
};

// check session - [webrtc] -> [handleWebRTC] -> [offer] [answer] [ice-candidate]
export const isSessionExist = async (
  sessionId: SessionId,
): Promise<boolean> => {
  if (!sessionId) {
    logger.error(
      `[REDIS] :: [isSessionExist] :: [sessionId] ${sessionId} :: SESSION ID INVALID`,
    );
    
  }
  return (await redisClient.exists(sessionId)) === 1;
};

// store file metadata - [webrtc] -> [handleWebRTC] -> [file-metadata]
export const storeFileMetadata = async (
  sessionId: SessionId,
  {
    fileName,
    mimeType,
    fileSize,
  }: {
    fileName: string;
    mimeType: string;
    fileSize: number;
  }
) => {
  if (!sessionId) {
    logger.error(
      `[REDIS] :: [storeFileMetadata] :: [sessionId] :: SESSION ID INVALID`
    );
    throw new Error("SessionId invalid");
  }
  if (
    !fileName ||
    !mimeType ||
    typeof fileSize !== "number" ||
    fileSize <= 0
  ) {
    logger.error(
      `[REDIS] :: [storeFileMetadata] :: INVALID METADATA for session ${sessionId}`
    );
    throw new Error("Invalid file metadata");
  }

  try {
    await redisClient
      .multi()
      .hSet(sessionId, "fileName", fileName)
      .hSet(sessionId, "mimeType", mimeType)
      .hSet(sessionId, "fileSize", fileSize.toString())
      .exec();

    logger.info(
      `[REDIS] :: [storeFileMetadata] :: Stored metadata for session ${sessionId}`
    );
  } catch (error) {
    logger.error(
      `[REDIS] :: [storeFileMetadata] :: ERROR STORING METADATA :: ${error}`
    );
    throw error;
  }
};

// change transfer status - [webrtc] -> [handleWebRTC] -> [transfer-complete] [transfer-error]
export const changeTransferStatus = async (
  sessionId: SessionId,
  status: SessionStatus,
): Promise<void> => {
  if (!sessionId) {
    logger.error(
      `[REDIS] :: [changeTransferStatus] :: [sessionId] :: SESSION ID INVALID`,
    );
    throw new Error("SessionId invalid");
  }

  try {
    await redisClient
      .multi()
      .hSet(sessionId, "lastActivity", Date.now().toString())
      .hSet(sessionId, "status", status.toLowerCase())
      .exec();
  } catch (error) {
    logger.error(`[REDIS] :: ERROR UPDATING TRANSFER STATUS :: ${error}`);
    throw error;
  }
};

// decrease peers count - [webrtc] -> [handleWebRTC] -> [disconnecting]
export const decreasePeersCount = async (
  sessionId: SessionId,
): Promise<void> => {
  if (!sessionId) {
    logger.error(
      `[REDIS] :: [decreasePeersCount] :: [sessionId] :: SESSION ID INVALID`,
    );
    throw new Error("SessionId invalid");
  }

  try {
    // check session
    let checkSession: CheckSession =
      (await redisClient.exists(sessionId)) === 1;
    if (!checkSession) {
      logger.error(
        `[REDIS] :: [decreasePeersCount] :: [checkSession] :: SESSION NOT FOUND`,
      );
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
    logger.info(`[REDIS] :: DECREASING PEER COUNT for session :: ${sessionId}`);
  } catch (error) {
    logger.error(`[REDIS] :: ERROR DECREASING PEER COUNT :: ${error}`);
    throw error;
  }
};

// cleanup session - [socket] - index -> [initsocket] -> [disconnect]
export const cleanupOnDisconnect = async (peerId: PeerID): Promise<void> => {
  if (!peerId) {
    logger.error(
      `[REDIS] :: [cleanupOnDisconnect] :: [peerId] :: PEER ID INVALID`,
    );
    throw new Error("PeerId invalid");
  }

  try {
    // find session
    const sessionId = await redisClient.get(peerId);
    if (!sessionId) {
      logger.error(
        `[REDIS] :: [cleanupOnDisconnect] :: [sessionId] :: SESSION ID INVALID`,
      );
      throw new Error("SessionId invalid");
    }

    // check who created the session
    const createdBy = await redisClient.hGet(sessionId, "createdBy");
    if (!createdBy) {
      logger.error(`[REDIS] :: PEER ${sessionId} :: DOES NOT HAVE SESSION`);
    }

    const pipeline = redisClient.multi();

    // delete session
    if (createdBy === peerId) pipeline.del(sessionId)

    // delete peer mapping
    pipeline.del(peerId);

    await pipeline.exec();

    logger.warn(`[SOCKET] :: CLOSED ALL SESSIONS for peer :: ${peerId}`);
  } catch (error) {
    logger.error(
      `[REDIS] :: ERROR WHILE CLEANING ON DISCONNECT FOR PEER ${peerId} :: ${error}`,
    );
    throw error;
  }
};

// get connected peers
export const getConnectedPeers = async (sessionId: SessionId): Promise<number> => {
  if (!sessionId) {
    logger.error(
      `[REDIS] :: [getConnectedPeers] :: [sessionId] :: SESSION ID INVALID`,
    );
    throw new Error("SessionId invalid");
  }

  try {
    const count = await redisClient.hGet(sessionId, "connectedPeers");
    return count ? Number(count) : 0;
  } catch (error) {
    logger.error(`[REDIS] :: ERROR GETTING ROOM SIZE :: ${error}`);
    throw error;
  }
};

// delete session
export const deleteSession = async (sessionId: SessionId): Promise<void> => {
  if (!sessionId) {
    logger.error(
      `[REDIS] :: [deleteSession] :: [sessionId] :: SESSION ID INVALID`,
    );
    throw new Error("SessionId invalid");
  }

  try {
    await redisClient.hIncrBy(sessionId, "createdSessions", -1);
    await redisClient.del(sessionId);
  } catch (error) {
    logger.error(`[REDIS] :: ERROR WHILE DELETING SESSION :: ${error}`);
    throw error;
  }
};
