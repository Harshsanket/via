import { PeerID, RedisSession, SessionStatus } from "./types.js";

export const SESSION_TTL: number = 60 * 10;
export const REFRESH_SESSION_TTL: number = 60 * 30;
export const NO_SESSION: string = "NOT_IN_SESSION";
export const NO_PEER: string = "NO_PEER";
export const NO_FILE_SELECTED: string = "NOT_SELECTED";

/**
 * Single source of truth for Redis hash field names. The peer counter is
 * `connectedPeers` (plural) and holds a number; `connectedPeer` (singular)
 * holds the id of the peer that joined the creator's session.
 */
export const SESSION_FIELDS = {
  createdBy: "createdBy",
  connectedPeer: "connectedPeer",
  connectedPeers: "connectedPeers",
  maxAllowedPeers: "maxAllowedPeers",
  fileName: "fileName",
  mimeType: "mimeType",
  fileSize: "fileSize",
  status: "status",
  createdAt: "createdAt",
  lastActivity: "lastActivity",
} as const;

/**
 * Key prefixes in one place: the Lua scripts build peer keys at runtime from
 * these values, so a prefix change cannot silently desynchronise them.
 */
export const KEY_PREFIXES = {
  session: "session:",
  peer: "peer:",
  peerSessions: "peer-sessions:",
} as const;

export const sessionStorageKey = (sessionId: string): string =>
  `${KEY_PREFIXES.session}${sessionId}`;
export const peerStorageKey = (peerId: string): string =>
  `${KEY_PREFIXES.peer}${peerId}`;
export const peerSessionCountKey = (peerId: string): string =>
  `${KEY_PREFIXES.peerSessions}${peerId}`;

export const createSessionObject = (peerId: PeerID): RedisSession => {
  const now = Date.now().toString();

  return {
    createdBy: peerId,
    connectedPeer: NO_PEER,
    connectedPeers: "0",
    maxAllowedPeers: "1",
    fileName: NO_FILE_SELECTED,
    mimeType: NO_FILE_SELECTED,
    fileSize: NO_FILE_SELECTED,
    status: SessionStatus.WAITING,
    createdAt: now,
    lastActivity: now,
  };
};
