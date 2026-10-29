import { useEffect, useState } from 'react'
import { RefreshCw, WifiOff } from 'lucide-react'

import { useSocketStatus } from '../hooks/useSocketStatus'
import { getSocket } from '../socket/Config'

export default function ConnectionBanner() {
  const socket = getSocket()
  const status = useSocketStatus(socket)
  const [wasOffline, setWasOffline] = useState(false)

  useEffect(() => {
    if (status.connected) return

    const timer = window.setTimeout(() => setWasOffline(true), 1_500)
    return () => window.clearTimeout(timer)
  }, [status.connected])

  if (status.connected || !wasOffline) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute left-1/2 top-[4.5rem] z-40 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100 backdrop-blur-md"
    >
      <span className="flex items-center gap-2">
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          {status.attempt > 0
            ? `Signaling server unreachable. Reconnecting (attempt ${status.attempt})…`
            : 'Signaling server unreachable. Reconnecting…'}
        </span>
      </span>
      <button
        type="button"
        onClick={status.retryNow}
        className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Retry now
      </button>
    </div>
  )
}
