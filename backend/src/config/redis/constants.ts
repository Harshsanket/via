import { PeerID, RedisSession, SessionStatus } from "./types.js";

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
  // Opaque, per-tab value the receiver keeps across a reload. It lets a
  // refreshed page prove it is the same receiver instead of a third peer.
  receiverToken: "receiverToken",
  maxAllowedPeers: "maxAllowedPeers",
  fileName: "fileName",
  mimeType: "mimeType",
  fileSize: "fileSize",
  status: "status",
  createdAt: "createdAt",
  lastActivity: "lastActivity",
  // Four-digit alias the sender shares instead of the UUID path. It is not a
  // secret; the link key stays in the URL fragment.
  shortCode: "shortCode",
} as const;

/**
 * Key prefixes in one place: the Lua scripts build peer keys at runtime from
 * these values, so a prefix change cannot silently desynchronise them.
 */
export const KEY_PREFIXES = {
  session: "session:",
  peer: "peer:",
  peerSessions: "peer-sessions:",
  short: "short:",
} as const;

/** Sorted set of active codes, scored by expiry, used to detect a full space. */
export const SHORT_CODE_ACTIVE_KEY = "short:active";

export const sessionStorageKey = (sessionId: string): string =>
  `${KEY_PREFIXES.session}${sessionId}`;
export const peerStorageKey = (peerId: string): string =>
  `${KEY_PREFIXES.peer}${peerId}`;
export const peerSessionCountKey = (peerId: string): string =>
  `${KEY_PREFIXES.peerSessions}${peerId}`;
export const shortCodeStorageKey = (shortCode: string): string =>
  `${KEY_PREFIXES.short}${shortCode}`;

export const createSessionObject = (
  peerId: PeerID,
  shortCode: string,
): RedisSession => {
  const now = Date.now().toString();

  return {
    createdBy: peerId,
    shortCode,
    connectedPeer: NO_PEER,
    connectedPeers: "0",
    receiverToken: "",
    maxAllowedPeers: "1",
    fileName: NO_FILE_SELECTED,
    mimeType: NO_FILE_SELECTED,
    fileSize: NO_FILE_SELECTED,
    status: SessionStatus.WAITING,
    createdAt: now,
    lastActivity: now,
  };
};
