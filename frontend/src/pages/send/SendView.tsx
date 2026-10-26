import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  FileText,
  Loader2,
  Pause,
  Play,
  Send as SendIcon,
  Share2,
  Upload,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'

import ErrorAlert from '../../components/ErrorAlert'
import StatusLine from '../../components/StatusLine'
import TransferProgress from '../../components/TransferProgress'
import { Button } from '../../components/ui/button'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import {
  formatFileSize,
  formatTTL,
  getFileExtension,
  truncateFileName,
} from '../../lib/format'
import FileDropzone from './FileDropzone'
import SecurityCode from '../../components/SecurityCode'
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
      </section>

      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-1 py-8 sm:px-4 sm:py-10">
        {!session.file && (
          <div className="w-full max-w-2xl space-y-8">
            <FileDropzone onFile={session.handleFileSelect} />

            <div className="space-y-2 text-center">
              <p className="text-lg font-light sm:text-xl">
                Please add a file to begin sharing
              </p>
              <p className="text-sm">
                {session.isConnected ? (
                  <span className="inline-flex items-center gap-2">
                    <Wifi
                      className="h-4 w-4 text-emerald-500"
                      aria-hidden="true"
                    />
                    <span className="font-medium text-emerald-600">
                      Connected to server
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <WifiOff className="h-4 w-4 text-red-500" aria-hidden="true" />
                    <span className="font-medium text-red-500">
                      Disconnected from server
                    </span>
                  </span>
                )}
              </p>
            </div>
          </div>
        )}

        {session.file && (
          <div className="w-full space-y-6">
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

            <div className="rounded-2xl border border-[#2B2B2B] p-4 shadow-lg sm:p-6 md:p-8">
              <div className="flex items-start gap-3 md:gap-6">
                <div className="shrink-0">
                  <FileText
                    className="h-6 w-6 text-indigo-600 md:h-10 md:w-10"
                    aria-hidden="true"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="mb-4 block max-w-xs truncate text-lg font-semibold md:max-w-none md:overflow-visible md:whitespace-normal md:text-xl">
                    {isDesktop
                      ? session.file.name
                      : truncateFileName(session.file.name, 20)}
                  </span>

                  <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm md:grid-cols-2">
                    <div className="flex items-center gap-2">
                      <span className="font-light text-gray-500">
                        Size
                      </span>
                      <span className="font-medium">
                        {formatFileSize(session.file.size)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-light text-gray-500">
                        Type
                      </span>
                      <span className="font-medium">
                        {getFileExtension(session.file.name)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-light text-gray-500">
                        Added
                      </span>
                      <span className="font-medium">
                        {session.uploadTime?.toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-light text-gray-500">
                        MIME
                      </span>
                      <span className="truncate font-medium text-gray-900">
                        {session.file.type || 'unknown'}
                      </span>
                    </div>

                    <div className="col-span-1 mt-1 flex flex-wrap items-center gap-2 md:col-span-2">
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                          session.isPeerConnected
                            ? 'bg-emerald-500'
                            : session.isReconnecting
                              ? 'bg-amber-500'
                              : 'bg-gray-300'
                        }`}
                        aria-hidden="true"
                      />
                      <span
                        className={`text-sm font-medium ${
                          session.isPeerConnected
                            ? 'text-emerald-700'
                            : session.isReconnecting
                              ? 'text-amber-700'
                              : 'text-gray-500'
                        }`}
                      >
                        {session.isPeerConnected
                          ? 'Receiver connected'
                          : session.isReconnecting
                            ? 'Reconnecting to receiver…'
                            : 'Waiting for receiver…'}
                      </span>
                      {session.receiverConfirmed && (
                        <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          Verified by receiver
                        </span>
                      )}
                    </div>

                    {session.verificationCode && (
                      <div className="col-span-1 md:col-span-2">
                        <SecurityCode code={session.verificationCode} />
                      </div>
                    )}

                    {session.ttl.seconds !== null && (
                      <div className="col-span-1 flex items-center gap-2 md:col-span-2">
                        <Clock
                          className={`h-3.5 w-3.5 shrink-0 ${
                            ttlNearExpiry ? 'text-red-500' : 'text-amber-500'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="text-sm font-light text-gray-500">
                          Session expires in
                        </span>
                        <span
                          className={`text-sm font-semibold ${
                            ttlNearExpiry
                              ? 'text-red-600'
                              : 'text-amber-600'
                          }`}
                        >
                          {formatTTL(session.ttl.seconds)}
                        </span>
                      </div>
                    )}

                    {session.sessionId && (
                      <div className="col-span-1 flex items-center gap-2 md:col-span-2">
                        <span className="text-sm font-light text-gray-500">
                          Session
                        </span>
                        <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600">
                          {session.sessionId.slice(0, 8)}…
                        </span>
                        {session.isCreatingSession && (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                            <Loader2
                              className="h-3 w-3 animate-spin motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                            creating
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

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
                  className="mt-8 border-t border-gray-200 pt-6"
                />
              )}

              {session.isDone && (
                <div className="mt-6 flex items-center gap-3 border-t border-gray-200 pt-5 text-emerald-700">
                  <Check className="h-5 w-5" aria-hidden="true" />
                  <span className="font-medium">
                    {session.receiverConfirmed
                      ? 'Complete — the receiver verified the file'
                      : 'File sent — the receiver is verifying it'}
                  </span>
                </div>
              )}

              {session.isError && session.sessionError && (
                <div className="mt-6 flex items-center gap-3 border-t border-gray-200 pt-5 text-red-600">
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                  <span className="font-medium">{session.sessionError}</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-center gap-3 pt-2">
              {session.sessionId && (
                <Button
                  type="button"
                  onClick={session.handleCopyUrl}
                  variant="outline"
                  className="flex h-11 items-center gap-2 border-[#2B2B2B]/40 bg-white px-5 text-sm font-semibold hover:border-[#2B2B2B]"
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

              {!session.isTransferring &&
                !session.isReconnecting &&
                !session.isDone &&
                !session.isError &&
                session.sessionId && (
                  <>
                    <Button
                      type="button"
                      disabled
                      className="flex h-11 items-center gap-2 bg-[#2E8B73] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <SendIcon className="h-4 w-4" aria-hidden="true" />
                      <span>
                        {session.canSend
                          ? 'Waiting for receiver to download…'
                          : 'Waiting for receiver…'}
                      </span>
                    </Button>
                    {session.canSend && (
                      <Button
                        type="button"
                        onClick={session.handleSendFile}
                        variant="outline"
                        className="flex h-11 items-center gap-2 px-5 text-sm font-semibold"
                      >
                        Send now
                      </Button>
                    )}
                  </>
                )}
            </div>

            <div className="py-4 text-center" role="status" aria-live="polite">
              <StatusLine
                currentLog={currentLog}
                isConnected={session.isConnected}
                isDesktop={isDesktop}
              />
            </div>
          </div>
        )}

      </section>
    </div>
  )
}
