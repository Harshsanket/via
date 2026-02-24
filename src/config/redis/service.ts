import { redisClient } from "./index.js";
import { logger } from "../../utils/logger.js";

import {
  SessionStatus,
  sessionId,
  PeerID,
  RedisSession,
  MaxAllowedPeers,
  CurrentPeers,
  CheckSession,
} from "./types.js";
import { SESSION_TTL, REFRESH_SESSION_TTL } from "./constants.js";

// create session - [socket] session.ts -> [handleSessions] -> [create-session]
export const createSession = async (
  sessionId: sessionId,
  peer: PeerID,
): Promise<void> => {
  const SESSION_KEY: sessionId = sessionId;
  const PEER_KEY: PeerID = peer;

  const session: RedisSession = {
    createdBy: PEER_KEY,
    connectedPeers: "0",
    maxAllowedPeers: "2",
    status: SessionStatus.WAITING,
    createdAt: Date.now().toString(),
    lastActivity: Date.now().toString(),
  };

  try {
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
export const joinSession = async (sessionId: sessionId): Promise<void> => {
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
      "connectedPeers",
    );
    if (!currentPeers) {
      logger.error(
        `[REDIS] :: [joinSession] :: [currentPeers] :: CURRENT PEER NOT FOUND`,
      );
      throw new Error("Current peer does not exist");
    }

    currentPeers = Number(currentPeers);

    if (currentPeers < maxAllowedPeers) {
      await redisClient.hIncrBy(sessionId, "connectedPeers", 1);
    }
  } catch (error) {
    logger.error(`[REDIS] :: ERROR JOINING SESSION :: ${error}`);
    throw error;
  }
};

// refresh ttl - [socket] session.ts -> [handleSessions] -> [join-session]
export const refreshSessionTTL = async (
  sessionId: sessionId,
): Promise<void> => {
  if (!sessionId) {
    logger.error(
      `[REDIS] :: [refreshSessionTTL] :: [sessionId] :: SESSION ID INVALID`,
    );
    throw new Error("SessionId invalid");
  }

  try {
    await redisClient.expire(sessionId, REFRESH_SESSION_TTL);
  } catch (error) {
    logger.error(`[REDIS] :: ERROR WHILE REFRESHING SESSION :: ${error}`);
    throw error;
  }
};

// check session - [webrtc] -> [handleWebRTC] -> [offer] [answer] [ice-candidate]
export const isSessionExist = async (
  sessionId: sessionId,
): Promise<boolean> => {
  if (!sessionId) {
    logger.error(
      `[REDIS] :: [isSessionExist] :: [sessionId] :: SESSION ID INVALID`,
    );
    throw new Error("SessionId invalid");
  }
  return (await redisClient.exists(sessionId)) === 1;
};

// change transfer status - [webrtc] -> [handleWebRTC] -> [transfer-complete] [transfer-error]
export const changeTransferStatus = async (
  sessionId: sessionId,
  status: SessionStatus,
): Promise<void> => {
  if (!sessionId) {
    logger.error(
      `[REDIS] :: [changeTransferStatus] :: [sessionId] :: SESSION ID INVALID`,
    );
    throw new Error("SessionId invalid");
  }

  try {
    await redisClient.hSet(sessionId, "status", status.toLowerCase());
  } catch (error) {
    logger.error(`[REDIS] :: ERROR UPDATING TRANSFER STATUS :: ${error}`);
    throw error;
  }
};

// decrease peers count - [webrtc] -> [handleWebRTC] -> [disconnecting]
export const decreasePeersCount = async (
  sessionId: sessionId,
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

    if (currentCount > 0)
      await redisClient.hIncrBy(sessionId, "connectedPeers", -1);

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
      logger.error(`[REDIS] :: ERROR GETTING CREATEDBY`);
      throw new Error("Peer does not exist");
    }

    const pipeline = redisClient.multi();

    // delete session
    if (createdBy === peerId) pipeline.del(sessionId);

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
export const getConnectedPeers = async (sessionId: string): Promise<number> => {
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
export const deleteSession = async (sessionId: sessionId): Promise<void> => {
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
