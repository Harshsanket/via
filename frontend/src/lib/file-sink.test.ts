import { describe, expect, it, vi } from 'vitest'

import { FileTooLargeError, IncomingFileSink, sweepStaleTransfers } from './file-sink'

const encode = (value: string): ArrayBuffer =>
  new TextEncoder().encode(value).slice().buffer

describe('IncomingFileSink', () => {
  it('buffers chunks in memory when OPFS is unavailable', async () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:test')
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)

    const sink = new IncomingFileSink('hello.txt', 'text/plain', 11, 1024)
    await sink.write(encode('hello '))
    await sink.write(encode('world'))

    const finished = await sink.finish()

    expect(finished.mode).toBe('memory')
    expect(finished.name).toBe('hello.txt')
    expect(finished.url).toBe('blob:test')
    expect(sink.sinkMode).toBe('memory')
    expect(createObjectURL).toHaveBeenCalledTimes(1)

    finished.cleanup()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })

  it('rejects files larger than the memory fallback', async () => {
    const sink = new IncomingFileSink('big.bin', 'application/octet-stream', 20, 10)

    await expect(sink.write(new ArrayBuffer(20))).rejects.toBeInstanceOf(
      FileTooLargeError,
    )
    await expect(sink.finish()).rejects.toBeInstanceOf(FileTooLargeError)
  })

  it('rejects writes after an abort', async () => {
    const sink = new IncomingFileSink('x.txt', 'text/plain', 3, 1024)
    await sink.abort()

    await expect(sink.write(encode('abc'))).rejects.toThrow('Sink is closed')
  })

  it('writes directly to a chosen file without creating an object URL', async () => {
    const chunks: string[] = []
    let closed = false
    const destination = {
      createWritable: async () => ({
        write: async (chunk: ArrayBuffer) => {
          chunks.push(new TextDecoder().decode(chunk))
        },
        close: async () => {
          closed = true
        },
        abort: async () => undefined,
      }),
    } as unknown as FileSystemFileHandle

    const sink = new IncomingFileSink('direct.txt', 'text/plain', 6, 1024, {
      destination,
    })
    await sink.write(encode('abc'))
    await sink.write(encode('def'))

    const finished = await sink.finish()

    expect(finished.mode).toBe('direct')
    expect(finished.url).toBeNull()
    expect(finished.name).toBe('direct.txt')
    expect(chunks.join('')).toBe('abcdef')
    expect(closed).toBe(true)
  })
})

describe('sweepStaleTransfers', () => {
  const fakeDirectory = (files: Record<string, number>) => {
    const removed: string[] = []
    const directory = {
      async *entries() {
        for (const [name, lastModified] of Object.entries(files)) {
          yield [
            name,
            { kind: 'file', getFile: async () => ({ lastModified }) },
          ] as const
        }
      },
      removeEntry: async (name: string) => {
        removed.push(name)
      },
    }
    return { directory, removed }
  }

  it('removes only partial files older than the cutoff', async () => {
    const now = 10 * 24 * 60 * 60 * 1000
    const day = 24 * 60 * 60 * 1000
    const { directory, removed } = fakeDirectory({
      'old.part': now - 2 * day,
      'fresh.part': now - 60_000,
      'old-but-not-ours.txt': now - 5 * day,
    })

    const count = await sweepStaleTransfers(
      directory as unknown as FileSystemDirectoryHandle,
      day,
      now,
    )

    expect(removed).toEqual(['old.part'])
    expect(count).toBe(1)
  })
})
