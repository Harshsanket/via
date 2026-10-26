import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ErrorAlertProps {
  message: string
  className?: string
}

export default function ErrorAlert({ message, className = '' }: ErrorAlertProps) {
  const alertRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    alertRef.current?.focus()
  }, [message])

  return (
    <div
      ref={alertRef}
      tabIndex={-1}
      role="alert"
      className={`flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 ${className}`}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}
