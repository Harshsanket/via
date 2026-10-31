import { describe, expect, it } from 'vitest'

import {
  buildReceiveUrl,
  buildShortReceiveUrl,
  extractReceiveLink,
  extractSessionId,
  isValidSessionId,
  isValidShortCode,
  parseLinkKeyFragment,
} from './validation'

const ORIGIN = 'https://via.example'
const KEY = 'A'.repeat(22)

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

describe('isValidShortCode', () => {
  it('accepts four to six lowercase letters or digits', () => {
    expect(isValidShortCode('4821')).toBe(true)
    expect(isValidShortCode('a7f2')).toBe(true)
    expect(isValidShortCode('k3m9p1')).toBe(true)
  })

  it('rejects codes outside the supported shape', () => {
    expect(isValidShortCode('482')).toBe(false)
    expect(isValidShortCode('k3m9p1x')).toBe(false)
    expect(isValidShortCode('A7F2')).toBe(false)
    expect(isValidShortCode('12-4')).toBe(false)
    expect(isValidShortCode('')).toBe(false)
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

describe('receive links', () => {
  it('builds the legacy long link with the key after #', () => {
    const url = new URL(buildReceiveUrl('abcd1234', KEY, ORIGIN))
    expect(url.pathname).toBe('/receive/abcd1234')
    expect(url.hash).toBe(`#k=${KEY}`)
    expect(url.search).toBe('')
  })

  it('builds the short link with the key after #', () => {
    const url = new URL(buildShortReceiveUrl('4821', KEY, ORIGIN))
    expect(url.pathname).toBe('/4821')
    expect(url.hash).toBe(`#k=${KEY}`)
    expect(url.search).toBe('')
  })

  it('extracts a short link', () => {
    expect(extractReceiveLink(`${ORIGIN}/4821#k=${KEY}`, ORIGIN)).toEqual({
      sessionId: null,
      shortCode: '4821',
      key: KEY,
    })
    expect(extractReceiveLink(`${ORIGIN}/4821/#k=${KEY}`, ORIGIN)).toEqual({
      sessionId: null,
      shortCode: '4821',
      key: KEY,
    })
  })

  it('extracts a legacy link', () => {
    expect(
      extractReceiveLink(`${ORIGIN}/receive/abcd1234#k=${KEY}`, ORIGIN),
    ).toEqual({
      sessionId: 'abcd1234',
      shortCode: null,
      key: KEY,
    })
  })

  it('accepts a bare short code but reports no key', () => {
    expect(extractReceiveLink('4821', ORIGIN)).toEqual({
      sessionId: null,
      shortCode: '4821',
      key: null,
    })
  })

  it('reports a missing key for a link without a fragment', () => {
    expect(extractReceiveLink(`${ORIGIN}/4821`, ORIGIN)).toEqual({
      sessionId: null,
      shortCode: '4821',
      key: null,
    })
    expect(extractReceiveLink(`${ORIGIN}/receive/abcd1234`, ORIGIN)).toEqual({
      sessionId: 'abcd1234',
      shortCode: null,
      key: null,
    })
  })

  it('rejects foreign origins, query strings and extra paths', () => {
    expect(
      extractReceiveLink(`https://evil.example/4821#k=${KEY}`, ORIGIN),
    ).toBeNull()
    expect(
      extractReceiveLink(`${ORIGIN}/4821?from=chat#k=${KEY}`, ORIGIN),
    ).toBeNull()
    expect(
      extractReceiveLink(`${ORIGIN}/receive/abcd1234/extra#k=${KEY}`, ORIGIN),
    ).toBeNull()
    expect(extractReceiveLink(`${ORIGIN}/send/4821#k=${KEY}`, ORIGIN)).toBeNull()
  })

  it('rejects a bare UUID, malformed keys and invalid codes', () => {
    expect(extractReceiveLink('abcd1234', ORIGIN)).toBeNull()
    expect(extractReceiveLink(`${ORIGIN}/4821#k=short`, ORIGIN)).toBeNull()
    expect(extractReceiveLink(`${ORIGIN}/482#k=${KEY}`, ORIGIN)).toBeNull()
    expect(extractReceiveLink(`${ORIGIN}/4821#k=${KEY}&x=1`, ORIGIN)).toBeNull()
    expect(extractReceiveLink('nonsense here', ORIGIN)).toBeNull()
  })

  it('strictly parses the fragment of a directly opened link', () => {
    expect(parseLinkKeyFragment(`#k=${KEY}`)).toBe(KEY)
    expect(parseLinkKeyFragment(`#k=${KEY}&x=1`)).toBeNull()
    expect(parseLinkKeyFragment('#k=short')).toBeNull()
    expect(parseLinkKeyFragment('')).toBeNull()
  })
})
