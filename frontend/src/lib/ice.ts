import { DEFAULT_STUN_SERVERS } from './constants'
import { apiBaseUrl } from './env'

interface IceServersApiResponse {
  success?: boolean
  data?: {
    iceServers?: unknown
  }
}

export interface IceConfig {
  servers: RTCIceServer[]
}

const isIceServer = (value: unknown): value is RTCIceServer => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const urls = record.urls

  const validUrls =
    typeof urls === 'string' ||
    (Array.isArray(urls) && urls.every((url) => typeof url === 'string'))

  if (!validUrls) return false
  if (record.username !== undefined && typeof record.username !== 'string') {
    return false
  }
  if (record.credential !== undefined && typeof record.credential !== 'string') {
    return false
  }

  return true
}

const withTimeout = (signal: AbortSignal | undefined, timeoutMs: number) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    },
  }
}

/**
 * Fetches STUN + ephemeral TURN credentials from the signaling server.
 * Falls back to public STUN when the endpoint is unavailable or TURN is
 * not configured, so LAN-friendly transfers still work.
 */
export async function fetchIceServers(
  sessionId: string,
  signal?: AbortSignal,
): Promise<IceConfig> {
  if (!sessionId) return { servers: DEFAULT_STUN_SERVERS }

  const { signal: timeoutSignal, cleanup } = withTimeout(signal, 5_000)

  try {
    const response = await fetch(
      `${apiBaseUrl}/ice-servers?sessionId=${encodeURIComponent(sessionId)}`,
      {
        signal: timeoutSignal,
        cache: 'no-store',
        credentials: 'omit',
        headers: { Accept: 'application/json' },
      },
    )

    // 503 means the deployment deliberately has no relay (the LAN-only case).
    // Direct host candidates are enough there, and skipping the public STUN
    // fallback keeps the browser from contacting an outside server for no gain.
    if (response.status === 503) {
      return { servers: [] }
    }

    if (!response.ok) {
      return { servers: DEFAULT_STUN_SERVERS }
    }

    const body = (await response.json()) as IceServersApiResponse
    const servers = body.data?.iceServers

    if (!Array.isArray(servers)) {
      return { servers: DEFAULT_STUN_SERVERS }
    }

    const valid = servers.filter(isIceServer)
    if (valid.length === 0) {
      return { servers: DEFAULT_STUN_SERVERS }
    }

    return { servers: valid }
  } catch {
    return { servers: DEFAULT_STUN_SERVERS }
  } finally {
    cleanup()
  }
}
