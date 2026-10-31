import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Download,
  FileDown,
  Loader2,
  RotateCcw,
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
import type { ReceiveSession, ReceiveStage } from './useReceiveSession'

const STEPS = ['Join', 'Review', 'Download'] as const
const ACTION = 'h-12 px-5 text-base font-semibold'
const CANCEL =
  'h-12 border-red-400/30 bg-transparent px-5 text-sm font-semibold text-red-300 hover:bg-red-500/10 hover:text-red-200'

/** Stages that show the file card: the file is known and not yet failed. */
const FILE_STAGES: ReadonlySet<ReceiveStage> = new Set([
  'ready',
  'requesting',
  'connecting',
  'receiving',
  'reconnecting',
  'done',
])

function describeStatus(session: ReceiveSession): { label: string; tone: StatusTone } {
  if (session.isDone) return { label: 'Transfer complete', tone: 'ok' }
  if (session.isReconnecting) return { label: 'Reconnecting to sender…', tone: 'warn' }
  if (session.isTransferring) return { label: 'Receiving…', tone: 'busy' }
  if (session.isConnectingStage || session.isRequesting) {
    return { label: 'Connecting to sender…', tone: 'busy' }
  }
  return { label: 'Sender connected', tone: 'ok' }
}

function currentStep(session: ReceiveSession): number {
  switch (session.stage) {
    case 'input':
    case 'joining':
    case 'waiting':
      return 0
    case 'ready':
    case 'connecting':
      // The peer connection is prepared while the user reviews the file.
      return 1
    case 'done':
      return STEPS.length
    case 'error':
      return session.fileInfo ? 2 : 0
    default:
      return 2
  }
}

function busyLabel(session: ReceiveSession): string {
  if (session.isRequesting) return 'Waiting for sender to start…'
  if (session.isReconnecting) return 'Reconnecting…'
  if (session.isConnectingStage) return 'Connecting…'
  return 'Receiving…'
}

export default function ReceiveView({ session }: { session: ReceiveSession }) {
  const isDesktop = useIsDesktop()
  const [inputValue, setInputValue] = useState('')
  const savedRef = useRef<HTMLDivElement>(null)
  const currentLog = session.logs[session.logs.length - 1]
  const showFile = session.fileInfo !== null && FILE_STAGES.has(session.stage)
  const status = describeStatus(session)

  useEffect(() => {
    if (!session.isDone || !session.receivedFile) return
    savedRef.current?.focus()
  }, [session.isDone, session.receivedFile])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (session.handleInputSubmit(inputValue)) setInputValue('')
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 pt-2 sm:pt-6">
      <PageHeader
        icon={
          <FileDown
            className="h-8 w-8 text-blue-300 md:h-12 md:w-12"
            aria-hidden="true"
          />
        }
        title="Receive File."
      />

      <StepTracker
        label="Receive progress"
        steps={STEPS}
        current={currentStep(session)}
        failed={session.isError}
      />

      {session.stage === 'input' && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/5 p-6 text-center shadow-lg backdrop-blur-sm sm:p-10"
        >
          <span className="rounded-full bg-blue-500/15 p-5">
            <FileDown className="h-12 w-12 text-blue-300" aria-hidden="true" />
          </span>
          <div className="space-y-2">
            <p className="text-xl font-semibold sm:text-2xl">Paste the Via link</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Paste the Via link or short code from the sender
            </p>
          </div>

          {session.sessionError && (
            <ErrorAlert message={session.sessionError} className="w-full max-w-md text-left" />
          )}

          <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
            <label htmlFor="session-key" className="sr-only">
              Via receive link or short code
            </label>
            <input
              id="session-key"
              type="text"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder="Paste Via link or short code…"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="h-12 w-full min-w-0 rounded-lg sm:flex-1 border border-white/20 bg-black/20 px-4 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
              autoFocus
            />
            <Button
              type="submit"
              disabled={!inputValue.trim() || !session.isConnected}
              aria-label="Join session"
              className="h-12 bg-[#3A5A98] px-5 text-white hover:bg-[#3A5A98]/90 [&_svg]:size-5"
            >
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </form>
      )}

      {(session.stage === 'joining' || session.stage === 'waiting') && (
        <div className="space-y-5">
          {session.sessionError && <ErrorAlert message={session.sessionError} />}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center shadow-lg backdrop-blur-sm sm:p-8">
            <Loader2
              className="mx-auto mb-4 h-10 w-10 animate-spin text-blue-300 motion-reduce:animate-none"
              aria-hidden="true"
            />
            <p className="font-medium">
              {session.stage === 'joining'
                ? 'Joining session…'
                : 'Waiting for the sender to add a file…'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">This won't take long</p>

            <div className="mx-auto mt-6 flex max-w-sm items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Link code</p>
                <p className="truncate font-mono text-sm">{session.displaySessionId}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={session.handleCopySessionId}
                aria-label="Copy link code"
                className="shrink-0 hover:bg-white/10"
              >
                {session.copied ? (
                  <Check className="text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="text-muted-foreground" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showFile && session.fileInfo && (
        <div className="space-y-5">
          {session.sessionError && <ErrorAlert message={session.sessionError} />}

          <FileDetailsCard
            fileName={session.fileInfo.fileName}
            fileSize={session.fileInfo.fileSize}
            mimeType={session.fileInfo.mimeType}
            ttlSeconds={session.ttl.seconds}
            ttlNearExpiry={session.ttlNearExpiry}
            verificationCode={session.verificationCode}
            status={<StatusPill tone={status.tone} label={status.label} />}
          >
            {session.showProgress && (
              <TransferProgress
                value={session.transferProgress}
                label={
                  session.isDone
                    ? 'Transfer complete'
                    : session.isReconnecting
                      ? 'Connection interrupted — resuming'
                      : 'Receiving'
                }
                bytesPerSecond={session.transferRate.bytesPerSecond}
                etaSeconds={session.transferRate.etaSeconds}
                done={session.isDone}
                tone="emerald"
                className="mt-6 border-t border-white/10 pt-5"
              />
            )}

            <div className="mt-6 border-t border-white/10 pt-5">
              {session.isDone && session.receivedFile ? (
                <div
                  ref={savedRef}
                  tabIndex={-1}
                  className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 font-semibold text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
                >
                  {session.receivedFile.downloadUrl ? (
                    <a
                      href={session.receivedFile.downloadUrl}
                      download={session.receivedFile.name}
                      className="flex flex-col items-center gap-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
                    >
                      <span className="flex items-center gap-3">
                        <Download className="h-5 w-5" aria-hidden="true" />
                        Save file
                      </span>
                      <span className="text-xs font-light text-emerald-300/80">
                        Received to temporary storage — download it to keep it
                      </span>
                    </a>
                  ) : (
                    <span className="flex items-center justify-center gap-3">
                      <Check className="h-5 w-5" aria-hidden="true" />
                      Saved directly to your chosen location
                    </span>
                  )}
                </div>
              ) : session.stage === 'ready' ? (
                <div className="space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button
                      type="button"
                      onClick={() => void session.handleStartDownload()}
                      className={`${ACTION} flex-1 bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 [&_svg]:size-5`}
                    >
                      <Download aria-hidden="true" />
                      Download
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={session.handleCancelReceive}
                      className={CANCEL}
                    >
                      <X aria-hidden="true" />
                      Cancel
                    </Button>
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    The sender starts automatically when you download.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div
                    aria-hidden="true"
                    className="flex h-12 flex-1 items-center justify-center gap-3 rounded-md border border-white/10 bg-white/5 text-sm font-medium text-muted-foreground"
                  >
                    <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
                    {busyLabel(session)}
                  </div>
                  {!session.isReconnecting && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={session.handleCancelReceive}
                      className={CANCEL}
                    >
                      <X aria-hidden="true" />
                      Cancel
                    </Button>
                  )}
                </div>
              )}
            </div>
          </FileDetailsCard>
        </div>
      )}

      {session.stage === 'error' && (
        <div className="space-y-4">
          {session.sessionError && <ErrorAlert message={session.sessionError} />}
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-center">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-400" aria-hidden="true" />
            <p className="mb-1 font-medium text-red-200">Something went wrong</p>
            <p className="mb-5 text-sm text-red-300">
              The session may have expired, the sender disconnected, or the key is
              invalid.
            </p>
            <div className="flex flex-col justify-center gap-2 sm:flex-row">
              {session.retryable && (
                <Button
                  type="button"
                  onClick={session.handleRetryTransfer}
                  className="h-10 bg-emerald-600 px-5 text-white hover:bg-emerald-700"
                >
                  <RotateCcw aria-hidden="true" />
                  Retry transfer
                </Button>
              )}
              <Button
                type="button"
                onClick={session.handleTryAgain}
                className="h-10 bg-red-600 px-6 text-white hover:bg-red-700"
              >
                Try Again
              </Button>
            </div>
          </div>
        </div>
      )}

      {!session.isDone && (
        <div role="status" aria-live="polite">
          <StatusLine currentLog={currentLog} isDesktop={isDesktop} />
        </div>
      )}
    </div>
  )
}
