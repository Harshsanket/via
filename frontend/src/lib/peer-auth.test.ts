import { describe, expect, it } from 'vitest'

import {
  computeAuthTag,
  computeVerificationCode,
  decryptMetadata,
  encryptMetadata,
  extractFingerprint,
  generateLinkKey,
  isEncryptedMetadata,
  parseLinkKey,
  verifyAuthTag,
} from './peer-auth'

const fp = (byte: string) =>
  `sha-256 ${Array.from({ length: 32 }, () => byte).join(':')}`

const sdpWith = (fingerprint: string) =>
  [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=-',
    `a=fingerprint:${fingerprint}`,
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    '',
  ].join('\r\n')

const SENDER_FP = fp('AA')
const RECEIVER_FP = fp('BB')
const ATTACKER_FP = fp('EE')

describe('link key', () => {
  it('generates a 128-bit base64url key that round-trips through a hash', () => {
    const key = generateLinkKey()
    expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(parseLinkKey(`#k=${key}`)).toBe(key)
    expect(generateLinkKey()).not.toBe(key)
  })

  it('rejects missing or malformed keys', () => {
    expect(parseLinkKey('')).toBeNull()
    expect(parseLinkKey('#k=short')).toBeNull()
    expect(parseLinkKey('#k=' + 'a'.repeat(23))).toBeNull()
    expect(parseLinkKey('#x=' + 'a'.repeat(22))).toBeNull()
  })
})

describe('extractFingerprint', () => {
  it('reads and normalises the DTLS fingerprint', () => {
    expect(extractFingerprint(sdpWith(fp('ab')))).toBe(fp('AB'))
  })

  it('returns null without one', () => {
    expect(extractFingerprint('v=0\r\ns=-\r\n')).toBeNull()
    expect(extractFingerprint(undefined)).toBeNull()
  })
})

describe('peer authentication', () => {
  it('accepts a peer that holds the key and sees the same connection', async () => {
    const key = generateLinkKey()

    // Each side tags (its role, its own fingerprint, the peer's fingerprint).
    const senderTag = await computeAuthTag(key, 'sender', SENDER_FP, RECEIVER_FP)
    const receiverTag = await computeAuthTag(key, 'receiver', RECEIVER_FP, SENDER_FP)

    // Each side checks the other's tag against its own view of the link.
    expect(
      await verifyAuthTag(key, 'sender', senderTag, {
        local: RECEIVER_FP,
        remote: SENDER_FP,
      }),
    ).toBe(true)
    expect(
      await verifyAuthTag(key, 'receiver', receiverTag, {
        local: SENDER_FP,
        remote: RECEIVER_FP,
      }),
    ).toBe(true)
  })

  it('detects a man in the middle that swapped the fingerprints', async () => {
    const key = generateLinkKey()

    // The relay gave each peer its own fingerprint instead of the other's.
    const senderTag = await computeAuthTag(key, 'sender', SENDER_FP, ATTACKER_FP)

    expect(
      await verifyAuthTag(key, 'sender', senderTag, {
        local: RECEIVER_FP,
        remote: ATTACKER_FP,
      }),
    ).toBe(false)
  })

  it('rejects a tag made without the key, or replayed for the other role', async () => {
    const key = generateLinkKey()
    const forged = await computeAuthTag(generateLinkKey(), 'sender', SENDER_FP, RECEIVER_FP)
    const view = { local: RECEIVER_FP, remote: SENDER_FP }

    expect(await verifyAuthTag(key, 'sender', forged, view)).toBe(false)

    const receiverTag = await computeAuthTag(key, 'receiver', SENDER_FP, RECEIVER_FP)
    expect(await verifyAuthTag(key, 'sender', receiverTag, view)).toBe(false)
    expect(await verifyAuthTag(key, 'sender', 'not base64!', view)).toBe(false)
  })
})

describe('verification code', () => {
  it('is the same six digits on both ends, and differs per connection', async () => {
    const key = generateLinkKey()
    const a = await computeVerificationCode(key, SENDER_FP, RECEIVER_FP)
    const b = await computeVerificationCode(key, RECEIVER_FP, SENDER_FP)

    expect(a).toMatch(/^\d{3} \d{3}$/)
    expect(b).toBe(a)
    expect(await computeVerificationCode(key, SENDER_FP, ATTACKER_FP)).not.toBe(a)
  })
})

describe('metadata encryption', () => {
  it('round-trips the file name and type with the right key only', async () => {
    const key = generateLinkKey()
    const sealed = await encryptMetadata(key, {
      fileName: 'tax return 2026.pdf',
      mimeType: 'application/pdf',
    })

    expect(isEncryptedMetadata(sealed)).toBe(true)
    expect(sealed).not.toContain('tax')
    expect(sealed.length).toBeLessThanOrEqual(2048)

    expect(await decryptMetadata(key, sealed)).toEqual({
      fileName: 'tax return 2026.pdf',
      mimeType: 'application/pdf',
    })
    expect(await decryptMetadata(generateLinkKey(), sealed)).toBeNull()
    expect(await decryptMetadata(key, 'enc.v1.garbage')).toBeNull()
    expect(isEncryptedMetadata('photo.png')).toBe(false)
  })

  it('stays within the server limit for the longest allowed name', async () => {
    const sealed = await encryptMetadata(generateLinkKey(), {
      fileName: '文'.repeat(255),
      mimeType: `application/${'x'.repeat(115)}`,
    })
    expect(sealed.length).toBeLessThanOrEqual(2048)
  })
})
