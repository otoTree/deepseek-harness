/** Explicit transfers between account-owned cloud archives and local Session persistence. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { SessionId, SessionLogOffset, Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { assertVersion, assertContiguous, validateStoredEvents, SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

const metadata = z.object({
  id: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u), header: z.record(z.string(), z.unknown()),
  inheritedEventCount: z.number().int().nonnegative(), nextSeq: z.number().int().nonnegative(),
}).strict()
const page = metadata.extend({ events: z.array(z.record(z.string(), z.unknown())).max(500) })

/** Import validated archives, retaining longer identical local histories and refusing conflicts.
 * @param persistence - Local account-scoped provider; cloud archives are never mutated.
 * @param request - Account-authenticated organization-relative JSON transport.
 * @param signal - Cancellation observed between downloaded pages and durable writes.
 * @returns Count of imported or already complete sessions after all handles close.
 */
export async function importCloudSessions(
  persistence: SessionPersistence,
  request: (path: string, signal: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
): Promise<{ imported: number }> {
  let after = ''
  let imported = 0
  while (true) {
    signal.throwIfAborted()
    const sessions = z.array(metadata).max(100).parse(await request('sessions' + (after ? '?after=' + encodeURIComponent(after) : ''), signal))
    for (const source of sessions) {
      if (source.id <= after) throw new Error('Cloud session list cursor did not advance')
      after = source.id
      const id = SessionId(source.id)
      // Network JSON is validated by the same released-format validators as local logs.
      const header = source.header as unknown as SessionHeader
      assertVersion(header)
      if (header.id !== id) throw new Error('Cloud session header identity mismatch')
      const events: SessionEvent[] = []
      do {
        const value = page.parse(await request(`sessions/${encodeURIComponent(id)}/events?offset=${events.length}`, signal))
        if (value.id !== id || value.nextSeq !== source.nextSeq
          || value.inheritedEventCount !== source.inheritedEventCount || !isDeepStrictEqual(value.header, source.header)) {
          throw new Error('Cloud session changed during import; retry the import')
        }
        const batch = value.events as unknown as SessionEvent[]
        assertContiguous(id, batch, events.length)
        if (events.length + batch.length > source.nextSeq || (batch.length === 0 && events.length < source.nextSeq)) {
          throw new Error('Cloud session page is incomplete')
        }
        events.push(...batch)
      } while (events.length < source.nextSeq)
      validateStoredEvents(header, events)
      Session.fromRestore(id, events, header, SessionLogOffset(source.inheritedEventCount))
      const existing = await persistence.stat(id, { signal })
      const matches = (localHeader: SessionHeader, inherited: number, local: readonly SessionEvent[]): void => {
        const overlap = Math.min(local.length, events.length)
        if (!isDeepStrictEqual({ delegationDepth: 0, ...localHeader }, { delegationDepth: 0, ...header })
          || inherited !== source.inheritedEventCount
          || !isDeepStrictEqual(local.slice(0, overlap), events.slice(0, overlap))) {
          throw new Error('SESSION_SYNC_CONFLICT')
        }
      }
      if (existing !== undefined) {
        const reader = await persistence.open(id, 'read', { signal })
        try {
          const local = await reader.read(0, undefined, { signal })
          matches(reader.header, reader.inheritedEventCount, local)
          if (local.length >= events.length) { imported += 1; continue }
        } finally { await reader.close() }
      }
      const handle = existing === undefined
        ? await persistence.create(header, { inheritedEventCount: SessionLogOffset(source.inheritedEventCount), signal })
        : await persistence.open(id, 'write', { signal }).catch((error: unknown) => {
          if (error instanceof SessionAlreadyOwnedError) throw new Error('SESSION_SYNC_BUSY')
          throw error
        })
      try {
        const local = await handle.read(0, undefined, { signal })
        matches(handle.header, handle.inheritedEventCount, local)
        for (let start = local.length; start < events.length; start += 500) {
          await handle.append(events.slice(start, start + 500), { signal })
        }
        await handle.flush({ signal })
        const saved = await handle.read(0, undefined, { signal })
        if (!isDeepStrictEqual(saved, local.length > events.length ? local : events)) throw new Error('Local session import verification failed')
      } finally { await handle.close() }
      imported += 1
    }
    if (sessions.length < 100) return { imported }
  }
}

/** Upload a durable snapshot of every local session without a persistent cloud writer.
 * @param persistence - Local account-scoped provider, flushed before taking snapshots.
 * @param request - Account-authenticated organization-relative JSON transport.
 * @param signal - Cancellation observed between snapshots and uploaded pages.
 * @returns Count of uploaded or already complete archives; earlier pages survive failures for retry.
 */
export async function uploadCloudSessions(
  persistence: SessionPersistence,
  request: (path: string, signal: AbortSignal, init: RequestInit) => Promise<unknown>,
  signal: AbortSignal,
): Promise<{ uploaded: number }> {
  signal.throwIfAborted()
  await persistence.flush()
  let uploaded = 0
  for (const source of await persistence.list({ signal })) {
    signal.throwIfAborted()
    const handle = await persistence.open(source.header.id, 'read', { signal })
    let events: SessionEvent[]
    try { events = [...await handle.read(0, undefined, { signal })] } finally { await handle.close() }
    validateStoredEvents(handle.header, events)
    Session.fromRestore(handle.header.id, events, handle.header, handle.inheritedEventCount)
    let offset = 0
    do {
      signal.throwIfAborted()
      const batch = events.slice(offset, offset + 500)
      const result = z.object({ nextSeq: z.number().int().nonnegative() }).strict().parse(await request(
        `sessions/${encodeURIComponent(handle.header.id)}/archive`, signal, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ header: handle.header, inheritedEventCount: handle.inheritedEventCount, offset, events: batch }),
        },
      ))
      if (result.nextSeq < offset + batch.length) throw new Error('Cloud session upload verification failed')
      offset += batch.length
    } while (offset < events.length)
    uploaded += 1
  }
  return { uploaded }
}
