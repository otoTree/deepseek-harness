/** DSH remote persistence with durable PostgreSQL acknowledgement and permanently fenced failed writers. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import {
  SessionPersistence, SessionPersistenceRevision, SessionAlreadyExistsError, SessionAlreadyOwnedError,
  SessionPersistenceNotFoundError, SessionHandleClosedError, SessionReadOnlyError, SessionOwnershipLostError,
  assertVersion, assertContiguous, materializeCreateHeader, materializeAppendBatch, validateStoredEvents,
} from '@deepseek-ai/dsh-session-persistence'
import type { SessionAccess, SessionHandle, SessionPersistenceCreateOptions, SessionPersistenceOpenOptions, SessionHandleReadOptions } from '@deepseek-ai/dsh-session-persistence'
import { sessionId, sessionCreate, sessionMetadata, sessionPage, sessionLease, sessionAppend } from '@deepseek-ai/dsh-enterprise-api/contracts'
import { z } from 'zod'
import { DesktopKeychain } from './keychain.ts'
import { SessionTransport, SessionTransportConfig, SessionTransportError } from './session-transport.ts'
import type { SessionTransportSettings, SessionTransportIO } from './session-transport.ts'

export const name = 'enterprise-session-persistence'
export const Config = SessionTransportConfig
type Metadata = z.infer<typeof sessionMetadata>

function headerOf(value: Metadata): SessionHeader {
  // Zod checks the wire fields; DSH owns the released logical header and body validation.
  const header = value.header as unknown as SessionHeader
  assertVersion(header)
  if (SessionId(value.id) !== header.id) throw new Error('Enterprise session identity mismatch')
  return header
}

/** Native persistence service; creates are immediately durable, including empty sessions. */
export class EnterpriseSessionPersistence extends SessionPersistence {
  private readonly transport: SessionTransport
  private readonly handles = new Set<RemoteHandle>()
  private readonly writers = new Map<SessionId, RemoteHandle>()
  private readonly opening = new Set<Promise<SessionHandle>>()
  private disposing = false

  constructor(ctx: Context, settings: SessionTransportSettings, io?: SessionTransportIO) {
    super(ctx)
    const keychain = new DesktopKeychain(settings.keychainHelper)
    this.transport = new SessionTransport(settings, io ?? { readCredential: () => keychain.get(settings.keychainAccount), request: fetch })
    ctx.on('session/event', (session, event) => {
      this.writers.get(session.id)?.route(event).catch(() => { ctx.logger.warn('Enterprise session background write failed; writer is fenced') })
    })
    ctx.on('session/flush', session => this.writers.get(session.id)?.flush())
    ctx.on('session/disposed', (session) => {
      this.writers.get(session.id)?.close().catch(() => { ctx.logger.warn('Enterprise session close failed; write ownership must be reacquired') })
    })
    ctx.effect(() => async () => {
      this.disposing = true
      await Promise.allSettled([...this.opening])
      const settled = await Promise.allSettled([...this.handles].map(handle => handle.close()))
      const failures = settled.filter(item => item.status === 'rejected')
      if (failures.length) throw new AggregateError(failures.map((item): unknown => item.reason), 'Enterprise session teardown failed')
    })
  }

  create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    return this.track(() => this.createHandle(header, options))
  }

  open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    return this.track(() => this.openHandle(id, access, options))
  }

  private track(run: () => Promise<SessionHandle>): Promise<SessionHandle> {
    if (this.disposing) return Promise.reject(new Error('Enterprise session provider is disposed'))
    const task = run()
    this.opening.add(task)
    void task.then(() => this.opening.delete(task), () => this.opening.delete(task))
    return task
  }

  private async createHandle(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const snapshot = materializeCreateHeader(header)
    assertVersion(snapshot)
    if (snapshot.isSeeded && options?.inheritedEventCount === undefined) throw new Error('Seeded session requires inheritedEventCount')
    const writer = randomUUID()
    const input = sessionCreate.parse({ id: snapshot.id, header: snapshot, inheritedEventCount: options?.inheritedEventCount ?? 0, writer })
    try { await this.transport.request('', 'POST', input, options?.signal) } catch (error) {
      if (error instanceof SessionTransportError && error.status === 409) throw new SessionAlreadyExistsError(header.id)
      throw error
    }
    return this.adopt({ id: input.id, header: input.header, inheritedEventCount: input.inheritedEventCount, nextSeq: 0 }, 'write', writer)
  }

  private async openHandle(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    const value = await this.metadata(id, options?.signal)
    if (!value) throw new SessionPersistenceNotFoundError(id)
    if (headerOf(value).id !== id) throw new Error('Enterprise session identity mismatch')
    let writer: string | undefined
    let leaseUntil: string | undefined
    if (access === 'write') {
      try {
        const lease = sessionLease.parse(await this.transport.request('/' + id + '/lease', 'POST', {}, options?.signal))
        writer = lease.writer
        leaseUntil = lease.leaseUntil
        value.nextSeq = lease.nextSeq
      } catch (error) {
        if (error instanceof SessionTransportError && error.status === 409) throw new SessionAlreadyOwnedError(id)
        throw error
      }
    }
    const handle = this.adopt(value, access, writer, leaseUntil)
    try { await handle.read(0, undefined, options); return handle } catch (error) {
      await handle.close()
      throw error
    }
  }

  async flush(): Promise<void> {
    const results = await Promise.allSettled([...this.writers.values()].map(handle => handle.flush()))
    const failures = results.filter(item => item.status === 'rejected' && !(item.reason instanceof SessionHandleClosedError))
    if (failures.length) throw new AggregateError(failures.map((item): unknown => (item as PromiseRejectedResult).reason), 'Enterprise session flush failed')
  }

  async stat(id: SessionId, options?: SessionPersistenceOpenOptions) {
    const value = await this.metadata(id, options?.signal)
    return value ? this.snapshot(value) : undefined
  }

  async list(options?: SessionPersistenceOpenOptions) {
    const result = []
    let after = ''
    while (true) {
      const page = z.array(sessionMetadata).max(100).parse(await this.transport.request(after ? '?after=' + after : '', 'GET', undefined, options?.signal))
      for (const value of page) {
        if (value.id <= after) throw new Error('Enterprise session list cursor did not advance')
        after = value.id
        result.push(this.snapshot(value))
      }
      if (page.length < 100) return result
    }
  }

  private snapshot(value: Metadata) {
    return { header: headerOf(value), revision: SessionPersistenceRevision(String(value.nextSeq)), eventCount: value.nextSeq }
  }

  private async metadata(id: SessionId, signal?: AbortSignal) {
    sessionId.parse(id)
    try { return sessionMetadata.parse(await this.transport.request('/' + id, 'GET', undefined, signal)) } catch (error) {
      if (error instanceof SessionTransportError && error.status === 404) return undefined
      throw error
    }
  }

  private adopt(value: Metadata, access: SessionAccess, writer?: string, leaseUntil?: string) {
    const handle = new RemoteHandle(value, access, writer, leaseUntil, this.transport, () => {
      this.handles.delete(handle)
      if (this.writers.get(handle.id) === handle) this.writers.delete(handle.id)
    })
    this.handles.add(handle)
    if (access === 'write') this.writers.set(handle.id, handle)
    return handle
  }
}

class RemoteHandle implements SessionHandle {
  readonly id: SessionId
  readonly header: SessionHeader
  readonly inheritedEventCount: SessionLogOffset
  private cursor: number
  private observed = 0
  private queue = Promise.resolve()
  private closing?: Promise<void>
  private failed = false
  private pending: SessionEvent[] = []
  private renewalTimer?: ReturnType<typeof setTimeout>

  constructor(value: Metadata, readonly access: SessionAccess, private readonly writer: string | undefined,
    leaseUntil: string | undefined, private readonly transport: SessionTransport, private readonly release: () => void) {
    this.id = SessionId(value.id)
    this.header = headerOf(value)
    this.inheritedEventCount = SessionLogOffset(value.inheritedEventCount)
    this.cursor = value.nextSeq
    if (access === 'write' && leaseUntil !== undefined) this.scheduleRenewal(leaseUntil)
  }

  private check(operation: string, write = false) {
    if (this.closing) throw new SessionHandleClosedError(this.id, operation)
    if (write && this.access !== 'write') throw new SessionReadOnlyError(this.id, operation)
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  async read(offset = 0, length = Number.MAX_SAFE_INTEGER, options?: SessionHandleReadOptions): Promise<readonly SessionEvent[]> {
    this.check('read')
    if (![offset, length].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Session read offset and length must be a non-negative safe integer')
    return this.serialize(async () => {
      const all: SessionEvent[] = []
      let count: number | undefined
      do {
        const page = sessionPage.parse(await this.transport.request('/' + this.id + '/events?offset=' + String(all.length), 'GET', undefined, options?.signal))
        if (SessionId(page.id) !== this.id || page.inheritedEventCount !== this.inheritedEventCount || JSON.stringify(Object.entries(page.header).sort()) !== JSON.stringify(Object.entries(this.header).sort())) throw new Error('Enterprise session metadata changed')
        count ??= page.nextSeq
        if (page.nextSeq < count || page.nextSeq < this.observed) throw new Error('Enterprise session log regressed')
        const batch = page.events.slice(0, count - all.length) as unknown as SessionEvent[]
        assertContiguous(this.id, batch, all.length)
        if (batch.length === 0 && all.length < count) throw new Error('Enterprise session page is incomplete')
        all.push(...batch)
      } while (all.length < count)
      validateStoredEvents(this.header, all)
      Session.fromRestore(this.id, all, this.header, this.inheritedEventCount)
      this.observed = all.length
      return all.slice(offset, offset + length)
    })
  }

  async append(events: readonly SessionEvent[], options?: SessionPersistenceOpenOptions): Promise<void> {
    this.check('append', true)
    options?.signal?.throwIfAborted()
    const batch = materializeAppendBatch(events)
    return this.serialize(async () => { await this.drain(); await this.persist(batch, options?.signal) })
  }

  async flush(options?: SessionPersistenceOpenOptions): Promise<void> {
    this.check('flush', true)
    options?.signal?.throwIfAborted()
    return this.serialize(async () => { await this.drain(); await this.renew(options?.signal) })
  }

  route(event: SessionEvent): Promise<void> {
    if (!this.closing) this.pending.push(event)
    return this.serialize(() => this.drain())
  }

  private async renew(signal?: AbortSignal) {
    if (this.failed) throw new SessionOwnershipLostError(this.id)
    try {
      const lease = sessionLease.parse(await this.transport.request('/' + this.id + '/lease', 'POST', { writer: this.writer }, signal))
      if (lease.writer !== this.writer || lease.nextSeq !== this.cursor || Date.parse(lease.leaseUntil) <= Date.now()) throw new Error('Lease mismatch')
      this.scheduleRenewal(lease.leaseUntil)
    } catch { this.failed = true; throw new SessionOwnershipLostError(this.id) }
  }

  private async persist(batch: readonly SessionEvent[], signal?: AbortSignal) {
    assertContiguous(this.id, batch, this.cursor)
    await this.renew(signal)
    for (let start = 0; start < batch.length; start += 500) {
      const slice = batch.slice(start, start + 500)
      const input = sessionAppend.parse({ writer: this.writer, events: slice })
      try {
        const result = z.object({ nextSeq: z.number().int().nonnegative() }).strict().parse(await this.transport.request('/' + this.id + '/events', 'POST', input, signal))
        if (result.nextSeq !== this.cursor + slice.length) throw new Error('Append sequence mismatch')
        this.cursor = result.nextSeq
      } catch { this.failed = true; throw new SessionOwnershipLostError(this.id) }
    }
  }

  private async drain() {
    if (!this.pending.length) return
    const batch = materializeAppendBatch(this.pending)
    await this.persist(batch)
    this.pending.splice(0, batch.length)
  }

  close(): Promise<void> {
    return this.closing ??= this.serialize(async () => {
      if (this.renewalTimer !== undefined) clearTimeout(this.renewalTimer)
      this.renewalTimer = undefined
      try {
        if (this.access === 'write') {
          try { if (!this.failed) await this.drain() } finally {
            await this.transport.request('/' + this.id + '/lease', 'DELETE', { writer: this.writer })
          }
          if (this.failed) throw new SessionOwnershipLostError(this.id)
        }
      } finally { this.release() }
    })
  }

  private scheduleRenewal(leaseUntil: string): void {
    if (this.access !== 'write' || this.closing || this.failed) return
    if (this.renewalTimer !== undefined) clearTimeout(this.renewalTimer)
    const remaining = Math.max(1000, Date.parse(leaseUntil) - Date.now())
    this.renewalTimer = setTimeout(() => {
      this.renewalTimer = undefined
      void this.serialize(() => this.renew()).catch(() => { /* the next write reports ownership loss */ })
    }, Math.floor(remaining / 2))
    this.renewalTimer.unref()
  }

  [Symbol.asyncDispose](): Promise<void> { return this.close() }
}

/** Mount remote persistence in a native enterprise profile.
 * @param ctx - DSH context; the provider owns its event registrations and handles.
 * @param config - Non-secret deployment and Keychain locator plus transport limits.
 */
export function apply(ctx: Context, config: SessionTransportSettings): void {
  const settings = Config.parse(config)
  ctx.plugin(EnterpriseSessionPersistence, settings)
}
