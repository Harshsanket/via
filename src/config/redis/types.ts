export enum SessionStatus {
  WAITING = "waiting",
  TRANSFERRING = "transferring",
  COMPLETED = "completed",
}

export type SessionID = string;
export type PeerID = string;
export type SocketId = string;

export interface RedisSession extends Record<string, string> {
  createdBy: string;
  maxAllowedPeers: string;
  status: SessionStatus;
  connectedPeers: string;
  createdAt: string;
  lastActivity: string;
}
