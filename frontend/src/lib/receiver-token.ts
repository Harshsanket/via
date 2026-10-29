/**
 * A per-tab identity for the receiver of a session.
 *
 * It lives in sessionStorage, so a reload keeps it while a different tab or
 * browser starts with a fresh one. The backend uses it to tell a refreshed
 * receiver from a third peer: only the same token may reclaim the receiver
 * slot before the transfer starts.
 */

const KEY_PREFIX = 'via:receiver-token:'

type TokenStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Survives a missing or blocked sessionStorage within this page's lifetime. */
const memory = new Map<string, string>()

const resolveStorage = (): TokenStorage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    // Access itself can throw when storage is disabled.
    return null
  }
}

const createToken = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export const getReceiverToken = (
  sessionId: string,
  storage: TokenStorage | null = resolveStorage()
): string => {
  const key = `${KEY_PREFIX}${sessionId}`

  const cached = memory.get(key)
  if (cached) return cached

  try {
    const stored = storage?.getItem(key)
    if (stored) {
      memory.set(key, stored)
      return stored
    }
  } catch {
    // Fall through and keep the token in memory only.
  }

  const token = createToken()
  memory.set(key, token)
  try {
    storage?.setItem(key, token)
  } catch {
    // The in-memory copy still covers this page.
  }
  return token
}
