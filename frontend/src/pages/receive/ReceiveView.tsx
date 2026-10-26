import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  Copy,
  Download,
  File,
  FileDown,
  Loader2,
  RotateCcw,
  X,
} from 'lucide-react'

import ErrorAlert from '../../components/ErrorAlert'
import StatusLine from '../../components/StatusLine'
import TransferProgress from '../../components/TransferProgress'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import {
  formatFileSize,
  formatTTL,
  getFileExtension,
  truncateFileName,
} from '../../lib/format'
import SecurityCode from '../../components/SecurityCode'
import type { ReceiveSession } from './useReceiveSession'

export default function ReceiveView({ session }: { session: ReceiveSession }) {
  const isDesktop = useIsDesktop()
  const [inputValue, setInputValue] = useState('')
  const saveButtonRef = useRef<HTMLButtonElement>(null)
  const directSavedRef = useRef<HTMLDivElement>(null)
  const currentLog = session.logs[session.logs.length - 1]

  useEffect(() => {
    if (!session.isDone || !session.receivedFile) return
    if (session.receivedFile.mode === 'direct') {
      directSavedRef.current?.focus()
    } else {
      saveButtonRef.current?.focus()
    }
  }, [session.isDone, session.receivedFile])

  const submitInput = () => {
    if (session.handleInputSubmit(inputValue)) setInputValue('')
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') submitInput()
  }

  return (
    <div className="flex w-full flex-1 flex-col">
      <section className="mt-4 flex flex-col items-center justify-center sm:mt-8">
        <div className="flex items-center justify-center gap-4 text-center">
          <FileDown
            className="h-8 w-8 text-[#3A5A98] md:h-12 md:w-12"
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
            <div className="w-full rounded-2xl border-2 border-dashed border-gray-300 bg-white/70 p-6 shadow-lg backdrop-blur-sm transition-all hover:border-[#3A5A98] sm:p-10">
              <div className="flex flex-col items-center justify-center gap-6">
                <div className="rounded-full bg-blue-50 p-5">
                  <FileDown
                    className="h-14 w-14 text-[#3A5A98]"
                    aria-hidden="true"
                  />
                </div>
                <p className="text-center text-xl font-semibold sm:text-2xl">
                  Enter your session key
                </p>
                <p className="max-w-md text-center text-sm text-gray-500">
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
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 px-4 py-3 font-mono text-sm focus:border-[#3A5A98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3A5A98] focus-visible:ring-offset-2"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={submitInput}
                    disabled={!inputValue.trim() || !session.isConnected}
                    aria-label="Join session"
                    className="flex items-center justify-center rounded-lg bg-[#3A5A98] px-5 py-3 text-white transition-all hover:bg-[#3A5A98]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3A5A98] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
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
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[#3A5A98]/20 bg-white p-4 shadow-sm">
              <div className="min-w-0">
                <p className="mb-0.5 text-xs text-gray-500">
                  Session
                </p>
                <p className="truncate font-mono text-sm text-[#3E2723]">
                  {session.displaySessionId}
                </p>
              </div>
              <button
                type="button"
                onClick={session.handleCopySessionId}
                aria-label="Copy session key"
                className="shrink-0 rounded-lg p-2 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3A5A98] focus-visible:ring-offset-2"
              >
                {session.copied ? (
                  <Check className="h-4 w-4 text-green-600" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4 text-gray-400" aria-hidden="true" />
                )}
              </button>
            </div>
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-8 text-center">
              <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[#3A5A98] border-t-transparent motion-reduce:animate-none" />
              <p className="font-medium text-blue-800">
                {session.stage === 'joining'
                  ? 'Joining session…'
                  : 'Waiting for the sender to add a file…'}
              </p>
              <p className="mt-1 text-sm text-blue-600">
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
            <div className="w-full max-w-lg space-y-6">
              {session.sessionError && (
                <ErrorAlert message={session.sessionError} />
              )}

              {session.turnAvailable === false && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    TURN relay is unavailable. Transfers may fail on strict
                    corporate or carrier-grade NAT networks.
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 rounded-xl border border-[#3A5A98]/20 bg-white p-4 shadow-sm">
                <div className="min-w-0 flex-1">
                  <p className="mb-0.5 text-xs text-gray-500">
                    Session
                  </p>
                  <p className="truncate font-mono text-sm text-[#3E2723]">
                    {session.displaySessionId}
                  </p>
                </div>
                {session.ttl.seconds !== null && (
                  <div
                    className={`flex shrink-0 items-center gap-1.5 text-xs font-medium ${
                      session.ttlNearExpiry
                        ? 'text-red-600'
                        : 'text-amber-600'
                    }`}
                  >
                    <Clock
                      className={`h-3.5 w-3.5 ${
                        session.ttlNearExpiry ? 'text-red-500' : 'text-amber-500'
                      }`}
                      aria-hidden="true"
                    />
                    <span>{formatTTL(session.ttl.seconds)}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={session.handleCopySessionId}
                  aria-label="Copy session key"
                  className="shrink-0 rounded-lg p-2 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3A5A98] focus-visible:ring-offset-2"
                >
                  {session.copied ? (
                    <Check className="h-4 w-4 text-green-600" aria-hidden="true" />
                  ) : (
                    <Copy className="h-4 w-4 text-gray-400" aria-hidden="true" />
                  )}
                </button>
              </div>

              <div className="rounded-2xl border border-[#2B2B2B] bg-white p-5 shadow-lg sm:p-6">
                <div className="flex items-start gap-3 sm:gap-4">
                  <div className="shrink-0 rounded-xl bg-indigo-50 p-3">
                    <File
                      className="h-7 w-7 text-indigo-600 sm:h-8 sm:w-8"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="mb-3 break-words text-base font-semibold sm:text-lg">
                      {isDesktop
                        ? session.fileInfo.fileName
                        : truncateFileName(session.fileInfo.fileName, 24)}
                    </p>
                    <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                      <div className="flex items-center gap-2">
                        <span className="font-light text-gray-500">
                          Size
                        </span>
                        <span className="font-medium">
                          {formatFileSize(session.fileInfo.fileSize)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-light text-gray-500">
                          Type
                        </span>
                        <span className="font-medium">
                          {getFileExtension(session.fileInfo.fileName)}
                        </span>
                      </div>
                      <div className="col-span-1 flex items-center gap-2 sm:col-span-2">
                        <span className="font-light text-gray-500">
                          MIME
                        </span>
                        <span className="truncate font-medium">
                          {session.fileInfo.mimeType || 'unknown'}
                        </span>
                      </div>

                      {session.ttl.seconds !== null && (
                        <div className="col-span-1 flex flex-wrap items-center gap-2 sm:col-span-2">
                          <Clock
                            className={`h-3.5 w-3.5 shrink-0 ${
                              session.ttlNearExpiry ? 'text-red-500' : 'text-amber-500'
                            }`}
                            aria-hidden="true"
                          />
                          <span className="text-sm font-light text-gray-500">
                            Session expires in
                          </span>
                          <span
                            className={`text-sm font-semibold ${
                              session.ttlNearExpiry
                                ? 'text-red-600'
                                : 'text-amber-600'
                            }`}
                          >
                            {formatTTL(session.ttl.seconds)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

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
                    className="mt-6 border-t border-gray-100 pt-5"
                  />
                )}

                {session.isDone && session.receivedFile?.mode !== 'direct' && (
                  <div className="mt-4 flex items-center gap-2 text-sm font-medium text-emerald-700">
                    <Check className="h-4 w-4" aria-hidden="true" />
                    <span>File verified — click Save if the download did not start</span>
                  </div>
                )}
              </div>

              {session.isDone &&
              session.receivedFile &&
              session.receivedFile.mode === 'direct' ? (
                <div
                  ref={directSavedRef}
                  tabIndex={-1}
                  className="flex w-full items-center justify-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 py-4 text-base font-semibold text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
                >
                  <Check className="h-5 w-5" aria-hidden="true" />
                  Saved directly to your chosen location
                </div>
              ) : session.isDone && session.receivedFile ? (
                <button
                  ref={saveButtonRef}
                  type="button"
                  onClick={session.handleSaveFile}
                  className="flex w-full items-center justify-center gap-3 rounded-xl bg-emerald-600 py-4 text-base font-semibold text-white shadow-md transition-all hover:bg-emerald-700 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 active:bg-emerald-800"
                >
                  <Download className="h-5 w-5" aria-hidden="true" />
                  {session.saved ? 'Save Again' : 'Save File'}
                </button>
              ) : (
                <div className="space-y-3">
                  {session.stage === 'ready' && (
                    <button
                      type="button"
                      onClick={() => void session.handleStartDownload()}
                      className="flex w-full items-center justify-center gap-3 rounded-xl bg-emerald-600 py-4 text-base font-semibold text-white shadow-md transition-all hover:bg-emerald-700 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 active:bg-emerald-800"
                    >
                      <Download className="h-5 w-5" aria-hidden="true" />
                      Download
                    </button>
                  )}

                  {session.stage === 'ready' && (
                    <p className="text-center text-xs text-gray-500">
                      The sender starts automatically when you click Download.
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
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-5 py-4 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                        Cancel
                      </button>
                    )}
                  </div>
                  )}
                </div>
              )}

              {session.isDone &&
                session.receivedFile &&
                session.receivedFile.mode !== 'direct' && (
                  <p className="text-center text-xs text-gray-500">
                    {session.storageLabel} — save it to keep it permanently.
                  </p>
                )}
            </div>
          )}

        {session.stage === 'error' && (
          <div className="w-full max-w-md space-y-4">
            {session.sessionError && <ErrorAlert message={session.sessionError} />}
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
              <AlertTriangle
                className="mx-auto mb-3 h-8 w-8 text-red-500"
                aria-hidden="true"
              />
              <p className="mb-1 font-medium text-red-700">
                Something went wrong
              </p>
              <p className="mb-4 text-sm text-red-500">
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

        <div className="mt-8 w-full max-w-md" role="status" aria-live="polite">
          <SecurityCode code={session.verificationCode} />
          <StatusLine
            currentLog={currentLog}
            isConnected={session.isConnected}
            isDesktop={isDesktop}
          />
        </div>
      </section>
    </div>
  )
}
