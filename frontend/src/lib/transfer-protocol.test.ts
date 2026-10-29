import { describe, expect, it } from 'vitest'

import {
  encodeControlFrame,
  parseControlFrame,
  parseControlFrameText,
} from './transfer-protocol'

describe('transfer protocol', () => {
  it('parses metadata and complete frames', () => {
    expect(
      parseControlFrame({
        type: 'metadata',
        fileName: 'notes.txt',
        fileSize: 12,
        fileType: 'text/plain',
      }),
    ).toEqual({
      type: 'metadata',
      fileName: 'notes.txt',
      fileSize: 12,
      fileType: 'text/plain',
    })

    expect(
      parseControlFrame({ type: 'complete', fileSize: 12, crc32: 0xcbf43926 }),
    ).toEqual({ type: 'complete', fileSize: 12, crc32: 0xcbf43926 })
  })

  it('parses resume and retry frames', () => {
    expect(
      parseControlFrame({ type: 'resume', receivedBytes: 64, crcState: 42 }),
    ).toEqual({ type: 'resume', receivedBytes: 64, crcState: 42 })
    expect(parseControlFrame({ type: 'resume-request' })).toEqual({
      type: 'resume-request',
    })
    expect(parseControlFrame({ type: 'request-transfer' })).toEqual({
      type: 'request-transfer',
    })
    expect(parseControlFrame({ type: 'offer-transfer' })).toEqual({
      type: 'offer-transfer',
    })
    expect(parseControlFrame({ type: 'retry' })).toEqual({ type: 'retry' })
  })

  it('accepts file sizes above the old 50 GB limit', () => {
    const fileSize = 50 * 1024 ** 3 + 1
    expect(
      parseControlFrame({ type: 'metadata', fileName: 'huge.bin', fileSize, fileType: 'x/y' }),
    ).not.toBeNull()
    expect(
      parseControlFrame({ type: 'complete', fileSize, crc32: 1 }),
    ).not.toBeNull()
    expect(
      parseControlFrame({ type: 'resume', receivedBytes: fileSize, crcState: 0 }),
    ).not.toBeNull()
  })

  it('rejects malformed or out-of-range frames', () => {
    expect(parseControlFrame(null)).toBeNull()
    expect(parseControlFrame({ type: 'metadata', fileName: '', fileSize: 12 })).toBeNull()
    expect(
      parseControlFrame({ type: 'metadata', fileName: 'a', fileSize: 0, fileType: 'x' }),
    ).toBeNull()
    expect(
      parseControlFrame({ type: 'complete', fileSize: 12, crc32: 0x1_0000_0000 }),
    ).toBeNull()
    expect(
      parseControlFrame({ type: 'resume', receivedBytes: -1, crcState: 0 }),
    ).toBeNull()
    expect(parseControlFrame({ type: 'unknown' })).toBeNull()
  })

  it('round-trips through JSON and rejects invalid JSON', () => {
    const raw = encodeControlFrame({ type: 'cancel', message: 'cancelled' })
    expect(parseControlFrameText(raw)).toEqual({
      type: 'cancel',
      message: 'cancelled',
    })
    expect(parseControlFrameText('{')).toBeNull()
  })

  it('accepts a well-formed auth frame and rejects anything else', () => {
    const tag = 'A'.repeat(43)
    expect(parseControlFrame({ type: 'auth', role: 'sender', tag })).toEqual({
      type: 'auth',
      role: 'sender',
      tag,
    })
    expect(parseControlFrame({ type: 'auth', role: 'admin', tag })).toBeNull()
    expect(parseControlFrame({ type: 'auth', role: 'receiver', tag: 'short' })).toBeNull()
    expect(
      parseControlFrame({ type: 'auth', role: 'receiver', tag: '!'.repeat(43) }),
    ).toBeNull()
  })
})
