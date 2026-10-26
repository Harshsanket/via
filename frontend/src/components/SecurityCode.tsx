import { ShieldCheck } from 'lucide-react'

interface SecurityCodeProps {
  code: string | null
}

/**
 * The code both peers derive from the link key and their connection (see
 * lib/peer-auth.ts). Seeing the same digits on both screens confirms the two
 * devices are talking to each other directly.
 */
export default function SecurityCode({ code }: SecurityCodeProps) {
  if (!code) return null

  return (
    <p className="flex items-center gap-1.5 text-xs text-emerald-700" role="status">
      <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        Verified connection · security code{' '}
        <span className="font-mono font-semibold tracking-wider">{code}</span>
        <span className="text-gray-500"> — the other screen shows the same</span>
      </span>
    </p>
  )
}
