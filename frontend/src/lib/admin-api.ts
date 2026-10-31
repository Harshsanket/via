import { apiBaseUrl } from './env'

export type ShortLinkMode = 'numeric' | 'alphanumeric'

export interface AdminSettings {
  shortLinks: {
    mode: ShortLinkMode
    length: number
  }
  sessions: {
    ttlSeconds: number
    refreshTtlSeconds: number
    maxLifetimeSeconds: number
    expiryWarningSeconds: number
    completedTtlSeconds: number
  }
  limits: {
    maxActiveSessionsPerPeer: number
    maxSocketsPerIp: number
    maxFileSizeBytes: number
    shortCodeAttemptsPerMinute: number
  }
  network: {
    stunUrls: string[]
    turnUrls: string[]
    turnCredentialTtlSeconds: number
  }
  admin: {
    username: string
    mustChangePassword: boolean
  }
}

export interface AdminLoginResult {
  token: string
  expiresAt: number
  mustChangePassword: boolean
}

export class AdminApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const request = async <T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
  }
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers })
  } catch {
    throw new AdminApiError(0, 'Could not reach the admin API.')
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new AdminApiError(
      response.status,
      'The admin API returned an invalid response.',
    )
  }

  if (!isRecord(body) || typeof body.success !== 'boolean') {
    throw new AdminApiError(
      response.status,
      'The admin API returned an invalid response.',
    )
  }

  if (!response.ok || !body.success) {
    const message =
      typeof body.message === 'string' && body.message.length > 0
        ? body.message
        : 'Request failed.'
    throw new AdminApiError(response.status, message)
  }

  return body.data as T
}

export const loginAdmin = (
  username: string,
  password: string,
): Promise<AdminLoginResult> =>
  request<AdminLoginResult>('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })

export const fetchAdminSettings = (token: string): Promise<AdminSettings> =>
  request<AdminSettings>('/admin/settings', {}, token)

export const saveAdminSettings = (
  token: string,
  settings: AdminSettings,
): Promise<AdminSettings> =>
  request<AdminSettings>(
    '/admin/settings',
    {
      method: 'PUT',
      body: JSON.stringify({
        shortLinks: settings.shortLinks,
        sessions: settings.sessions,
        limits: settings.limits,
        network: settings.network,
      }),
    },
    token,
  )

export const changeAdminCredentials = (
  token: string,
  currentPassword: string,
  username: string,
  newPassword: string,
): Promise<AdminLoginResult> =>
  request<AdminLoginResult>(
    '/admin/credentials',
    {
      method: 'POST',
      body: JSON.stringify({ currentPassword, username, newPassword }),
    },
    token,
  )
