import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
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
import StatusLine from '../../components/StatusLine'
import TransferProgress from '../../components/TransferProgress'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import type { ReceiveSession } from './useReceiveSession'

export default function ReceiveView({ session }: { session: ReceiveSession }) {
  const isDesktop = useIsDesktop()
  const [inputValue, setInputValue] = useState('')
  const directSavedRef = useRef<HTMLDivElement>(null)
  const currentLog = session.logs[session.logs.length - 1]

  useEffect(() => {
    if (!session.isDone || !session.receivedFile) return
    directSavedRef.current?.focus()
  }, [session.isDone, session.receivedFile])

  const submitInput = () => {
    if (session.handleInputSubmit(inputValue)) setInputValue('')
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') submitInput()
  }

  const receiverStatus = session.isDone
    ? 'Transfer complete'
    : session.isReconnecting
      ? 'Reconnecting to sender…'
      : session.isTransferring
        ? 'Receiving…'
        : session.isConnectingStage || session.isRequesting
          ? 'Connecting to sender…'
          : 'Sender connected'

  const receiverStatusTone = session.isReconnecting
    ? { dot: 'bg-amber-500', text: 'text-amber-300' }
    : session.isConnectingStage || session.isRequesting
      ? {
          dot: 'bg-blue-400 animate-pulse motion-reduce:animate-none',
          text: 'text-blue-300',
        }
      : { dot: 'bg-emerald-500', text: 'text-emerald-300' }

  return (
    <div className="flex w-full flex-1 flex-col">
      <section className="mt-4 flex flex-col items-center justify-center sm:mt-8">
        <div className="flex items-center justify-center gap-4 text-center">
          <FileDown
            className="h-8 w-8 text-blue-300 md:h-12 md:w-12"
            aria-hidden="true"
          />
          <h1 className="font-serif text-4xl font-light tracking-tighter md:text-6xl">
            Receive File.
          </h1>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-1 py-8 sm:px-4 sm:py-10">
        {session.stage === 'input' && (
          <div className="w-full max-w-2xl space-y-8">
            <div className="w-full rounded-2xl border-2 border-dashed border-white/20 bg-white/5 p-6 shadow-lg backdrop-blur-sm transition-all hover:border-blue-400/60 sm:p-10">
              <div className="flex flex-col items-center justify-center gap-6">
                <div className="rounded-full bg-blue-500/15 p-5">
                  <FileDown
                    className="h-14 w-14 text-blue-300"
                    aria-hidden="true"
                  />
                </div>
                <p className="text-center text-xl font-semibold sm:text-2xl">
                  Enter your session key
                </p>
                <p className="max-w-md text-center text-sm text-muted-foreground">
                  Paste the session key or the full receive link from the sender
                </p>

                {session.sessionError && (
                  <ErrorAlert message={session.sessionError} className="w-full max-w-md" />
                )}

                <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
                  <label htmlFor="session-key" className="sr-only">
                    Session key or receive link
                  </label>
                  <input
                    id="session-key"
                    type="text"
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    onKeyDown={handleInputKeyDown}
                    placeholder="Paste session key or link…"
                    autoComplete="off"
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded-lg border border-white/20 bg-white/5 px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={submitInput}
                    disabled={!inputValue.trim() || !session.isConnected}
                    aria-label="Join session"
                    className="flex items-center justify-center rounded-lg bg-[#3A5A98] px-5 py-3 text-white transition-all hover:bg-[#3A5A98]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ArrowRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {(session.stage === 'joining' || session.stage === 'waiting') && (
          <div className="w-full max-w-md space-y-6">
            {session.sessionError && (
              <ErrorAlert message={session.sessionError} />
            )}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm">
              <div className="min-w-0">
                <p className="mb-0.5 text-xs text-muted-foreground">
                  Session
                </p>
                <p className="truncate font-mono text-sm text-foreground">
                  {session.displaySessionId}
                </p>
              </div>
              <button
                type="button"
                onClick={session.handleCopySessionId}
                aria-label="Copy session key"
                className="shrink-0 rounded-lg p-2 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
              >
                {session.copied ? (
                  <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                )}
              </button>
            </div>
            <div className="rounded-2xl border border-blue-400/20 bg-blue-500/10 p-8 text-center">
              <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-blue-400 border-t-transparent motion-reduce:animate-none" />
              <p className="font-medium text-blue-200">
                {session.stage === 'joining'
                  ? 'Joining session…'
                  : 'Waiting for the sender to add a file…'}
              </p>
              <p className="mt-1 text-sm text-blue-300">
                This won't take long
              </p>
            </div>
          </div>
        )}

        {session.fileInfo &&
          (session.stage === 'ready' ||
            session.stage === 'connecting' ||
            session.stage === 'receiving' ||
            session.stage === 'reconnecting' ||
            session.stage === 'done') && (
            <div className="w-full space-y-6">
              {session.sessionError && (
                <ErrorAlert message={session.sessionError} />
              )}

              <FileDetailsCard
                fileName={session.fileInfo.fileName}
                fileSize={session.fileInfo.fileSize}
                mimeType={session.fileInfo.mimeType}
                sessionId={session.displaySessionId}
                ttlSeconds={session.ttl.seconds}
                ttlNearExpiry={session.ttlNearExpiry}
                verificationCode={session.verificationCode}
                status={
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${receiverStatusTone.dot}`}
                      aria-hidden="true"
                    />
                    <span
                      className={`text-sm font-medium ${receiverStatusTone.text}`}
                    >
                      {receiverStatus}
                    </span>
                  </span>
                }
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
              </FileDetailsCard>

              {session.isDone && session.receivedFile ? (
                <div
                  ref={directSavedRef}
                  tabIndex={-1}
                  className="w-full rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-4 text-base font-semibold text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
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
              ) : (
                <div className="space-y-3">
                  {session.stage === 'ready' && (
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => void session.handleStartDownload()}
                        className="flex flex-1 items-center justify-center gap-3 rounded-xl bg-emerald-600 py-4 text-base font-semibold text-white shadow-md transition-all hover:bg-emerald-700 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 active:bg-emerald-800"
                      >
                        <Download className="h-5 w-5" aria-hidden="true" />
                        Download
                      </button>
                      <button
                        type="button"
                        onClick={session.handleCancelReceive}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/30 bg-transparent px-5 py-4 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                        Cancel
                      </button>
                    </div>
                  )}

                  {session.stage === 'ready' && (
                    <p className="text-center text-xs text-muted-foreground">
                      The sender starts automatically when you download.
                    </p>
                  )}

                  {session.stage !== 'ready' && (
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        disabled
                        className="flex flex-1 cursor-not-allowed items-center justify-center gap-3 rounded-xl bg-[#3A5A98] py-4 text-base font-semibold text-white opacity-70 shadow-md"
                      >
                        {session.isRequesting ? (
                          <>
                            <Loader2
                              className="h-5 w-5 animate-spin motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                            Waiting for sender to start…
                          </>
                        ) : session.isReconnecting ? (
                          <>
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent motion-reduce:animate-none" />
                            Reconnecting…
                          </>
                        ) : session.isConnectingStage || session.isTransferring ? (
                          <>
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent motion-reduce:animate-none" />
                            {session.isConnectingStage ? 'Connecting…' : 'Receiving…'}
                          </>
                        ) : (
                          <>
                            <Loader2
                              className="h-5 w-5 animate-spin motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                            Waiting for the sender…
                          </>
                        )}
                      </button>
                      {(session.isTransferring ||
                        session.isConnectingStage ||
                        session.isRequesting) && (
                        <button
                          type="button"
                          onClick={session.handleCancelReceive}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/30 bg-transparent px-5 py-4 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                          Cancel
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        {session.stage === 'error' && (
          <div className="w-full max-w-md space-y-4">
            {session.sessionError && <ErrorAlert message={session.sessionError} />}
            <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-center">
              <AlertTriangle
                className="mx-auto mb-3 h-8 w-8 text-red-400"
                aria-hidden="true"
              />
              <p className="mb-1 font-medium text-red-200">
                Something went wrong
              </p>
              <p className="mb-4 text-sm text-red-300">
                The session may have expired, the sender disconnected, or the key
                is invalid.
              </p>
              <div className="flex flex-col justify-center gap-2 sm:flex-row">
                {session.retryable && (
                  <button
                    type="button"
                    onClick={session.handleRetryTransfer}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Retry transfer
                  </button>
                )}
                <button
                  type="button"
                  onClick={session.handleTryAgain}
                  className="rounded-lg bg-red-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
                >
                  Try Again
                </button>
              </div>
            </div>
          </div>
        )}

        {!session.isDone && (
          <div className="mt-8 w-full max-w-md" role="status" aria-live="polite">
            <StatusLine currentLog={currentLog} isDesktop={isDesktop} />
          </div>
        )}
      </section>
    </div>
  )
}
