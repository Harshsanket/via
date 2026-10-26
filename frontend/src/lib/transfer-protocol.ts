import { MAX_FILE_SIZE } from './constants'

const MAX_WIRE_FILE_NAME_LENGTH = 255

export interface MetadataFrame {
  type: 'metadata'
  fileName: string
  fileSize: number
  fileType: string
}

export interface CompleteFrame {
  type: 'complete'
  fileSize: number
  crc32: number
}

export interface ResumeFrame {
  type: 'resume'
  receivedBytes: number
  crcState: number
}

export interface ResumeRequestFrame {
  type: 'resume-request'
}

export interface RequestTransferFrame {
  type: 'request-transfer'
}

export interface RetryFrame {
  type: 'retry'
}

/**
 * Proof that the peer holds the link key and sees the same DTLS connection
 * (see lib/peer-auth.ts). Nothing else is accepted until it verifies.
 */
export interface AuthFrame {
  type: 'auth'
  role: 'sender' | 'receiver'
  /** base64url HMAC-SHA256: 32 bytes, 43 characters. */
  tag: string
}

export interface CancelFrame {
  type: 'cancel'
  message?: string
}

export type ControlFrame =
  | MetadataFrame
  | CompleteFrame
  | ResumeFrame
  | ResumeRequestFrame
  | RequestTransferFrame
  | RetryFrame
  | CancelFrame
  | AuthFrame

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isUnsigned32 = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff

const isFileSize = (value: number): boolean =>
  Number.isInteger(value) && value > 0 && value <= MAX_FILE_SIZE

export function parseControlFrame(value: unknown): ControlFrame | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null

  switch (value.type) {
    case 'metadata': {
      if (
        typeof value.fileName !== 'string' ||
        value.fileName.trim().length === 0 ||
        value.fileName.length > MAX_WIRE_FILE_NAME_LENGTH ||
        typeof value.fileType !== 'string' ||
        value.fileType.length > 255 ||
        typeof value.fileSize !== 'number' ||
        !isFileSize(value.fileSize)
      ) {
        return null
      }

      return {
        type: 'metadata',
        fileName: value.fileName,
        fileSize: value.fileSize,
        fileType: value.fileType,
      }
    }

    case 'complete': {
      if (
        typeof value.fileSize !== 'number' ||
        !isFileSize(value.fileSize) ||
        typeof value.crc32 !== 'number' ||
        !isUnsigned32(value.crc32)
      ) {
        return null
      }

      return {
        type: 'complete',
        fileSize: value.fileSize,
        crc32: value.crc32 >>> 0,
      }
    }

    case 'resume': {
      if (
        typeof value.receivedBytes !== 'number' ||
        !Number.isInteger(value.receivedBytes) ||
        value.receivedBytes < 0 ||
        value.receivedBytes > MAX_FILE_SIZE ||
        typeof value.crcState !== 'number' ||
        !isUnsigned32(value.crcState)
      ) {
        return null
      }

      return {
        type: 'resume',
        receivedBytes: value.receivedBytes,
        crcState: value.crcState >>> 0,
      }
    }

    case 'resume-request':
      return { type: 'resume-request' }

    case 'request-transfer':
      return { type: 'request-transfer' }

    case 'retry':
      return { type: 'retry' }

    case 'auth': {
      if (
        (value.role !== 'sender' && value.role !== 'receiver') ||
        typeof value.tag !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(value.tag)
      ) {
        return null
      }
      return { type: 'auth', role: value.role, tag: value.tag }
    }

    case 'cancel': {
      if (
        value.message !== undefined &&
        (typeof value.message !== 'string' || value.message.length > 300)
      ) {
        return null
      }

      return {
        type: 'cancel',
        ...(typeof value.message === 'string' ? { message: value.message } : {}),
      }
    }

    default:
      return null
  }
}

export function parseControlFrameText(raw: string): ControlFrame | null {
  try {
    return parseControlFrame(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export function encodeControlFrame(frame: ControlFrame): string {
  return JSON.stringify(frame)
}
