import { redisClient } from "./index.js";
import { logger } from "../../utils/logger.js";

import {
  SessionStatus,
  SessionID,
  PeerID,
  RedisSession,
  SocketId,
} from "./types.js";
import { SESSION_TTL, REFRESH_SESSION_TTL } from "./constants.js";

// create session
export const createSession = async (
  sessionID: SessionID,
  peer: PeerID,
): Promise<void> => {
  const SESSION_KEY: SessionID = sessionID;
  const PEER_KEY: PeerID = peer;

  const session: RedisSession = {
    createdBy: PEER_KEY,
    maxAllowedPeers: "2",
    status: SessionStatus.WAITING,
    connectedPeers: "0",
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
    logger.error(`[REDIS] :: ERROR WHILE CREATING SESSION :: ${error}`);
  }
};

// check session
export const isSessionExist = async (
  sessionID: string | null,
): Promise<boolean> => {
  if (!sessionID) return false;
  return (await redisClient.exists(sessionID)) === 1;
};

// get session
export const getSocketSession = async (
  socketId: SocketId,
): Promise<string | null | void> => {
  if (!socketId) {
    logger.error(`[REDIS] :: ERROR GETTING SESSION`);
    return;
  }

  try {
    return await redisClient.get(socketId);
  } catch (error) {
    logger.error(`[REDIS] :: ERROR WHILE GETTING SESSION :: ${error}`);
  }
};

// refresh ttl
export const refreshSession = async (sessionId: SessionID): Promise<void> => {
  if (!sessionId) {
    logger.error(`[REDIS] :: ERROR GETTING SESSION`);
    return;
  }

  try {
    await redisClient.expire(sessionId, REFRESH_SESSION_TTL);
  } catch (error) {
    logger.error(`[REDIS] :: ERROR WHILE REFRESHING SESSION :: ${error}`);
  }
};

// delete session
export const deleteSession = async (sessionId: SessionID): Promise<void> => {
  if (!sessionId) {
    logger.error(`[REDIS] :: ERROR GETTING SESSION`);
    return;
  }

  try {
    await redisClient.del(sessionId);
  } catch (error) {
    logger.error(`[REDIS] :: ERROR WHILE DELETING SESSION :: ${error}`);
  }
};

// cleanup session
export const cleanupOnDisconnect = async (peerId: PeerID): Promise<void> => {
  const PEER_KEY: PeerID = peerId;
  if (!PEER_KEY) return;

  try {
    // find session
    const sessionID = await redisClient.get(PEER_KEY);
    if (!sessionID) {
      logger.error(`[REDIS] :: ERROR GETTING SESSION`);
      return;
    }

    // check who created the session
    const createdBy = await redisClient.hGet(sessionID, "createdBy");
    if (!createdBy) {
      logger.error(`[REDIS] :: ERROR GETTING CREATEDBY`);
      return;
    }

    // delete session
    if (createdBy === peerId) await redisClient.del(sessionID);

    // delete peer mapping
    await redisClient.del(PEER_KEY);

    logger.warn(`[SOCKET] :: CLOSED ALL SESSIONS for peer :: ${PEER_KEY}`);
  } catch (error) {
    logger.error(`[REDIS] :: ERROR WHILE CLEANING ON DISCONNECT :: ${error}`);
  }
};
