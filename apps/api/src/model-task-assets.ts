/** Server-owned media downloads with public-DNS validation and bounded object storage writes. */
import { inspectFileMediaType } from '@deepseek-ai/dsh-attachment'
import { createHash } from 'node:crypto'
import { request } from 'node:https'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { createModelLookup } from './gateway.ts'

/**
 * Fetch media without provider credentials or redirects.
 * @param value Untrusted provider media URL.
 * @param limit Maximum response bytes.
 * @param signal Owned deadline and cancellation.
 * @returns Verified bytes and MIME type.
 */
export async function downloadTaskAsset(value: string, limit: number,
  signal: AbortSignal): Promise<{ bytes: Uint8Array; mimeType: string; checksum: string }> {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Provider media address is not permitted')
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const req = request(url, { method: 'GET', signal, lookup: createModelLookup() }, resolve)
    req.once('error', reject)
    req.end()
  })
  try {
    if (response.statusCode !== 200) throw new HTTPException(502, { message: 'Provider media download failed' })
    const mimeType = z.string().regex(/^(?:image|video|audio)\/[a-z0-9.+-]+$/u).parse((response.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase())
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of response as AsyncIterable<unknown>) {
      if (!(chunk instanceof Uint8Array)) throw new Error('Invalid provider media bytes')
      const bytes = Buffer.from(chunk)
      size += bytes.byteLength
      if (size > limit) throw new Error('Provider media exceeds the configured asset limit')
      chunks.push(bytes)
    }
    if (!size) throw new Error('Provider media is empty')
    const bytes = Buffer.concat(chunks)
    if (inspectFileMediaType(bytes, mimeType, 'provider-output') !== mimeType) throw new Error('Provider media type cannot be verified')
    return { bytes, mimeType, checksum: createHash('sha256').update(bytes).digest('hex') }
  } finally { response.destroy() }
}
