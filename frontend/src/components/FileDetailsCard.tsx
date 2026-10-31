import type { ReactNode } from 'react'
import { Clock, FileText } from 'lucide-react'

import { useIsDesktop } from '../hooks/useIsDesktop'
import {
  formatFileSize,
  formatTTL,
  getFileExtension,
  truncateFileName,
} from '../lib/format'
import SecurityCode from './SecurityCode'

interface FileDetailsCardProps {
  fileName: string
  fileSize: number
  mimeType: string
  addedAt?: Date | null
  ttlSeconds: number | null
  ttlNearExpiry?: boolean
  status?: ReactNode
  verificationCode?: string | null
  children?: ReactNode
}

function Detail({
  label,
  value,
  className = '',
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <span className="shrink-0 font-light text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  )
}

/** The same file summary on the send and receive pages. */
export default function FileDetailsCard({
  fileName,
  fileSize,
  mimeType,
  addedAt,
  ttlSeconds,
  ttlNearExpiry = false,
  status,
  verificationCode,
  children,
}: FileDetailsCardProps) {
  const isDesktop = useIsDesktop()

  return (
    <div className="w-full rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg sm:p-6">
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="shrink-0 rounded-xl bg-indigo-500/15 p-3">
          <FileText
            className="h-7 w-7 text-indigo-300 sm:h-8 sm:w-8"
            aria-hidden="true"
          />
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="mb-3 break-words text-base font-semibold sm:text-lg">
            {isDesktop ? fileName : truncateFileName(fileName, 24)}
          </h2>

          <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <Detail label="Size" value={formatFileSize(fileSize)} />
            <Detail label="Type" value={getFileExtension(fileName)} />
            <Detail
              label="MIME"
              value={mimeType || 'unknown'}
              className="sm:col-span-2"
            />
            {addedAt && (
              <Detail
                label="Added"
                value={addedAt.toLocaleTimeString()}
                className="sm:col-span-2"
              />
            )}
          </div>

          {(status || verificationCode) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {status}
              {verificationCode && (
                <SecurityCode code={verificationCode} />
              )}
            </div>
          )}

          {ttlSeconds !== null && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <span className="flex items-center gap-1.5">
                <Clock
                  className={`h-3.5 w-3.5 shrink-0 ${
                    ttlNearExpiry ? 'text-red-500' : 'text-amber-500'
                  }`}
                  aria-hidden="true"
                />
                <span className="font-light text-muted-foreground">
                  Session expires in
                </span>
                <span
                  className={`font-semibold ${
                    ttlNearExpiry ? 'text-red-300' : 'text-amber-400'
                  }`}
                >
                  {formatTTL(ttlSeconds)}
                </span>
              </span>
            </div>
          )}
        </div>
      </div>

      {children}
    </div>
  )
}
