/** Cancellable, bounded HTTPS reads and streamed full-installer verification. */
import { createHash } from 'node:crypto'
import { open, rm } from 'node:fs/promises'
import { updateUrl, type DesktopRelease } from './update-manifest.ts'

/** Fetch adapter kept instance-local for deterministic cancellation tests. */
export type UpdateFetch = (url: string, init?: RequestInit) => Promise<Response>

function responseBodyFor(
  url: string, signal: AbortSignal, request: UpdateFetch, allowEmpty: true,
): Promise<ReadableStream<Uint8Array> | undefined>
function responseBodyFor(
  url: string, signal: AbortSignal, request: UpdateFetch, allowEmpty?: false,
): Promise<ReadableStream<Uint8Array>>
async function responseBodyFor(
  url: string, signal: AbortSignal, request: UpdateFetch, allowEmpty = false,
): Promise<ReadableStream<Uint8Array> | undefined> {
  let location = updateUrl(url)
  for (let redirects = 0; redirects <= 5; redirects++) {
    signal.throwIfAborted()
    const response = await request(location, { signal, redirect: 'manual', credentials: 'omit', cache: 'no-store' })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const next = response.headers.get('location')
      if (!next) throw new Error('Desktop update redirect has no location')
      location = updateUrl(new URL(next, location).href)
      continue
    }
    if (allowEmpty && response.status === 204) return undefined
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw new Error('Desktop update request failed')
    }
    return response.body
  }
  throw new Error('Desktop update has too many redirects')
}

/** Read the release envelope without buffering an unbounded response.
 * @param url - Configured feed URL.
 * @param signal - Cancellation, including the caller's deadline.
 * @param request - HTTP transport.
 * @returns Envelope bytes, at most 256 KiB, or undefined when the feed returns 204.
 */
export async function fetchReleaseEnvelope(url: string, signal: AbortSignal, request: UpdateFetch = fetch): Promise<Buffer | undefined> {
  const body = await responseBodyFor(url, signal, request, true)
  if (!body) return undefined
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 256 * 1024) throw new Error('Desktop release manifest exceeds 256 KiB')
      chunks.push(next.value)
    }
    signal.throwIfAborted()
    return Buffer.concat(chunks)
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}

/** Stream an authenticated release to a new owner-only file; delete failures.
 * @param release - Verified signed installer metadata.
 * @param destination - Unused file inside a private operation directory.
 * @param signal - Cancellation, including the caller's deadline.
 * @param request - HTTP transport.
 */
export async function downloadDesktopRelease(
  release: DesktopRelease, destination: string, signal: AbortSignal, request: UpdateFetch = fetch,
): Promise<void> {
  const file = await open(destination, 'wx', 0o600)
  let verified = false
  try {
    const body = await responseBodyFor(release.url, signal, request)
    const reader = body.getReader()
    const hash = createHash('sha256')
    let size = 0
    try {
      for (;;) {
        signal.throwIfAborted()
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > release.size) throw new Error('Desktop installer exceeds its signed size')
        hash.update(next.value)
        await file.writeFile(next.value)
      }
      signal.throwIfAborted()
      if (size !== release.size || hash.digest('hex') !== release.sha256) {
        throw new Error('Desktop installer size or SHA-256 does not match its signed release')
      }
      await file.sync()
      verified = true
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
  } finally {
    await file.close()
    if (!verified) await rm(destination, { force: true })
  }
}
