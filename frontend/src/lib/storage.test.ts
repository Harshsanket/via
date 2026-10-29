import { afterEach, describe, expect, it, vi } from 'vitest'

import { getAvailableBytes, hasEnoughStorage } from './storage'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getAvailableBytes', () => {
  it('subtracts usage from quota', () => {
    expect(getAvailableBytes({ quota: 100, usage: 30 })).toBe(70)
  })

  it('returns null when the browser gives no quota', () => {
    expect(getAvailableBytes({})).toBeNull()
    expect(getAvailableBytes(null)).toBeNull()
  })
})

describe('hasEnoughStorage', () => {
  it('refuses when the estimate is smaller than the file', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ quota: 100, usage: 90 }) },
    })

    await expect(hasEnoughStorage(20)).resolves.toBe(false)
  })

  it('allows when there is enough room', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ quota: 100, usage: 10 }) },
    })

    await expect(hasEnoughStorage(20)).resolves.toBe(true)
  })

  it('does not block when the estimate is unavailable', async () => {
    vi.stubGlobal('navigator', {})

    await expect(hasEnoughStorage(20)).resolves.toBe(true)
  })
})
