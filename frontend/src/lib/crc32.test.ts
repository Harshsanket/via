import { describe, expect, it } from 'vitest'

import { Crc32, crc32 } from './crc32'

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)

describe('crc32', () => {
  it('matches the standard IEEE check value', () => {
    expect(crc32(encode('123456789'))).toBe(0xcbf43926)
  })

  it('returns zero for empty input', () => {
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('produces the same digest across incremental updates', () => {
    const checksum = new Crc32()
    checksum.update(encode('1234'))
    checksum.update(encode('56789'))

    expect(checksum.digest()).toBe(crc32(encode('123456789')))
  })

  it('handles typed-array views with offsets', () => {
    const bytes = encode('xx123456789yy')
    const view = bytes.subarray(2, 11)

    expect(crc32(view)).toBe(0xcbf43926)
  })

  it('can resume from a raw state after a partial update', () => {
    const original = new Crc32().update(encode('1234'))
    const resumed = Crc32.fromState(original.rawState()).update(encode('56789'))

    expect(resumed.digest()).toBe(0xcbf43926)
    expect(original.rawState()).not.toBe(resumed.rawState())
  })

  it('rejects invalid raw states', () => {
    expect(() => Crc32.fromState(-1)).toThrow(RangeError)
    expect(() => Crc32.fromState(1.5)).toThrow(RangeError)
    expect(() => Crc32.fromState(0x1_0000_0000)).toThrow(RangeError)
  })
})
