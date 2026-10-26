import { MAX_FILE_NAME_LENGTH } from './constants'

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    SIZE_UNITS.length - 1,
  )
  const value = bytes / 1024 ** exponent
  const precision = exponent === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2

  return `${value.toFixed(precision)} ${SIZE_UNITS[exponent]}`
}

export function formatTTL(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Expired'
  if (seconds < 60) return `${Math.floor(seconds)}s`
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
  }
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

export function getFileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0 || dot === fileName.length - 1) return 'FILE'
  return fileName.slice(dot + 1).toUpperCase()
}

export function truncateFileName(fileName: string, limit = 20): string {
  if (fileName.length <= limit) return fileName

  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return `${fileName.slice(0, limit)}…`

  const extension = fileName.slice(dot)
  const base = fileName.slice(0, dot)
  const available = Math.max(1, limit - extension.length)
  return `${base.slice(0, available)}…${extension}`
}

/**
 * Produces a filename safe to hand to `link.download`:
 * no path separators, control characters, or Windows-reserved characters.
 */
export function sanitizeFileName(fileName: string): string {
  const cleaned = Array.from(fileName, (character) => {
    const code = character.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f) return '_'
    return /[\\/:*?"<>|]/.test(character) ? '_' : character
  })
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim()

  const safe = cleaned.length > 0 ? cleaned : 'download'
  if (safe.length <= MAX_FILE_NAME_LENGTH) return safe

  const dot = safe.lastIndexOf('.')
  if (dot <= 0) return safe.slice(0, MAX_FILE_NAME_LENGTH)

  const extension = safe.slice(dot)
  const base = safe.slice(0, dot)
  return `${base.slice(0, Math.max(1, MAX_FILE_NAME_LENGTH - extension.length))}${extension}`
}

/**
 * Types a browser renders or runs. A received blob carries the app's origin,
 * so if one of these were opened in a tab it would run as the app; they are
 * always downloaded as plain bytes instead.
 */
const ACTIVE_MIME_TYPES = new Set([
  'text/html',
  'image/svg+xml',
  'application/xhtml+xml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/ecmascript',
])

export function sanitizeMimeType(mimeType: string | undefined | null): string {
  if (!mimeType) return 'application/octet-stream'
  const trimmed = mimeType.trim()
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(trimmed)) return 'application/octet-stream'
  if (ACTIVE_MIME_TYPES.has(trimmed.toLowerCase())) return 'application/octet-stream'
  return trimmed
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}
