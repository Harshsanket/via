import { formatDuration } from '../lib/transfer-rate'
import { formatFileSize } from '../lib/format'

interface TransferProgressProps {
  value: number
  label: string
  bytesPerSecond: number | null
  etaSeconds: number | null
  paused?: boolean
  done?: boolean
  tone?: 'emerald' | 'indigo'
  className?: string
}

export default function TransferProgress({
  value,
  label,
  bytesPerSecond,
  etaSeconds,
  paused = false,
  done = false,
  tone = 'indigo',
  className = '',
}: TransferProgressProps) {
  const percent = Math.min(100, Math.max(0, Math.round(value)))
  const speedLabel =
    bytesPerSecond !== null && bytesPerSecond > 0
      ? `${formatFileSize(Math.round(bytesPerSecond))}/s`
      : null
  const etaLabel =
    etaSeconds !== null && !done ? `ETA ${formatDuration(etaSeconds)}` : null
  const barTone =
    tone === 'emerald'
      ? 'from-emerald-500 via-emerald-400 to-teal-400'
      : 'from-indigo-500 via-purple-500 to-pink-500'

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm text-gray-600">
        <span className="font-light">{paused ? 'Paused' : label}</span>
        <span className="mb-0.5 flex items-baseline gap-3 font-semibold">
          {speedLabel && (
            <span className="text-xs font-medium text-gray-500">
              {speedLabel}
            </span>
          )}
          {etaLabel && (
            <span className="text-xs font-medium text-gray-500">
              {etaLabel}
            </span>
          )}
          <span className={tone === 'emerald' ? 'text-emerald-600' : 'text-indigo-600'}>
            {percent}%
          </span>
        </span>
      </div>
      <span className="sr-only" aria-live="polite">
        {Math.floor(percent / 10) * 10} percent
      </span>
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-gray-200 shadow-inner"
        role="progressbar"
        aria-label="Transfer progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent} percent${speedLabel ? `, ${speedLabel}` : ''}${
          etaLabel ? `, ${etaLabel}` : ''
        }`}
        aria-busy={!done && !paused}
      >
        <div
          className={`h-3 rounded-full bg-linear-to-r ${barTone} shadow-lg transition-all duration-300 ease-out motion-reduce:transition-none`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
