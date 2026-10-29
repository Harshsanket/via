import { describe, expect, it } from 'vitest'

import {
  IncomingFileSink,
  MEMORY_FALLBACK_MAX_FILE_SIZE,
} from './file-sink'

const encode = (value: string): ArrayBuffer =>
  new TextEncoder().encode(value).slice().buffer

const makeDestination = () => {
  const chunks: string[] = []
  let closed = false
  let aborted = false

  const destination = {
    createWritable: async () => ({
      write: async (chunk: ArrayBuffer) => {
        chunks.push(new TextDecoder().decode(chunk))
      },
      close: async () => {
        closed = true
      },
      abort: async () => {
        aborted = true
      },
    }),
  } as unknown as FileSystemFileHandle

  return {
    destination,
    chunks,
    get closed() {
      return closed
    },
    get aborted() {
      return aborted
    },
  }
}

describe('IncomingFileSink', () => {
  it('writes chunks directly to the chosen file', async () => {
    const target = makeDestination()
    const sink = new IncomingFileSink('direct.txt', 'text/plain', 6, {
      destination: target.destination,
    })

    await sink.write(encode('abc'))
    await sink.write(encode('def'))

    const finished = await sink.finish()

    expect(finished.mode).toBe('direct')
    expect(finished.name).toBe('direct.txt')
    expect(target.chunks.join('')).toBe('abcdef')
    expect(target.closed).toBe(true)
    expect(sink.sinkMode).toBe('direct')
  })

  it('aborts the open destination', async () => {
    const target = makeDestination()
    const sink = new IncomingFileSink('x.txt', 'text/plain', 3, {
      destination: target.destination,
    })

    await sink.abort()

    expect(target.aborted).toBe(true)
    await expect(sink.write(encode('abc'))).rejects.toThrow('Sink is closed')
  })

  it('keeps chunks temporarily and offers a download when there is no picker', async () => {
    // Node has no navigator.storage here, so this exercises the in-memory
    // fallback; a browser with OPFS uses the same temporary mode on disk.
    const sink = new IncomingFileSink('temp.txt', 'text/plain', 6, {})

    await sink.write(encode('abc'))
    await sink.write(encode('def'))

    const finished = await sink.finish()

    expect(finished.mode).toBe('temporary')
    expect(finished.name).toBe('temp.txt')
    expect(finished.downloadUrl).toMatch(/^blob:/)
    expect(await (await fetch(finished.downloadUrl!)).text()).toBe('abcdef')
    expect(sink.sinkMode).toBe('temporary')

    finished.cleanup()
  })

  it('refuses to buffer an oversized file when OPFS is unavailable', async () => {
    // Node has no navigator.storage, so this is the in-memory fallback.
    const sink = new IncomingFileSink(
      'huge.bin',
      'application/octet-stream',
      MEMORY_FALLBACK_MAX_FILE_SIZE + 1,
      {},
    )

    await expect(sink.write(encode('abc'))).rejects.toThrow(
      /too large to buffer in memory/i,
    )
  })
})
