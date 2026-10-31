import { useCallback, useEffect, useRef, useState } from 'react'

import { useLogger } from '../../hooks/useLogger'
import { useSessionTtl } from '../../hooks/useSessionTtl'
import {
  BUFFER_HIGH_THRESHOLD,
  BUFFER_LOW_THRESHOLD,
  CHUNK_SIZE,
  DEFAULT_STUN_SERVERS,
  DIRECT_CONNECTION_ERROR,
  MAX_RECOVERY_ATTEMPTS,
} from '../../lib/constants'
import { Crc32 } from '../../lib/crc32'
import { describeError, formatFileSize, sanitizeFileName } from '../../lib/format'
import { fetchIceServers, type IceConfig } from '../../lib/ice'
import {
  computeAuthTag,
  computeVerificationCode,
  encryptMetadata,
  extractFingerprint,
  generateLinkKey,
  verifyAuthTag,
} from '../../lib/peer-auth'
import { reportEvent } from '../../lib/observability'
import {
  TransferRateTracker,
  type TransferRateSnapshot,
} from '../../lib/transfer-rate'
import {
  encodeControlFrame,
  parseControlFrameText,
  type AuthFrame,
  type MetadataFrame,
} from '../../lib/transfer-protocol'
import {
  buildReceiveUrl,
  buildShortReceiveUrl,
} from '../../lib/validation'
import {
  IceCandidateBuffer,
  closePeerConnection,
  createPeerConnectionConfig,
} from '../../lib/webrtc'
import type {
  AnswerEvent,
  IceCandidateEvent,
  SessionErrorEvent,
} from '../../socket/Index'
import {
  createSession,
  getSocket,
  getTTL,
  offAnswer,
  offConnect,
  offDisconnect,
  offFileMetadata,
  offIceCandidate,
  offPeerJoined,
  offPeerLeft,
  offSessionError,
  offTransferComplete,
  offTransferError,
  onAnswer,
  onConnect,
  onDisconnect,
  onFileMetadata,
  onIceCandidate,
  onPeerJoined,
  onPeerLeft,
  onSessionError,
  onTransferComplete,
  onTransferError,
  sendFileMetadata,
  sendIceCandidate,
  sendOffer,
  sendTransferError,
} from '../../socket/Index'

export type TransferStage =
  | 'idle'
  | 'creating_session'
  | 'session_created'
  | 'peer_joined'
  | 'webrtc_negotiating'
  | 'ready'
  | 'transferring'
  | 'reconnecting'
  | 'done'
  | 'error'

const SESSION_ACK_TIMEOUT = 15_000
const DRAIN_TIMEOUT = 20_000
const RECOVERY_TIMEOUT = 45_000
const YIELD_EVERY_CHUNKS = 8
/**
 * A first negotiation sometimes fails on one side (ICE gathering/connectivity
 * timeout) even though the same peers connect on a second attempt. Wait long
 * enough for stale answers from the failed offer to arrive before replacing it.
 */
const PRE_TRANSFER_RETRY_DELAY_MS = 1_000

class TransferAbortedError extends Error {}
class TransferInterruptedError extends Error {}
/** A peer connection finished preparing after it had already been superseded. */
class StaleConnectionError extends Error {}

/**
 * The session a sender created, kept in module memory so in-app navigation
 * (home ⇄ send) does not lose it: the server still has the sender in the
 * session, and asking for another one would be refused. A full reload clears
 * this, which matches the server dropping the creator's session on disconnect.
 */
interface RetainedSendSession {
  file: File
  sessionId: string
  shortCode: string
  linkKey: string
  uploadTime: Date
}

let retainedSendSession: RetainedSendSession | null = null

const waitForBufferSpace = (channel: RTCDataChannel): Promise<void> => {
  if (channel.bufferedAmount <= BUFFER_HIGH_THRESHOLD) return Promise.resolve()

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      channel.removeEventListener('bufferedamountlow', handleLow)
      channel.removeEventListener('close', handleClose)
      clearTimeout(timeout)
    }

    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }

    const handleLow = () => settle(resolve)
    const handleClose = () => settle(() => reject(new TransferInterruptedError()))

    const timeout = setTimeout(
      () => settle(() => reject(new Error('Timed out waiting for the send buffer'))),
      DRAIN_TIMEOUT,
    )

    channel.addEventListener('bufferedamountlow', handleLow)
    channel.addEventListener('close', handleClose)

    if (channel.bufferedAmount <= BUFFER_LOW_THRESHOLD) handleLow()
  })
}

const isTerminalSessionError = (message: string): boolean =>
  /expired|invalid|full|unauthorized|not in session/i.test(message)

const metadataFrame = (file: File): MetadataFrame => ({
  type: 'metadata',
  fileName: file.name || 'unknown',
  fileSize: file.size,
  fileType: file.type || 'application/octet-stream',
})

const isChannelStale = (
  channelRef: { current: RTCDataChannel | null },
  channel: RTCDataChannel,
): boolean =>
  channelRef.current !== channel || channel.readyState !== 'open'

/** How long the receiver has to prove it holds the link key. */
const AUTH_TIMEOUT_MS = 15_000
/** Frames held while our own check of the receiver is still running. */
const MAX_PENDING_FRAMES = 32

export function useSendSession() {
  // Lazy state rather than refs: both are fixed for the hook's lifetime and
  // are read during render.
  const [socket] = useState(getSocket)
  const [restored] = useState<RetainedSendSession | null>(
    () => retainedSendSession,
  )
  const didRestoreRef = useRef(false)

  const [file, setFile] = useState<File | null>(restored?.file ?? null)
  const [sessionId, setSessionId] = useState(restored?.sessionId ?? '')
  const [shortCode, setShortCode] = useState(restored?.shortCode ?? '')
  const [copied, setCopied] = useState(false)
  const [transferProgress, setTransferProgress] = useState(0)
  const [uploadTime, setUploadTime] = useState<Date | null>(
    restored?.uploadTime ?? null,
  )
  const [isConnected, setIsConnected] = useState(socket.connected)
  const [stage, setStage] = useState<TransferStage>(
    restored ? 'session_created' : 'idle',
  )
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [receiverConfirmed, setReceiverConfirmed] = useState(false)
  const [paused, setPaused] = useState(false)
  const [transferRate, setTransferRate] = useState<TransferRateSnapshot>({
    bytesPerSecond: null,
    etaSeconds: null,
  })

  const { logs, addLog } = useLogger(10)

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)
  const fileRef = useRef<File | null>(restored?.file ?? null)
  const sessionIdRef = useRef(restored?.sessionId ?? '')
  const shortCodeRef = useRef(restored?.shortCode ?? '')
  const stageRef = useRef<TransferStage>(restored ? 'session_created' : 'idle')
  const webrtcInitiatedRef = useRef(false)
  /** Increments whenever a pending peer setup must be discarded. */
  const webrtcAttemptRef = useRef(0)
  const transferActiveRef = useRef(false)
  const transferAbortedRef = useRef(false)
  const transferStartedRef = useRef(false)
  const sendRunRef = useRef(0)
  const finishedRef = useRef(false)
  const pausedRef = useRef(false)
  const waitingForPeerRef = useRef(restored !== null)
  const recoveryAttemptsRef = useRef(0)
  const recoveryTimerRef = useRef<number | null>(null)
  /** Fresh offers after a pre-transfer negotiation failure, not a resume. */
  const connectionRetriesRef = useRef(0)
  const connectionRetryTimerRef = useRef<number | null>(null)
  const pauseResolversRef = useRef<Array<() => void>>([])
  const iceConfigPromiseRef = useRef<Promise<IceConfig> | null>(null)
  const iceBufferRef = useRef(new IceCandidateBuffer())
  const transferRateRef = useRef(new TransferRateTracker())
  const transferStartedAtRef = useRef(0)
  const offsetRef = useRef(0)
  const initialOffsetRef = useRef(0)
  const lastProgressRef = useRef(-1)
  const lastRateUiAtRef = useRef(0)
  const checksumRef = useRef<Crc32 | null>(null)
  // Link key (shared only through the link's #fragment) and the result of
  // the peer check it enables; see lib/peer-auth.ts.
  const linkKeyRef = useRef<string | null>(restored?.linkKey ?? null)
  const peerVerifiedRef = useRef(false)
  const authTimerRef = useRef<number | null>(null)
  const pendingFramesRef = useRef<string[]>([])
  const [verificationCode, setVerificationCode] = useState<string | null>(null)

  const initiateConnectionRef = useRef<(resume?: boolean) => Promise<void>>(
    async () => undefined,
  )
  const beginRecoveryRef = useRef<(reason: string) => void>(() => undefined)
  const renegotiateRef = useRef<() => Promise<void>>(async () => undefined)
  const sendFromOffsetRef = useRef<() => Promise<void>>(async () => undefined)
  const handleChannelControlRef = useRef<(raw: string) => void>(() => undefined)
  const handlePeerAuthRef = useRef<(frame: AuthFrame) => Promise<void>>(
    async () => undefined,
  )
  /** What to do once the receiver is verified (become ready, or resume). */
  const afterVerifyRef = useRef<() => void>(() => undefined)
  const startTransferRef = useRef<() => Promise<void>>(async () => undefined)

  useEffect(() => {
    stageRef.current = stage
  }, [stage])

  const clearRecoveryTimer = useCallback(() => {
    if (recoveryTimerRef.current !== null) {
      window.clearTimeout(recoveryTimerRef.current)
      recoveryTimerRef.current = null
    }
  }, [])

  const clearConnectionRetryTimer = useCallback(() => {
    if (connectionRetryTimerRef.current !== null) {
      window.clearTimeout(connectionRetryTimerRef.current)
      connectionRetryTimerRef.current = null
    }
  }, [])

  const releasePauseWaiters = useCallback(() => {
    const waiters = pauseResolversRef.current
    pauseResolversRef.current = []
    for (const resolve of waiters) resolve()
  }, [])

  const resetPeerConnection = useCallback(() => {
    const channel = dataChannelRef.current
    if (channel) {
      channel.onopen = null
      channel.onclose = null
      channel.onerror = null
      channel.onmessage = null
      channel.close()
    }
    dataChannelRef.current = null

    closePeerConnection(peerConnectionRef.current)
    peerConnectionRef.current = null

    iceBufferRef.current.reset()
    webrtcInitiatedRef.current = false
    webrtcAttemptRef.current += 1
    clearConnectionRetryTimer()
  }, [clearConnectionRetryTimer])

  const failTransfer = useCallback(
    (message: string, notifyPeer = true) => {
      if (finishedRef.current) return

      transferAbortedRef.current = true
      transferActiveRef.current = false
      transferStartedRef.current = false
      waitingForPeerRef.current = false
      pausedRef.current = false
      setPaused(false)
      releasePauseWaiters()
      clearRecoveryTimer()
      resetPeerConnection()
      setStage('error')
      setSessionError(message)
      addLog(message, 'error')
      setTransferRate({ bytesPerSecond: null, etaSeconds: null })
      reportEvent('transfer.failed', { surface: 'send' })

      if (notifyPeer && sessionIdRef.current && socket.connected) {
        sendTransferError(socket, sessionIdRef.current, message)
      }
    },
    [addLog, clearRecoveryTimer, releasePauseWaiters, resetPeerConnection, socket],
  )

  /**
   * A failed first negotiation is usually transient: reloading the receiver
   * negotiates the same pair again successfully. Retry here instead of making
   * the user refresh.
   */
  const schedulePreTransferRetry = useCallback(() => {
    if (
      finishedRef.current ||
      transferAbortedRef.current ||
      transferStartedRef.current
    ) {
      return
    }

    if (connectionRetriesRef.current >= MAX_RECOVERY_ATTEMPTS) {
      failTransfer(DIRECT_CONNECTION_ERROR)
      return
    }

    connectionRetriesRef.current += 1
    addLog('Connection failed — retrying automatically…', 'connecting')
    resetPeerConnection()
    setStage('webrtc_negotiating')

    connectionRetryTimerRef.current = window.setTimeout(() => {
      connectionRetryTimerRef.current = null
      if (
        finishedRef.current ||
        transferAbortedRef.current ||
        transferStartedRef.current ||
        waitingForPeerRef.current
      ) {
        return
      }
      void initiateConnectionRef.current(false)
    }, PRE_TRANSFER_RETRY_DELAY_MS)
  }, [addLog, failTransfer, resetPeerConnection])

  const handleSessionExpired = useCallback(() => {
    if (finishedRef.current) return
    retainedSendSession = null
    failTransfer('This session expired. Start a new session to continue.')
  }, [failTransfer])

  const ttl = useSessionTtl(socket, sessionId, handleSessionExpired)

  const startRecoveryTimer = useCallback(
    (message: string) => {
      clearRecoveryTimer()
      recoveryTimerRef.current = window.setTimeout(() => {
        recoveryTimerRef.current = null
        failTransfer(message)
      }, RECOVERY_TIMEOUT)
    },
    [clearRecoveryTimer, failTransfer],
  )

  const sendMetadata = useCallback((channel: RTCDataChannel, current: File) => {
    channel.send(encodeControlFrame(metadataFrame(current)))
  }, [])

  const sendFromOffset = useCallback(async () => {
    const currentFile = fileRef.current
    const channel = dataChannelRef.current
    const sid = sessionIdRef.current

    if (!currentFile || !channel || !sid) return
    if (channel.readyState !== 'open') {
      beginRecoveryRef.current('The data channel closed before sending')
      return
    }

    transferActiveRef.current = true
    transferAbortedRef.current = false
    setStage('transferring')

    // A recovery may start a new loop while this one is still waiting on a
    // slice or the buffer. Only the newest run may move the offset or finish.
    const run = ++sendRunRef.current
    const isStale = () => sendRunRef.current !== run

    try {
      while (offsetRef.current < currentFile.size) {
        if (isStale()) return
        if (transferAbortedRef.current) throw new TransferAbortedError()

        if (isChannelStale(dataChannelRef, channel)) {
          throw new TransferInterruptedError()
        }

        if (pausedRef.current) {
          await new Promise<void>((resolve) => {
            pauseResolversRef.current.push(resolve)
          })
          if (isStale()) return
          if (transferAbortedRef.current) throw new TransferAbortedError()
          if (isChannelStale(dataChannelRef, channel)) throw new TransferInterruptedError()
        }

        await waitForBufferSpace(channel)

        if (isStale()) return
        if (transferAbortedRef.current) throw new TransferAbortedError()
        if (isChannelStale(dataChannelRef, channel)) throw new TransferInterruptedError()

        const start = offsetRef.current
        const end = Math.min(start + CHUNK_SIZE, currentFile.size)
        const buffer = await currentFile.slice(start, end).arrayBuffer()

        if (isStale()) return

        if (!checksumRef.current) checksumRef.current = new Crc32()
        checksumRef.current.update(buffer)
        channel.send(buffer)
        offsetRef.current = end

        const percent = Math.floor((end / currentFile.size) * 100)
        if (percent !== lastProgressRef.current) {
          lastProgressRef.current = percent
          setTransferProgress(percent)
        }

        const rate = transferRateRef.current.update(end)
        const now = Date.now()
        if (now - lastRateUiAtRef.current >= 1_000) {
          lastRateUiAtRef.current = now
          setTransferRate(rate)
        }

        if (offsetRef.current % (CHUNK_SIZE * YIELD_EVERY_CHUNKS) === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }

      if (isStale()) return

      const checksum = checksumRef.current ?? new Crc32()
      channel.send(
        encodeControlFrame({
          type: 'complete',
          fileSize: currentFile.size,
          crc32: checksum.digest(),
        }),
      )

      setTransferProgress(100)
      setStage('done')
      finishedRef.current = true
      transferActiveRef.current = false
      addLog('File sent — waiting for the receiver to verify it', 'success')
      reportEvent('transfer.sent', {
        bytes: currentFile.size,
        durationMs: Date.now() - transferStartedAtRef.current,
        resumed: initialOffsetRef.current > 0,
      })
    } catch (error) {
      if (isStale()) return
      if (error instanceof TransferAbortedError || transferAbortedRef.current) {
        return
      }

      if (error instanceof TransferInterruptedError) {
        beginRecoveryRef.current('The data channel closed during transfer')
        return
      }

      failTransfer(`Transfer failed: ${describeError(error)}`)
    } finally {
      if (!isStale()) transferActiveRef.current = false
    }
  }, [addLog, failTransfer])

  useEffect(() => {
    sendFromOffsetRef.current = sendFromOffset
  }, [sendFromOffset])

  const handleChannelControl = useCallback(
    (raw: string) => {
      const frame = parseControlFrameText(raw)
      if (!frame) return

      if (frame.type === 'auth') {
        void handlePeerAuthRef.current(frame)
        return
      }

      // Until the receiver proves it holds the link key and sees this exact
      // connection, nothing it says is acted on. Frames that overtake our own
      // (async) check are held and replayed once it passes.
      if (!peerVerifiedRef.current) {
        if (pendingFramesRef.current.length < MAX_PENDING_FRAMES) {
          pendingFramesRef.current.push(raw)
        }
        return
      }

      if (frame.type === 'resume') {
        const currentFile = fileRef.current
        if (!currentFile) return
        if (frame.receivedBytes > currentFile.size) {
          failTransfer('The receiver reported an invalid resume position.')
          return
        }

        try {
          checksumRef.current = Crc32.fromState(frame.crcState)
        } catch {
          failTransfer('The receiver reported an invalid resume checksum.')
          return
        }

        clearRecoveryTimer()
        offsetRef.current = frame.receivedBytes
        initialOffsetRef.current = frame.receivedBytes
        lastProgressRef.current = Math.floor(
          (frame.receivedBytes / currentFile.size) * 100,
        )
        pausedRef.current = false
        setPaused(false)
        transferRateRef.current.start(currentFile.size, frame.receivedBytes)
        lastRateUiAtRef.current = 0
        setTransferRate(transferRateRef.current.snapshot())
        setTransferProgress(lastProgressRef.current)
        setSessionError(null)
        addLog(
          `Resuming from ${formatFileSize(frame.receivedBytes)}…`,
          'connecting',
        )
        reportEvent('transfer.resumed', {
          bytes: frame.receivedBytes,
        })
        void sendFromOffsetRef.current()
        return
      }

      if (frame.type === 'retry') {
        const currentFile = fileRef.current
        const channel = dataChannelRef.current
        if (!currentFile || !channel || channel.readyState !== 'open') return

        offsetRef.current = 0
        initialOffsetRef.current = 0
        lastProgressRef.current = -1
        checksumRef.current = new Crc32()
        transferAbortedRef.current = false
        transferStartedRef.current = true
        finishedRef.current = false
        pausedRef.current = false
        setPaused(false)
        setReceiverConfirmed(false)
        transferRateRef.current.start(currentFile.size, 0)
        lastRateUiAtRef.current = 0
        setTransferRate(transferRateRef.current.snapshot())
        setTransferProgress(0)
        setSessionError(null)
        addLog('Receiver requested a fresh copy — restarting…', 'connecting')
        sendMetadata(channel, currentFile)
        void sendFromOffsetRef.current()
        return
      }

      if (frame.type === 'request-transfer') {
        if (stageRef.current !== 'ready') return
        addLog('Receiver requested the file — sending automatically', 'success')
        reportEvent('transfer.requested', { surface: 'send' })
        void startTransferRef.current()
        return
      }

      if (frame.type === 'cancel') {
        failTransfer(frame.message ?? 'The receiver cancelled the transfer.', false)
      }
    },
    [addLog, clearRecoveryTimer, failTransfer, sendMetadata],
  )

  useEffect(() => {
    handleChannelControlRef.current = handleChannelControl
  }, [handleChannelControl])

  const createSenderPeer = useCallback(
    async (sid: string, attempt: number): Promise<RTCPeerConnection> => {
      const iceConfig =
        (await iceConfigPromiseRef.current) ?? {
          servers: DEFAULT_STUN_SERVERS,
        }

      if (
        sessionIdRef.current !== sid ||
        webrtcAttemptRef.current !== attempt ||
        !webrtcInitiatedRef.current
      ) {
        throw new StaleConnectionError()
      }

      const pc = new RTCPeerConnection(
        createPeerConnectionConfig(iceConfig.servers),
      )
      peerConnectionRef.current = pc

      pc.onicecandidate = (event) => {
        sendIceCandidate(socket, sid, event.candidate)
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        if (state === 'failed') {
          if (transferStartedRef.current && !finishedRef.current) {
            beginRecoveryRef.current('The peer connection failed')
          } else if (!finishedRef.current) {
            schedulePreTransferRetry()
          }
        } else if (state === 'disconnected') {
          addLog('Peer connection temporarily lost; trying to recover…', 'info')
        } else if (state === 'connected') {
          // The retry budget is cleared after peer verification, not here: a
          // connection that drops again before verification must still count.
          clearConnectionRetryTimer()
          addLog('Peer connection established', 'success')
        }
      }

      return pc
    },
    [addLog, clearConnectionRetryTimer, schedulePreTransferRetry, socket],
  )

  const clearAuthTimer = useCallback(() => {
    if (authTimerRef.current !== null) {
      window.clearTimeout(authTimerRef.current)
      authTimerRef.current = null
    }
  }, [])

  /** Both DTLS fingerprints as this side sees them, once both are known. */
  const currentFingerprints = useCallback(() => {
    const pc = peerConnectionRef.current
    const local = extractFingerprint(pc?.localDescription?.sdp)
    const remote = extractFingerprint(pc?.remoteDescription?.sdp)
    return local && remote ? { local, remote } : null
  }, [])

  /** Sends this side's proof and starts the clock for the receiver's. */
  const startPeerAuth = useCallback(
    async (channel: RTCDataChannel) => {
      peerVerifiedRef.current = false
      // The old code belongs to the previous channel; a new handshake has not
      // proven anything yet, so never show it as "Verified" meanwhile.
      setVerificationCode(null)
      pendingFramesRef.current = []
      clearAuthTimer()

      const key = linkKeyRef.current
      const view = currentFingerprints()
      if (!key || !view) {
        failTransfer('Could not start the security check for this connection.')
        return
      }

      addLog('Verifying the receiver…', 'connecting')
      authTimerRef.current = window.setTimeout(() => {
        authTimerRef.current = null
        // Skip if the transfer already failed for another reason.
        if (!peerVerifiedRef.current && !transferAbortedRef.current) {
          failTransfer(
            'The receiver did not pass the security check. Nothing was sent.',
          )
        }
      }, AUTH_TIMEOUT_MS)

      try {
        const tag = await computeAuthTag(key, 'sender', view.local, view.remote)
        if (channel.readyState === 'open') {
          channel.send(encodeControlFrame({ type: 'auth', role: 'sender', tag }))
        }
      } catch (error) {
        failTransfer(`The security check could not run: ${describeError(error)}`)
      }
    },
    [addLog, clearAuthTimer, currentFingerprints, failTransfer],
  )

  const handlePeerAuth = useCallback(
    async (frame: AuthFrame) => {
      if (peerVerifiedRef.current) return

      const key = linkKeyRef.current
      const view = currentFingerprints()
      const valid =
        frame.role === 'receiver' &&
        key !== null &&
        view !== null &&
        (await verifyAuthTag(key, 'receiver', frame.tag, view))

      if (!valid || !key || !view) {
        clearAuthTimer()
        pendingFramesRef.current = []
        failTransfer(
          'Security check failed: this connection does not lead directly to the person who opened your link. Nothing was sent.',
        )
        return
      }

      peerVerifiedRef.current = true
      // A verified channel is a real success; a later pre-transfer failure gets
      // a fresh retry budget instead of inheriting the earlier attempts.
      connectionRetriesRef.current = 0
      clearConnectionRetryTimer()
      clearAuthTimer()
      const code = await computeVerificationCode(key, view.local, view.remote)
      setVerificationCode(code)
      addLog(`Receiver verified — security code ${code}`, 'success')
      reportEvent('peer.verified', { surface: 'send' })
      afterVerifyRef.current()

      const queued = pendingFramesRef.current
      pendingFramesRef.current = []
      for (const raw of queued) handleChannelControlRef.current(raw)
    },
    [
      addLog,
      clearAuthTimer,
      clearConnectionRetryTimer,
      currentFingerprints,
      failTransfer,
    ],
  )

  useEffect(() => {
    handlePeerAuthRef.current = handlePeerAuth
  }, [handlePeerAuth])

  const attachSenderChannel = useCallback(
    (channel: RTCDataChannel, resume: boolean) => {
      channel.binaryType = 'arraybuffer'
      channel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD
      dataChannelRef.current = channel

      channel.onopen = () => {
        if (resume) {
          addLog('Channel re-established — asking the receiver for its position…', 'connecting')
          setStage('reconnecting')
          afterVerifyRef.current = () => {
            try {
              channel.send(encodeControlFrame({ type: 'resume-request' }))
            } catch {
              beginRecoveryRef.current('Could not ask the receiver to resume')
            }
          }
        } else {
          afterVerifyRef.current = () => {
            addLog('Secure channel open — ready to send', 'success')
            setStage('ready')
          }
        }

        // Every channel (including resumes) is verified before use.
        void startPeerAuth(channel)
      }

      channel.onclose = () => {
        if (dataChannelRef.current !== channel) return
        dataChannelRef.current = null

        if (transferStartedRef.current && !finishedRef.current) {
          beginRecoveryRef.current('The data channel closed during transfer')
        } else if (!transferAbortedRef.current && !finishedRef.current) {
          addLog('Data channel closed', 'info')
        }
      }

      channel.onerror = () => {
        addLog('Data channel error', 'error')
      }

      channel.onmessage = (event) => {
        if (typeof event.data === 'string') {
          handleChannelControlRef.current(event.data)
        }
      }
    },
    [addLog, startPeerAuth],
  )

  const initiateWebRTCConnection = useCallback(
    async (resume = false) => {
      if (webrtcInitiatedRef.current) return
      const sid = sessionIdRef.current
      if (!sid) return

      webrtcInitiatedRef.current = true
      const attempt = ++webrtcAttemptRef.current
      setStage(resume ? 'reconnecting' : 'webrtc_negotiating')
      addLog(
        resume ? 'Re-establishing the encrypted channel…' : 'Creating an encrypted connection…',
        'connecting',
      )

      try {
        const pc = await createSenderPeer(sid, attempt)
        if (
          !webrtcInitiatedRef.current ||
          webrtcAttemptRef.current !== attempt ||
          sessionIdRef.current !== sid
        ) {
          return
        }

        const channel = pc.createDataChannel('fileTransfer', { ordered: true })
        attachSenderChannel(channel, resume)

        const offer = await pc.createOffer({ iceRestart: resume })
        await pc.setLocalDescription(offer)
        sendOffer(socket, sid, offer)
        addLog(
          resume ? 'Recovery offer sent to receiver' : 'Connection offer sent to receiver',
          'connecting',
        )
      } catch (error) {
        // A reset or a newer attempt already owns the connection; its state
        // (including webrtcInitiatedRef) must not be disturbed by this one.
        if (
          error instanceof StaleConnectionError ||
          webrtcAttemptRef.current !== attempt
        ) {
          return
        }
        webrtcInitiatedRef.current = false
        failTransfer(`WebRTC setup failed: ${describeError(error)}`)
      }
    },
    [addLog, attachSenderChannel, createSenderPeer, failTransfer, socket],
  )

  useEffect(() => {
    initiateConnectionRef.current = initiateWebRTCConnection
  }, [initiateWebRTCConnection])

  const renegotiate = useCallback(async () => {
    if (waitingForPeerRef.current || finishedRef.current) return
    const sid = sessionIdRef.current
    const currentFile = fileRef.current
    if (!sid || !currentFile) return

    const pc = peerConnectionRef.current
    if (!pc || pc.signalingState === 'closed') {
      webrtcInitiatedRef.current = false
      await initiateConnectionRef.current(true)
      return
    }

    try {
      const oldChannel = dataChannelRef.current
      if (oldChannel) {
        oldChannel.onopen = null
        oldChannel.onclose = null
        oldChannel.onerror = null
        oldChannel.onmessage = null
        oldChannel.close()
        dataChannelRef.current = null
      }

      const channel = pc.createDataChannel('fileTransfer-resume', { ordered: true })
      attachSenderChannel(channel, true)
      pc.restartIce()
      const offer = await pc.createOffer({ iceRestart: true })
      await pc.setLocalDescription(offer)
      sendOffer(socket, sid, offer)
      addLog('Recovery offer sent to receiver', 'connecting')
    } catch (error) {
      failTransfer(`Could not re-establish the connection: ${describeError(error)}`)
    }
  }, [addLog, attachSenderChannel, failTransfer, socket])

  useEffect(() => {
    renegotiateRef.current = renegotiate
  }, [renegotiate])

  useEffect(() => {
    const snapshot = restored
    if (!snapshot || didRestoreRef.current) return
    didRestoreRef.current = true

    addLog('Restored your open session', 'info')
    iceConfigPromiseRef.current = fetchIceServers(snapshot.sessionId)
    // The receiver may still be waiting in the session; offer a fresh
    // connection. If it is not there yet, peer-joined starts a new one.
    void initiateConnectionRef.current(false)
  }, [addLog, restored])

  const beginRecovery = useCallback(
    (reason: string) => {
      if (
        finishedRef.current ||
        transferAbortedRef.current ||
        !transferStartedRef.current ||
        stageRef.current === 'reconnecting' ||
        stageRef.current === 'error'
      ) {
        return
      }

      // Stop the current send loop before the channel is replaced: it would
      // otherwise wake up on the stale channel and either throw or emit a
      // completion frame from the old stream.
      sendRunRef.current += 1

      recoveryAttemptsRef.current += 1
      if (recoveryAttemptsRef.current > MAX_RECOVERY_ATTEMPTS) {
        failTransfer('The connection could not be restored. Start a new transfer.')
        return
      }

      transferActiveRef.current = false
      pausedRef.current = false
      setPaused(false)
      releasePauseWaiters()
      setStage('reconnecting')
      setSessionError(null)
      addLog(`${reason}. Attempting to resume…`, 'connecting')
      reportEvent('transfer.recovering', {
        attempt: recoveryAttemptsRef.current,
      })

      if (waitingForPeerRef.current) {
        resetPeerConnection()
        addLog('Waiting for the receiver to rejoin…', 'info')
        startRecoveryTimer('The receiver did not return in time. Start a new transfer.')
        return
      }

      startRecoveryTimer('Could not resume the transfer. Start a new transfer.')

      if (socket.connected) {
        void renegotiateRef.current()
      } else {
        addLog('Waiting for the signaling server before resuming…', 'info')
      }
    },
    [
      addLog,
      failTransfer,
      releasePauseWaiters,
      resetPeerConnection,
      socket,
      startRecoveryTimer,
    ],
  )

  useEffect(() => {
    beginRecoveryRef.current = beginRecovery
  }, [beginRecovery])

  useEffect(() => {
    const handleConnect = () => {
      setIsConnected(true)
      addLog('Connected to server', 'success')

      if (socket.recovered) {
        addLog('Connection recovered', 'success')
      }

      if (stageRef.current === 'reconnecting') {
        if (dataChannelRef.current?.readyState === 'open') {
          clearRecoveryTimer()
          addLog('Signaling recovered; the WebRTC transfer can continue', 'success')
          setStage('transferring')
          return
        }
        void renegotiateRef.current()
      }
    }

    const handleDisconnect = () => {
      setIsConnected(false)
      addLog('Signaling connection lost', 'error')
      if (transferStartedRef.current && !finishedRef.current) {
        addLog('The WebRTC transfer may continue while the server reconnects', 'info')
      }
    }

    const handleSessionError = (data: SessionErrorEvent) => {
      setSessionError(data.message)
      addLog(`Session error: ${data.message}`, 'error')

      if (isTerminalSessionError(data.message) && !transferActiveRef.current) {
        retainedSendSession = null
        failTransfer(data.message, false)
      }
    }

    const handleFileMetadataAck = (data: { success: boolean }) => {
      if (data.success) {
        addLog('File details shared with the receiver', 'success')
      } else {
        addLog('The server could not store the file details', 'error')
      }
    }

    onConnect(socket, handleConnect)
    onDisconnect(socket, handleDisconnect)
    onSessionError(socket, handleSessionError)
    onFileMetadata(socket, handleFileMetadataAck)

    return () => {
      offConnect(socket, handleConnect)
      offDisconnect(socket, handleDisconnect)
      offSessionError(socket, handleSessionError)
      offFileMetadata(socket, handleFileMetadataAck)
    }
  }, [addLog, clearRecoveryTimer, failTransfer, resetPeerConnection, socket])

  useEffect(() => {
    const handlePeerJoined = () => {
      const wasWaiting = waitingForPeerRef.current
      waitingForPeerRef.current = false
      // A (re)joining receiver is a fresh negotiation, so allow retries again.
      connectionRetriesRef.current = 0
      clearConnectionRetryTimer()

      // Joining refreshes the session TTL on the server; re-seed the local
      // countdown so the sender does not display the original, shorter one.
      if (sessionIdRef.current) getTTL(socket, sessionIdRef.current)

      if (transferStartedRef.current && !finishedRef.current) {
        addLog('Receiver rejoined — resuming the transfer…', 'success')
        if (wasWaiting || !dataChannelRef.current) {
          resetPeerConnection()
          void initiateConnectionRef.current(true)
        }
        return
      }

      if (finishedRef.current) return

      // A restored session may have sent an offer before the receiver came
      // back; start over so the receiver gets a fresh one.
      if (wasWaiting || webrtcInitiatedRef.current) {
        resetPeerConnection()
        webrtcInitiatedRef.current = false
      }

      addLog('Receiver joined — starting the handshake…', 'connecting')
      setSessionError(null)
      setStage('peer_joined')
      void initiateConnectionRef.current(false)
    }

    const handlePeerLeft = () => {
      waitingForPeerRef.current = true
      connectionRetriesRef.current = 0
      clearConnectionRetryTimer()

      if (transferStartedRef.current && !finishedRef.current) {
        addLog(
          'Receiver left the signaling session. Waiting for it to rejoin…',
          'info',
        )
        if (dataChannelRef.current?.readyState !== 'open') {
          beginRecoveryRef.current('The receiver disconnected')
        }
        return
      }

      if (!finishedRef.current) {
        addLog('Receiver left — the link is ready to share again', 'info')
        setStage('session_created')
        setTransferProgress(0)
        setVerificationCode(null)
        resetPeerConnection()
      }
    }

    const handleAnswer = async ({ answer }: AnswerEvent) => {
      if (finishedRef.current || transferAbortedRef.current) return

      const pc = peerConnectionRef.current
      // An answer for an offer we already replaced (a retry) must not be
      // applied to the new peer connection.
      if (!pc || pc.signalingState !== 'have-local-offer') return

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer))
        await iceBufferRef.current.markRemoteDescriptionSet(pc)
        addLog('Encrypted channel negotiated', 'connecting')
      } catch (error) {
        failTransfer(`Failed to apply the answer: ${describeError(error)}`)
      }
    }

    const handleIceCandidate = ({ candidate }: IceCandidateEvent) => {
      const pc = peerConnectionRef.current
      if (!pc) return
      iceBufferRef.current.add(pc, candidate)
    }

    const handleTransferError = () => {
      if (finishedRef.current) {
        setReceiverConfirmed(false)
        setSessionError('The receiver could not verify or save the file.')
        setStage('error')
        addLog('The receiver could not verify or save the file', 'error')
        reportEvent('transfer.receiver-error', { surface: 'send' })
        return
      }
      failTransfer('The receiver could not complete the transfer.', false)
    }

    const handleTransferComplete = () => {
      setReceiverConfirmed(true)
      addLog('Receiver verified and saved the file', 'success')
      reportEvent('transfer.confirmed', { surface: 'send' })
    }

    onPeerJoined(socket, handlePeerJoined)
    onPeerLeft(socket, handlePeerLeft)
    onAnswer(socket, handleAnswer)
    onIceCandidate(socket, handleIceCandidate)
    onTransferError(socket, handleTransferError)
    onTransferComplete(socket, handleTransferComplete)

    return () => {
      offPeerJoined(socket, handlePeerJoined)
      offPeerLeft(socket, handlePeerLeft)
      offAnswer(socket, handleAnswer)
      offIceCandidate(socket, handleIceCandidate)
      offTransferError(socket, handleTransferError)
      offTransferComplete(socket, handleTransferComplete)
    }
  }, [
    addLog,
    clearConnectionRetryTimer,
    failTransfer,
    resetPeerConnection,
    socket,
  ])

  const handleCreateSession = useCallback(
    (selectedFile: File) => {
      if (!socket.connected) {
        setSessionError('Not connected to the signaling server.')
        addLog('Not connected to server', 'error')
        return
      }

      setStage('creating_session')
      setSessionError(null)
      addLog('Creating session…', 'connecting')

      let settled = false
      const timeout = window.setTimeout(() => {
        if (settled) return
        settled = true
        setStage('error')
        setSessionError('Session creation timed out. Please try again.')
        addLog('Session creation timed out', 'error')
      }, SESSION_ACK_TIMEOUT)

      createSession(socket, (response) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)

        if (!response?.success || !response.sessionId) {
          setStage('error')
          setSessionError(response?.message ?? 'Could not create a session.')
          addLog('Session creation failed', 'error')
          return
        }

        const id = response.sessionId
        sessionIdRef.current = id
        setSessionId(id)

        const code = response.shortCode ?? ''
        shortCodeRef.current = code
        setShortCode(code)

        // A fresh key per session; it only ever travels in the link fragment.
        const linkKey = generateLinkKey()
        linkKeyRef.current = linkKey
        const selectedAt = new Date()
        retainedSendSession = {
          file: selectedFile,
          sessionId: id,
          shortCode: code,
          linkKey,
          uploadTime: selectedAt,
        }
        setUploadTime(selectedAt)
        peerVerifiedRef.current = false
        setVerificationCode(null)
        setStage('session_created')
        webrtcInitiatedRef.current = false
        transferAbortedRef.current = false
        transferStartedRef.current = false
        finishedRef.current = false
        waitingForPeerRef.current = false
        recoveryAttemptsRef.current = 0
        connectionRetriesRef.current = 0
        setReceiverConfirmed(false)
        setSessionError(null)
        addLog('Session created — share the link with the receiver', 'success')

        iceConfigPromiseRef.current = fetchIceServers(id)

        // The server only ever stores the name and type encrypted.
        void encryptMetadata(linkKey, {
          fileName: sanitizeFileName(selectedFile.name || 'unknown'),
          mimeType: selectedFile.type || 'application/octet-stream',
        })
          .then((sealed) => {
            if (sessionIdRef.current !== id) return
            sendFileMetadata(
              socket,
              id,
              sealed,
              'application/octet-stream',
              selectedFile.size,
            )
          })
          .catch(() => {
            addLog('Could not encrypt the file details', 'error')
          })
      })
    },
    [addLog, socket],
  )

  const handleFileSelect = useCallback(
    (selectedFile: File) => {
      if (selectedFile.size <= 0) {
        addLog('That file is empty', 'error')
        setSessionError('Empty files cannot be transferred.')
        return
      }

      if (sessionIdRef.current) {
        addLog('Finish this transfer or start over before choosing another file', 'error')
        return
      }

      fileRef.current = selectedFile
      setFile(selectedFile)
      setUploadTime(new Date())
      setTransferProgress(0)
      setStage('idle')
      setSessionError(null)
      setReceiverConfirmed(false)
      setPaused(false)
      setTransferRate({ bytesPerSecond: null, etaSeconds: null })
      transferRateRef.current.reset()
      lastRateUiAtRef.current = 0
      finishedRef.current = false
      addLog(`File selected: ${selectedFile.name}`, 'success')
      handleCreateSession(selectedFile)
    },
    [addLog, handleCreateSession],
  )

  const handleSendFile = useCallback(async () => {
    const currentFile = fileRef.current
    const channel = dataChannelRef.current
    const sid = sessionIdRef.current

    if (!currentFile || !channel || !sid) {
      addLog('The data channel is not ready', 'error')
      return
    }

    if (channel.readyState !== 'open') {
      addLog('The receiver is not connected yet', 'error')
      return
    }

    if (!peerVerifiedRef.current) {
      addLog('The receiver has not passed the security check', 'error')
      return
    }

    offsetRef.current = 0
    initialOffsetRef.current = 0
    lastProgressRef.current = -1
    checksumRef.current = new Crc32()
    transferStartedRef.current = true
    transferAbortedRef.current = false
    finishedRef.current = false
    pausedRef.current = false
    waitingForPeerRef.current = false
    recoveryAttemptsRef.current = 0
    connectionRetriesRef.current = 0
    transferStartedAtRef.current = Date.now()
    transferRateRef.current.start(currentFile.size, 0)
    lastRateUiAtRef.current = 0
    setPaused(false)
    setTransferRate(transferRateRef.current.snapshot())
    setTransferProgress(0)
    setSessionError(null)
    setStage('transferring')
    addLog('Starting file transfer…', 'connecting')
    reportEvent('transfer.started', {
      bytes: currentFile.size,
      surface: 'send',
    })

    try {
      sendMetadata(channel, currentFile)
      await sendFromOffsetRef.current()
    } catch (error) {
      failTransfer(`Transfer failed: ${describeError(error)}`)
    }
  }, [addLog, failTransfer, sendMetadata])

  useEffect(() => {
    startTransferRef.current = handleSendFile
  }, [handleSendFile])

  const handleTogglePause = useCallback(() => {
    if (!transferActiveRef.current && !pausedRef.current) return

    if (pausedRef.current) {
      pausedRef.current = false
      setPaused(false)
      releasePauseWaiters()
      transferRateRef.current.start(
        fileRef.current?.size ?? 0,
        offsetRef.current,
      )
      lastRateUiAtRef.current = 0
      setTransferRate(transferRateRef.current.snapshot())
      addLog('Transfer resumed', 'info')
      return
    }

    pausedRef.current = true
    setPaused(true)
    addLog('Transfer paused', 'info')
  }, [addLog, releasePauseWaiters])

  const resetToIdle = useCallback(() => {
    retainedSendSession = null
    transferAbortedRef.current = true
    transferActiveRef.current = false
    transferStartedRef.current = false
    finishedRef.current = false
    pausedRef.current = false
    waitingForPeerRef.current = false
    peerVerifiedRef.current = false
    releasePauseWaiters()
    clearAuthTimer()
    clearRecoveryTimer()
    resetPeerConnection()

    fileRef.current = null
    sessionIdRef.current = ''
    offsetRef.current = 0
    initialOffsetRef.current = 0
    lastProgressRef.current = -1
    checksumRef.current = null
    iceConfigPromiseRef.current = null
    recoveryAttemptsRef.current = 0
    connectionRetriesRef.current = 0
    transferRateRef.current.reset()
    lastRateUiAtRef.current = 0

    setFile(null)
    setSessionId('')
    shortCodeRef.current = ''
    setShortCode('')
    setStage('idle')
    setSessionError(null)
    setTransferProgress(0)
    setUploadTime(null)
    setCopied(false)
    setReceiverConfirmed(false)
    setPaused(false)
    setVerificationCode(null)
    setTransferRate({ bytesPerSecond: null, etaSeconds: null })

    // Leaving the socket releases the creator's session, so the next file can
    // create a fresh one instead of being refused as "already in session".
    socket.disconnect()
    socket.connect()
  }, [
    clearAuthTimer,
    clearRecoveryTimer,
    releasePauseWaiters,
    resetPeerConnection,
    socket,
  ])

  const handleCancelTransfer = useCallback(() => {
    if (sessionIdRef.current && socket.connected) {
      sendTransferError(socket, sessionIdRef.current, 'cancelled by sender')
    }
    const channel = dataChannelRef.current
    if (channel?.readyState === 'open') {
      try {
        channel.send(encodeControlFrame({ type: 'cancel', message: 'cancelled by sender' }))
      } catch {
        // The channel may already be closing.
      }
    }

    addLog('Transfer cancelled', 'info')
    reportEvent('transfer.cancelled', { surface: 'send' })

    // Cancelling is a deliberate exit: return to the file picker, not the
    // error card.
    resetToIdle()
  }, [addLog, resetToIdle, socket])

  const handleCopyUrl = useCallback(async () => {
    if (!sessionIdRef.current) return

    try {
      const code = shortCodeRef.current
      await navigator.clipboard.writeText(
        code
          ? buildShortReceiveUrl(code, linkKeyRef.current)
          : buildReceiveUrl(sessionIdRef.current, linkKeyRef.current),
      )
      setCopied(true)
      addLog('Receive link copied to clipboard', 'success')
      window.setTimeout(() => setCopied(false), 2_000)
    } catch {
      addLog('Could not copy the link', 'error')
    }
  }, [addLog])

  const handleStartOver = useCallback(() => {
    resetToIdle()
    addLog('Ready for a new transfer', 'info')
  }, [addLog, resetToIdle])

  useEffect(() => {
    return () => {
      transferAbortedRef.current = true
      transferActiveRef.current = false
      pausedRef.current = false
      releasePauseWaiters()
      clearRecoveryTimer()
      resetPeerConnection()
    }
  }, [clearRecoveryTimer, releasePauseWaiters, resetPeerConnection])

  useEffect(() => {
    if (!file || stage === 'done' || stage === 'error' || stage === 'idle') return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [file, stage])

  const isTransferring = stage === 'transferring'
  const isReconnecting = stage === 'reconnecting'
  const isDone = stage === 'done'
  const isError = stage === 'error'
  const isCreatingSession = stage === 'creating_session'
  const isPeerConnected =
    stage === 'ready' || stage === 'transferring' || stage === 'done'

  return {
    file,
    sessionId,
    shortCode,
    verificationCode,
    copied,
    transferProgress,
    uploadTime,
    isConnected,
    stage,
    sessionError,
    receiverConfirmed,
    paused,
    transferRate,
    logs,
    ttl,
    isTransferring,
    isReconnecting,
    isDone,
    isError,
    isCreatingSession,
    isPeerConnected,
    handleFileSelect,
    handleSendFile,
    handleTogglePause,
    handleCancelTransfer,
    handleCopyUrl,
    handleStartOver,
  }
}

export type SendSession = ReturnType<typeof useSendSession>
