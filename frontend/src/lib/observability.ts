import { errorReportingUrl } from './env'

type EventValue = string | number | boolean | null

interface ErrorPayload {
  type: 'error'
  context: string
  message: string
  timestamp: number
}

interface EventPayload {
  type: 'event'
  name: string
  data: Record<string, EventValue>
  timestamp: number
}

interface VitalsPayload {
  type: 'vitals'
  metrics: Record<string, number>
  timestamp: number
}

type TelemetryPayload = ErrorPayload | EventPayload | VitalsPayload

const MAX_MESSAGE_LENGTH = 500
const MAX_CONTEXT_LENGTH = 120

let initialized = false
let vitalsFlushed = false
const vitals: Record<string, number> = {}

const normalizeError = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

const send = (payload: TelemetryPayload): void => {
  if (!errorReportingUrl || typeof window === 'undefined') return

  const body = JSON.stringify(payload)
  try {
    if (typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon(errorReportingUrl, blob)) return
    }
    void fetch(errorReportingUrl, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined)
  } catch {
    // Telemetry must never break the transfer flow.
  }
}

export function reportError(error: unknown, context: string): void {
  const message = normalizeError(error).slice(0, MAX_MESSAGE_LENGTH)
  console.error(`[via] ${context}`, error)
  send({
    type: 'error',
    context: context.slice(0, MAX_CONTEXT_LENGTH),
    message,
    timestamp: Date.now(),
  })
}

export function reportEvent(
  name: string,
  data: Record<string, EventValue> = {},
): void {
  if (import.meta.env.DEV) {
    console.info(`[via] ${name}`, data)
  }

  send({
    type: 'event',
    name: name.slice(0, MAX_CONTEXT_LENGTH),
    data,
    timestamp: Date.now(),
  })
}

function flushVitals(): void {
  if (vitalsFlushed) return
  vitalsFlushed = true
  if (Object.keys(vitals).length > 0) {
    send({ type: 'vitals', metrics: { ...vitals }, timestamp: Date.now() })
  }
}

function observe(
  type: string,
  callback: (entries: PerformanceEntryList) => void,
): void {
  if (typeof PerformanceObserver === 'undefined') return
  try {
    const observer = new PerformanceObserver((list) => callback(list.getEntries()))
    observer.observe({ type, buffered: true } as PerformanceObserverInit)
  } catch {
    // The browser does not support this entry type.
  }
}

export function initObservability(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, 'window.error')
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, 'window.unhandledrejection')
  })

  observe('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1]
    if (last) vitals.LCP = Math.round(last.startTime)
  })

  observe('layout-shift', (entries) => {
    let total = vitals.CLS ?? 0
    for (const entry of entries) {
      const shift = entry as PerformanceEntry & {
        value?: number
        hadRecentInput?: boolean
      }
      if (!shift.hadRecentInput && typeof shift.value === 'number') {
        total += shift.value
      }
    }
    vitals.CLS = Math.round(total * 1000) / 1000
  })

  observe('event', (entries) => {
    for (const entry of entries) {
      const event = entry as PerformanceEntry & { duration?: number }
      if (typeof event.duration === 'number') {
        vitals.INP = Math.round(Math.max(vitals.INP ?? 0, event.duration))
      }
    }
  })

  window.addEventListener('pagehide', flushVitals)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushVitals()
  })
}
