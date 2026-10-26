const fallbackOrigin = typeof window === 'undefined' ? '' : window.location.origin

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

const parseHttpUrl = (value: string): URL | null => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

const configuredSocketUrl = import.meta.env.VITE_SOCKET_SERVER_URL?.trim() ?? ''

const socketUrlResult = ((): { url: string; error: string | null } => {
  if (!configuredSocketUrl) {
    return { url: fallbackOrigin, error: null }
  }

  const parsed = parseHttpUrl(configuredSocketUrl)
  if (!parsed) {
    return {
      url: fallbackOrigin,
      error:
        'VITE_SOCKET_SERVER_URL must be a valid http(s) URL. Falling back to the current origin.',
    }
  }

  return { url: stripTrailingSlash(parsed.toString()), error: null }
})()

export const socketServerUrl = socketUrlResult.url
export const socketConfigError = socketUrlResult.error

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''

export const apiBaseUrl = ((): string => {
  if (configuredApiBaseUrl) {
    return stripTrailingSlash(configuredApiBaseUrl)
  }

  const parsed = parseHttpUrl(socketServerUrl)
  const origin = parsed?.origin ?? fallbackOrigin
  return `${origin}/api/v1`
})()

const configuredReportingUrl =
  import.meta.env.VITE_ERROR_REPORTING_URL?.trim() ?? ''

export const errorReportingUrl = ((): string | null => {
  if (!configuredReportingUrl) return null
  const parsed = parseHttpUrl(configuredReportingUrl)
  return parsed ? stripTrailingSlash(parsed.toString()) : null
})()
