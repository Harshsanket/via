import {
  Check,
  Copy,
  Loader2,
  Pause,
  Play,
  Share2,
  Upload,
  X,
} from 'lucide-react'

import ErrorAlert from '../../components/ErrorAlert'
import FileDetailsCard from '../../components/FileDetailsCard'
import StatusLine from '../../components/StatusLine'
import TransferProgress from '../../components/TransferProgress'
import { Button } from '../../components/ui/button'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import FileDropzone from './FileDropzone'
import type { SendSession } from './useSendSession'

export default function SendView({ session }: { session: SendSession }) {
  const isDesktop = useIsDesktop()
  const currentLog = session.logs[session.logs.length - 1]
  const ttlNearExpiry =
    session.ttl.seconds !== null &&
    session.ttl.seconds > 0 &&
    session.ttl.seconds <= 60
  const showProgress =
    session.isTransferring ||
    session.isReconnecting ||
    session.isDone

  const isNegotiating =
    session.stage === 'peer_joined' || session.stage === 'webrtc_negotiating'

  const statusLabel = session.isError
    ? 'Connection failed'
    : session.isPeerConnected
      ? 'Receiver connected'
      : session.isReconnecting
        ? 'Reconnecting to receiver…'
        : isNegotiating
          ? 'Connecting to receiver…'
          : session.isCreatingSession
            ? 'Creating session…'
            : 'Waiting for receiver…'

  const statusTone = session.isError
    ? { dot: 'bg-red-500', text: 'text-red-300' }
    : session.isPeerConnected
      ? { dot: 'bg-emerald-500', text: 'text-emerald-300' }
      : session.isReconnecting
        ? { dot: 'bg-amber-500', text: 'text-amber-300' }
        : isNegotiating || session.isCreatingSession
          ? {
              dot: 'bg-blue-400 animate-pulse motion-reduce:animate-none',
              text: 'text-blue-300',
            }
          : { dot: 'bg-gray-600', text: 'text-muted-foreground' }

  const waitingForReceiver =
    !session.isTransferring &&
    !session.isReconnecting &&
    !session.isDone &&
    !session.isError &&
    session.sessionId

  return (
    <div className="flex w-full flex-1 flex-col">
      <section className="mt-4 flex flex-col items-center justify-center sm:mt-8">
        <div className="flex items-center justify-center gap-4 text-center">
          <Share2
            className="h-8 w-8 text-[#2E8B73] md:h-12 md:w-12"
            aria-hidden="true"
          />
          <h1 className="font-serif text-4xl font-light tracking-tighter md:text-6xl">
            Send File.
          </h1>
        </div>
        {!session.file && (
          <p className="mt-5 text-lg font-light text-muted-foreground sm:text-xl">
            Please add a file to begin sharing
          </p>
        )}
      </section>

      <section className="mx-auto flex w-full max-w-2xl flex-col items-center justify-start px-1 py-8 sm:flex-1 sm:justify-center sm:px-4 sm:py-10">
        {!session.file && (
          <div className="w-full">
            <FileDropzone onFile={session.handleFileSelect} />
          </div>
        )}

        {session.file && (
          <div className="w-full space-y-6">
            {session.sessionError && (
              <ErrorAlert message={session.sessionError} />
            )}

            <FileDetailsCard
              fileName={session.file.name}
              fileSize={session.file.size}
              mimeType={session.file.type || 'application/octet-stream'}
              addedAt={session.uploadTime}
              sessionId={session.sessionId}
              ttlSeconds={session.ttl.seconds}
              ttlNearExpiry={ttlNearExpiry}
              verificationCode={session.verificationCode}
              status={
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusTone.dot}`}
                      aria-hidden="true"
                    />
                    <span className={`text-sm font-medium ${statusTone.text}`}>
                      {statusLabel}
                    </span>
                  </span>
                  {session.receiverConfirmed && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      Verified by receiver
                    </span>
                  )}
                </div>
              }
            >
              {showProgress && (
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
                <div className="mt-6 flex items-center gap-3 border-t border-white/10 pt-5 text-emerald-300">
                  <Check className="h-5 w-5" aria-hidden="true" />
                  <span className="font-medium">
                    {session.receiverConfirmed
                      ? 'Receiver verified and saved the file'
                      : 'File sent — the receiver is verifying it'}
                  </span>
                </div>
              )}
            </FileDetailsCard>

            <div className="flex flex-wrap justify-center gap-3 pt-2">
              {session.sessionId && (
                <Button
                  type="button"
                  onClick={session.handleCopyUrl}
                  variant="outline"
                  className="flex h-11 items-center gap-2 border-white/15 bg-white/5 px-5 text-sm font-semibold hover:border-white/30"
                >
                  {session.copied ? (
                    <>
                      <Check className="h-4 w-4" aria-hidden="true" />
                      <span>Link Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      <span>Copy Link</span>
                    </>
                  )}
                </Button>
              )}

              {(session.isTransferring || session.isReconnecting) && (
                <>
                  {session.isTransferring && (
                    <Button
                      type="button"
                      onClick={session.handleTogglePause}
                      variant="outline"
                      className="flex h-11 items-center gap-2 px-5 text-sm font-semibold"
                    >
                      {session.paused ? (
                        <>
                          <Play className="h-4 w-4" aria-hidden="true" />
                          <span>Resume</span>
                        </>
                      ) : (
                        <>
                          <Pause className="h-4 w-4" aria-hidden="true" />
                          <span>Pause</span>
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={session.handleCancelTransfer}
                    variant="destructive"
                    className="flex h-11 items-center gap-2 px-5 text-sm font-semibold"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                    <span>Cancel Transfer</span>
                  </Button>
                </>
              )}

              {waitingForReceiver && (
                <Button
                  type="button"
                  onClick={session.handleCancelTransfer}
                  variant="destructive"
                  className="flex h-11 items-center gap-2 px-5 text-sm font-semibold"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  <span>Cancel</span>
                </Button>
              )}

              {waitingForReceiver && session.isPeerConnected && (
                <p className="w-full text-center text-xs text-muted-foreground">
                  The receiver can download the file from their page.
                </p>
              )}

              {!session.isTransferring &&
                !session.isReconnecting &&
                (session.isDone || session.isError || !session.sessionId) && (
                  <Button
                    type="button"
                    onClick={session.handleStartOver}
                    disabled={session.isCreatingSession}
                    className="flex h-11 items-center gap-2 bg-[#2E8B73] px-5 text-sm font-semibold text-white hover:bg-[#2E8B73]/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {session.isCreatingSession ? (
                      <Loader2
                        className="h-4 w-4 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : (
                      <Upload className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>
                      {session.isCreatingSession ? 'Creating…' : 'Start New Transfer'}
                    </span>
                  </Button>
                )}
            </div>

            {!session.isDone && (
              <div className="py-2 text-center" role="status" aria-live="polite">
                <StatusLine currentLog={currentLog} isDesktop={isDesktop} />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
