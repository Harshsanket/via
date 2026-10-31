import { Check } from 'lucide-react'

import { cn } from '../lib/utils'

interface StepTrackerProps {
  steps: readonly string[]
  /** Index of the step in progress; `steps.length` marks every step done. */
  current: number
  failed?: boolean
  label: string
}

/** Where the user is in the transfer, so each page reads as one flow. */
export default function StepTracker({
  steps,
  current,
  failed = false,
  label,
}: StepTrackerProps) {
  return (
    <ol aria-label={label} className="flex w-full items-center gap-2 sm:gap-3">
      {steps.map((step, index) => {
        const complete = index < current
        const active = index === current

        return (
          <li
            key={step}
            aria-current={active ? 'step' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 last:flex-none sm:gap-3"
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                complete && 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200',
                active && !failed && 'border-white/60 bg-white/10 text-foreground',
                active && failed && 'border-red-400/60 bg-red-500/15 text-red-200',
                !complete && !active && 'border-white/15 text-muted-foreground',
              )}
            >
              {complete ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
            </span>
            <span
              className={cn(
                'truncate text-xs sm:text-sm',
                active ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {step}
              {complete && <span className="sr-only"> (done)</span>}
            </span>
            {index < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  'h-px min-w-3 flex-1',
                  complete ? 'bg-emerald-400/40' : 'bg-white/15',
                )}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
