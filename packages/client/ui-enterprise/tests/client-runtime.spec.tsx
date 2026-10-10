// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import { ClientModuleSystem, type ClientBundleRegistration, type ClientModuleLoaderTarget, type DshWindow } from '@deepseek-ai/dsh-client-modules/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, it, vi } from 'vitest'
import { EnterpriseClientPluginRuntime } from '../src/client/enterprise.tsx'

function moduleSystem(): ClientModuleSystem {
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
    staticModules: {}, registrationTarget: target,
    bootstrapModule: { id: '@deepseek-ai/dsh-client-modules', exports: {} },
  })
}

describe('enterprise Client plugin runtime', () => {
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
    expect(calls).toContainEqual({ endpoint: 'plugin-client-window-state', payload: { activationId, windowId: 'window-test', state: 'active', error: null } })
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
    expect(calls).toContainEqual({ endpoint: 'plugin-client-window-state', payload: { activationId: failedActivationId, windowId: 'window-test', state: 'failed', error: 'broken bundle' } })
    expect(calls).toContainEqual({ endpoint: 'plugin-client-window-state', payload: { activationId: healthyActivationId, windowId: 'window-test', state: 'active', error: null } })
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
    expect(calls).toContainEqual({ endpoint: 'plugin-client-window-state', payload: { activationId: healthyActivationId, windowId: 'window-test', state: 'active', error: null } })
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
      activationId: '00000000-0000-4000-8000-000000000042', windowId: 'window-test', state: 'active', error: null,
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
    let targets: Array<{ installationId: string; releaseId: string; pluginId: string; version: string; activationId: string; moduleId: string; source: string }> = [{
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
