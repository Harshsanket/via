/**
 * End-to-end checks that don't trust the signaling server.
 *
 * The sender puts a random key in the receive link's fragment
 * (`/receive/<id>#k=<key>`). Browsers never send the fragment to a server, so
 * only the two people holding the link know it. With it:
 *
 * - each peer proves it holds the key *and* sees the same DTLS connection
 *   (HMAC over both certificate fingerprints). A relay that substitutes its
 *   own SDP to sit in the middle changes the fingerprints and fails this;
 * - the file name and type sent through the server are encrypted, so the
 *   server stores only ciphertext;
 * - both screens can show the same short code for a human cross-check.
 *
 * All of it uses Web Crypto, which needs a secure context (HTTPS or
 * localhost).
 */

export type PeerRole = 'sender' | 'receiver'

export interface FingerprintView {
  /** This side's own DTLS fingerprint (from its local description). */
  local: string
  /** The fingerprint this side sees for the other peer. */
  remote: string
}

export interface PlainMetadata {
  fileName: string
  mimeType: string
}

const KEY_BYTES = 16
const KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/
const ENCRYPTED_PREFIX = 'enc.v1.'
const AUTH_CONTEXT = 'via-auth-v1'
const CODE_CONTEXT = 'via-code-v1'
const META_CONTEXT = 'via-meta-v1'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** A fresh 128-bit link key, base64url without padding (22 characters). */
export function generateLinkKey(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(KEY_BYTES)))
}

/** Reads `k` from a URL fragment such as `#k=…`; null when absent or invalid. */
export function parseLinkKey(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const key = params.get('k')
  return key && KEY_PATTERN.test(key) ? key : null
}

/** The first `a=fingerprint:` line of an SDP, as "algo HEX:HEX…". */
export function extractFingerprint(sdp: string | undefined | null): string | null {
  if (!sdp) return null
  const match = sdp.match(/^a=fingerprint:(\S+)\s+([0-9A-Fa-f:]+)\s*$/m)
  if (!match) return null
  return `${match[1].toLowerCase()} ${match[2].toUpperCase()}`
}

const keyMaterial = async (linkKey: string): Promise<CryptoKey> => {
  const raw = fromBase64Url(linkKey)
  if (!raw || raw.length !== KEY_BYTES) throw new Error('Invalid link key')
  return crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey'])
}

const hkdf = (context: string): HkdfParams => ({
  name: 'HKDF',
  hash: 'SHA-256',
  salt: new Uint8Array(0),
  info: encoder.encode(context),
})

/** Separate keys per purpose, so a tag can never double as ciphertext. */
const macKey = async (linkKey: string): Promise<CryptoKey> =>
  crypto.subtle.deriveKey(
    hkdf(AUTH_CONTEXT),
    await keyMaterial(linkKey),
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  )

const encryptionKey = async (linkKey: string): Promise<CryptoKey> =>
  crypto.subtle.deriveKey(
    hkdf(META_CONTEXT),
    await keyMaterial(linkKey),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )

const authMessage = (role: PeerRole, own: string, peer: string): Uint8Array<ArrayBuffer> =>
  encoder.encode(`${AUTH_CONTEXT}|${role}|${own}|${peer}`)

/** This side's proof: HMAC over (role, own fingerprint, peer's fingerprint). */
export async function computeAuthTag(
  linkKey: string,
  role: PeerRole,
  ownFingerprint: string,
  peerFingerprint: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await macKey(linkKey),
    authMessage(role, ownFingerprint, peerFingerprint),
  )
  return toBase64Url(new Uint8Array(signature))
}

/**
 * Checks the other peer's tag against what this side sees: the peer's own
 * fingerprint must be our remote one, and the fingerprint it saw for us must
 * be our local one. Constant-time via `subtle.verify`.
 */
export async function verifyAuthTag(
  linkKey: string,
  peerRole: PeerRole,
  tag: string,
  view: FingerprintView,
): Promise<boolean> {
  const signature = fromBase64Url(tag)
  if (!signature) return false
  try {
    return await crypto.subtle.verify(
      'HMAC',
      await macKey(linkKey),
      signature,
      authMessage(peerRole, view.remote, view.local),
    )
  } catch {
    return false
  }
}

/** Six digits ("123 456") both peers derive from the key and the connection. */
export async function computeVerificationCode(
  linkKey: string,
  fingerprintA: string,
  fingerprintB: string,
): Promise<string> {
  const ordered = [fingerprintA, fingerprintB].sort().join('|')
  const digest = await crypto.subtle.sign(
    'HMAC',
    await macKey(linkKey),
    encoder.encode(`${CODE_CONTEXT}|${ordered}`),
  )
  const value = new DataView(digest).getUint32(0) % 1_000_000
  const digits = value.toString().padStart(6, '0')
  return `${digits.slice(0, 3)} ${digits.slice(3)}`
}

export function isEncryptedMetadata(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX)
}

/** AES-GCM over {name, type}; "enc.v1." + base64url(iv ‖ ciphertext). */
export async function encryptMetadata(
  linkKey: string,
  metadata: PlainMetadata,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(
    JSON.stringify({ n: metadata.fileName, t: metadata.mimeType }),
  )
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await encryptionKey(linkKey),
      plaintext,
    ),
  )

  const sealed = new Uint8Array(iv.length + ciphertext.length)
  sealed.set(iv)
  sealed.set(ciphertext, iv.length)
  return ENCRYPTED_PREFIX + toBase64Url(sealed)
}

/** The plaintext, or null for a wrong key, tampering or malformed input. */
export async function decryptMetadata(
  linkKey: string,
  sealed: string,
): Promise<PlainMetadata | null> {
  if (!isEncryptedMetadata(sealed)) return null
  const bytes = fromBase64Url(sealed.slice(ENCRYPTED_PREFIX.length))
  if (!bytes || bytes.length < 12 + 16) return null

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      await encryptionKey(linkKey),
      bytes.slice(12),
    )
    const parsed = JSON.parse(decoder.decode(plaintext)) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { n?: unknown }).n === 'string' &&
      typeof (parsed as { t?: unknown }).t === 'string'
    ) {
      return {
        fileName: (parsed as { n: string }).n,
        mimeType: (parsed as { t: string }).t,
      }
    }
    return null
  } catch {
    return null
  }
}
