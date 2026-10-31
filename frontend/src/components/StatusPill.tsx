export type StatusTone = 'idle' | 'busy' | 'ok' | 'warn' | 'error'

const TONES: Record<StatusTone, { dot: string; text: string }> = {
  idle: { dot: 'bg-gray-500', text: 'text-muted-foreground' },
  busy: {
    dot: 'bg-blue-400 animate-pulse motion-reduce:animate-none',
    text: 'text-blue-300',
  },
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-300' },
  warn: { dot: 'bg-amber-500', text: 'text-amber-300' },
  error: { dot: 'bg-red-500', text: 'text-red-300' },
}

export default function StatusPill({
  tone,
  label,
}: {
  tone: StatusTone
  label: string
}) {
  const { dot, text } = TONES[tone]

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <span className={`text-sm font-medium ${text}`}>{label}</span>
    </span>
  )
}
