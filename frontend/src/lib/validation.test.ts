import { describe, expect, it } from 'vitest'

import {
  buildReceiveUrl,
  extractReceiveLink,
  extractSessionId,
  isValidSessionId,
} from './validation'

describe('isValidSessionId', () => {
  it('accepts backend-style ids', () => {
    expect(isValidSessionId('abcd1234')).toBe(true)
    expect(isValidSessionId('A1b2_C3d-4')).toBe(true)
  })

  it('rejects short, padded, or unsafe ids', () => {
    expect(isValidSessionId('a234567')).toBe(false)
    expect(isValidSessionId('abcd 1234')).toBe(false)
    expect(isValidSessionId('-abcd1234')).toBe(false)
    expect(isValidSessionId('')).toBe(false)
    expect(isValidSessionId('a'.repeat(129))).toBe(false)
  })
})

describe('extractSessionId', () => {
  it('accepts raw ids and trims whitespace', () => {
    expect(extractSessionId('  abcd1234  ')).toBe('abcd1234')
  })

  it('extracts ids from receive URLs', () => {
    expect(
      extractSessionId('https://via.example/receive/abcd1234?source=link'),
    ).toBe('abcd1234')
    expect(extractSessionId('http://localhost:5173/receive/abcd1234/')).toBe(
      'abcd1234',
    )
  })

  it('rejects unrelated URLs and malformed input', () => {
    expect(extractSessionId('https://via.example/send/abcd1234')).toBeNull()
    expect(extractSessionId('not a session')).toBeNull()
    expect(extractSessionId('')).toBeNull()
  })
})

describe('receive links carry the key in the fragment', () => {
  const KEY = 'A'.repeat(22)

  it('builds the link with the key after #', () => {
    const url = new URL(buildReceiveUrl('abcd1234', KEY, 'https://via.example'))
    expect(url.pathname).toBe('/receive/abcd1234')
    expect(url.hash).toBe(`#k=${KEY}`)
    expect(url.search).toBe('')
  })

  it('extracts the id and key from a pasted link', () => {
    expect(extractReceiveLink(`https://via.example/receive/abcd1234#k=${KEY}`)).toEqual({
      sessionId: 'abcd1234',
      key: KEY,
    })
  })

  it('returns a null key for a bare id or a link without one', () => {
    expect(extractReceiveLink('abcd1234')).toEqual({ sessionId: 'abcd1234', key: null })
    expect(extractReceiveLink('https://via.example/receive/abcd1234')).toEqual({
      sessionId: 'abcd1234',
      key: null,
    })
    expect(extractReceiveLink('nonsense here')).toBeNull()
  })
})
