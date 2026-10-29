import { describe, expect, it } from 'vitest'

import { getReceiverToken } from './receiver-token'

const fakeStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe('getReceiverToken', () => {
  it('reuses the token stored for the same session', () => {
    const storage = fakeStorage()

    const first = getReceiverToken('session-one', storage)
    const second = getReceiverToken('session-one', storage)

    expect(second).toBe(first)
    expect(storage.values.get('via:receiver-token:session-one')).toBe(first)
  })

  it('reads a token left by the previous page load', () => {
    const storage = fakeStorage({
      'via:receiver-token:session-two': 'kept-from-before',
    })

    expect(getReceiverToken('session-two', storage)).toBe('kept-from-before')
  })

  it('keeps sessions apart', () => {
    const storage = fakeStorage()

    expect(getReceiverToken('session-a', storage)).not.toBe(
      getReceiverToken('session-b', storage)
    )
  })

  it('still returns a token when storage is unavailable', () => {
    const first = getReceiverToken('session-blocked', null)
    const second = getReceiverToken('session-blocked', null)

    expect(first).toMatch(/^[A-Za-z0-9_-]{8,128}$/)
    expect(second).toBe(first)
  })
})
