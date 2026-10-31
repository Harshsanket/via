/**
 * Runtime checks for everything the signaling server sends.
 *
 * The TypeScript types in socket/Types.ts describe what a well-behaved server
 * sends, but nothing enforced them: a compromised or buggy server could hand
 * the UI any shape. Each parser returns a clean copy, or null to drop the
 * event, the same way transfer-protocol.ts treats frames from the peer.
 */
import type {
  AnswerEvent,
  FileMetadata,
  FileMetadataEvent,
  IceCandidateEvent,
  JoinSessionResponse,
  CreateSessionResponse,
  ResolveSessionResponse,
  OfferEvent,
  SessionErrorEvent,
  SessionExpiredEvent,
  SessionExpiringEvent,
  SessionTTL,
  TransferCompleteEvent,
  TransferErrorEvent,
} from '../socket/Types'
import { isValidShortCode } from './validation'

const MAX_NAME_LENGTH = 2048
const MAX_MIME_LENGTH = 255
const MAX_SDP_LENGTH = 64 * 1024
const MAX_CANDIDATE_LENGTH = 1024
const MAX_MESSAGE_LENGTH = 300
const MAX_ID_LENGTH = 128
const SDP_TYPES = new Set(['offer', 'answer', 'pranswer', 'rollback'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isBoundedString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max

const optionalBounded = (value: unknown, max: number): boolean =>
  value === undefined || value === null || isBoundedString(value, max)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const truncate = (value: string): string =>
  value.length > MAX_MESSAGE_LENGTH ? `${value.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : value

const parseMetadata = (value: unknown): FileMetadata | null | undefined => {
  if (value === null || value === undefined) return null
  if (
    !isRecord(value) ||
    !isBoundedString(value.fileName, MAX_NAME_LENGTH) ||
    value.fileName.length === 0 ||
    !isBoundedString(value.mimeType, MAX_MIME_LENGTH) ||
    !Number.isSafeInteger(value.fileSize) ||
    (value.fileSize as number) <= 0
  ) {
    return undefined
  }
  return {
    fileName: value.fileName,
    mimeType: value.mimeType,
    fileSize: value.fileSize as number,
  }
}

export function parseFileMetadataEvent(value: unknown): FileMetadataEvent | null {
  if (!isRecord(value) || typeof value.success !== 'boolean') return null
  if (!optionalBounded(value.sessionId, MAX_ID_LENGTH)) return null
  const metadata = parseMetadata(value.metadata)
  if (metadata === undefined) return null
  return {
    ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
    success: value.success,
    metadata,
  }
}

export function parseJoinSessionResponse(value: unknown): JoinSessionResponse | null {
  if (!isRecord(value) || typeof value.success !== 'boolean') return null
  const metadata = parseMetadata(value.metadata)
  if (metadata === undefined) return null
  return {
    success: value.success,
    ...(typeof value.message === 'string' ? { message: truncate(value.message) } : {}),
    ...(value.metadata !== undefined ? { metadata } : {}),
  }
}

export function parseCreateSessionResponse(value: unknown): CreateSessionResponse | null {
  if (!isRecord(value) || typeof value.success !== 'boolean') return null
  if (!optionalBounded(value.sessionId, MAX_ID_LENGTH)) return null
  if (
    value.shortCode !== undefined &&
    (typeof value.shortCode !== 'string' || !isValidShortCode(value.shortCode))
  ) {
    return null
  }
  return {
    success: value.success,
    ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
    ...(typeof value.shortCode === 'string' ? { shortCode: value.shortCode } : {}),
    ...(typeof value.message === 'string' ? { message: truncate(value.message) } : {}),
  }
}

export function parseResolveSessionResponse(value: unknown): ResolveSessionResponse | null {
  if (!isRecord(value) || typeof value.success !== 'boolean') return null
  if (!optionalBounded(value.sessionId, MAX_ID_LENGTH)) return null
  return {
    success: value.success,
    ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
    ...(typeof value.message === 'string' ? { message: truncate(value.message) } : {}),
  }
}

const parseDescription = (value: unknown): RTCSessionDescriptionInit | null => {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    !SDP_TYPES.has(value.type) ||
    !isBoundedString(value.sdp, MAX_SDP_LENGTH)
  ) {
    return null
  }
  return { type: value.type as RTCSdpType, sdp: value.sdp }
}

export function parseDescriptionEvent(value: unknown, key: 'offer'): OfferEvent | null
export function parseDescriptionEvent(value: unknown, key: 'answer'): AnswerEvent | null
export function parseDescriptionEvent(
  value: unknown,
  key: 'offer' | 'answer',
): OfferEvent | AnswerEvent | null {
  if (!isRecord(value)) return null
  const description = parseDescription(value[key])
  if (!description) return null
  return key === 'offer' ? { offer: description } : { answer: description }
}

export function parseIceCandidateEvent(value: unknown): IceCandidateEvent | null {
  if (!isRecord(value)) return null
  const candidate = value.candidate
  if (candidate === null) return { candidate: null }
  if (
    !isRecord(candidate) ||
    !optionalBounded(candidate.candidate, MAX_CANDIDATE_LENGTH) ||
    !optionalBounded(candidate.sdpMid, 64) ||
    !optionalBounded(candidate.usernameFragment, 256) ||
    !(
      candidate.sdpMLineIndex === undefined ||
      candidate.sdpMLineIndex === null ||
      (Number.isInteger(candidate.sdpMLineIndex) &&
        (candidate.sdpMLineIndex as number) >= 0 &&
        (candidate.sdpMLineIndex as number) < 1024)
    )
  ) {
    return null
  }
  return {
    candidate: {
      ...(typeof candidate.candidate === 'string' ? { candidate: candidate.candidate } : {}),
      ...(candidate.sdpMid !== undefined ? { sdpMid: candidate.sdpMid as string | null } : {}),
      ...(candidate.sdpMLineIndex !== undefined
        ? { sdpMLineIndex: candidate.sdpMLineIndex as number | null }
        : {}),
      ...(candidate.usernameFragment !== undefined
        ? { usernameFragment: candidate.usernameFragment as string | null }
        : {}),
    },
  }
}

export function parseSessionTtl(value: unknown): SessionTTL | null {
  if (
    !isRecord(value) ||
    typeof value.exists !== 'boolean' ||
    !(value.createdAt === null || isBoundedString(value.createdAt, 32)) ||
    !(value.ttl === null || isFiniteNumber(value.ttl))
  ) {
    return null
  }
  return {
    exists: value.exists,
    createdAt: value.createdAt as string | null,
    ttl: value.ttl as number | null,
  }
}

export function parseSessionExpiringEvent(value: unknown): SessionExpiringEvent | null {
  if (
    !isRecord(value) ||
    !isBoundedString(value.sessionId, MAX_ID_LENGTH) ||
    !isFiniteNumber(value.secondsRemaining) ||
    value.secondsRemaining < 0
  ) {
    return null
  }
  return { sessionId: value.sessionId, secondsRemaining: value.secondsRemaining }
}

export function parseSessionExpiredEvent(value: unknown): SessionExpiredEvent | null {
  if (!isRecord(value) || !isBoundedString(value.sessionId, MAX_ID_LENGTH)) return null
  return { sessionId: value.sessionId }
}

export function parseSessionErrorEvent(value: unknown): SessionErrorEvent | null {
  if (!isRecord(value) || typeof value.message !== 'string') return null
  return { success: false, message: truncate(value.message) }
}

export function parseTransferCompleteEvent(value: unknown): TransferCompleteEvent | null {
  if (!isRecord(value) || !isBoundedString(value.fileName, MAX_NAME_LENGTH)) return null
  return { success: true, fileName: value.fileName }
}

export function parseTransferErrorEvent(value: unknown): TransferErrorEvent | null {
  return isRecord(value) ? { success: true } : null
}
