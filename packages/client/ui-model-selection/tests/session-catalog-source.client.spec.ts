/** Optional scoped catalogs retain the original selector and durable Session projection. */
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ModelCatalog, ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { ModelDirectoryResolver } from '../src/client/service.ts'

const sid = (id: string) => id as SessionId
const catalog = (name: string): ModelCatalog => ({ default: { provider: 'fixture', model: name },
  routableProviders: ['fixture'], groups: [{ id: 'fixture', name: 'Fixture', models: [{ id: name, name }] }], failures: [] })
async function bench() {
  const ctx = new Context()
  const shared = vi.fn(async () => ({ ok: true as const, value: catalog('deployment-default') }))
  const selectModel = vi.fn(async () => { throw new Error('discovery must never change selection') })
  const session = { modelCatalog: shared, selectModel }
  const remote = Object.assign(new TestRemote(ctx), { session })
  ctx.reflect.provide('remote.session', session)
  const projections = new Map<SessionId, ReturnType<typeof createSnapshotStore<ModelSelectionProjection>>>()
  const scopes = new Map<SessionId, Context>()
  const addressed = new Set<SessionId>()
  ctx.provide('sessions', {
    scope: (id: SessionId) => scopes.get(id),
    binding: (id: SessionId) => scopes.has(id) ? { session: { projections: { faceOf: () => projections.get(id) } } } : undefined,
    subagentAddress: (id: SessionId) => addressed.has(id) ? { childSessionId: id } : undefined,
  })
  const fiber = ctx.plugin(ModelDirectoryResolver, { blockReason: () => 'unavailable' })
  await fiber.await()
  await ctx.plugin(function settled() {}).await()
  const mint = (id: string) => {
    const key = sid(id), handle = createScope(ctx, key)
    scopes.set(key, handle.ctx)
    projections.set(key, createSnapshotStore<ModelSelectionProjection>({ lastUsed: null, next: { provider: 'fixture', model: id } }))
    return { key, handle, directory: () => ctx.modelDirectories.directoryFor(key) }
  }
  return { ctx, remote, shared, selectModel, mint, addressed,
    setProjected: (id: SessionId, value: ModelSelectionProjection) => { projections.get(id)!.set(value) } }
}

describe('Session catalog source', () => {
  it('recovers a failed project read, isolates two projects and leaves the deployment default and selection intact', async () => {
    const b = await bench()
    try {
      let online = false
      const source = vi.fn(async (id: SessionId) => { if (!online) throw new Error('cloud unavailable'); return catalog(String(id)) })
      const release = b.ctx.modelDirectories.registerCatalogSource(source)
      const a = b.mint('project-a'), second = b.mint('project-b')
      await expect(a.directory().load()).rejects.toThrow('cloud unavailable')
      expect(a.directory().store.getSnapshot()).toMatchObject({ status: 'error', groups: [] })
      expect(a.directory().store.getSnapshot().current).toEqual({ provider: 'fixture', model: 'project-a' })
      online = true
      const aState = await a.directory().load(), bState = await second.directory().load()
      expect(aState.groups).toEqual(catalog('project-a').groups)
      expect(bState.groups).toEqual(catalog('project-b').groups)
      expect(aState.current).toEqual({ provider: 'fixture', model: 'project-a' })
      expect(bState.current).toEqual({ provider: 'fixture', model: 'project-b' })
      expect(b.shared).toHaveBeenCalledTimes(1)
      expect(b.selectModel).not.toHaveBeenCalled()
      const original = a.directory()
      release()
      expect(a.directory()).toBe(original)
      expect(original.store.getSnapshot().groups).toEqual(catalog('deployment-default').groups)
      expect(original.store.getSnapshot().current?.model).toBe('project-a')
    } finally { await b.ctx.fiber.dispose() }
  })

  it('retains an original unavailable-route block when project discovery fails without importing shared choices', async () => {
    const b = await bench()
    try {
      b.ctx.modelDirectories.registerCatalogSource(async () => { throw new Error('project settings required') })
      const a = b.mint('missing-provider')
      b.setProjected(a.key, {
        lastUsed: null, next: { provider: 'unconfigured', model: 'original-default' },
      })
      await expect(a.directory().load()).rejects.toThrow('project settings required')
      expect(a.directory().store.getSnapshot()).toMatchObject({
        current: { provider: 'unconfigured', model: 'original-default' }, routable: false, groups: [], status: 'error',
      })
      expect(b.selectModel).not.toHaveBeenCalled()
    } finally { await b.ctx.fiber.dispose() }
  })

  it('replaces already mounted directories, cancels reads on reset/removal and ignores late old-account results', async () => {
    const b = await bench()
    try {
      const a = b.mint('project-a'), directory = a.directory()
      await directory.load()
      const old = Promise.withResolvers<ModelCatalog>(), fresh = Promise.withResolvers<ModelCatalog>()
      const signals: AbortSignal[] = []
      const source = vi.fn((_id: SessionId, signal: AbortSignal) => {
        signals.push(signal); return signals.length === 1 ? old.promise : fresh.promise
      })
      const release = b.ctx.modelDirectories.registerCatalogSource(source)
      expect(a.directory()).toBe(directory)
      expect(directory.store.getSnapshot().groups).toEqual([])
      expect(() => b.ctx.modelDirectories.registerCatalogSource(source)).toThrow('already registered')
      b.ctx.emit('connection/reset')
      expect(signals[0]?.aborted).toBe(true)
      expect(directory.store.getSnapshot().groups).toEqual([])
      old.resolve(catalog('old-account'))
      fresh.resolve(catalog('fresh-account'))
      await vi.waitFor(() => { expect(directory.store.getSnapshot().groups).toEqual(catalog('fresh-account').groups) })
      release()
      expect(signals[1]?.aborted).toBe(true)
      expect(directory.store.getSnapshot().groups).toEqual(catalog('deployment-default').groups)
      expect(b.selectModel).not.toHaveBeenCalled()
    } finally { await b.ctx.fiber.dispose() }
  })

  it('uses shared discovery for null and addressed Sessions, and releases a removed Session read', async () => {
    const b = await bench()
    try {
      const pending = Promise.withResolvers<ModelCatalog>()
      const signals: AbortSignal[] = []
      const source = vi.fn(async (id: SessionId, signal: AbortSignal) => {
        if (String(id) !== 'pending') return null
        signals.push(signal); return pending.promise
      })
      b.ctx.modelDirectories.registerCatalogSource(source)
      await b.mint('ordinary').directory().load()
      const addressed = b.mint('child'); b.addressed.add(addressed.key)
      await expect(addressed.directory().load()).rejects.toThrow('addressed subagent')
      expect(source).toHaveBeenCalledTimes(1)
      const removed = b.mint('pending'), stale = removed.directory()
      await removed.handle.fiber.dispose()
      expect(signals[0]?.aborted).toBe(true)
      pending.resolve(catalog('must-not-publish'))
      await Promise.resolve(); await Promise.resolve()
      expect(stale.store.getSnapshot().groups).toEqual([])
      expect(b.shared).toHaveBeenCalledTimes(1)
      expect(b.selectModel).not.toHaveBeenCalled()
    } finally { await b.ctx.fiber.dispose() }
  })
})
