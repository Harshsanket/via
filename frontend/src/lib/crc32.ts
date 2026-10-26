const TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
})()

const asBytes = (data: ArrayBuffer | ArrayBufferView): Uint8Array => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

/** Incremental CRC-32 (IEEE 802.3), useful for streaming checksums. */
export class Crc32 {
  private state = 0xffffffff

  update(data: ArrayBuffer | ArrayBufferView): this {
    const bytes = asBytes(data)
    let state = this.state
    for (let i = 0; i < bytes.length; i += 1) {
      state = TABLE[(state ^ bytes[i]) & 0xff] ^ (state >>> 8)
    }
    this.state = state >>> 0
    return this
  }

  digest(): number {
    return (this.state ^ 0xffffffff) >>> 0
  }

  /** Raw running state, for resuming a checksum in another instance. */
  rawState(): number {
    return this.state >>> 0
  }

  static fromState(state: number): Crc32 {
    if (!Number.isInteger(state) || state < 0 || state > 0xffffffff) {
      throw new RangeError('CRC32 state must be an unsigned 32-bit integer')
    }
    const checksum = new Crc32()
    checksum.state = state >>> 0
    return checksum
  }
}

export function crc32(data: ArrayBuffer | ArrayBufferView): number {
  return new Crc32().update(data).digest()
}
