import {
  Check,
  Copy,
  Link2,
  Loader2,
  Pause,
  Play,
  Share2,
  Upload,
  X,
} from 'lucide-react'

import ErrorAlert from '../../components/ErrorAlert'
import FileDetailsCard from '../../components/FileDetailsCard'
import PageHeader from '../../components/PageHeader'
import StatusLine from '../../components/StatusLine'
import StatusPill from '../../components/StatusPill'
import type { StatusTone } from '../../components/StatusPill'
import StepTracker from '../../components/StepTracker'
import TransferProgress from '../../components/TransferProgress'
import { Button } from '../../components/ui/button'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import FileDropzone from './FileDropzone'
import type { SendSession } from './useSendSession'

const STEPS = ['Choose file', 'Share link', 'Transfer'] as const
const ACTION = 'h-11 px-5 text-sm font-semibold'

function describeStatus(session: SendSession): { label: string; tone: StatusTone } {
  if (session.isError) return { label: 'Connection failed', tone: 'error' }
  if (session.isDone) {
    return session.receiverConfirmed
      ? { label: 'Delivered', tone: 'ok' }
      : { label: 'Sent', tone: 'ok' }
  }
  if (session.isReconnecting) {
    return { label: 'Reconnecting to receiver…', tone: 'warn' }
  }
  if (session.isTransferring) return { label: 'Sending…', tone: 'busy' }
  if (session.isPeerConnected) return { label: 'Receiver connected', tone: 'ok' }
  if (session.stage === 'peer_joined' || session.stage === 'webrtc_negotiating') {
    return { label: 'Connecting to receiver…', tone: 'busy' }
  }
  if (session.isCreatingSession) return { label: 'Creating session…', tone: 'busy' }
  return { label: 'Waiting for receiver…', tone: 'idle' }
}

function currentStep(session: SendSession): number {
  if (!session.file) return 0
  if (session.isDone) return STEPS.length
  if (session.isTransferring || session.isReconnecting || session.isPeerConnected) {
    return 2
  }
  return 1
}

export default function SendView({ session }: { session: SendSession }) {
  const isDesktop = useIsDesktop()
  const currentLog = session.logs[session.logs.length - 1]
  const status = describeStatus(session)
  const isActive = session.isTransferring || session.isReconnecting
  const ttlNearExpiry =
    session.ttl.seconds !== null &&
    session.ttl.seconds > 0 &&
    session.ttl.seconds <= 60
  const awaitingReceiver =
    !isActive && !session.isDone && !session.isError && Boolean(session.sessionId)
  const canStartOver =
    !isActive && (session.isDone || session.isError || !session.sessionId)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 pt-2 sm:pt-6">
      <PageHeader
        icon={
          <Share2
            className="h-8 w-8 text-[#2E8B73] md:h-12 md:w-12"
            aria-hidden="true"
          />
        }
        title="Send File."
        description={session.file ? undefined : 'Please add a file to begin sharing'}
      />

      <StepTracker
        label="Send progress"
        steps={STEPS}
        current={currentStep(session)}
        failed={session.isError}
      />

      {!session.file ? (
        <FileDropzone onFile={session.handleFileSelect} />
      ) : (
        <div className="space-y-5">
          {session.sessionError && <ErrorAlert message={session.sessionError} />}

          <FileDetailsCard
            fileName={session.file.name}
            fileSize={session.file.size}
            mimeType={session.file.type || 'application/octet-stream'}
            addedAt={session.uploadTime}
            ttlSeconds={session.ttl.seconds}
            ttlNearExpiry={ttlNearExpiry}
            verificationCode={session.verificationCode}
            status={
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <StatusPill tone={status.tone} label={status.label} />
                {session.receiverConfirmed && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    Verified by receiver
                  </span>
                )}
              </div>
            }
          >
            {awaitingReceiver && !session.isPeerConnected && (
              <div className="mt-6 flex gap-3 rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
                <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2E8B73]" aria-hidden="true" />
                <p className="text-muted-foreground">
                  Copy the link and send it to the receiver. Keep this tab open: the
                  file goes straight from this device and is never uploaded to the
                  server.
                </p>
              </div>
            )}

            {(isActive || session.isDone) && (
              <TransferProgress
                value={session.transferProgress}
                label={
                  session.isDone
                    ? 'Sent — awaiting verification'
                    : session.isReconnecting
                      ? 'Connection interrupted — resuming'
                      : 'Transferring'
                }
                bytesPerSecond={session.transferRate.bytesPerSecond}
                etaSeconds={session.transferRate.etaSeconds}
                paused={session.paused}
                done={session.isDone}
                tone="indigo"
                className="mt-6 border-t border-white/10 pt-5"
              />
            )}

            {session.isDone && (
              <div className="mt-5 flex items-center gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-emerald-200">
                <Check className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="font-medium">
                  {session.receiverConfirmed
                    ? 'Receiver verified and saved the file'
                    : 'File sent — the receiver is verifying it'}
                </span>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:flex-wrap">
              {session.sessionId && !session.isDone && !session.isError && (
                <Button
                  type="button"
                  onClick={session.handleCopyUrl}
                  className={`${ACTION} bg-[#2E8B73] text-white hover:bg-[#2E8B73]/90 sm:flex-1`}
                >
                  {session.copied ? (
                    <>
                      <Check aria-hidden="true" />
                      <span>Link Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy aria-hidden="true" />
                      <span>Copy Link</span>
                    </>
                  )}
                </Button>
              )}

              {session.isTransferring && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={session.handleTogglePause}
                  className={`${ACTION} border-white/15 bg-white/5 hover:border-white/30`}
                >
                  {session.paused ? (
                    <>
                      <Play aria-hidden="true" />
                      <span>Resume</span>
                    </>
                  ) : (
                    <>
                      <Pause aria-hidden="true" />
                      <span>Pause</span>
                    </>
                  )}
                </Button>
              )}

              {(isActive || awaitingReceiver) && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={session.handleCancelTransfer}
                  className={`${ACTION} border-red-400/30 bg-transparent text-red-300 hover:bg-red-500/10 hover:text-red-200`}
                >
                  <X aria-hidden="true" />
                  <span>{isActive ? 'Cancel Transfer' : 'Cancel'}</span>
                </Button>
              )}

              {canStartOver && (
                <Button
                  type="button"
                  onClick={session.handleStartOver}
                  disabled={session.isCreatingSession}
                  className={`${ACTION} bg-[#2E8B73] text-white hover:bg-[#2E8B73]/90 sm:flex-1`}
                >
                  {session.isCreatingSession ? (
                    <Loader2
                      className="animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <Upload aria-hidden="true" />
                  )}
                  <span>
                    {session.isCreatingSession ? 'Creating…' : 'Start New Transfer'}
                  </span>
                </Button>
              )}
            </div>

            {awaitingReceiver && session.isPeerConnected && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                The receiver can download the file from their page.
              </p>
            )}
          </FileDetailsCard>
        </div>
      )}

      {session.file && !session.isDone && (
        <div role="status" aria-live="polite">
          <StatusLine currentLog={currentLog} isDesktop={isDesktop} />
        </div>
      )}
    </div>
  )
}
