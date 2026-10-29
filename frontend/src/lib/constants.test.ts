import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('MAX_RECOVERY_ATTEMPTS', () => {
  it('defaults to two', async () => {
    const { MAX_RECOVERY_ATTEMPTS } = await import('./constants')
    expect(MAX_RECOVERY_ATTEMPTS).toBe(2)
  })

  it('reads VITE_MAX_RECOVERY_ATTEMPTS', async () => {
    vi.stubEnv('VITE_MAX_RECOVERY_ATTEMPTS', '5')
    const { MAX_RECOVERY_ATTEMPTS } = await import('./constants')
    expect(MAX_RECOVERY_ATTEMPTS).toBe(5)
  })

  it('falls back on invalid values', async () => {
    vi.stubEnv('VITE_MAX_RECOVERY_ATTEMPTS', 'nope')
    const { MAX_RECOVERY_ATTEMPTS } = await import('./constants')
    expect(MAX_RECOVERY_ATTEMPTS).toBe(2)
  })
})
