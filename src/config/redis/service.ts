import { redisClient } from "./index.js";
import { logger } from "../../utils/logger.js";

import {
  SessionStatus,
  SessionID,
  PeerID,
  RedisSession,
  MaxAllowedPeers,
  CurrentPeers,
  CheckSession,
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
    logger.error(`[REDIS] :: ERROR WHILE STORING SESSION :: ${error}`);
  }
};

// check session
export const isSessionExist = async (
  sessionID: SessionID,
): Promise<boolean> => {
  if (!sessionID) {
    logger.error(`[REDIS] :: ERROR NO SESSION ID :: isSessionExist`);
    return false;
  }
  return (await redisClient.exists(sessionID)) === 1;
};

// join session
export const joinSession = async (sessionID: SessionID): Promise<boolean> => {
  // check session id
  if (!sessionID) {
    logger.error(`[REDIS] :: ERROR NO SESSION ID :: JOIN SESSION`);
    return false;
  }
  try {
    // check session
    let checkSession: CheckSession =
      (await redisClient.exists(sessionID)) === 1;
    if (!checkSession) return false;

    // get max allowed peers
    let maxAllowedPeers: MaxAllowedPeers = await redisClient.hGet(
      sessionID,
      "maxAllowedPeers",
    );
    if (!maxAllowedPeers) return false;
    maxAllowedPeers = Number(maxAllowedPeers);

    // get current peers
    let currentPeers: CurrentPeers = await redisClient.hGet(
      sessionID,
      "connectedPeers",
    );
    if (!currentPeers) return false;
    currentPeers = Number(currentPeers);

    if (currentPeers < maxAllowedPeers) {
      await redisClient.hIncrBy(sessionID, "connectedPeers", 1);
    }

    return true;
  } catch (error) {
    logger.error(`[REDIS] :: ERROR JOINING SESSION :: ${error}`);
    return false;
  }
};

// decrease peers count
export const decreasePeersCount = async (
  sessionID: SessionID,
): Promise<boolean> => {
  if (!sessionID) {
    logger.error(`[REDIS] :: ERROR NO SESSION ID :: JOIN SESSION`);
    return false;
  }

  try {
    // check session
    let checkSession: CheckSession =
      (await redisClient.exists(sessionID)) === 1;
    if (!checkSession) return false;

    await redisClient.hIncrBy(sessionID, "connectedPeers", -1);
    return true;
  } catch (error) {
    logger.error(`[REDIS] :: ERROR DECREASING PEER COUNT :: ${error}`);
    return false;
  }
};

// get connected peers
export const getConnectedPeers = async (
  sessionID: string,
): Promise<number | null> => {
  try {
    const count = await redisClient.hGet(sessionID, "connectedPeers");

    return count ? Number(count) : 0;
  } catch (error) {
    logger.error(`[REDIS] :: ERROR GETTING ROOM SIZE :: ${error}`);
    return null;
  }
};

// refresh ttl
export const refreshSessionTTL = async (
  sessionId: SessionID,
): Promise<void> => {
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

// change transfer status
export const changeTransferStatus = async (
  sessionID: SessionID,
  status: SessionStatus,
): Promise<void> => {
  try {
    await redisClient.hSet(sessionID, "status", status.toLowerCase());
  } catch (error) {
    logger.error(`[REDIS] :: ERROR UPDATING TRANSFER STATUS :: ${error}`);
    throw error;
  }
};

// delete session
export const deleteSession = async (sessionId: SessionID): Promise<void> => {
  if (!sessionId) {
    logger.error(`[REDIS] :: ERROR GETTING SESSION`);
    return;
  }

  try {
    await redisClient.hIncrBy(sessionId, "createdSessions", -1);
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
