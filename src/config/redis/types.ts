export enum SessionStatus {
  WAITING = "waiting",
  TRANSFERRING = "transferring",
  COMPLETED = "completed",
  ERROR = "error",
}

export type sessionId = string;
export type PeerID = string;
export type SocketId = string;
export type MaxAllowedPeers = string | null | number;
export type CurrentPeers = string | null | number;
export type CheckSession = boolean;

export interface RedisSession extends Record<string, string> {
  createdBy: string;
  maxAllowedPeers: string;
  status: SessionStatus;
  connectedPeers: string;
  createdAt: string;
  lastActivity: string;
}
