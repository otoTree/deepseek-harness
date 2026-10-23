/** Signed desktop release protocol shared by the API, native updater and offline signer. */
import { createPublicKey, verify } from 'node:crypto'
import semver from 'semver'
import { z } from 'zod'

/** Signed installer fields; one feed serves one operating system and architecture. */
export const desktopReleaseSchema = z.object({
  format: z.literal(1),
  identifier: z.literal('ai.deepseek.harness.enterprise'),
  version: z.string().refine(value => semver.valid(value) === value, 'Expected a canonical semantic version'),
  target: z.enum(['darwin-arm64', 'win32-x64']),
  url: z.string().transform(value => updateUrl(value)),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  notes: z.string().min(1).max(16000),
}).strict()

/** Parsed release fields authenticated by the pinned Ed25519 key. */
export type DesktopRelease = z.infer<typeof desktopReleaseSchema>

/** Validate the canonical Ed25519 SPKI key supplied by deployment or installer configuration.
 * @param value - Base64-encoded SPKI DER public key.
 * @returns Parsed public key; malformed or non-Ed25519 keys throw.
 */
export function desktopReleaseKey(value: string): ReturnType<typeof createPublicKey> {
  const key = createPublicKey({ key: decodeBase64(value), format: 'der', type: 'spki' })
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Desktop update key must be Ed25519')
  return key
}

/** Require HTTPS URLs without credentials or fragments.
 * @param value - Feed or installer URL.
 * @returns Canonical absolute HTTPS URL.
 */
export function updateUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Desktop updates require HTTPS URLs without credentials or fragments')
  }
  return url.href
}

/** Authenticate exact payload bytes before accepting any installer fields.
 * @param bytes - JSON envelope, bounded to 256 KiB.
 * @param publicKey - Pinned base64 SPKI DER Ed25519 key.
 * @returns Authenticated release metadata; malformed or unsigned input throws.
 */
export function parseSignedDesktopRelease(bytes: Uint8Array, publicKey: string): DesktopRelease {
  if (bytes.byteLength > 256 * 1024) throw new Error('Desktop release manifest exceeds 256 KiB')
  const envelope = z.object({ payload: z.string(), signature: z.string() }).strict()
    .parse(JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown)
  const payload = decodeBase64(envelope.payload)
  if (!verify(null, payload, desktopReleaseKey(publicKey), decodeBase64(envelope.signature))) {
    throw new Error('Desktop release signature is invalid')
  }
  return desktopReleaseSchema.parse(JSON.parse(payload.toString('utf8')) as unknown)
}

function decodeBase64(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (!value || decoded.toString('base64') !== value) throw new Error('Expected canonical base64')
  return decoded
}
