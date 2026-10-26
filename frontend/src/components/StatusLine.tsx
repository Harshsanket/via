import { Wifi, WifiOff } from 'lucide-react'

import { truncateFileName } from '../lib/format'
import type { LogEntry } from '../socket/Types'

interface StatusLineProps {
  currentLog?: LogEntry
  isConnected: boolean
  isDesktop: boolean
  className?: string
}

const DOT_COLORS: Record<string, string> = {
  error: 'bg-red-500',
  success: 'bg-emerald-500',
  connecting: 'bg-blue-400 animate-pulse motion-reduce:animate-none',
  info: 'bg-gray-400',
}

export default function StatusLine({
  currentLog,
  isConnected,
  isDesktop,
  className = '',
}: StatusLineProps) {
  return (
    <div className={`py-4 text-center ${className}`}>
      {currentLog ? (
        <div className="flex items-center justify-center gap-3 text-base tracking-tight">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              DOT_COLORS[currentLog.status] ?? DOT_COLORS.info
            }`}
            aria-hidden="true"
          />
          <span className="font-medium text-gray-700">
            {isDesktop
              ? currentLog.message
              : truncateFileName(currentLog.message, 40)}
          </span>
        </div>
      ) : (
        <span className="inline-flex items-center gap-2 text-sm">
          {isConnected ? (
            <>
              <Wifi className="h-4 w-4 text-emerald-500" aria-hidden="true" />
              <span className="font-medium text-emerald-600">
                Connected to server
              </span>
            </>
          ) : (
            <>
              <WifiOff className="h-4 w-4 text-red-500" aria-hidden="true" />
              <span className="font-medium text-red-500">
                Disconnected
              </span>
            </>
          )}
        </span>
      )}
    </div>
  )
}
