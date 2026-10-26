import { useCallback, useEffect, useState } from 'react'
import type { Socket } from 'socket.io-client'

export interface SocketStatus {
  connected: boolean
  reconnecting: boolean
  attempt: number
  retryNow: () => void
}

interface StatusState {
  connected: boolean
  attempt: number
}

export function useSocketStatus(socket: Socket): SocketStatus {
  const [status, setStatus] = useState<StatusState>({
    connected: socket.connected,
    attempt: 0,
  })

  useEffect(() => {
    const manager = socket.io

    const handleConnect = () => {
      setStatus({ connected: true, attempt: 0 })
    }

    const handleDisconnect = () => {
      setStatus((previous) => ({ ...previous, connected: false }))
    }

    const handleAttempt = (attempt: number) => {
      setStatus({ connected: false, attempt })
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    manager.on('reconnect_attempt', handleAttempt)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      manager.off('reconnect_attempt', handleAttempt)
    }
  }, [socket])

  const retryNow = useCallback(() => {
    socket.connect()
  }, [socket])

  return {
    connected: status.connected,
    reconnecting: !status.connected,
    attempt: status.attempt,
    retryNow,
  }
}
