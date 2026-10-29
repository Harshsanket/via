import { truncateFileName } from '../lib/format'
import type { LogEntry } from '../socket/Types'

interface StatusLineProps {
  currentLog?: LogEntry
  isDesktop: boolean
  className?: string
}

const DOT_COLORS: Record<string, string> = {
  error: 'bg-red-500',
  success: 'bg-emerald-500',
  connecting: 'bg-blue-400 animate-pulse motion-reduce:animate-none',
  info: 'bg-gray-500',
}

export default function StatusLine({
  currentLog,
  isDesktop,
  className = '',
}: StatusLineProps) {
  if (!currentLog) return null

  return (
    <div className={`py-4 text-center ${className}`}>
      <div className="flex items-center justify-center gap-3 text-base tracking-tight">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
            DOT_COLORS[currentLog.status] ?? DOT_COLORS.info
          }`}
          aria-hidden="true"
        />
        <span className="font-medium text-foreground">
          {isDesktop
            ? currentLog.message
            : truncateFileName(currentLog.message, 40)}
        </span>
      </div>
    </div>
  )
}
