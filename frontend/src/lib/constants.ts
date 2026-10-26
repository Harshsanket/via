const MB = 1024 * 1024
const GB = 1024 * MB

/** Mirrors the backend's MAX_FILE_SIZE. */
export const MAX_FILE_SIZE = 50 * GB

/** Safe ceiling when the browser cannot stream to disk (no OPFS). */
export const MEMORY_FALLBACK_MAX_FILE_SIZE = 512 * MB

export const CHUNK_SIZE = 64 * 1024
export const BUFFER_HIGH_THRESHOLD = 4 * MB
export const BUFFER_LOW_THRESHOLD = 1 * MB

export const TTL_WARNING_SECONDS = 60

export const MAX_SESSION_ID_LENGTH = 128
export const MAX_FILE_NAME_LENGTH = 180

export const DEFAULT_STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]
