import { sanitizeFileName, sanitizeMimeType } from './format'

export type SinkMode = 'direct' | 'temporary'

export interface FinishedFile {
  name: string
  mode: SinkMode
  /**
   * For temporary sinks: an object URL the UI can offer as a download.
   * Direct sinks write to the user's file and have no URL.
   */
  downloadUrl?: string
  cleanup: () => void
}

export interface IncomingFileSinkOptions {
  /**
   * The user-chosen file to stream into. Omit it in browsers without the File
   * System Access API; the sink then stores the file temporarily instead.
   */
  destination?: FileSystemFileHandle
}

const TEMP_PREFIX = 'via-incoming-'

/**
 * Safe ceiling for the in-memory fallback. Without OPFS the whole file is
 * held in an ArrayBuffer list, so an unbounded file can crash the tab.
 */
export const MEMORY_FALLBACK_MAX_FILE_SIZE = 512 * 1024 * 1024

/** True when the browser can persist a temporary file instead of buffering it. */
export const isOpfsAvailable = (): boolean =>
  typeof navigator !== 'undefined' &&
  typeof navigator.storage?.getDirectory === 'function'

const STALE_TEMP_AGE_MS = 24 * 60 * 60 * 1000

/** `entries()` is implemented by browsers but missing from the DOM typings. */
type OpfsDirectory = Pick<FileSystemDirectoryHandle, 'removeEntry'> & {
  entries(): AsyncIterable<readonly [string, FileSystemHandle]>
}

/**
 * Deletes partial downloads left in OPFS by a tab that crashed or was closed
 * mid-transfer; nothing else would ever remove them. Only files untouched for
 * a day go, so another tab's transfer in progress is safe.
 */
export async function sweepStaleTempFiles(
  maxAgeMs = STALE_TEMP_AGE_MS,
  now = Date.now(),
): Promise<number> {
  if (!isOpfsAvailable()) return 0

  try {
    const root = (await navigator.storage.getDirectory()) as unknown as OpfsDirectory
    let removed = 0

    for await (const [name, handle] of root.entries()) {
      if (
        handle.kind !== 'file' ||
        !name.startsWith(TEMP_PREFIX) ||
        !name.endsWith('.part')
      ) {
        continue
      }

      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        if (now - file.lastModified < maxAgeMs) continue
        await root.removeEntry(name)
        removed += 1
      } catch {
        // In use or already gone; try again next time.
      }
    }

    return removed
  } catch {
    return 0
  }
}

/**
 * Streams received chunks into a file. When the browser supports the save
 * picker, chunks go straight to the file the receiver chose, so there is no
 * second copy. Browsers without it (Safari, Firefox) keep the file in the
 * Origin Private File System, or in memory as a last resort, and the finished
 * file is offered as a download.
 */
export class IncomingFileSink {
  private writable: FileSystemWritableFileStream | null = null
  private tempHandle: FileSystemFileHandle | null = null
  private memoryChunks: ArrayBuffer[] | null = null
  private downloadUrl: string | null = null
  private initPromise: Promise<void> | null = null
  private queue: Promise<void> = Promise.resolve()
  private closed = false
  private finished = false
  private readonly fileName: string
  private readonly mimeType: string
  private readonly expectedSize: number
  private readonly destination: FileSystemFileHandle | null
  private readonly mode: SinkMode

  constructor(
    fileName: string,
    mimeType: string,
    expectedSize: number,
    options: IncomingFileSinkOptions,
  ) {
    this.fileName = fileName
    this.mimeType = sanitizeMimeType(mimeType)
    this.expectedSize = expectedSize
    this.destination = options.destination ?? null
    this.mode = this.destination ? 'direct' : 'temporary'
  }

  get sinkMode(): SinkMode {
    return this.mode
  }

  private async initialize(): Promise<void> {
    if (this.destination) {
      try {
        this.writable = await this.destination.createWritable()
      } catch {
        throw new Error('Could not open the selected file for writing.')
      }
      return
    }

    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage

    try {
      if (!storage?.getDirectory) throw new Error('No private file system')
      const root = await storage.getDirectory()
      this.tempHandle = await root.getFileHandle(
        `${TEMP_PREFIX}${crypto.randomUUID()}.part`,
        { create: true },
      )
      this.writable = await this.tempHandle.createWritable()
    } catch {
      // Drop the empty handle created above if createWritable was unavailable.
      await this.removeTemp()

      if (this.expectedSize > MEMORY_FALLBACK_MAX_FILE_SIZE) {
        throw new Error(
          'This browser cannot stream the file to disk, and the file is too large to buffer in memory. Use Chrome or Edge, or choose a smaller file.',
        )
      }
      // No OPFS: keep the chunks in memory until the download is offered.
      this.writable = null
      this.memoryChunks = []
    }
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.initialize()
    return this.initPromise
  }

  write(chunk: ArrayBuffer): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Sink is closed'))

    this.queue = this.queue.then(async () => {
      if (this.closed) throw new Error('Sink is closed')
      await this.ensureInitialized()
      if (this.writable) {
        await this.writable.write(chunk)
      } else {
        this.memoryChunks!.push(chunk)
      }
    })

    return this.queue
  }

  async finish(): Promise<FinishedFile> {
    if (this.finished) throw new Error('Sink already finished')
    this.finished = true

    await this.queue
    await this.ensureInitialized()

    const name = sanitizeFileName(this.fileName)

    if (this.writable) {
      await this.writable.close()
      this.writable = null

      if (this.tempHandle) {
        const file = await this.tempHandle.getFile()
        this.downloadUrl = URL.createObjectURL(
          new File([file], name, { type: this.mimeType }),
        )
      }
    } else {
      const blob = new Blob(this.memoryChunks ?? [], { type: this.mimeType })
      // The Blob now owns the bytes; release the chunk list so a large file is
      // not kept in memory twice.
      this.memoryChunks = null
      this.downloadUrl = URL.createObjectURL(
        new File([blob], name, { type: this.mimeType }),
      )
    }

    return {
      name,
      mode: this.mode,
      downloadUrl: this.downloadUrl ?? undefined,
      cleanup: this.cleanup,
    }
  }

  async abort(): Promise<void> {
    if (this.closed) return
    this.closed = true

    try {
      await this.ensureInitialized()
    } catch {
      // Initialization may have failed; nothing to close.
    }

    if (this.writable) {
      await this.writable.abort().catch(() => undefined)
      this.writable = null
    }
    this.memoryChunks = null
    await this.removeTemp()
  }

  cleanup = (): void => {
    this.closed = true
    if (this.downloadUrl) {
      URL.revokeObjectURL(this.downloadUrl)
      this.downloadUrl = null
    }
    void this.removeTemp()
  }

  private async removeTemp(): Promise<void> {
    const handle = this.tempHandle
    this.tempHandle = null
    if (!handle) return

    try {
      const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
      const root = await storage?.getDirectory?.()
      await root?.removeEntry(handle.name)
    } catch {
      // Best effort: a stale temporary file is harmless.
    }
  }
}
