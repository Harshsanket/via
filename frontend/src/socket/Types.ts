// ─── Session ─────────────────────────────────────────────────────────────────

export interface CreateSessionResponse {
  success: boolean
  sessionId?: string
  message?: string
}

export interface JoinSessionResponse {
  success: boolean
  message?: string
  metadata?: FileMetadata | null
}

// ─── File Metadata ────────────────────────────────────────────────────────────

export interface FileMetadata {
  fileName: string
  mimeType: string
  fileSize: number
}

/** Shape emitted by the backend on "file-metadata". */
export interface FileMetadataEvent {
  sessionId?: string
  success: boolean
  metadata: FileMetadata | null
}

// ─── Session TTL ──────────────────────────────────────────────────────────────

/** Emitted by the backend on "session:ttl". */
export interface SessionTTL {
  exists: boolean
  createdAt: string | null
  ttl: number | null
}

/** Pushed by the backend shortly before a session expires. */
export interface SessionExpiringEvent {
  sessionId: string
  secondsRemaining: number
}

/** Pushed by the backend when a session has expired. */
export interface SessionExpiredEvent {
  sessionId: string
}

// ─── Session Error ────────────────────────────────────────────────────────────

/** Emitted by the backend on "session:error" for handler failures without an ack. */
export interface SessionErrorEvent {
  success: false
  message: string
}

// ─── WebRTC Signaling ─────────────────────────────────────────────────────────

export interface OfferEvent {
  offer: RTCSessionDescriptionInit
}

export interface AnswerEvent {
  answer: RTCSessionDescriptionInit
}

export interface IceCandidateEvent {
  candidate: RTCIceCandidateInit | null
}

// ─── Transfer ────────────────────────────────────────────────────────────────

/** Emitted by the backend on "transfer-complete" to the other peer. */
export interface TransferCompleteEvent {
  success: true
  fileName: string
}

/** Emitted by the backend on "transfer-error" to the other peer. */
export interface TransferErrorEvent {
  success: true
}

// ─── Generic Error ────────────────────────────────────────────────────────────

export interface ErrorEvent {
  message: string
}

// ─── Logging (UI only) ───────────────────────────────────────────────────────

export type LogStatus = 'error' | 'success' | 'connecting' | 'info'

export interface LogEntry {
  id: string
  message: string
  status: LogStatus
  timestamp: number
}
