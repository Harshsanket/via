import { PeerID, RedisSession, SessionStatus } from "./types.js";

export const SESSION_TTL: number = 60 * 10;
export const REFRESH_SESSION_TTL: number = 60 * 30;
export const NO_SESSION: string = "NOT_IN_SESSION";
export const createSessionObject = (peerId: PeerID): RedisSession => {
  const now = Date.now().toString();

  return {
    createdBy: peerId,
    connectedPeer: "NO_PEER",
    maxAllowedPeers: "1",
    fileName: "NOT_SELECTED",
    mimeType: "NOT_SELECTED",
    fileSize: "NOT_SELECTED",
    status: SessionStatus.WAITING,
    createdAt: now,
    lastActivity: now,
  };
};
