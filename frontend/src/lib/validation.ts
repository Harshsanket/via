import { MAX_SESSION_ID_LENGTH } from './constants'
import { parseLinkKey } from './peer-auth'

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/

export function isValidSessionId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_SESSION_ID_LENGTH &&
    SESSION_ID_PATTERN.test(value)
  )
}

/**
 * Accepts either a raw session id or a full receive URL and returns the id.
 * Returns null for anything that cannot be a valid session id.
 */
export function extractSessionId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed)
      const match = url.pathname.match(/\/receive\/([^/]+)\/?$/)
      if (!match) return null
      const id = decodeURIComponent(match[1])
      return isValidSessionId(id) ? id : null
    } catch {
      return null
    }
  }

  return isValidSessionId(trimmed) ? trimmed : null
}

/**
 * The link the sender shares. The key goes in the fragment (`#k=`), which
 * browsers never send to a server, so the signaling server never sees it.
 */
export function buildReceiveUrl(
  sessionId: string,
  key: string | null,
  origin: string = window.location.origin,
): string {
  const base = `${origin}/receive/${encodeURIComponent(sessionId)}`
  return key ? `${base}#k=${key}` : base
}

/** Session id and link key (null if absent) from a pasted link or bare id. */
export function extractReceiveLink(
  input: string,
): { sessionId: string; key: string | null } | null {
  const sessionId = extractSessionId(input)
  if (!sessionId) return null

  const hashIndex = input.indexOf('#')
  const key = hashIndex >= 0 ? parseLinkKey(input.slice(hashIndex).trim()) : null
  return { sessionId, key }
}
