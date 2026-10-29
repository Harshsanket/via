import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'

interface SecurityCodeProps {
  code: string | null
}

/**
 * The code both peers derive from the link key and their connection (see
 * lib/peer-auth.ts). The badge stays compact; the code is behind "Learn more"
 * so it can be compared when someone wants to check.
 */
export default function SecurityCode({ code }: SecurityCodeProps) {
  const [expanded, setExpanded] = useState(false)

  if (!code) return null

  return (
    <div className="w-full" role="status">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-emerald-300">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="font-medium">Verified</span>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="rounded-sm text-xs font-medium text-emerald-200/90 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
        >
          {expanded ? 'Hide code' : 'Learn more'}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 rounded-lg border border-emerald-400/20 bg-emerald-500/5 px-3 py-2">
          <p className="text-xs font-light text-muted-foreground">
            Security code
          </p>
          <p className="font-mono text-base font-semibold tracking-wider text-emerald-200">
            {code}
          </p>
          <p className="mt-1 text-xs font-light text-muted-foreground">
            Compare it with the code on the other screen.
          </p>
        </div>
      )}
    </div>
  )
}
