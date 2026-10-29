export type SessionID = string;
export type PeerID = string;
export type Level = "error" | "success" | "warn";

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
  receiverToken: string;
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
