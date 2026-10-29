import { describe, expect, it } from 'vitest'

import {
  formatFileSize,
  formatTTL,
  getFileExtension,
  sanitizeFileName,
  sanitizeMimeType,
  truncateFileName,
} from './format'

describe('formatFileSize', () => {
  it('formats bytes and larger units', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(500)).toBe('500 B')
    expect(formatFileSize(1536)).toBe('1.50 KB')
    expect(formatFileSize(1024 * 1024)).toBe('1.00 MB')
  })

  it('guards against invalid values', () => {
    expect(formatFileSize(-1)).toBe('0 B')
    expect(formatFileSize(Number.NaN)).toBe('0 B')
  })
})

describe('formatTTL', () => {
  it('formats seconds, minutes, and hours', () => {
    expect(formatTTL(0)).toBe('Expired')
    expect(formatTTL(45)).toBe('45s')
    expect(formatTTL(125)).toBe('2m 5s')
    expect(formatTTL(3720)).toBe('1h 2m')
  })
})

describe('file names', () => {
  it('detects extensions', () => {
    expect(getFileExtension('archive.tar.gz')).toBe('GZ')
    expect(getFileExtension('README')).toBe('FILE')
    expect(getFileExtension('.env')).toBe('FILE')
  })

  it('sanitizes path separators, reserved characters, and control characters', () => {
    expect(sanitizeFileName('  ../Hello:World?.txt  ')).toBe(
      '_Hello_World_.txt',
    )
    expect(sanitizeFileName('a\u0000b\u007fc')).toBe('a_b_c')
    // A bidi override could otherwise disguise the real extension.
    expect(sanitizeFileName('invoice\u202Etxt.exe')).toBe('invoice_txt.exe')
    expect(sanitizeFileName('')).toBe('download')
  })

  it('caps very long names while keeping the extension', () => {
    const result = sanitizeFileName(`${'a'.repeat(300)}.txt`)
    expect(result.length).toBeLessThanOrEqual(180)
    expect(result.endsWith('.txt')).toBe(true)
  })

  it('truncates the base name but keeps the extension', () => {
    expect(truncateFileName('really-long-name.txt', 10)).toBe('really….txt')
    expect(truncateFileName('short.txt', 20)).toBe('short.txt')
  })
})

describe('sanitizeMimeType', () => {
  it('accepts simple MIME types and rejects parameters', () => {
    expect(sanitizeMimeType('text/plain')).toBe('text/plain')
    expect(sanitizeMimeType('application/wasm')).toBe('application/wasm')
    expect(sanitizeMimeType('text/html; charset=utf-8')).toBe(
      'application/octet-stream',
    )
    expect(sanitizeMimeType(undefined)).toBe('application/octet-stream')
  })
})

describe('sanitizeMimeType with active content', () => {
  it('downgrades types a browser would render or run to a plain download', () => {
    for (const active of [
      'text/html',
      'TEXT/HTML',
      'image/svg+xml',
      'application/xhtml+xml',
      'text/xml',
      'application/xml',
      'text/javascript',
      'application/javascript',
      'application/ecmascript',
    ]) {
      expect(sanitizeMimeType(active)).toBe('application/octet-stream')
    }
    expect(sanitizeMimeType('image/png')).toBe('image/png')
    expect(sanitizeMimeType('application/pdf')).toBe('application/pdf')
  })
})
