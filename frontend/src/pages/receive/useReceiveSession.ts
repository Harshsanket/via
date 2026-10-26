import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Socket } from 'socket.io-client'

import { useLogger } from '../../hooks/useLogger'
import { useSessionTtl } from '../../hooks/useSessionTtl'
import {
  DEFAULT_STUN_SERVERS,
  MAX_FILE_SIZE,
  MEMORY_FALLBACK_MAX_FILE_SIZE,
} from '../../lib/constants'
import { Crc32 } from '../../lib/crc32'
import {
  IncomingFileSink,
  isOpfsSupported,
  sweepStaleTransfers,
  type SinkMode,
} from '../../lib/file-sink'
import {
  describeError,
  formatFileSize,
  sanitizeFileName,
  sanitizeMimeType,
} from '../../lib/format'
import { fetchIceServers, type IceConfig } from '../../lib/ice'
import { reportEvent } from '../../lib/observability'
import {
  computeAuthTag,
  computeVerificationCode,
  decryptMetadata,
  extractFingerprint,
  isEncryptedMetadata,
  parseLinkKey,
  verifyAuthTag,
} from '../../lib/peer-auth'
import {
  TransferRateTracker,
  type TransferRateSnapshot,
} from '../../lib/transfer-rate'
import {
  encodeControlFrame,
  parseControlFrameText,
  type AuthFrame,
} from '../../lib/transfer-protocol'
import { extractReceiveLink, isValidSessionId } from '../../lib/validation'
import {
  IceCandidateBuffer,
  closePeerConnection,
  createPeerConnectionConfig,
} from '../../lib/webrtc'
import type {
  FileMetadata,
  FileMetadataEvent,
  IceCandidateEvent,
  JoinSessionResponse,
  OfferEvent,
  SessionErrorEvent,
} from '../../socket/Index'
import {
  getSocket,
  joinSession,
  offConnect,
  offDisconnect,
  offFileMetadata,
  offIceCandidate,
  offOffer,
  offPeerLeft,
  offSessionError,
  offTransferComplete,
  offTransferError,
  onConnect,
  onDisconnect,
  onFileMetadata,
  onIceCandidate,
  onOffer,
  onPeerLeft,
  onSessionError,
  onTransferComplete,
  onTransferError,
  sendAnswer,
  sendIceCandidate,
  sendTransferComplete,
  sendTransferError,
} from '../../socket/Index'

export type ReceiveStage =
  | 'input'
  | 'joining'
  | 'waiting'
  | 'ready'
  | 'requesting'
  | 'connecting'
  | 'receiving'
  | 'reconnecting'
  | 'done'
  | 'error'

export type DownloadMode = 'direct' | 'fallback'

type SaveFilePicker = (options?: {
  suggestedName?: string
}) => Promise<FileSystemFileHandle>

const getSaveFilePicker = (): SaveFilePicker | null => {
  const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker })
    .showSaveFilePicker
  return typeof picker === 'function' ? picker.bind(window) : null
}

const triggerDownload = (url: string, name: string): void => {
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export interface FileInfo {
  fileName: string
  mimeType: string
  fileSize: number
}

export interface ReceivedFile {
  name: string
  url: string | null
  mode: SinkMode
}

const JOIN_ACK_TIMEOUT = 15_000
const RECOVERY_TIMEOUT = 45_000
const RETRY_TIMEOUT = 10_000
const REQUEST_TIMEOUT = 15_000
const MAX_RECOVERY_ATTEMPTS = 2

const isTerminalSessionError = (message: string): boolean =>
  /expired|invalid|full|unauthorized|not in session/i.test(message)

/** How long the sender has to prove it holds the link key. */
const AUTH_TIMEOUT_MS = 15_000
/** Frames held while our own check of the peer is still running. */
const MAX_PENDING_FRAMES = 32
const MISSING_KEY_MESSAGE =
  'This link is missing its security key. Open the full link the sender shared (it ends in #k=…).'
const UNREADABLE_DETAILS_MESSAGE =
  "The file details couldn't be decrypted. Make sure you opened the complete link."

export function useReceiveSession(urlSessionId: string | undefined) {
  const navigate = useNavigate()
  const socketRef = useRef<Socket | null>(null)
  socketRef.current ??= getSocket()
  const socket = socketRef.current

  const [stage, setStage] = useState<ReceiveStage>(
    urlSessionId ? 'joining' : 'input',
  )
  const [sessionId, setSessionId] = useState('')
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)
  const [transferProgress, setTransferProgress] = useState(0)
  const [receivedFile, setReceivedFile] = useState<ReceivedFile | null>(null)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isConnected, setIsConnected] = useState(socket.connected)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [retryable, setRetryable] = useState(false)
  const [downloadMode, setDownloadMode] = useState<DownloadMode | null>(null)
  const [turnAvailable, setTurnAvailable] = useState<boolean | null>(null)
  const [transferRate, setTransferRate] = useState<TransferRateSnapshot>({
    bytesPerSecond: null,
    etaSeconds: null,
  })

  const [verificationCode, setVerificationCode] = useState<string | null>(null)

  const { logs, addLog } = useLogger(10)

  const sessionIdRef = useRef(urlSessionId ?? '')
  const stageRef = useRef<ReceiveStage>(stage)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)
  const sinkRef = useRef<IncomingFileSink | null>(null)
  const receivedFileCleanupRef = useRef<(() => void) | null>(null)
  const fileInfoRef = useRef<FileInfo | null>(null)
  const dataMetaRef = useRef<FileInfo | null>(null)
  const receivedBytesRef = useRef(0)
  const checksumRef = useRef<Crc32 | null>(null)
  const transferStartedRef = useRef(false)
  const abortedRef = useRef(false)
  const finishedRef = useRef(false)
  const failedRef = useRef(false)
  const awaitingRetryRef = useRef(false)
  const webrtcReadyRef = useRef(false)
  const recoveryAttemptsRef = useRef(0)
  const recoveryTimerRef = useRef<number | null>(null)
  const retryTimerRef = useRef<number | null>(null)
  const requestTimerRef = useRef<number | null>(null)
  const destinationRef = useRef<FileSystemFileHandle | null>(null)
  const downloadModeRef = useRef<DownloadMode | null>(null)
  const autoDownloadRef = useRef(false)
  const lastProgressRef = useRef(-1)
  const lastRateUiAtRef = useRef(0)
  const initialOffsetRef = useRef(0)
  const transferStartedAtRef = useRef(0)
  const transferRateRef = useRef(new TransferRateTracker())
  const iceConfigPromiseRef = useRef<Promise<IceConfig> | null>(null)
  const iceBufferRef = useRef(new IceCandidateBuffer())
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null)
  const joinInFlightRef = useRef(false)
  const autoJoinStartedRef = useRef(false)
  const joinedIdRef = useRef('')
  const handleIncomingDataRef = useRef<(data: unknown) => void>(() => undefined)
  const startPeerAuthRef = useRef<(channel: RTCDataChannel) => Promise<void>>(
    async () => undefined,
  )
  // Link key from the #fragment (never sent to the server) and the result of
  // the sender check it enables; see lib/peer-auth.ts.
  const linkKeyRef = useRef<string | null>(
    typeof window === 'undefined' ? null : parseLinkKey(window.location.hash),
  )
  const peerVerifiedRef = useRef(false)
  const authTimerRef = useRef<number | null>(null)
  const pendingFramesRef = useRef<unknown[]>([])
  const afterVerifyRef = useRef<() => void>(() => undefined)
  const handlePeerAuthRef = useRef<(frame: AuthFrame) => Promise<void>>(
    async () => undefined,
  )
  const finalizeTransferRef = useRef<
    (expectedSize: number, expectedCrc: number) => void
  >(() => undefined)
  const beginRecoveryRef = useRef<(reason: string) => void>(() => undefined)
  const sendResumeStateRef = useRef<() => boolean>(() => false)

  useEffect(() => {
    stageRef.current = stage
  }, [stage])

  // Clear partial downloads a crashed or closed tab left behind.
  useEffect(() => {
    void sweepStaleTransfers().catch(() => undefined)
  }, [])

  const clearRecoveryTimer = useCallback(() => {
    if (recoveryTimerRef.current !== null) {
      window.clearTimeout(recoveryTimerRef.current)
      recoveryTimerRef.current = null
    }
  }, [])

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [])

  const clearRequestTimer = useCallback(() => {
    if (requestTimerRef.current !== null) {
      window.clearTimeout(requestTimerRef.current)
      requestTimerRef.current = null
    }
  }, [])

  const releaseReceivedFile = useCallback(() => {
    receivedFileCleanupRef.current?.()
    receivedFileCleanupRef.current = null
  }, [])

  const abortSink = useCallback(() => {
    const sink = sinkRef.current
    sinkRef.current = null
    if (sink) void sink.abort()
  }, [])

  const teardownNegotiation = useCallback(() => {
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
    pendingIceRef.current = []
    webrtcReadyRef.current = false
  }, [])

  const teardownPeer = useCallback(() => {
    teardownNegotiation()
    pendingOfferRef.current = null
  }, [teardownNegotiation])

  const failTransfer = useCallback(
    (message: string, notifyPeer = true) => {
      if (finishedRef.current) return

      failedRef.current = true
      abortedRef.current = true
      transferStartedRef.current = false
      awaitingRetryRef.current = false
      clearRecoveryTimer()
      clearRetryTimer()
      clearRequestTimer()
      teardownPeer()
      abortSink()
      setStage('error')
      setSessionError(message)
      setRetryable(false)
      setTransferRate({ bytesPerSecond: null, etaSeconds: null })
      addLog(message, 'error')
      reportEvent('transfer.failed', { surface: 'receive' })

      if (notifyPeer && sessionIdRef.current && socket.connected) {
        sendTransferError(socket, sessionIdRef.current, message)
      }
    },
    [
      abortSink,
      addLog,
      clearRecoveryTimer,
      clearRequestTimer,
      clearRetryTimer,
      socket,
      teardownPeer,
    ],
  )

  const markRecoverableFailure = useCallback(
    (message: string) => {
      if (finishedRef.current) return

      failedRef.current = true
      transferStartedRef.current = false
      abortedRef.current = false
      awaitingRetryRef.current = true
      clearRecoveryTimer()
      clearRetryTimer()
      clearRequestTimer()
      abortSink()
      checksumRef.current = null
      dataMetaRef.current = null
      receivedBytesRef.current = 0
      lastProgressRef.current = -1
      setRetryable(true)
      setStage('error')
      setSessionError(message)
      setTransferProgress(0)
      setTransferRate({ bytesPerSecond: null, etaSeconds: null })
      addLog(message, 'error')
      reportEvent('transfer.recoverable-error', { surface: 'receive' })
    },
    [abortSink, addLog, clearRecoveryTimer, clearRequestTimer, clearRetryTimer],
  )

  const handleSessionExpired = useCallback(() => {
    if (finishedRef.current) return
    failTransfer('This session expired before the transfer completed.')
  }, [failTransfer])

  const ttl = useSessionTtl(socket, sessionId, handleSessionExpired)

  const sendResumeState = useCallback((): boolean => {
    const channel = dataChannelRef.current
    const info = fileInfoRef.current
    if (!channel || channel.readyState !== 'open' || !info) return false

    if (!dataMetaRef.current) dataMetaRef.current = info
    if (!checksumRef.current) checksumRef.current = new Crc32()

    const checksum = checksumRef.current
    const receivedBytes = receivedBytesRef.current
    if (receivedBytes > info.fileSize) return false

    initialOffsetRef.current = receivedBytes
    if (transferStartedAtRef.current === 0) {
      transferStartedAtRef.current = Date.now()
    }
    lastProgressRef.current =
      info.fileSize > 0 ? Math.floor((receivedBytes / info.fileSize) * 100) : 0
    transferStartedRef.current = true
    failedRef.current = false
    abortedRef.current = false
    awaitingRetryRef.current = false
    finishedRef.current = false
    transferRateRef.current.start(info.fileSize, receivedBytes)
    lastRateUiAtRef.current = 0
    setTransferRate(transferRateRef.current.snapshot())
    setTransferProgress(lastProgressRef.current)
    setStage('receiving')
    clearRecoveryTimer()

    try {
      channel.send(
        encodeControlFrame({
          type: 'resume',
          receivedBytes,
          crcState: checksum.rawState(),
        }),
      )
      addLog(
        receivedBytes > 0
          ? `Resuming at ${formatFileSize(receivedBytes)}…`
          : 'Restarting the transfer from the beginning…',
        'connecting',
      )
      return true
    } catch {
      return false
    }
  }, [addLog, clearRecoveryTimer])

  useEffect(() => {
    sendResumeStateRef.current = sendResumeState
  }, [sendResumeState])

  const startRecoveryTimer = useCallback(() => {
    clearRecoveryTimer()
    recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = null
      failTransfer('The sender did not reconnect in time. Try again.')
    }, RECOVERY_TIMEOUT)
  }, [clearRecoveryTimer, failTransfer])

  const beginRecovery = useCallback(
    (reason: string) => {
      if (
        finishedRef.current ||
        abortedRef.current ||
        !transferStartedRef.current ||
        stageRef.current === 'reconnecting' ||
        stageRef.current === 'error'
      ) {
        return
      }

      recoveryAttemptsRef.current += 1
      if (recoveryAttemptsRef.current > MAX_RECOVERY_ATTEMPTS) {
        failTransfer('The connection could not be restored. Try again.')
        return
      }

      setStage('reconnecting')
      setSessionError(null)
      reportEvent('transfer.recovering', {
        attempt: recoveryAttemptsRef.current,
        surface: 'receive',
      })
      addLog(`${reason}. Waiting for the sender to resume…`, 'connecting')
      startRecoveryTimer()
    },
    [addLog, failTransfer, startRecoveryTimer],
  )

  useEffect(() => {
    beginRecoveryRef.current = beginRecovery
  }, [beginRecovery])

  const attachReceiveChannel = useCallback(
    (channel: RTCDataChannel) => {
      channel.binaryType = 'arraybuffer'
      channel.bufferedAmountLowThreshold = 1024 * 1024
      dataChannelRef.current = channel

      channel.onopen = () => {
        if (transferStartedRef.current && !finishedRef.current) {
          addLog('Channel restored — asking the sender to resume…', 'connecting')
          setStage('reconnecting')
          afterVerifyRef.current = () => undefined
        } else {
          afterVerifyRef.current = () => {
            addLog('Secure channel open — waiting for the sender', 'success')
            setStage((previous) =>
              previous === 'waiting' || previous === 'connecting'
                ? 'ready'
                : previous,
            )
          }
        }

        // Every channel (including resumes) is verified before use.
        void startPeerAuthRef.current(channel)
      }

      channel.onmessage = (messageEvent) => {
        handleIncomingDataRef.current(messageEvent.data)
      }

      channel.onerror = () => {
        failTransfer('The data channel reported an error.')
      }

      channel.onclose = () => {
        if (dataChannelRef.current !== channel) return
        dataChannelRef.current = null

        if (transferStartedRef.current && !finishedRef.current && !abortedRef.current) {
          beginRecoveryRef.current('The sender connection closed')
        } else if (!finishedRef.current && !abortedRef.current) {
          addLog('Data channel closed', 'info')
        }
      }
    },
    [addLog, failTransfer],
  )

  const createReceivePeer = useCallback(
    async (sid: string): Promise<RTCPeerConnection> => {
      const iceConfig =
        (await iceConfigPromiseRef.current) ?? {
          servers: DEFAULT_STUN_SERVERS,
          turnAvailable: false,
        }

      if (sessionIdRef.current !== sid) {
        throw new Error('Session changed while creating the peer connection')
      }

      const pc = new RTCPeerConnection(
        createPeerConnectionConfig(iceConfig.servers),
      )
      peerConnectionRef.current = pc
      webrtcReadyRef.current = true

      pc.onicecandidate = (event) => {
        sendIceCandidate(socket, sid, event.candidate)
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        if (state === 'failed') {
          if (transferStartedRef.current && !finishedRef.current) {
            beginRecoveryRef.current('The peer connection failed')
          } else if (!finishedRef.current) {
            failTransfer(
              'The peer-to-peer connection failed. A TURN relay may be required on this network.',
            )
          }
        } else if (state === 'disconnected') {
          addLog('Peer connection temporarily lost; trying to recover…', 'info')
        } else if (state === 'connected') {
          addLog('Peer connection established', 'success')
        }
      }

      pc.ondatachannel = (event) => {
        attachReceiveChannel(event.channel)
      }

      return pc
    },
    [addLog, attachReceiveChannel, failTransfer, socket],
  )

  const processOffer = useCallback(
    async (offer: RTCSessionDescriptionInit) => {
      const sid = sessionIdRef.current
      if (!sid) {
        pendingOfferRef.current = offer
        return
      }

      try {
        let pc = peerConnectionRef.current
        const needsFreshPeer =
          !pc ||
          pc.signalingState === 'closed' ||
          pc.connectionState === 'failed'

        if (needsFreshPeer) {
          const oldChannel = dataChannelRef.current
          if (oldChannel) {
            oldChannel.onopen = null
            oldChannel.onclose = null
            oldChannel.onerror = null
            oldChannel.onmessage = null
            oldChannel.close()
            dataChannelRef.current = null
          }
          closePeerConnection(pc)
          peerConnectionRef.current = null
          iceBufferRef.current.reset()
          pendingIceRef.current = []
          pc = await createReceivePeer(sid)
        }

        if (!pc) return

        for (const candidate of pendingIceRef.current.splice(0)) {
          iceBufferRef.current.add(pc, candidate)
        }

        await pc.setRemoteDescription(new RTCSessionDescription(offer))
        await iceBufferRef.current.markRemoteDescriptionSet(pc)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        sendAnswer(socket, sid, answer)
        setStage((previous) => {
          if (previous === 'waiting' || previous === 'ready') return 'connecting'
          return previous
        })
        addLog('Handshake answer sent to sender', 'connecting')
      } catch (error) {
        failTransfer(`Could not answer the sender: ${describeError(error)}`)
      }
    },
    [addLog, createReceivePeer, failTransfer, socket],
  )

  const setupWebRTC = useCallback(
    async (sid: string) => {
      if (webrtcReadyRef.current) return
      addLog('Preparing the encrypted channel…', 'connecting')

      try {
        await createReceivePeer(sid)
        if (sessionIdRef.current !== sid) return

        if (pendingOfferRef.current) {
          const pending = pendingOfferRef.current
          pendingOfferRef.current = null
          await processOffer(pending)
        }
      } catch (error) {
        failTransfer(`WebRTC setup failed: ${describeError(error)}`)
      }
    },
    [addLog, createReceivePeer, failTransfer, processOffer],
  )

  const handleControlFrame = useCallback(
    (raw: string) => {
      const frame = parseControlFrameText(raw)
      if (!frame) {
        failTransfer('The sender sent malformed transfer data.')
        return
      }

      // Already verified on this channel; a repeat changes nothing.
      if (frame.type === 'auth') return

      if (frame.type === 'metadata') {
        const info: FileInfo = {
          fileName: sanitizeFileName(frame.fileName),
          mimeType: sanitizeMimeType(frame.fileType),
          fileSize: frame.fileSize,
        }

        const socketInfo = fileInfoRef.current
        if (
          socketInfo &&
          (socketInfo.fileSize !== info.fileSize ||
            socketInfo.fileName !== info.fileName)
        ) {
          failTransfer(
            'The file details from the sender do not match the session metadata.',
          )
          return
        }

        if (!isOpfsSupported() && info.fileSize > MEMORY_FALLBACK_MAX_FILE_SIZE) {
          failTransfer(
            'This browser can only receive files up to 512 MB. Use Chrome or Edge for larger files.',
          )
          return
        }

        clearRetryTimer()
        clearRecoveryTimer()
        clearRequestTimer()
        abortSink()
        dataMetaRef.current = info
        fileInfoRef.current = info
        setFileInfo(info)
        receivedBytesRef.current = 0
        initialOffsetRef.current = 0
        lastProgressRef.current = 0
        checksumRef.current = new Crc32()
        transferStartedRef.current = true
        transferStartedAtRef.current = Date.now()
        failedRef.current = false
        abortedRef.current = false
        awaitingRetryRef.current = false
        finishedRef.current = false
        transferRateRef.current.start(info.fileSize, 0)
        lastRateUiAtRef.current = 0
        setTransferRate(transferRateRef.current.snapshot())
        setTransferProgress(0)
        setStage('receiving')
        setSessionError(null)
        addLog(`Receiving ${info.fileName}…`, 'connecting')
        reportEvent('transfer.started', {
          bytes: info.fileSize,
          surface: 'receive',
        })
        return
      }

      if (frame.type === 'complete') {
        finalizeTransferRef.current(frame.fileSize, frame.crc32)
        return
      }

      if (frame.type === 'resume-request') {
        if (!sendResumeStateRef.current()) {
          failTransfer('Could not tell the sender where to resume.')
        }
        return
      }

      if (frame.type === 'cancel') {
        failTransfer(frame.message ?? 'The sender cancelled the transfer.', false)
      }
    },
    [
      abortSink,
      addLog,
      clearRecoveryTimer,
      clearRequestTimer,
      clearRetryTimer,
      failTransfer,
    ],
  )

  const handleIncomingData = useCallback(
    (data: unknown) => {
      if (abortedRef.current || finishedRef.current || awaitingRetryRef.current) {
        return
      }

      // Nothing from the sender is used until it proves it holds the link key
      // and sees this exact connection. Frames that overtake our own (async)
      // check are held and replayed once it passes.
      if (!peerVerifiedRef.current) {
        if (typeof data === 'string') {
          const frame = parseControlFrameText(data)
          if (frame?.type === 'auth') {
            void handlePeerAuthRef.current(frame)
            return
          }
        }
        if (pendingFramesRef.current.length >= MAX_PENDING_FRAMES) {
          failTransfer('The sender sent data before passing the security check.')
          return
        }
        pendingFramesRef.current.push(data)
        return
      }

      if (typeof data === 'string') {
        handleControlFrame(data)
        return
      }

      if (!(data instanceof ArrayBuffer)) {
        failTransfer('The sender sent an unsupported data frame.')
        return
      }

      const meta = dataMetaRef.current
      const checksum = checksumRef.current

      if (!meta || !checksum) {
        failTransfer('Received file data before the file details.')
        return
      }

      const nextSize = receivedBytesRef.current + data.byteLength
      if (nextSize > meta.fileSize) {
        markRecoverableFailure('The sender sent more data than expected. Restarting…')
        return
      }

      checksum.update(data)
      receivedBytesRef.current = nextSize

      let activeSink = sinkRef.current
      if (!activeSink) {
        activeSink = new IncomingFileSink(
          meta.fileName,
          meta.mimeType,
          meta.fileSize,
          MEMORY_FALLBACK_MAX_FILE_SIZE,
          { destination: destinationRef.current ?? undefined },
        )
        sinkRef.current = activeSink
      }

      void activeSink.write(data).catch((error: unknown) => {
        if (
          awaitingRetryRef.current ||
          abortedRef.current ||
          sinkRef.current !== activeSink
        ) {
          return
        }
        failTransfer(`Could not save the incoming file: ${describeError(error)}`)
      })

      const percent = Math.floor((nextSize / meta.fileSize) * 100)
      if (percent !== lastProgressRef.current) {
        lastProgressRef.current = percent
        setTransferProgress(percent)
      }

      const rate = transferRateRef.current.update(nextSize)
      const now = Date.now()
      if (now - lastRateUiAtRef.current >= 1_000) {
        lastRateUiAtRef.current = now
        setTransferRate(rate)
      }
    },
    [failTransfer, handleControlFrame, markRecoverableFailure],
  )

  useEffect(() => {
    handleIncomingDataRef.current = handleIncomingData
  }, [handleIncomingData])

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

  /** Sends this side's proof and starts the clock for the sender's. */
  const startPeerAuth = useCallback(
    async (channel: RTCDataChannel) => {
      peerVerifiedRef.current = false
      pendingFramesRef.current = []
      clearAuthTimer()

      const key = linkKeyRef.current
      const view = currentFingerprints()
      if (!key || !view) {
        failTransfer(key ? 'Could not start the security check.' : MISSING_KEY_MESSAGE)
        return
      }

      addLog('Verifying the sender…', 'connecting')
      authTimerRef.current = window.setTimeout(() => {
        authTimerRef.current = null
        // Skip if the transfer already failed for another reason.
        if (!peerVerifiedRef.current && !abortedRef.current) {
          failTransfer('The sender did not pass the security check.')
        }
      }, AUTH_TIMEOUT_MS)

      try {
        const tag = await computeAuthTag(key, 'receiver', view.local, view.remote)
        if (channel.readyState === 'open') {
          channel.send(encodeControlFrame({ type: 'auth', role: 'receiver', tag }))
        }
      } catch (error) {
        failTransfer(`The security check could not run: ${describeError(error)}`)
      }
    },
    [addLog, clearAuthTimer, currentFingerprints, failTransfer],
  )

  useEffect(() => {
    startPeerAuthRef.current = startPeerAuth
  }, [startPeerAuth])

  const handlePeerAuth = useCallback(
    async (frame: AuthFrame) => {
      if (peerVerifiedRef.current) return

      const key = linkKeyRef.current
      const view = currentFingerprints()
      const valid =
        frame.role === 'sender' &&
        key !== null &&
        view !== null &&
        (await verifyAuthTag(key, 'sender', frame.tag, view))

      if (!valid || !key || !view) {
        clearAuthTimer()
        pendingFramesRef.current = []
        failTransfer(
          'Security check failed: this connection does not lead directly to the sender who shared the link. Nothing was received.',
        )
        return
      }

      peerVerifiedRef.current = true
      clearAuthTimer()
      const code = await computeVerificationCode(key, view.local, view.remote)
      setVerificationCode(code)
      addLog(`Sender verified — security code ${code}`, 'success')
      reportEvent('peer.verified', { surface: 'receive' })
      afterVerifyRef.current()

      const queued = pendingFramesRef.current
      pendingFramesRef.current = []
      for (const data of queued) handleIncomingDataRef.current(data)
    },
    [addLog, clearAuthTimer, currentFingerprints, failTransfer],
  )

  useEffect(() => {
    handlePeerAuthRef.current = handlePeerAuth
  }, [handlePeerAuth])

  const finalizeTransfer = useCallback(
    async (expectedSize: number, expectedCrc: number) => {
      if (abortedRef.current || finishedRef.current) return

      const meta = dataMetaRef.current
      const sink = sinkRef.current
      const checksum = checksumRef.current

      if (!meta || !sink || !checksum) {
        markRecoverableFailure(
          'The transfer ended before the file was complete. Restarting…',
        )
        return
      }

      if (!Number.isFinite(expectedSize) || expectedSize !== meta.fileSize) {
        markRecoverableFailure(
          'The sender reported an unexpected file size. Restarting…',
        )
        return
      }

      if (receivedBytesRef.current !== meta.fileSize) {
        markRecoverableFailure(
          `The transfer is incomplete (${receivedBytesRef.current} of ${meta.fileSize} bytes). Restarting…`,
        )
        return
      }

      if (checksum.digest() !== expectedCrc) {
        markRecoverableFailure(
          'The file checksum did not match. Restarting from the beginning…',
        )
        return
      }

      try {
        const finished = await sink.finish()
        receivedFileCleanupRef.current = finished.cleanup
        clearRetryTimer()
        clearRecoveryTimer()
        clearRequestTimer()
        setReceivedFile({
          name: finished.name,
          url: finished.url,
          mode: finished.mode,
        })
        setTransferProgress(100)
        setStage('done')
        setRetryable(false)
        finishedRef.current = true
        transferStartedRef.current = false
        addLog(
          finished.mode === 'direct'
            ? `Saved directly to disk: ${finished.name}`
            : `File verified and ready to save: ${finished.name}`,
          'success',
        )
        reportEvent('transfer.received', {
          bytes: meta.fileSize,
          durationMs: Date.now() - transferStartedAtRef.current,
          resumed: initialOffsetRef.current > 0,
          saveMode: finished.mode,
        })

        if (
          autoDownloadRef.current &&
          downloadModeRef.current === 'fallback' &&
          finished.url
        ) {
          setSaved(true)
          window.setTimeout(() => {
            if (finished.url) triggerDownload(finished.url, finished.name)
          }, 0)
        } else if (finished.mode === 'direct') {
          setSaved(true)
        }

        if (sessionIdRef.current) {
          sendTransferComplete(socket, sessionIdRef.current, finished.name)
        }
      } catch (error) {
        failTransfer(`Could not finish saving the file: ${describeError(error)}`)
      }
    },
    [
      addLog,
      clearRecoveryTimer,
      clearRequestTimer,
      clearRetryTimer,
      failTransfer,
      markRecoverableFailure,
      socket,
    ],
  )

  useEffect(() => {
    finalizeTransferRef.current = finalizeTransfer
  }, [finalizeTransfer])

  useEffect(() => {
    const handleConnect = () => {
      setIsConnected(true)
      addLog('Connected to server', 'success')

      if (socket.recovered) {
        addLog('Connection recovered', 'success')
      }

      if (stageRef.current === 'reconnecting') {
        addLog('Signaling reconnected; waiting for the sender to resume', 'info')
      }
    }

    const handleDisconnect = () => {
      setIsConnected(false)
      addLog('Signaling connection lost', 'error')
      if (transferStartedRef.current && !finishedRef.current) {
        addLog('The WebRTC transfer may continue while the server reconnects', 'info')
      }
    }

    onConnect(socket, handleConnect)
    onDisconnect(socket, handleDisconnect)

    return () => {
      offConnect(socket, handleConnect)
      offDisconnect(socket, handleDisconnect)
    }
  }, [addLog, socket])

  /**
   * The server stores the file name and type encrypted with the link key.
   * Returns the plaintext details, or null when they can't be decrypted.
   * (Plain names from an older sender are passed through.)
   */
  const readMetadata = useCallback(
    async (metadata: FileMetadata): Promise<FileMetadata | null> => {
      if (!isEncryptedMetadata(metadata.fileName)) return metadata
      const key = linkKeyRef.current
      if (!key) return null
      const plain = await decryptMetadata(key, metadata.fileName)
      return plain ? { ...plain, fileSize: metadata.fileSize } : null
    },
    [],
  )

  useEffect(() => {
    const applyFileMetadata = (metadata: FileMetadata) => {
      const info: FileInfo = {
        fileName: sanitizeFileName(metadata.fileName),
        mimeType: sanitizeMimeType(metadata.mimeType),
        fileSize: metadata.fileSize,
      }

      if (!Number.isFinite(info.fileSize) || info.fileSize <= 0) return
      if (info.fileSize > MAX_FILE_SIZE) {
        setSessionError('The sender selected a file larger than 50 GB.')
        return
      }

      fileInfoRef.current = info
      setFileInfo(info)

      if (!isOpfsSupported() && info.fileSize > MEMORY_FALLBACK_MAX_FILE_SIZE) {
        setSessionError(
          'This browser cannot stream to disk, so it can only receive files up to 512 MB. Use Chrome or Edge for larger files.',
        )
      }

      setStage((previous) =>
        previous === 'waiting' || previous === 'joining' ? 'ready' : previous,
      )
    }

    const handleFileMetadata = (data: FileMetadataEvent) => {
      if (data.sessionId && data.sessionId !== sessionIdRef.current) return
      if (!data.success || !data.metadata) return

      const alreadyReceiving =
        stageRef.current === 'receiving' ||
        stageRef.current === 'reconnecting' ||
        stageRef.current === 'done'
      if (alreadyReceiving) return

      const sid = sessionIdRef.current
      void readMetadata(data.metadata).then((metadata) => {
        if (sessionIdRef.current !== sid) return
        if (!metadata) {
          setSessionError(UNREADABLE_DETAILS_MESSAGE)
          addLog('Could not decrypt the file details', 'error')
          return
        }
        applyFileMetadata(metadata)
        addLog(
          `File ready: ${sanitizeFileName(metadata.fileName)} (${formatFileSize(metadata.fileSize)})`,
          'success',
        )
      })
    }

    const handleSessionError = (data: SessionErrorEvent) => {
      if (/unauthorized/i.test(data.message) && !joinedIdRef.current) {
        addLog('Ignored an authorization response from before the session joined', 'info')
        return
      }

      setSessionError(data.message)
      addLog(`Session error: ${data.message}`, 'error')

      if (isTerminalSessionError(data.message) && !finishedRef.current) {
        failTransfer(data.message, false)
      }
    }

    onFileMetadata(socket, handleFileMetadata)
    onSessionError(socket, handleSessionError)

    return () => {
      offFileMetadata(socket, handleFileMetadata)
      offSessionError(socket, handleSessionError)
    }
  }, [abortSink, addLog, failTransfer, readMetadata, socket, teardownPeer])

  useEffect(() => {
    const handleOfferEvent = ({ offer }: OfferEvent) => {
      addLog('Received connection offer from sender', 'connecting')
      void processOffer(offer)
    }

    const handleIceCandidateEvent = ({ candidate }: IceCandidateEvent) => {
      if (!candidate) return
      const pc = peerConnectionRef.current
      if (!pc) {
        pendingIceRef.current.push(candidate)
        return
      }
      iceBufferRef.current.add(pc, candidate)
    }

    const handlePeerLeft = () => {
      if (finishedRef.current) {
        addLog('Sender left the session', 'info')
        teardownPeer()
        return
      }

      if (transferStartedRef.current && !abortedRef.current) {
        addLog(
          'Sender left the signaling session. The transfer may continue…',
          'info',
        )
        if (dataChannelRef.current?.readyState !== 'open') {
          beginRecoveryRef.current('The sender disconnected')
        }
        return
      }

      const wasReceiving =
        stageRef.current === 'receiving' || stageRef.current === 'connecting'
      clearRequestTimer()
      abortedRef.current = true
      transferStartedRef.current = false
      teardownPeer()
      abortSink()
      setStage('error')
      setSessionError(
        wasReceiving
          ? 'The sender disconnected during the transfer.'
          : 'The sender disconnected or the session expired.',
      )
      addLog(
        wasReceiving ? 'Sender disconnected mid-transfer' : 'Sender disconnected',
        'error',
      )
    }

    const handleTransferError = () => {
      if (finishedRef.current) return
      failTransfer('The sender reported a transfer error.', false)
    }

    const handleTransferComplete = () => {
      if (!finishedRef.current) {
        addLog('Sender confirmed the transfer', 'success')
      }
    }

    onOffer(socket, handleOfferEvent)
    onIceCandidate(socket, handleIceCandidateEvent)
    onPeerLeft(socket, handlePeerLeft)
    onTransferError(socket, handleTransferError)
    onTransferComplete(socket, handleTransferComplete)

    return () => {
      offOffer(socket, handleOfferEvent)
      offIceCandidate(socket, handleIceCandidateEvent)
      offPeerLeft(socket, handlePeerLeft)
      offTransferError(socket, handleTransferError)
      offTransferComplete(socket, handleTransferComplete)
    }
  }, [
    abortSink,
    addLog,
    clearRequestTimer,
    failTransfer,
    processOffer,
    socket,
    teardownPeer,
  ])

  const handleJoinSession = useCallback(
    (id: string) => {
      if (!socket.connected) {
        setSessionError('Not connected to the signaling server yet.')
        addLog('Not connected to server', 'error')
        return
      }

      if (!isValidSessionId(id)) {
        setStage('error')
        setSessionError('That session key is not valid.')
        addLog('Invalid session key', 'error')
        return
      }

      // Without the key the sender can't be verified, so the sender would
      // never release the file; say so instead of joining.
      if (!linkKeyRef.current) {
        setStage('error')
        setSessionError(MISSING_KEY_MESSAGE)
        addLog('The link has no security key', 'error')
        return
      }

      if (joinInFlightRef.current || joinedIdRef.current === id) return
      joinInFlightRef.current = true

      clearRequestTimer()
      destinationRef.current = null
      downloadModeRef.current = null
      autoDownloadRef.current = false
      setDownloadMode(null)
      setStage('joining')
      setSessionError(null)
      addLog('Joining session…', 'connecting')

      let settled = false
      const timeout = window.setTimeout(() => {
        if (settled) return
        settled = true
        joinInFlightRef.current = false
        setStage('error')
        setSessionError('Joining the session timed out. Please try again.')
        addLog('Join request timed out', 'error')
      }, JOIN_ACK_TIMEOUT)

      joinSession(socket, id, (response: JoinSessionResponse) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        joinInFlightRef.current = false

        if (!response?.success) {
          setStage('error')
          setSessionError(response?.message ?? 'Could not join the session.')
          addLog('Failed to join the session', 'error')
          return
        }

        joinedIdRef.current = id
        sessionIdRef.current = id
        setSessionId(id)
        webrtcReadyRef.current = false
        abortedRef.current = false
        finishedRef.current = false
        failedRef.current = false
        recoveryAttemptsRef.current = 0
        addLog('Session joined', 'success')

        iceConfigPromiseRef.current = fetchIceServers(id).then((config) => {
          setTurnAvailable(config.turnAvailable)
          return config
        })
        void setupWebRTC(id)

        if (response.metadata) {
          void readMetadata(response.metadata).then((metadata) => {
            if (sessionIdRef.current !== id) return
            if (!metadata) {
              setStage('error')
              setSessionError(UNREADABLE_DETAILS_MESSAGE)
              addLog('Could not decrypt the file details', 'error')
              return
            }

            const info: FileInfo = {
              fileName: sanitizeFileName(metadata.fileName),
              mimeType: sanitizeMimeType(metadata.mimeType),
              fileSize: metadata.fileSize,
            }

            if (info.fileSize > MAX_FILE_SIZE) {
              setStage('error')
              setSessionError('The sender selected a file larger than 50 GB.')
              return
            }

            fileInfoRef.current = info
            setFileInfo(info)
            setStage('ready')
            addLog(
              `File ready: ${info.fileName} (${formatFileSize(info.fileSize)})`,
              'success',
            )

            if (!isOpfsSupported() && info.fileSize > MEMORY_FALLBACK_MAX_FILE_SIZE) {
              setSessionError(
                'This browser cannot stream to disk, so it can only receive files up to 512 MB. Use Chrome or Edge for larger files.',
              )
            }
          })
        } else {
          setStage('waiting')
        }
      })
    },
    [addLog, clearRequestTimer, readMetadata, setupWebRTC, socket],
  )

  useEffect(() => {
    if (!urlSessionId || autoJoinStartedRef.current) return
    if (!isConnected) return
    autoJoinStartedRef.current = true
    joinedIdRef.current = ''
    handleJoinSession(urlSessionId)
  }, [handleJoinSession, isConnected, urlSessionId])

  const handleInputSubmit = useCallback(
    (value: string) => {
      const link = extractReceiveLink(value)
      if (!link) {
        setSessionError('Paste the receive link the sender shared.')
        addLog('Invalid receive link', 'error')
        return false
      }
      if (!link.key) {
        setSessionError(MISSING_KEY_MESSAGE)
        addLog('The link has no security key', 'error')
        return false
      }

      linkKeyRef.current = link.key
      autoJoinStartedRef.current = true
      joinedIdRef.current = ''
      // The key stays in the fragment, which is never sent to the server.
      navigate(`/receive/${link.sessionId}#k=${link.key}`, { replace: true })
      handleJoinSession(link.sessionId)
      return true
    },
    [addLog, handleJoinSession, navigate],
  )

  const handleStartDownload = useCallback(async () => {
    const info = fileInfoRef.current
    const channel = dataChannelRef.current
    if (!info || stageRef.current !== 'ready') return

    if (!channel || channel.readyState !== 'open') {
      setSessionError('The sender connection is not ready yet.')
      addLog('The sender connection is not ready yet', 'error')
      return
    }

    if (!peerVerifiedRef.current) {
      setSessionError('Still verifying the sender — try again in a moment.')
      addLog('The sender has not passed the security check yet', 'error')
      return
    }

    let mode = downloadModeRef.current
    let destination = destinationRef.current

    if (!mode) {
      const picker = getSaveFilePicker()
      if (picker) {
        try {
          destination = await picker({ suggestedName: info.fileName })
          mode = 'direct'
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            addLog('Save location selection cancelled', 'info')
            return
          }
          addLog(
            'Direct save is unavailable. Using temporary browser storage instead.',
            'info',
          )
          mode = 'fallback'
        }
      } else {
        mode = 'fallback'
      }
    }

    if (stageRef.current !== 'ready') {
      addLog('The transfer already started before a save location was selected', 'info')
      return
    }

    const activeChannel = dataChannelRef.current
    if (!activeChannel || activeChannel.readyState !== 'open') {
      setSessionError('The sender disconnected before the transfer started.')
      setStage('error')
      addLog('The sender disconnected before the transfer started', 'error')
      return
    }

    destinationRef.current = destination
    downloadModeRef.current = mode
    autoDownloadRef.current = mode === 'fallback'
    setDownloadMode(mode)
    setSessionError(null)
    setRetryable(false)
    setTransferProgress(0)
    setSaved(false)
    setTransferRate({ bytesPerSecond: null, etaSeconds: null })
    transferRateRef.current.reset()
    lastRateUiAtRef.current = 0
    failedRef.current = false
    abortedRef.current = false
    finishedRef.current = false
    transferStartedRef.current = false
    awaitingRetryRef.current = false
    dataMetaRef.current = null
    checksumRef.current = null
    receivedBytesRef.current = 0
    initialOffsetRef.current = 0
    lastProgressRef.current = -1
    setStage('requesting')
    addLog(
      mode === 'direct'
        ? 'Starting transfer to your chosen file…'
        : 'Starting transfer with automatic download…',
      'connecting',
    )
    reportEvent('transfer.requested', {
      surface: 'receive',
      saveMode: mode,
    })

    clearRequestTimer()
    requestTimerRef.current = window.setTimeout(() => {
      requestTimerRef.current = null
      if (stageRef.current !== 'requesting') return
      setStage('ready')
      setSessionError('The sender did not start the transfer. Try again.')
      addLog('The sender did not start the transfer in time', 'error')
    }, REQUEST_TIMEOUT)

    try {
      activeChannel.send(encodeControlFrame({ type: 'request-transfer' }))
    } catch (error) {
      clearRequestTimer()
      setStage('ready')
      setSessionError('Could not ask the sender to start the transfer.')
      addLog(`Could not request the transfer: ${describeError(error)}`, 'error')
    }
  }, [addLog, clearRequestTimer])

  const handleRetryTransfer = useCallback(() => {
    const channel = dataChannelRef.current
    if (!channel || channel.readyState !== 'open') {
      failTransfer('The sender is no longer connected. Try again later.', false)
      return
    }

    setRetryable(false)
    setSessionError(null)
    setTransferProgress(0)
    setTransferRate({ bytesPerSecond: null, etaSeconds: null })
    failedRef.current = false
    abortedRef.current = false
    awaitingRetryRef.current = false
    finishedRef.current = false
    transferStartedRef.current = false
    dataMetaRef.current = null
    checksumRef.current = null
    receivedBytesRef.current = 0
    initialOffsetRef.current = 0
    lastProgressRef.current = -1
    transferRateRef.current.reset()
    lastRateUiAtRef.current = 0
    setStage('requesting')
    addLog('Asking the sender to resend the file…', 'connecting')
    reportEvent('transfer.retry-requested', { surface: 'receive' })

    try {
      channel.send(encodeControlFrame({ type: 'retry' }))
    } catch (error) {
      failTransfer(`Could not ask the sender to retry: ${describeError(error)}`)
      return
    }

    clearRetryTimer()
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null
      failTransfer('The sender did not respond to the retry request. Try again.', false)
    }, RETRY_TIMEOUT)
  }, [addLog, clearRetryTimer, failTransfer])

  const handleCancelReceive = useCallback(() => {
    const channel = dataChannelRef.current
    if (channel?.readyState === 'open') {
      try {
        channel.send(
          encodeControlFrame({ type: 'cancel', message: 'cancelled by receiver' }),
        )
      } catch {
        // The channel may already be closing.
      }
    }
    if (sessionIdRef.current && socket.connected) {
      sendTransferError(socket, sessionIdRef.current, 'cancelled by receiver')
    }

    abortedRef.current = true
    transferStartedRef.current = false
    failedRef.current = true
    awaitingRetryRef.current = false
    clearRecoveryTimer()
    clearRetryTimer()
    clearRequestTimer()
    destinationRef.current = null
    downloadModeRef.current = null
    autoDownloadRef.current = false
    setDownloadMode(null)
    teardownPeer()
    abortSink()
    setStage('error')
    setSessionError('Receive cancelled.')
    setRetryable(false)
    setTransferRate({ bytesPerSecond: null, etaSeconds: null })
    addLog('Receive cancelled', 'info')
    reportEvent('transfer.cancelled', { surface: 'receive' })
  }, [
    abortSink,
    addLog,
    clearRecoveryTimer,
    clearRequestTimer,
    clearRetryTimer,
    socket,
    teardownPeer,
  ])

  const handleSaveFile = useCallback(() => {
    if (!receivedFile?.url) return

    triggerDownload(receivedFile.url, receivedFile.name)
    setSaved(true)
    addLog('Download started', 'success')
  }, [addLog, receivedFile])

  const handleCopySessionId = useCallback(async () => {
    const id = sessionId || urlSessionId
    if (!id) return

    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2_000)
    } catch {
      addLog('Could not copy the session key', 'error')
    }
  }, [addLog, sessionId, urlSessionId])

  const handleTryAgain = useCallback(() => {
    abortedRef.current = true
    transferStartedRef.current = false
    finishedRef.current = false
    failedRef.current = false
    awaitingRetryRef.current = false
    joinedIdRef.current = ''
    autoJoinStartedRef.current = false
    joinInFlightRef.current = false
    clearRecoveryTimer()
    clearRetryTimer()
    clearRequestTimer()
    destinationRef.current = null
    downloadModeRef.current = null
    autoDownloadRef.current = false
    teardownPeer()
    abortSink()
    releaseReceivedFile()

    sessionIdRef.current = ''
    fileInfoRef.current = null
    dataMetaRef.current = null
    receivedBytesRef.current = 0
    checksumRef.current = null
    lastProgressRef.current = -1
    initialOffsetRef.current = 0
    iceConfigPromiseRef.current = null
    recoveryAttemptsRef.current = 0
    transferRateRef.current.reset()
    lastRateUiAtRef.current = 0

    setSessionId('')
    setFileInfo(null)
    setReceivedFile(null)
    setSaved(false)
    setSessionError(null)
    setRetryable(false)
    setDownloadMode(null)
    setTurnAvailable(null)
    setTransferProgress(0)
    setTransferRate({ bytesPerSecond: null, etaSeconds: null })
    setStage('input')
    addLog('Ready to receive another file', 'info')

    navigate('/receive', { replace: true })
  }, [
    abortSink,
    addLog,
    clearRecoveryTimer,
    clearRequestTimer,
    clearRetryTimer,
    navigate,
    releaseReceivedFile,
    teardownPeer,
  ])

  useEffect(() => {
    return () => {
      abortedRef.current = true
      transferStartedRef.current = false
      clearRecoveryTimer()
      clearRetryTimer()
      clearRequestTimer()
      teardownPeer()
      abortSink()
      releaseReceivedFile()
    }
  }, [
    abortSink,
    clearRecoveryTimer,
    clearRequestTimer,
    clearRetryTimer,
    releaseReceivedFile,
    teardownPeer,
  ])

  useEffect(() => {
    if (!transferStartedRef.current || stage === 'done' || stage === 'error') return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [stage])

  const isTransferring = stage === 'receiving'
  const isConnectingStage = stage === 'connecting'
  const isReconnecting = stage === 'reconnecting'
  const showProgress =
    isTransferring || isReconnecting || stage === 'done'
  const isDone = stage === 'done'
  const isError = stage === 'error'
  const displaySessionId = sessionId || urlSessionId || ''
  const ttlNearExpiry =
    ttl.seconds !== null && ttl.seconds > 0 && ttl.seconds <= 60
  const storageLabel =
    receivedFile?.mode === 'direct'
      ? 'Saved directly to your chosen location'
      : receivedFile?.mode === 'opfs'
        ? 'Saved to temporary browser storage'
        : 'Buffered in memory'

  return {
    stage,
    sessionId,
    verificationCode,
    fileInfo,
    transferProgress,
    receivedFile,
    saved,
    copied,
    isConnected,
    sessionError,
    retryable,
    downloadMode,
    turnAvailable,
    transferRate,
    logs,
    ttl,
    isTransferring,
    isConnectingStage,
    isReconnecting,
    isRequesting: stage === 'requesting',
    showProgress,
    isDone,
    isError,
    displaySessionId,
    ttlNearExpiry,
    storageLabel,
    handleInputSubmit,
    handleStartDownload,
    handleRetryTransfer,
    handleCancelReceive,
    handleSaveFile,
    handleCopySessionId,
    handleTryAgain,
  }
}

export type ReceiveSession = ReturnType<typeof useReceiveSession>
