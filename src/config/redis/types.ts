export type SessionID = string;
export type PeerID = string;
export type SocketId = string;
export type MaxAllowedPeers = string | null | number;
export type CurrentPeers = string | null | number;
export type CheckSession = boolean;
export type SessionData = { [key: string]: string };
export type Level = "error" | "success";

export enum SessionStatus {
  WAITING = "waiting",
  TRANSFERRING = "transferring",
  COMPLETED = "completed",
  ERROR = "error",
}

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

export interface SessionParams {
  sessionId: SessionID;
  peerId: PeerID;
}

export interface FileMetaData {
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface TTLMeta {
  exists: boolean;
  createdAt: string | null;
  ttl: number | null;
}
