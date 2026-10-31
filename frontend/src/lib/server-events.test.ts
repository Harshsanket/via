import { describe, expect, it } from 'vitest'

import {
  parseCreateSessionResponse,
  parseDescriptionEvent,
  parseFileMetadataEvent,
  parseIceCandidateEvent,
  parseJoinSessionResponse,
  parseResolveSessionResponse,
  parseSessionErrorEvent,
  parseSessionExpiringEvent,
  parseSessionTtl,
  parseTransferCompleteEvent,
} from './server-events'

describe('server event parsers', () => {
  it('accepts well-formed file metadata and rejects bad sizes or types', () => {
    const metadata = { fileName: 'a.txt', mimeType: 'text/plain', fileSize: 10 }
    expect(parseFileMetadataEvent({ success: true, metadata })).toEqual({
      success: true,
      metadata,
    })
    expect(parseFileMetadataEvent({ success: true, metadata: null })).toEqual({
      success: true,
      metadata: null,
    })

    for (const bad of [
      { success: true, metadata: { ...metadata, fileSize: -1 } },
      { success: true, metadata: { ...metadata, fileSize: '10' } },
      { success: true, metadata: { ...metadata, fileName: '' } },
      { success: true, metadata: { ...metadata, fileName: 'x'.repeat(3000) } },
      { success: 'yes', metadata },
      null,
      'string',
    ]) {
      expect(parseFileMetadataEvent(bad)).toBeNull()
    }
  })

  it('accepts metadata above the old 50 GB limit', () => {
    const metadata = {
      fileName: 'huge.bin',
      mimeType: 'application/octet-stream',
      fileSize: 50 * 1024 ** 3 + 1,
    }
    expect(parseFileMetadataEvent({ success: true, metadata })).toEqual({
      success: true,
      metadata,
    })
  })

  it('checks created sessions and short-link lookups', () => {
    expect(
      parseCreateSessionResponse({
        success: true,
        sessionId: 'abcd1234',
        shortCode: '4821',
      }),
    ).toEqual({
      success: true,
      sessionId: 'abcd1234',
      shortCode: '4821',
    })
    expect(
      parseCreateSessionResponse({
        success: true,
        sessionId: 'abcd1234',
        shortCode: 'bad code',
      }),
    ).toBeNull()
    expect(
      parseResolveSessionResponse({ success: true, sessionId: 'abcd1234' }),
    ).toEqual({ success: true, sessionId: 'abcd1234' })
    expect(parseResolveSessionResponse({ success: false, message: 'expired' })).toEqual({
      success: false,
      message: 'expired',
    })
  })

  it('checks join responses, including their metadata', () => {
    expect(parseJoinSessionResponse({ success: false, message: 'full' })).toEqual({
      success: false,
      message: 'full',
    })
    expect(
      parseJoinSessionResponse({
        success: true,
        metadata: { fileName: 'a', mimeType: 'b/c', fileSize: 'huge' },
      }),
    ).toBeNull()
  })

  it('only relays real session descriptions', () => {
    expect(
      parseDescriptionEvent({ offer: { type: 'offer', sdp: 'v=0' } }, 'offer'),
    ).toEqual({ offer: { type: 'offer', sdp: 'v=0' } })
    expect(
      parseDescriptionEvent({ offer: { type: 'evil', sdp: 'v=0' } }, 'offer'),
    ).toBeNull()
    expect(
      parseDescriptionEvent({ answer: { type: 'answer', sdp: 'x'.repeat(70_000) } }, 'answer'),
    ).toBeNull()
  })

  it('accepts end-of-candidates and bounded candidates only', () => {
    expect(parseIceCandidateEvent({ candidate: null })).toEqual({ candidate: null })
    expect(
      parseIceCandidateEvent({
        candidate: { candidate: 'candidate:1 1 udp 1 10.0.0.1 9 typ host', sdpMid: '0' },
      }),
    ).not.toBeNull()
    expect(parseIceCandidateEvent({ candidate: { candidate: 42 } })).toBeNull()
    expect(
      parseIceCandidateEvent({ candidate: { candidate: 'c'.repeat(2000) } }),
    ).toBeNull()
  })

  it('validates timers and errors', () => {
    expect(parseSessionTtl({ exists: true, createdAt: '1', ttl: 30 })).not.toBeNull()
    expect(parseSessionTtl({ exists: true, createdAt: 1, ttl: 30 })).toBeNull()
    expect(
      parseSessionExpiringEvent({ sessionId: 'abc', secondsRemaining: 30 }),
    ).not.toBeNull()
    expect(
      parseSessionExpiringEvent({ sessionId: 'abc', secondsRemaining: Infinity }),
    ).toBeNull()

    const longError = parseSessionErrorEvent({ success: false, message: 'x'.repeat(5000) })
    expect(longError?.message.length).toBeLessThanOrEqual(300)
    expect(parseSessionErrorEvent({ success: false })).toBeNull()
  })

  it('accepts transfer completion with a string name', () => {
    expect(parseTransferCompleteEvent({ success: true, fileName: 'a' })).toEqual({
      success: true,
      fileName: 'a',
    })
    expect(parseTransferCompleteEvent({ success: true, fileName: 7 })).toBeNull()
  })
})
