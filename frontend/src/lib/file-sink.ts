import { sanitizeFileName, sanitizeMimeType } from './format'

export type SinkMode = 'opfs' | 'memory' | 'direct'

export interface FinishedFile {
  url: string | null
  name: string
  mode: SinkMode
  cleanup: () => void
}

export interface IncomingFileSinkOptions {
  /** When set, chunks are written directly to this user-chosen file. */
  destination?: FileSystemFileHandle
}

export class FileTooLargeError extends Error {
  constructor() {
    super(
      'This browser cannot stream the file to disk, and the file is too large to buffer in memory. Use a Chromium-based browser or a smaller file.',
    )
    this.name = 'FileTooLargeError'
  }
}

const OPFS_DIRECTORY = 'via-transfers'
const STALE_TRANSFER_AGE_MS = 24 * 60 * 60 * 1000

type SweepableDirectory = Pick<FileSystemDirectoryHandle, 'removeEntry'> & {
  entries(): AsyncIterable<
    readonly [string, { kind: string; getFile?: () => Promise<{ lastModified: number }> }]
  >
}

/**
 * Deletes partial downloads (`*.part`) left in OPFS by a tab that crashed or
 * was closed mid-transfer; nothing else would ever remove them. Only files
 * untouched for a day go, so another tab's transfer in progress is safe.
 * Returns how many were removed.
 */
export async function sweepStaleTransfers(
  directory?: FileSystemDirectoryHandle,
  maxAgeMs = STALE_TRANSFER_AGE_MS,
  now = Date.now(),
): Promise<number> {
  let target = directory as SweepableDirectory | undefined
  if (!target) {
    if (!isOpfsSupported()) return 0
    try {
      const root = await navigator.storage.getDirectory()
      target = (await root.getDirectoryHandle(OPFS_DIRECTORY, {
        create: false,
      })) as unknown as SweepableDirectory
    } catch {
      return 0
    }
  }

  let removed = 0
  for await (const [name, handle] of target.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.part') || !handle.getFile) continue
    try {
      const file = await handle.getFile()
      if (now - file.lastModified < maxAgeMs) continue
      await target.removeEntry(name)
      removed += 1
    } catch {
      // In use or already gone; try again next time.
    }
  }
  return removed
}

export function isOpfsSupported(): boolean {
  if (typeof navigator === 'undefined') return false
  if (!('storage' in navigator) || typeof navigator.storage.getDirectory !== 'function') {
    return false
  }
  if (typeof FileSystemFileHandle === 'undefined') return false
  return 'createWritable' in FileSystemFileHandle.prototype
}

/**
 * Receives chunks either into the Origin Private File System (streaming,
 * survives large files) or, when OPFS is unavailable, into memory.
 *
 * Writes are serialized through a promise chain so the caller can hand chunks
 * over synchronously while the sink is still being initialized.
 */
export class IncomingFileSink {
  private mode: SinkMode = 'memory'
  private initPromise: Promise<void> | null = null
  private queue: Promise<void> = Promise.resolve()
  private chunks: ArrayBuffer[] = []
  private writable: FileSystemWritableFileStream | null = null
  private fileHandle: FileSystemFileHandle | null = null
  private directory: FileSystemDirectoryHandle | null = null
  private opfsFileName = ''
  private objectUrl: string | null = null
  private closed = false
  private finished = false
  private readonly fileName: string
  private readonly mimeType: string
  private readonly expectedSize: number
  private readonly maxMemoryBytes: number
  private readonly destination: FileSystemFileHandle | null

  constructor(
    fileName: string,
    mimeType: string,
    expectedSize: number,
    maxMemoryBytes: number,
    options: IncomingFileSinkOptions = {},
  ) {
    this.fileName = fileName
    this.mimeType = mimeType
    this.expectedSize = expectedSize
    this.maxMemoryBytes = maxMemoryBytes
    this.destination = options.destination ?? null
  }

  get sinkMode(): SinkMode {
    return this.mode
  }

  private async initialize(): Promise<void> {
    if (this.destination) {
      try {
        this.writable = await this.destination.createWritable()
        this.mode = 'direct'
        return
      } catch {
        throw new Error('Could not open the selected file for writing.')
      }
    }

    if (!isOpfsSupported()) {
      if (this.expectedSize > this.maxMemoryBytes) throw new FileTooLargeError()
      this.mode = 'memory'
      return
    }

    try {
      const root = await navigator.storage.getDirectory()
      const directory = await root.getDirectoryHandle(OPFS_DIRECTORY, {
        create: true,
      })
      const opfsFileName = `${crypto.randomUUID()}.part`
      const fileHandle = await directory.getFileHandle(opfsFileName, {
        create: true,
      })
      const writable = await fileHandle.createWritable()

      this.directory = directory
      this.opfsFileName = opfsFileName
      this.fileHandle = fileHandle
      this.writable = writable
      this.mode = 'opfs'
    } catch {
      this.mode = 'memory'
      if (this.expectedSize > this.maxMemoryBytes) throw new FileTooLargeError()
    }
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.initialize()
    return this.initPromise
  }

  write(chunk: ArrayBuffer): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Sink is closed'))

    this.queue = this.queue.then(async () => {
      await this.ensureInitialized()
      if (this.mode === 'opfs' && this.writable) {
        await this.writable.write(chunk)
        return
      }
      if (this.mode === 'direct' && this.writable) {
        await this.writable.write(chunk)
        return
      }
      this.chunks.push(chunk)
    })

    return this.queue
  }

  async finish(): Promise<FinishedFile> {
    if (this.finished) throw new Error('Sink already finished')
    this.finished = true

    await this.queue
    await this.ensureInitialized()

    const name = sanitizeFileName(this.fileName)
    const type = sanitizeMimeType(this.mimeType)

    if (this.mode === 'direct' && this.writable) {
      await this.writable.close()
      return { url: null, name, mode: this.mode, cleanup: this.cleanup }
    }

    if (this.mode === 'opfs' && this.writable && this.fileHandle) {
      await this.writable.close()
      const file = await this.fileHandle.getFile()
      const url = URL.createObjectURL(file)
      this.objectUrl = url
      return { url, name, mode: this.mode, cleanup: this.cleanup }
    }

    const blob = new Blob(this.chunks, { type })
    this.chunks = []
    const url = URL.createObjectURL(blob)
    this.objectUrl = url
    return { url, name, mode: this.mode, cleanup: this.cleanup }
  }

  async abort(): Promise<void> {
    if (this.closed) return
    this.closed = true

    try {
      await this.ensureInitialized()
    } catch {
      // Initialization may have failed; nothing to close.
    }

    this.writable?.abort().catch(() => undefined)
    this.chunks = []
    this.revokeUrl()

    if (this.directory && this.opfsFileName) {
      await this.directory.removeEntry(this.opfsFileName).catch(() => undefined)
    }
  }

  cleanup = (): void => {
    this.closed = true
    this.revokeUrl()
    this.chunks = []
    if (this.directory && this.opfsFileName) {
      void this.directory.removeEntry(this.opfsFileName).catch(() => undefined)
    }
  }

  private revokeUrl(): void {
    if (!this.objectUrl) return
    URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = null
  }
}
