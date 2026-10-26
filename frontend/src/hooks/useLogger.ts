import { useCallback, useRef, useState } from 'react'

import type { LogEntry, LogStatus } from '../socket/Types'

export function useLogger(limit = 8) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const counterRef = useRef(0)

  const addLog = useCallback(
    (message: string, status: LogStatus = 'info') => {
      counterRef.current += 1
      const entry: LogEntry = {
        id: `${Date.now()}-${counterRef.current}`,
        message,
        status,
        timestamp: Date.now(),
      }

      setLogs((previous) => [...previous, entry].slice(-limit))
    },
    [limit],
  )

  return { logs, addLog }
}
