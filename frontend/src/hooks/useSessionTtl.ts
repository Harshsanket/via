import { useCallback, useEffect, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import {
  getTTL,
  offConnect,
  offSessionExpired,
  offSessionExpiring,
  offTTL,
  onConnect,
  onSessionExpired,
  onSessionExpiring,
  onTTL,
} from '../socket/Index'
import type {
  SessionExpiredEvent,
  SessionExpiringEvent,
  SessionTTL,
} from '../socket/Types'
import { TTL_WARNING_SECONDS } from '../lib/constants'

interface TtlSnapshot {
  sessionId: string
  seconds: number | null
  createdAt: string | null
  expired: boolean
}

const EMPTY_SNAPSHOT: TtlSnapshot = {
  sessionId: '',
  seconds: null,
  createdAt: null,
  expired: false,
}

/**
 * Seeded by a single get-ttl request, then kept live by the server's
 * session:expiring / session:expired pushes and a local 1-second countdown.
 */
export function useSessionTtl(
  socket: Socket,
  sessionId: string,
  onExpired?: () => void,
) {
  const [snapshot, setSnapshot] = useState<TtlSnapshot>(EMPTY_SNAPSHOT)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const secondsRef = useRef<number | null>(null)
  const expiredNotifiedRef = useRef(false)
  const onExpiredRef = useRef(onExpired)

  useEffect(() => {
    onExpiredRef.current = onExpired
  }, [onExpired])

  const stopCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
  }, [])

  const notifyExpired = useCallback(() => {
    stopCountdown()
    secondsRef.current = 0
    setSnapshot((previous) => ({
      ...previous,
      seconds: 0,
      expired: true,
    }))

    if (!expiredNotifiedRef.current) {
      expiredNotifiedRef.current = true
      onExpiredRef.current?.()
    }
  }, [stopCountdown])

  const startCountdown = useCallback(() => {
    stopCountdown()
    countdownRef.current = setInterval(() => {
      const previous = secondsRef.current
      if (previous === null) return

      const next = Math.max(0, previous - 1)
      secondsRef.current = next
      setSnapshot((snapshotValue) => ({ ...snapshotValue, seconds: next }))

      if (next === 0) {
        stopCountdown()
        getTTL(socket, sessionId)
      }
    }, 1_000)
  }, [sessionId, socket, stopCountdown])

  useEffect(() => {
    if (!sessionId) return

    expiredNotifiedRef.current = false
    secondsRef.current = null

    const seed = () => getTTL(socket, sessionId)

    const handleTtl = (data: SessionTTL) => {
      if (!data.exists || data.ttl === null || data.ttl <= 0) {
        notifyExpired()
        return
      }

      secondsRef.current = data.ttl
      setSnapshot({
        sessionId,
        seconds: data.ttl,
        createdAt: data.createdAt,
        expired: false,
      })
      startCountdown()
    }

    const handleExpiring = (event: SessionExpiringEvent) => {
      if (event.sessionId !== sessionId || expiredNotifiedRef.current) return
      const secondsRemaining = Math.max(0, event.secondsRemaining)
      secondsRef.current = secondsRemaining
      setSnapshot((previous) => ({
        ...previous,
        sessionId,
        seconds: secondsRemaining,
        expired: false,
      }))
      startCountdown()
    }

    const handleExpired = (event: SessionExpiredEvent) => {
      if (event.sessionId !== sessionId) return
      notifyExpired()
    }

    const handleConnect = () => seed()

    seed()
    onTTL(socket, handleTtl)
    onSessionExpiring(socket, handleExpiring)
    onSessionExpired(socket, handleExpired)
    onConnect(socket, handleConnect)

    return () => {
      offTTL(socket, handleTtl)
      offSessionExpiring(socket, handleExpiring)
      offSessionExpired(socket, handleExpired)
      offConnect(socket, handleConnect)
      stopCountdown()
    }
  }, [notifyExpired, sessionId, socket, startCountdown, stopCountdown])

  const current = snapshot.sessionId === sessionId ? snapshot : EMPTY_SNAPSHOT

  return {
    seconds: current.seconds,
    createdAt: current.createdAt,
    expired: current.expired,
    isNearExpiry:
      current.seconds !== null && current.seconds <= TTL_WARNING_SECONDS,
  }
}
