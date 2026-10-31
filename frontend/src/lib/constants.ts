const MB = 1024 * 1024

const parsePositiveInt = (value: unknown, fallback: number): number => {
  const parsed = Number.parseInt(typeof value === 'string' ? value : '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** How many times a broken transfer is retried before giving up. */
export const MAX_RECOVERY_ATTEMPTS = parsePositiveInt(
  import.meta.env.VITE_MAX_RECOVERY_ATTEMPTS,
  2,
)

export const CHUNK_SIZE = 64 * 1024
export const BUFFER_HIGH_THRESHOLD = 4 * MB
export const BUFFER_LOW_THRESHOLD = 1 * MB

export const TTL_WARNING_SECONDS = 60

/** Shown when ICE cannot establish a path after the automatic retries. */
export const DIRECT_CONNECTION_ERROR =
  'Could not connect directly to the other device. Make sure both devices are on the same Wi-Fi (not a guest network), with client/AP isolation off and any VPN disabled.'

export const MAX_SESSION_ID_LENGTH = 128
export const MIN_SHORT_CODE_LENGTH = 4
export const MAX_SHORT_CODE_LENGTH = 6
export const MAX_FILE_NAME_LENGTH = 180

export const DEFAULT_STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]
