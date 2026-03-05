export enum SessionStatus {
  WAITING = "waiting",
  TRANSFERRING = "transferring",
  COMPLETED = "completed",
  ERROR = "error",
}

export type SessionId = string;
export type PeerID = string;
export type SocketId = string;
export type MaxAllowedPeers = string | null | number;
export type CurrentPeers = string | null | number;
export type CheckSession = boolean;
export type CheckPeer = string | null;

export interface RedisSession extends Record<string, string> {
  createdBy: string;
  maxAllowedPeers: string;
  fileName: string;
  mimeType: string;
  fileSize: string;
  status: SessionStatus;
  connectedPeer: string;
  createdAt: string;
  lastActivity: string;
}
