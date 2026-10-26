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
  turnAvailable: boolean
}

const hasTurnServer = (servers: RTCIceServer[]): boolean =>
  servers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
    return urls.some((url) => url.startsWith('turn:') || url.startsWith('turns:'))
  })

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
  if (!sessionId) return { servers: DEFAULT_STUN_SERVERS, turnAvailable: false }

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

    if (!response.ok) {
      return { servers: DEFAULT_STUN_SERVERS, turnAvailable: false }
    }

    const body = (await response.json()) as IceServersApiResponse
    const servers = body.data?.iceServers

    if (!Array.isArray(servers)) {
      return { servers: DEFAULT_STUN_SERVERS, turnAvailable: false }
    }

    const valid = servers.filter(isIceServer)
    if (valid.length === 0) {
      return { servers: DEFAULT_STUN_SERVERS, turnAvailable: false }
    }

    return { servers: valid, turnAvailable: hasTurnServer(valid) }
  } catch {
    return { servers: DEFAULT_STUN_SERVERS, turnAvailable: false }
  } finally {
    cleanup()
  }
}
