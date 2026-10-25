// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import * as uiPrimitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as sharedStore from '@deepseek-ai/dsh-client-store'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
import { pluginManifest } from '@deepseek-ai/dsh-plugin-protocol'
import { ClientModuleSystem, type ClientBundleRegistration, type ClientModuleLoaderTarget, type DshWindow } from '@deepseek-ai/dsh-client-modules/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, it, vi } from 'vitest'
import { marketDisplayCatalog } from '../src/client/market.tsx'
import { enterprisePluginInstallations, enterprisePluginCatalog } from '../src/wire.ts'
import { EnterpriseClientPluginRuntime } from '../src/client/enterprise.tsx'

function moduleSystem(staticModules: Record<string, unknown> = {}): ClientModuleSystem {
  const pendingQueue: ClientBundleRegistration[] = []
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue,
    load: (registration) => { pendingQueue.push(registration) },
    create: () => { throw new Error('Test module system already exists') },
  }
  ;(window as unknown as DshWindow).__ModuleLoader__ = target
  return new ClientModuleSystem({
    manifest: { rev: 'test', modules: [], plugins: [] },
    staticModules, registrationTarget: target,
    bootstrapModule: { id: '@deepseek-ai/dsh-client-modules', exports: {} },
  })
}

describe('enterprise Client plugin runtime', () => {
  it('keeps a revoked installed version removable without offering a downgrade or executing its catalog entry', () => {
    const catalog = enterprisePluginCatalog.parse([{ id: 'old-release', pluginId: 'arivo.test', version: '1.0.0', targets: ['host'], permissions: [], tools: [], publishedAt: '2026-10-25', policyRevision: 1 }])
    const installations = enterprisePluginInstallations.parse([{ id: 'installation', pluginId: 'arivo.test', releaseId: 'withdrawn-release', version: '2.0.0', dataSpaceId: 'data', enabled: false, desiredState: 'disabled', observedState: 'revoked', config: {}, targetState: {}, updatedAt: '2026-10-25' }])
    const display = marketDisplayCatalog(catalog, installations, 'Unavailable release')
    expect(display).toHaveLength(1)
    expect(display[0]).toMatchObject({ id: 'withdrawn-release', status: 'unavailable', version: '2.0.0' })
    expect(catalog[0]!.id).toBe('old-release')
    expect(marketDisplayCatalog(catalog, [], 'Unavailable release')).toEqual(catalog)
  })

  it('loads the built market factory without composing enterprise account plugins', async () => {
    const modules = moduleSystem({ react: React, 'react/jsx-runtime': jsx,
      '@deepseek-ai/dsh-client-store': sharedStore, '@deepseek-ai/dsh-client-ui-primitives': uiPrimitives })
    try {
      window.eval(readFileSync('lib/client.js', 'utf8'))
      expect(modules.manifest.plugins).toHaveLength(0)
      const exports = await modules.import('@deepseek-ai/dsh-enterprise-client/client') as Record<string, unknown>
      expect(exports.registerPluginMarket).toBeTypeOf('function')
      expect(exports.apply).toBeTypeOf('function')
      expect(modules.loadCache.has('@deepseek-ai/dsh-enterprise-client')).toBe(true)
    } finally { Reflect.deleteProperty(window, '__ModuleLoader__') }
  })

  it.skipIf(process.env.DSH_MEDIA_PLUGIN_ZIP === undefined)('mounts the actual Media Canvas ZIP Client through marketplace verification', async () => {
    const files = unzipSync(readFileSync(process.env.DSH_MEDIA_PLUGIN_ZIP!))
    const manifest = pluginManifest.parse(JSON.parse(strFromU8(files['manifest.json']!)))
    const target = manifest.targets.find(item => item.kind === 'client')!
    const ctx = new Context()
    const modules = moduleSystem({ react: React, 'react/jsx-runtime': jsx, '@deepseek-ai/dsh-client-store': sharedStore })
    ctx.reflect.provide('modules', modules)
    ctx.provide('locale', new LocaleRuntime(ctx))
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: {
      'workbench.panel': { kind: 'keyed', scope: 'root' },
      'workbench.tabs': { kind: 'list', scope: 'root' },
    } } as never, () => null)
    const disposeRemote = vi.fn(async () => {})
    ctx.provide('remote', { $mount: async () => disposeRemote } as never)
    ctx.provide('remote.mediaCanvas', {} as never)
    let targets = [{
      installationId: 'media-installation', releaseId: 'media-release', pluginId: manifest.pluginId, version: manifest.version,
      activationId: '00000000-0000-4000-8000-000000000072', moduleId: target.moduleId,
      source: strFromU8(files[target.entry]!), contributions: target.contributions,
    }]
    const calls: Array<{ endpoint: string; payload: unknown }> = []
    const runtime = new EnterpriseClientPluginRuntime({ ctx, windowId: 'media-test',
      call: async (endpoint, payload) => {
        if (endpoint === 'plugin-runtime-targets') return { targets, activationTimeoutMs: 30_000, cleanupTimeoutMs: 10_000 }
        calls.push({ endpoint, payload })
        return null
      },
      loadTarget: async (input) => { window.eval(input.source) },
    })
    try {
      await runtime.reconcile()
      expect(calls.find(call => call.endpoint === 'plugin-client-window-state')).toEqual({
        endpoint: 'plugin-client-window-state', payload: {
          activationId: targets[0]!.activationId, moduleId: target.moduleId, windowId: 'media-test', state: 'active', error: null,
        },
      })
      expect(slots.entries('workbench.panel').map(entry => entry.options.key)).toEqual(['media'])
      expect(slots.entries('workbench.tabs').map(entry => entry.options.id)).toEqual(['media-canvas-tab'])
      expect(calls).toMatchSnapshot()
      targets = []
      await runtime.reconcile()
      expect(slots.entries('workbench.panel')).toHaveLength(0)
      expect(slots.entries('workbench.tabs')).toHaveLength(0)
      expect(disposeRemote).toHaveBeenCalledOnce()
      expect(modules.loadCache.has(target.moduleId)).toBe(false)
      expect(document.querySelector('style[data-plugin="' + target.moduleId + '"]')).toBeNull()
    } finally {
      await runtime.dispose()
      await ctx.fiber.dispose()
      Reflect.deleteProperty(window, '__ModuleLoader__')
    }
  })

  it.each([
    { panelId: 'media', tabId: 'media-canvas-tab', ready: true },
    { panelId: 'media-canvas-panel', tabId: 'media-canvas-tab', ready: false },
    { panelId: 'media', tabId: 'missing-tab', ready: false },
  ])('checks a keyed panel and list tab against their manifest selectors ($panelId, $tabId)', async ({ panelId, tabId, ready }) => {
    const ctx = new Context()
    const modules = moduleSystem()
    ctx.reflect.provide('modules', modules)
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: {
      'workbench.panel': { kind: 'keyed', scope: 'root' },
      'workbench.tabs': { kind: 'list', scope: 'root' },
    } } as never, () => null)
    const source = `window.__ModuleLoader__.load({
      id: '@example/keyed-panel', factory: () => ({ inject: ['slots'], apply(ctx) {
        ctx.slots.inject('workbench.panel', () => ctx.slots.register({ name: 'workbench.panel', key: 'media' }, () => null))
        ctx.slots.inject('workbench.tabs', () => ctx.slots.register({ name: 'workbench.tabs', id: 'media-canvas-tab' }, () => null))
      } })
    })`
    const target = {
      installationId: 'installation', releaseId: 'release', pluginId: 'panel', version: '1.0.0',
      activationId: '00000000-0000-4000-8000-000000000071', moduleId: '@example/keyed-panel', source,
      contributions: [
        { kind: 'slot', id: panelId, slot: 'workbench.panel', multiplicity: 'one' },
        { kind: 'slot', id: tabId, slot: 'workbench.tabs', multiplicity: 'many' },
      ],
    }
    let targets = [target]
    const calls: Array<{ endpoint: string; payload: unknown }> = []
    const runtime = new EnterpriseClientPluginRuntime({ ctx, windowId: 'selector-test',
      call: async (endpoint, payload) => {
        if (endpoint === 'plugin-runtime-targets') return { targets, activationTimeoutMs: 30_000, cleanupTimeoutMs: 10_000 }
        calls.push({ endpoint, payload })
        return null
      },
      loadTarget: async (input) => { window.eval(input.source) },
    })
    try {
      await runtime.reconcile()
      const report = calls.find(call => call.endpoint === 'plugin-client-window-state')?.payload as { state: string; error: string | null }
      expect(report.state).toBe(ready ? 'active' : 'failed')
      if (ready) expect(report.error).toBeNull()
      else expect(report.error).toContain(panelId === 'media' ? tabId : panelId)
      expect(slots.entries('workbench.panel')).toHaveLength(ready ? 1 : 0)
      expect(slots.entries('workbench.tabs')).toHaveLength(ready ? 1 : 0)
      if (ready) expect(calls.find(call => call.endpoint === 'plugin-client-slot-state')).toEqual({
        endpoint: 'plugin-client-slot-state', payload: {
          activationId: target.activationId, moduleId: target.moduleId, windowId: 'selector-test', slots: [
            { id: 'media', slot: 'workbench.panel', present: true },
            { id: 'media-canvas-tab', slot: 'workbench.tabs', present: true },
          ],
        },
      })
      targets = []
      await runtime.reconcile()
      expect(slots.entries('workbench.panel')).toHaveLength(0)
      expect(slots.entries('workbench.tabs')).toHaveLength(0)
      expect(modules.loadCache.has(target.moduleId)).toBe(false)
    } finally {
      await runtime.dispose()
      await ctx.fiber.dispose()
      Reflect.deleteProperty(window, '__ModuleLoader__')
    }
  })

  it('mounts SDK-backed slots and removes them when the Host withdraws the target', async () => {
    const ctx = new Context()
    const modules = moduleSystem()
    ctx.reflect.provide('modules', modules)
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    const disposeRoot = slots.register({
      name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    const activationId = '00000000-0000-4000-8000-000000000011'
    const source = `
      window.__ModuleLoader__.load({
        id: '@example/client-probe',
        factory: () => ({
          name: 'client-probe',
          inject: ['pluginSdk', 'slots', 'clientWindow'],
          apply(ctx) {
            ctx.pluginSdk.identity.current().then(identity => { window.__clientProbeIdentity = identity.name })
            ctx.clientWindow.open('inspector', { source: 'client-probe' }).then(instance => { window.__clientProbeWindow = instance.contributionId })
            ctx.slots.inject('settings.section', () => ctx.slots.register({
              name: 'settings.section', id: 'client-probe', order: 40, label: 'Client probe'
            }, () => null))
          }
        })
      })
    `
    let targets = [{
      installationId: 'installation', releaseId: 'release', pluginId: 'client-probe', version: '1.0.0',
      activationId, moduleId: '@example/client-probe', source,
    }]
    const calls: Array<{ endpoint: string; payload: unknown }> = []
    const call = vi.fn(async (endpoint: string, payload: unknown): Promise<unknown> => {
      calls.push({ endpoint, payload })
      if (endpoint === 'plugin-runtime-targets') return { targets, activationTimeoutMs: 30_000, cleanupTimeoutMs: 10_000 }
      if (endpoint === 'plugin-sdk-call') {
        const operation = (payload as { operation?: unknown }).operation
        if (operation === 'client-window/open') return { windowInstanceId: 'plugin-window-1', pluginId: 'client-probe', contributionId: 'inspector', state: 'ready' }
        return { userId: 'user', name: 'Ada', avatarUrl: null, email: 'ada@example.com', organizationId: 'organization', owner: { kind: 'personal', accountId: 'user' } }
      }
      if (endpoint === 'plugin-client-window-state') return null
      throw new Error(`Unexpected endpoint ${endpoint}`)
    })
    const runtime = new EnterpriseClientPluginRuntime({
      ctx,
      call,
      windowId: 'window-test',
      loadTarget: async (target) => { window.eval(target.source) },
    })

    await runtime.reconcile()
    await vi.waitFor(() => { expect((window as typeof window & { __clientProbeIdentity?: string }).__clientProbeIdentity).toBe('Ada') })
    await vi.waitFor(() => { expect((window as typeof window & { __clientProbeWindow?: string }).__clientProbeWindow).toBe('inspector') })
    expect(slots.entries('settings.section').map(entry => entry.options.id)).toContain('client-probe')
    expect(modules.loadCache.has('@example/client-probe')).toBe(true)
    expect(calls).toContainEqual({ endpoint: 'plugin-client-window-state', payload: { activationId, moduleId: '@example/client-probe', windowId: 'window-test', state: 'active', error: null } })
    expect(calls.some(callRecord => callRecord.endpoint === 'plugin-sdk-call')).toBe(true)

    targets = []
    await runtime.reconcile()
    expect(slots.entries('settings.section').map(entry => entry.options.id)).not.toContain('client-probe')
    expect(modules.loadCache.has('@example/client-probe')).toBe(false)

    targets = [{
      installationId: 'installation', releaseId: 'release', pluginId: 'client-probe', version: '1.0.0',
      activationId: '00000000-0000-4000-8000-000000000012', moduleId: '@example/client-probe',
      source,
    }]
    await runtime.reconcile()
    expect(slots.entries('settings.section').map(entry => entry.options.id)).toContain('client-probe')
    await runtime.dispose()
    expect(modules.loadCache.has('@example/client-probe')).toBe(false)
    disposeRoot()
    await ctx.fiber.dispose()
    Reflect.deleteProperty(window, '__clientProbeIdentity')
    Reflect.deleteProperty(window, '__clientProbeWindow')
    Reflect.deleteProperty(window, '__ModuleLoader__')
  })

  it('continues loading other targets when one Client target fails', async () => {
    const ctx = new Context()
    const modules = moduleSystem()
    ctx.reflect.provide('modules', modules)
    const failedActivationId = '00000000-0000-4000-8000-000000000021'
    const healthyActivationId = '00000000-0000-4000-8000-000000000022'
    const source = `window.__ModuleLoader__.load({
      id: '@example/healthy-client',
      factory: () => ({ name: 'healthy-client', apply() {} }),
    })`
    const targets = [
      { installationId: 'failed', releaseId: 'release', pluginId: 'failed-client', version: '1.0.0', activationId: failedActivationId, moduleId: '@example/failed-client', source: 'throw new Error(\"broken bundle\")' },
      { installationId: 'healthy', releaseId: 'release', pluginId: 'healthy-client', version: '1.0.0', activationId: healthyActivationId, moduleId: '@example/healthy-client', source },
    ]
    const calls: Array<{ endpoint: string; payload: unknown }> = []
    const runtime = new EnterpriseClientPluginRuntime({
      ctx,
      windowId: 'window-test',
      call: vi.fn(async (endpoint: string, payload: unknown): Promise<unknown> => {
        calls.push({ endpoint, payload })
        if (endpoint === 'plugin-runtime-targets') return { targets, activationTimeoutMs: 30_000, cleanupTimeoutMs: 10_000 }
        if (endpoint === 'plugin-client-window-state') return null
        throw new Error(`Unexpected endpoint ${endpoint}`)
      }),
      loadTarget: async (target) => { window.eval(target.source) },
    })

    await runtime.reconcile()
    expect(calls).toContainEqual({ endpoint: 'plugin-client-window-state', payload: { activationId: failedActivationId, moduleId: '@example/failed-client', windowId: 'window-test', state: 'failed', error: 'broken bundle' } })
    expect(calls).toContainEqual({ endpoint: 'plugin-client-window-state', payload: { activationId: healthyActivationId, moduleId: '@example/healthy-client', windowId: 'window-test', state: 'active', error: null } })
    await runtime.dispose()
    Reflect.deleteProperty(window, '__ModuleLoader__')
    await ctx.fiber.dispose()
  })

  it('times out one pending Client activation while another plugin starts', async () => {
    const ctx = new Context()
    const modules = moduleSystem()
    ctx.reflect.provide('modules', modules)
    let releaseStalledActivation: (() => void) | undefined
    const stalledActivation = new Promise<void>((resolve) => { releaseStalledActivation = resolve })
    ;(window as typeof window & { __stalledActivation: () => Promise<void> }).__stalledActivation = () => stalledActivation
    const stalledActivationId = '00000000-0000-4000-8000-000000000023'
    const healthyActivationId = '00000000-0000-4000-8000-000000000024'
    const targets = [
      {
        installationId: 'stalled', releaseId: 'release-stalled', pluginId: 'stalled-client', version: '1.0.0',
        activationId: stalledActivationId, moduleId: '@example/stalled-activation',
        source: 'window.__ModuleLoader__.load({ id: \'@example/stalled-activation\', factory: () => ({ async apply() { await window.__stalledActivation() } }) })',
      },
      {
        installationId: 'healthy', releaseId: 'release-healthy', pluginId: 'healthy-client', version: '1.0.0',
        activationId: healthyActivationId, moduleId: '@example/healthy-activation',
        source: 'window.__ModuleLoader__.load({ id: \'@example/healthy-activation\', factory: () => ({ apply() {} }) })',
      },
    ]
    const calls: Array<{ endpoint: string; payload: unknown }> = []
    const runtime = new EnterpriseClientPluginRuntime({
      ctx, activationTimeoutMs: 5,
      call: vi.fn(async (endpoint: string, payload: unknown): Promise<unknown> => {
        calls.push({ endpoint, payload })
        if (endpoint === 'plugin-runtime-targets') return { targets, activationTimeoutMs: 30_000, cleanupTimeoutMs: 10_000 }
        if (endpoint === 'plugin-client-window-state') return null
        throw new Error(`Unexpected endpoint ${endpoint}`)
      }),
      windowId: 'window-test',
      loadTarget: async (target) => { window.eval(target.source) },
    })

    const started = Date.now()
    await runtime.reconcile()
    expect(Date.now() - started).toBeLessThan(500)
    expect(calls).toContainEqual({ endpoint: 'plugin-client-window-state', payload: { activationId: healthyActivationId, moduleId: '@example/healthy-activation', windowId: 'window-test', state: 'active', error: null } })
    expect(calls.some(call => call.endpoint === 'plugin-client-window-state'
      && (call.payload as { activationId?: string; state?: string }).activationId === stalledActivationId
      && (call.payload as { state?: string }).state === 'failed')).toBe(true)
    releaseStalledActivation?.()
    await runtime.dispose()
    Reflect.deleteProperty(window, '__ModuleLoader__')
    Reflect.deleteProperty(window, '__stalledActivation')
    await ctx.fiber.dispose()
  })

  it('bounds a stalled Client disposer so later reconciliation can continue', async () => {
    const ctx = new Context()
    const modules = moduleSystem()
    ctx.reflect.provide('modules', modules)
    let releaseCleanup: (() => void) | undefined
    const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve })
    const activationId = '00000000-0000-4000-8000-000000000031'
    const source = `window.__ModuleLoader__.load({
      id: '@example/stalled-client',
      factory: () => ({ name: 'stalled-client', apply(ctx) { ctx.effect(() => async () => await window.__stalledCleanup()) } }),
    })`
    ;(window as typeof window & { __stalledCleanup: () => Promise<void> }).__stalledCleanup = () => cleanup
    let targets: unknown[] = [{
      installationId: 'stalled', releaseId: 'release', pluginId: 'stalled-client', version: '1.0.0', activationId,
      moduleId: '@example/stalled-client', source,
    }]
    const runtime = new EnterpriseClientPluginRuntime({
      ctx, cleanupTimeoutMs: 5,
      call: vi.fn(async (endpoint: string): Promise<unknown> => endpoint === 'plugin-runtime-targets'
        ? { targets, activationTimeoutMs: 30_000, cleanupTimeoutMs: 10_000 }
        : null),
      loadTarget: async (target) => { window.eval(target.source) },
    })

    await runtime.reconcile()
    targets = []
    const started = Date.now()
    await runtime.reconcile()
    expect(Date.now() - started).toBeLessThan(500)
    releaseCleanup?.()
    await runtime.dispose()
    await ctx.fiber.dispose()
    Reflect.deleteProperty(window, '__ModuleLoader__')
    Reflect.deleteProperty(window, '__stalledCleanup')
  })

  it('replaces the active target and its slots when an installation upgrades', async () => {
    const ctx = new Context()
    const modules = moduleSystem()
    ctx.reflect.provide('modules', modules)
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    const disposeRoot = slots.register({
      name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    const versions: string[] = []
    ;(window as typeof window & { __pluginVersions: string[] }).__pluginVersions = versions
    const source = (version: string) => `window.__ModuleLoader__.load({
      id: '@example/upgradable-client',
      factory: () => ({
        name: 'upgradable-client-${version}',
        inject: ['slots'],
        apply(ctx) {
          window.__pluginVersions.push('mounted-${version}')
          ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section', id: 'upgradable-${version}', order: 40,
          }, () => null))
          ctx.effect(() => () => { window.__pluginVersions.push('disposed-${version}') })
        }
      })
    })`
    let targets = [{
      installationId: 'installation', releaseId: 'release-v1', pluginId: 'upgradable-client', version: '1.0.0',
      activationId: '00000000-0000-4000-8000-000000000041', moduleId: '@example/upgradable-client', source: source('v1'),
    }]
    const calls: Array<{ endpoint: string; payload: unknown }> = []
    const runtime = new EnterpriseClientPluginRuntime({
      ctx,
      windowId: 'window-test',
      call: vi.fn(async (endpoint: string, payload: unknown): Promise<unknown> => {
        calls.push({ endpoint, payload })
        if (endpoint === 'plugin-runtime-targets') return { targets, activationTimeoutMs: 30_000, cleanupTimeoutMs: 10_000 }
        if (endpoint === 'plugin-client-window-state') return null
        throw new Error(`Unexpected endpoint ${endpoint}`)
      }),
      loadTarget: async (target) => { window.eval(target.source) },
    })

    await runtime.reconcile()
    expect(versions).toEqual(['mounted-v1'])
    expect(slots.entries('settings.section').map(entry => entry.options.id)).toContain('upgradable-v1')

    targets = [{
      installationId: 'installation', releaseId: 'release-v2', pluginId: 'upgradable-client', version: '2.0.0',
      activationId: '00000000-0000-4000-8000-000000000042', moduleId: '@example/upgradable-client', source: source('v2'),
    }]
    await runtime.reconcile()
    expect(versions).toEqual(['mounted-v1', 'disposed-v1', 'mounted-v2'])
    expect(slots.entries('settings.section').map(entry => entry.options.id)).toEqual(['upgradable-v2'])
    expect(calls).toContainEqual({ endpoint: 'plugin-client-window-state', payload: {
      activationId: '00000000-0000-4000-8000-000000000042', moduleId: '@example/upgradable-client', windowId: 'window-test', state: 'active', error: null,
    } })

    await runtime.dispose()
    expect(versions).toEqual(['mounted-v1', 'disposed-v1', 'mounted-v2', 'disposed-v2'])
    disposeRoot()
    await ctx.fiber.dispose()
    Reflect.deleteProperty(window, '__pluginVersions')
    Reflect.deleteProperty(window, '__ModuleLoader__')
  })

  it('supersedes a stalled Client activation with the latest target snapshot', async () => {
    const ctx = new Context()
    const modules = moduleSystem()
    ctx.reflect.provide('modules', modules)
    let releaseStalled: (() => void) | undefined
    const stalled = new Promise<void>((resolve) => { releaseStalled = resolve })
    ;(window as typeof window & { __stalledClientActivation: () => Promise<void> }).__stalledClientActivation = () => stalled
    const healthyActivationId = '00000000-0000-4000-8000-000000000052'
    let targets: Array<{ installationId: string
      releaseId: string
      pluginId: string
      version: string
      activationId: string
      moduleId: string
      source: string }> = [{
      installationId: 'installation', releaseId: 'release-v1', pluginId: 'stalled-client', version: '1.0.0',
      activationId: '00000000-0000-4000-8000-000000000051', moduleId: '@example/stalled-client',
      source: 'window.__ModuleLoader__.load({ id: \'@example/stalled-client\', factory: () => ({ async apply() { await window.__stalledClientActivation() } }) })',
    }]
    const calls: Array<{ endpoint: string; payload: unknown }> = []
    const runtime = new EnterpriseClientPluginRuntime({
      ctx,
      windowId: 'window-test',
      call: vi.fn(async (endpoint: string, payload: unknown): Promise<unknown> => {
        calls.push({ endpoint, payload })
        if (endpoint === 'plugin-runtime-targets') return { targets, activationTimeoutMs: 30_000, cleanupTimeoutMs: 10_000 }
        if (endpoint === 'plugin-client-window-state') return null
        throw new Error(`Unexpected endpoint ${endpoint}`)
      }),
      loadTarget: async (target) => { window.eval(target.source) },
    })

    const first = runtime.reconcile()
    await vi.waitFor(() => { expect(calls.some(call => call.endpoint === 'plugin-runtime-targets')).toBe(true) })
    targets = [{
      installationId: 'installation', releaseId: 'release-v2', pluginId: 'healthy-client', version: '2.0.0',
      activationId: healthyActivationId, moduleId: '@example/healthy-client',
      source: 'window.__ModuleLoader__.load({ id: \'@example/healthy-client\', factory: () => ({ apply() {} }) })',
    }]
    await runtime.reconcile()
    await first
    expect(calls.filter(call => call.endpoint === 'plugin-client-window-state'
      && (call.payload as { activationId?: string }).activationId === healthyActivationId
      && (call.payload as { state?: string }).state === 'active')).toHaveLength(1)
    releaseStalled?.()
    await runtime.dispose()
    await ctx.fiber.dispose()
    Reflect.deleteProperty(window, '__ModuleLoader__')
    Reflect.deleteProperty(window, '__stalledClientActivation')
  })
})
