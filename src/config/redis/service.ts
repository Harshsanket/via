import { redisClient } from "./index.js";
import { logger } from "../../utils/logger.js";
import {SessionStatus} from "./types.js"
import { SESSION_TTL } from "./constants.js";

// create session
export const createSession = async (
  sessionID: string,
  peer: string,
): Promise<void> => {
  const SESSION_KEY: string = sessionID;
  const PEER_KEY: string = peer;

  await redisClient.hSet(SESSION_KEY, {
    createdBy: PEER_KEY,
    maxAllowedPeers: "2",
    status: SessionStatus.WAITING,
    connectedPeers: "0",
    createdAt: Date.now().toString(),
    lastActivity: Date.now().toString(),
  });

  // map peer to session
  await redisClient.set(PEER_KEY, SESSION_KEY, { EX: SESSION_TTL });
  // session expiry
  await redisClient.expire(SESSION_KEY, SESSION_TTL);
};

// check session
export const isSessionExist = async (sessionID: string): Promise<boolean> => {
  return (await redisClient.exists(sessionID)) === 1;
};

// get session
export const getSocketSession = async (
  socketId: string,
): Promise<string | null> => {
  return await redisClient.get(socketId);
};

// refresh ttl
export const refreshSession = async (sessionId: string): Promise<void> => {
  await redisClient.expire(sessionId, 60 * 30);
};

// delete session
export const deleteSession = async (sessionId: string): Promise<void> => {
  await redisClient.del(sessionId);
};

// cleanup session
export const cleanupOnDisconnect = async (peerId: string): Promise<void> => {
  const PEER_KEY = peerId;

  // find session
  const sessionID = await redisClient.get(PEER_KEY);
  if (!sessionID) return;

  // check who created the session
  const createdBy = await redisClient.hGet(sessionID, "createdBy");

  // delete session
  if (createdBy === peerId) await redisClient.del(sessionID);

  // delete peer mapping
  await redisClient.del(PEER_KEY);

  logger.warn(`[SOCKET] :: CLOSED ALL SESSIONS for peer :: ${PEER_KEY}`);
};
