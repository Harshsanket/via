import {
  MAX_SESSION_ID_LENGTH,
  MAX_SHORT_CODE_LENGTH,
  MIN_SHORT_CODE_LENGTH,
} from './constants'

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/
const SHORT_CODE_PATTERN = new RegExp(
  `^[a-z0-9]{${MIN_SHORT_CODE_LENGTH},${MAX_SHORT_CODE_LENGTH}}$`,
)
const LINK_KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/

export function isValidSessionId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_SESSION_ID_LENGTH &&
    SESSION_ID_PATTERN.test(value)
  )
}

export function isValidShortCode(value: string): boolean {
  return SHORT_CODE_PATTERN.test(value)
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

/** The short link the sender shares: four digits today, up to six later. */
export function buildShortReceiveUrl(
  shortCode: string,
  key: string | null,
  origin: string = window.location.origin,
): string {
  const base = `${origin}/${encodeURIComponent(shortCode)}`
  return key ? `${base}#k=${key}` : base
}

export interface ReceiveLink {
  sessionId: string | null
  shortCode: string | null
  key: string | null
}

const normalizeOrigin = (origin: string): string => origin.replace(/\/+$/, '')

/** Returns undefined for a malformed fragment, null when it is absent. */
const parseStrictKey = (hash: string): string | null | undefined => {
  if (!hash) return null
  const match = /^#k=(.+)$/.exec(hash)
  if (!match || !LINK_KEY_PATTERN.test(match[1])) return undefined
  return match[1]
}

/** Strictly parses the fragment of the page the receiver actually opened. */
export function parseLinkKeyFragment(hash: string): string | null {
  return parseStrictKey(hash) ?? null
}

/**
 * Accepts only a Via receive link (this origin) or a bare short code. The
 * receiver page must never act on another site's URL, a query string, an
 * extra path segment, or a bare session UUID.
 */
export function extractReceiveLink(
  input: string,
  origin: string = window.location.origin,
): ReceiveLink | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (isValidShortCode(trimmed)) {
    return { sessionId: null, shortCode: trimmed, key: null }
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.origin !== normalizeOrigin(origin) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== ''
  ) {
    return null
  }

  const key = parseStrictKey(url.hash)
  if (key === undefined) return null

  const legacy = url.pathname.match(/^\/receive\/([^/]+)\/?$/)
  if (legacy) {
    const sessionId = decodeURIComponent(legacy[1])
    return isValidSessionId(sessionId)
      ? { sessionId, shortCode: null, key }
      : null
  }

  const short = url.pathname.match(/^\/([^/]+)\/?$/)
  if (short && isValidShortCode(short[1])) {
    return { sessionId: null, shortCode: short[1], key }
  }

  return null
}
