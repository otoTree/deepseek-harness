/** Cloud imports exercise real local durability, prefix recovery and conflict refusal. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionSeq, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { importCloudSessions, uploadCloudSessions } from '../src/session-import.ts'

async function fixture(t: TestContext, count = 2) {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-session-import-'))
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlPersistence, { root, compression: 'none' })
  const id = SessionId(randomUUID())
  const header: SessionHeader = { id, version: SESSION_FORMAT_VERSION, createdAt: 1000, isSeeded: false }
  const events: SessionEvent[] = Array.from({ length: count }, (_, index) => ({
    type: 'turn/start', seq: SessionSeq(index), time: index, data: { turn: index + 1 },
  }))
  const source = { id, header, inheritedEventCount: 0, nextSeq: events.length }
  const calls: string[] = []
  const request = async (path: string): Promise<unknown> => {
    calls.push(path)
    if (path === 'sessions') return [source]
    const url = new URL(path, 'https://fixture.example/')
    assert.equal(url.pathname, `/sessions/${id}/events`)
    const offset = Number(url.searchParams.get('offset'))
    return { ...source, events: events.slice(offset, offset + 500) }
  }
  const run = (transport = request, signal = new AbortController().signal) => importCloudSessions(ctx.sessionPersistence, transport, signal)
  return { ctx, id, header, events, source, request, calls, run }
}

void test('paged cloud archives become durable local sessions and repeated imports retain their content', async (t) => {
  const f = await fixture(t, 502)
  assert.deepEqual(await f.run(), { imported: 1 })
  assert.equal(f.calls.some(path => path.endsWith('offset=500')), true)
  assert.equal(f.calls.some(path => /lease|export/u.test(path)), false)
  const handle = await f.ctx.sessionPersistence.open(f.id, 'read')
  try { assert.deepEqual(await handle.read(), f.events) } finally { await handle.close() }
  assert.deepEqual(await f.run(), { imported: 1 })
})

void test('an identical partial local import resumes from its durable prefix', async (t) => {
  const f = await fixture(t)
  const handle = await f.ctx.sessionPersistence.create(f.header)
  await handle.append(f.events.slice(0, 1))
  await handle.close()
  assert.deepEqual(await f.run(), { imported: 1 })
  const reader = await f.ctx.sessionPersistence.open(f.id, 'read')
  try { assert.deepEqual(await reader.read(), f.events) } finally { await reader.close() }
})

void test('a conflicting local session remains unchanged and releases its writer after refusal', async (t) => {
  const f = await fixture(t)
  const local = { ...f.events[0]!, time: 999 }
  const handle = await f.ctx.sessionPersistence.create(f.header)
  await handle.append([local])
  await handle.close()
  await assert.rejects(f.run(), /SESSION_SYNC_CONFLICT/)
  const reader = await f.ctx.sessionPersistence.open(f.id, 'write')
  try { assert.deepEqual(await reader.read(), [local]) } finally { await reader.close() }
})

void test('a longer local history remains readable and unchanged while its writer is active', async (t) => {
  const f = await fixture(t)
  const writer = await f.ctx.sessionPersistence.create(f.header)
  try {
    await writer.append(f.events)
    f.source.nextSeq = 1
    assert.deepEqual(await f.run(async path => path === 'sessions' ? [f.source] : { ...f.source, events: f.events.slice(0, 1) }), { imported: 1 })
    assert.deepEqual(await writer.read(), f.events)
  } finally { await writer.close() }
})

void test('downloads refuse to extend an active local writer and succeed after it closes', async (t) => {
  const f = await fixture(t)
  const writer = await f.ctx.sessionPersistence.create(f.header)
  try {
    await writer.append(f.events.slice(0, 1))
    await assert.rejects(f.run(), /SESSION_SYNC_BUSY/)
    assert.deepEqual(await writer.read(), f.events.slice(0, 1))
  } finally { await writer.close() }
  assert.deepEqual(await f.run(), { imported: 1 })
})

void test('uploads page durable local history, resume after failure and download on a second device', async (t) => {
  const first = await fixture(t, 502)
  await first.run()
  const cloud: SessionEvent[] = []
  const offsets: number[] = []
  let unavailable = true
  const upload = async (path: string, _signal: AbortSignal, init: RequestInit): Promise<unknown> => {
    assert.equal(path, `sessions/${first.id}/archive`)
    assert.equal(init.method, 'POST')
    assert.ok(typeof init.body === 'string')
    const input = JSON.parse(init.body) as {
      header: SessionHeader
      inheritedEventCount: number
      offset: number
      events: SessionEvent[]
    }
    assert.deepEqual(input.header, { delegationDepth: 0, ...first.header })
    assert.equal(input.inheritedEventCount, 0)
    offsets.push(input.offset)
    if (input.offset === 500 && unavailable) throw new Error('offline')
    const overlap = Math.min(input.events.length, cloud.length - input.offset)
    assert.deepEqual(cloud.slice(input.offset, input.offset + overlap), input.events.slice(0, overlap))
    cloud.push(...input.events.slice(overlap))
    return { nextSeq: cloud.length }
  }
  const signal = new AbortController().signal
  await assert.rejects(uploadCloudSessions(first.ctx.sessionPersistence, upload, signal), /offline/)
  assert.equal(cloud.length, 500)
  unavailable = false
  assert.deepEqual(await uploadCloudSessions(first.ctx.sessionPersistence, upload, signal), { uploaded: 1 })
  assert.deepEqual(await uploadCloudSessions(first.ctx.sessionPersistence, upload, signal), { uploaded: 1 })
  assert.deepEqual(cloud, first.events)
  assert.deepEqual(offsets, [0, 500, 0, 500, 0, 500])
  const second = await fixture(t, 0)
  await importCloudSessions(second.ctx.sessionPersistence, async (path) => {
    const metadata = { ...first.source, header: { delegationDepth: 0, ...first.header } }
    if (path === 'sessions') return [metadata]
    const offset = Number(new URL(path, 'https://fixture.example').searchParams.get('offset'))
    return { ...metadata, events: cloud.slice(offset, offset + 500) }
  }, signal)
  const reader = await second.ctx.sessionPersistence.open(first.id, 'read')
  try { assert.deepEqual(await reader.read(), first.events) } finally { await reader.close() }
})

void test('fork uploads retain the exact inherited event count', async (t) => {
  const f = await fixture(t)
  const header = { ...f.header, isSeeded: true, parentSession: SessionId('parent-session') }
  const events: SessionEvent[] = [
    ...f.events.slice(0, 1), { type: 'session/end-seed', seq: SessionSeq(1), time: 1, data: { inherited: true } },
  ]
  const writer = await f.ctx.sessionPersistence.create(header, { inheritedEventCount: SessionLogOffset(1) })
  await writer.append(events)
  await writer.close()
  let uploaded: unknown
  await uploadCloudSessions(f.ctx.sessionPersistence, async (_path, _signal, init) => {
    assert.ok(typeof init.body === 'string')
    uploaded = JSON.parse(init.body) as unknown
    return { nextSeq: 2 }
  }, new AbortController().signal)
  assert.deepEqual(uploaded, {
    header: { delegationDepth: 0, ...header }, inheritedEventCount: 1, offset: 0, events,
  })
})

void test('empty uploads materialize an archive, observe cancellation and propagate conflict refusal', async (t) => {
  const f = await fixture(t, 0)
  await f.run()
  let calls = 0
  const request = async (_path: string, _signal: AbortSignal, init: RequestInit) => {
    calls += 1
    assert.ok(typeof init.body === 'string')
    assert.deepEqual((JSON.parse(init.body) as { events: unknown[] }).events, [])
    return { nextSeq: 0 }
  }
  await assert.rejects(uploadCloudSessions(f.ctx.sessionPersistence, request, AbortSignal.abort(new Error('cancelled'))), /cancelled/)
  assert.equal(calls, 0)
  assert.deepEqual(await uploadCloudSessions(f.ctx.sessionPersistence, request, new AbortController().signal), { uploaded: 1 })
  assert.equal(calls, 1)
  await assert.rejects(uploadCloudSessions(f.ctx.sessionPersistence, async () => { throw new Error('SESSION_SYNC_CONFLICT') }, new AbortController().signal), /SESSION_SYNC_CONFLICT/)
  const writer = await f.ctx.sessionPersistence.open(f.id, 'write')
  await writer.close()
})

void test('changing archives and unknown required events refuse before creating local files', async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.run(async path => path === 'sessions' ? [f.source] : { ...f.source, nextSeq: 3, events: f.events }), /changed/)
  assert.equal(await f.ctx.sessionPersistence.stat(f.id), undefined)
  await assert.rejects(f.run(async path => path === 'sessions' ? [f.source] : { ...f.source, events: [
    { type: 'future/required', seq: 0, time: 0, data: {} }, f.events[1],
  ] }), /unknown|unsupported/u)
  assert.equal(await f.ctx.sessionPersistence.stat(f.id), undefined)
})

void test('empty sessions materialize locally and cancelled imports leave no records', async (t) => {
  const f = await fixture(t, 0)
  await assert.rejects(f.run(f.request, AbortSignal.abort(new Error('cancelled'))), /cancelled/)
  assert.equal(await f.ctx.sessionPersistence.stat(f.id), undefined)
  assert.deepEqual(await f.run(), { imported: 1 })
  assert.ok(await f.ctx.sessionPersistence.stat(f.id))
  const handle = await f.ctx.sessionPersistence.open(f.id, 'read')
  try { assert.deepEqual(await handle.read(), []) } finally { await handle.close() }
})
