import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import Group from '@deepseek-ai/cordis-plugin-group'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { strToU8, zipSync, unzipSync } from 'fflate'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EnterprisePluginRuntime } from '../src/plugin-runtime.ts'
import { marketCredentialKey } from '../src/plugin-credentials.ts'
import { pluginConfiguration, resolvePluginConfiguration } from '../src/wire.ts'

const encoder = new TextEncoder()
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

async function runtimeContext(): Promise<Context> {
  const ctx = new Context()
  const home = await mkdtemp(join(tmpdir(), 'dsh-plugin-runtime-test-'))
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  ;(ctx as Context & { dshHomePath: (...segments: string[]) => string }).dshHomePath = (...segments) => join(home, ...segments)
  ctx.effect(() => () => rm(home, { recursive: true, force: true }))
  return ctx
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Condition did not become true within ${timeoutMs}ms`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function pluginPackage(version: string, hostSource?: string, pluginId = 'runtime.probe'): Uint8Array {
  const manifest = {
    schemaVersion: 2, pluginId, name: 'Runtime probe', version,
    targets: [
      { kind: 'host', entry: 'host/index.js', compatibility: 'dsh-host>=1', contributions: ['host:probe'] },
      { kind: 'client', entry: 'client/index.js', moduleId: '@deepseek-ai/dsh-plugin-runtime-probe', compatibility: 'dsh-client>=1', contributions: [
        { kind: 'slot', id: 'panel', slot: 'settings.section', multiplicity: 'one' },
        { kind: 'window', id: 'inspector', surface: 'plugin-window', multiplicity: 'many', titleKey: 'window.inspector.title', shell: 'minimal' },
      ] },
    ],
    permissions: [], resources: [], migrations: [], contributions: [], dependencies: {},
    build: { runtime: 'node22', lockfileDigest: '0'.repeat(64) },
  }
  const manifestBytes = encoder.encode(`${JSON.stringify(manifest)}\n`)
  const host = encoder.encode(hostSource ?? `
      import { createRequire } from 'node:module'
      import { Context } from '@deepseek-ai/cordis'
      const { version } = createRequire(import.meta.url)('../package.json')
      export const name = 'runtime-probe-host'
      export function apply(ctx) {
        if (!(ctx instanceof Context)) throw new Error('Host target loaded a different Cordis module')
        const probe = globalThis.__dshEnterprisePluginProbe
        probe.version = version
        probe.mounts += 1
        ctx.effect(() => () => { probe.disposes += 1 })
      }
    `)
  const client = encoder.encode("export const name = 'runtime-probe-client'; export function apply() {}\n")
  const entries = { 'manifest.json': manifestBytes, 'host/index.js': host, 'client/index.js': client }
  const integrity = Object.fromEntries(Object.entries(entries).map(([path, bytes]) => [path, digest(bytes)]))
  return zipSync({ ...entries, 'integrity.json': strToU8(`${JSON.stringify(integrity)}\n`) }, { level: 9 })
}

function multiPackageRelease(): Uint8Array {
  const pluginId = 'runtime.multi'
  const manifest = {
    schemaVersion: 3, pluginId, name: 'Runtime multi package', version: '1.0.0', targets: [],
    packages: ['first', 'second'].map(id => ({
      id, name: `@example/${pluginId}-${id}`, version: '1.0.0',
      dependencies: id === 'first' ? { '@example/runtime.multi-second': '1.0.0' } : {},
      targets: [
        { kind: 'host', entry: `packages/${id}/host/index.js`, compatibility: 'dsh-host>=1', contributions: [] },
        { kind: 'client', entry: `packages/${id}/client/index.js`, moduleId: `@example/${pluginId}-${id}-client`, compatibility: 'dsh-client>=1', contributions: [{ kind: 'slot', id: `panel-${id}`, slot: 'settings.section', multiplicity: 'one' }] },
      ],
    })),
    permissions: [], resources: [], migrations: [], build: { runtime: 'node22', lockfileDigest: '0'.repeat(64) },
  }
  const entries: Record<string, Uint8Array> = { 'manifest.json': encoder.encode(`${JSON.stringify(manifest)}\n`) }
  for (const id of ['first', 'second']) {
    const dependencies = id === 'first' ? { '@example/runtime.multi-second': '1.0.0' } : {}
    entries[`packages/${id}/package.json`] = encoder.encode(JSON.stringify({ name: `@example/${pluginId}-${id}`, version: '1.0.0', type: 'module', dependencies }))
    const markerImport = id === 'first' ? 'import { marker } from \'@example/runtime.multi-second/helper.js\'' : 'import { marker } from \'./helper.js\''
    entries[`packages/${id}/host/index.js`] = encoder.encode(`export const inject = ['tools', 'skills']; ${markerImport}; export function apply(ctx) { const probe = globalThis.__dshEnterprisePluginProbe; probe.mounts += 1; probe.helpers.push(marker); ctx.tools.register({ name: 'multi_${id}', description: 'Package ${id} probe', parameters: { type: 'object' }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { return marker } }); ctx.skills.register({ name: 'multi-${id}-skill', description: 'Package ${id} skill', source: 'plugin', content: marker }); ctx.effect(() => () => { probe.disposes += 1 }) }`)
    entries[`packages/${id}/host/helper.js`] = encoder.encode(`export const marker = '${id}-helper'`)
    entries[`packages/${id}/client/index.js`] = encoder.encode('export function apply() {}')
  }
  const integrity = Object.fromEntries(Object.entries(entries).map(([path, bytes]) => [path, digest(bytes)]))
  return zipSync({ ...entries, 'integrity.json': strToU8(`${JSON.stringify(integrity)}\n`) }, { level: 9 })
}

void test('enterprise runtime loads, upgrades, and removes real ZIP targets', async () => {
  const probe = { mounts: 0, disposes: 0 }
  ;(globalThis as typeof globalThis & { __dshEnterprisePluginProbe: typeof probe }).__dshEnterprisePluginProbe = probe
  const ctx = await runtimeContext()
  const archives = new Map([['release-v1', pluginPackage('1.0.0')], ['release-v2', pluginPackage('1.1.0')]])
  let releaseId = 'release-v1'
  let permissionRevision = 1
  let enabled = true
  let lease = 0
  const requests: Array<{ path: string; method: string; body: unknown }> = []
  const catalog = () => {
    const bytes = archives.get(releaseId)!
    return [{ id: releaseId, pluginId: 'runtime.probe', version: releaseId === 'release-v1' ? '1.0.0' : '1.1.0', digest: digest(bytes), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 }]
  }
  const installations = () => enabled ? [{
    id: 'installation', releaseId, ownerKind: 'personal', dataSpaceId: 'space', enabled: true,
    desiredState: 'enabled', observedState: 'preparing', permissionRevision,
    config: {}, targetState: {}, updatedAt: new Date(0).toISOString(),
  }] : []
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device',
    request: async (path, _signal, init = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : null
      requests.push({ path, method: init.method ?? 'GET', body })
      if (path === 'plugins/catalog') return catalog()
      if (path === 'plugins/installations') return installations()
      if (path.endsWith('/activate')) {
        lease += 1
        return { activationId: `00000000-0000-4000-8000-${String(lease).padStart(12, '0')}`, token: `token-${String(lease)}` }
      }
      return {}
    },
    requestBytes: async path => archives.get(path.split('/')[1]!)!,
  })

  await runtime.reconcile(new AbortController().signal)
  assert.equal(probe.mounts, 1)
  assert.equal((probe as typeof probe & { version: string }).version, '1.0.0')
  assert.equal(probe.disposes, 0)
  assert.equal(runtime.clientTargets().length, 1)
  const activeHeartbeat = requests.find(request => request.path.endsWith('/heartbeat'))
  assert.deepEqual(activeHeartbeat?.body, {
    activationId: '00000000-0000-4000-8000-000000000001', targetKind: 'host', observedState: 'active', error: null,
  })
  const clientActivationId = runtime.clientTargets()[0]?.activationId
  assert.ok(clientActivationId)
  await runtime.reportClientWindow(clientActivationId, 'window-test', 'active', null, new AbortController().signal)
  assert.ok(requests.some(request => request.path.endsWith('/heartbeat')
    && JSON.stringify(request.body) === JSON.stringify({
      activationId: clientActivationId, targetKind: 'client', observedState: 'active', error: null,
    })))

  permissionRevision = 2
  await runtime.reconcile(new AbortController().signal)
  assert.equal(probe.mounts, 2)
  assert.equal(probe.disposes, 1)
  assert.equal(runtime.clientWindows.listDefinitions('runtime.probe').length, 1)

  releaseId = 'release-v2'
  await runtime.reconcile(new AbortController().signal)
  assert.equal(probe.mounts, 3)
  assert.equal(probe.disposes, 2)
  assert.equal((probe as typeof probe & { version: string }).version, '1.1.0')
  assert.equal(runtime.clientTargets()[0]?.version, '1.1.0')
  assert.equal(runtime.clientWindows.listDefinitions('runtime.probe').length, 1)

  enabled = false
  await runtime.reconcile(new AbortController().signal)
  assert.equal(probe.disposes, 3)
  assert.equal(runtime.clientTargets().length, 0)
  assert.equal(runtime.clientWindows.listDefinitions('runtime.probe').length, 0)
  assert.equal(requests.filter(request => request.path.endsWith('/deactivate')).length, 6)
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe')
})

void test('enterprise runtime loads and unloads multiple Cordis packages under one product lease', async () => {
  const probe = { mounts: 0, disposes: 0, helpers: [] as string[] }
  ;(globalThis as typeof globalThis & { __dshEnterprisePluginProbe: typeof probe }).__dshEnterprisePluginProbe = probe
  const ctx = await runtimeContext()
  const archive = multiPackageRelease()
  let enabled = true
  let lease = 0
  const errors: unknown[] = []
  const clientHeartbeats: unknown[] = []
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device',
    request: async (path, _signal, init = {}) => {
      if (path === 'plugins/catalog') return [{ id: 'multi-release', pluginId: 'runtime.multi', version: '1.0.0', digest: digest(archive), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 }]
      if (path === 'plugins/installations') return enabled ? [{ id: 'multi-installation', releaseId: 'multi-release', pluginId: 'runtime.multi', ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision: 1, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() }] : []
      if (path.endsWith('/activate')) {
        lease += 1
        return { activationId: `00000000-0000-4000-8000-${String(lease).padStart(12, '0')}`, token: `token-${lease}` }
      }
      if (path.endsWith('/heartbeat')) {
        const body = JSON.parse((init.body as string)) as { observedState?: string; error?: string | null }
        if (body.observedState === 'failed') errors.push(body.error)
        if ((body as { targetKind?: string }).targetKind === 'client') clientHeartbeats.push(body)
      }
      return {}
    },
    requestBytes: async () => archive,
  })

  await runtime.reconcile(new AbortController().signal)
  assert.equal(probe.mounts, 2, JSON.stringify(errors))
  assert.deepEqual(probe.helpers, ['second-helper', 'second-helper'])
  assert.deepEqual(ctx.tools.schemas().filter(tool => tool.name.startsWith('multi_')).map(tool => tool.name), ['multi_first', 'multi_second'])
  assert.deepEqual((await ctx.systemPrompt.assemble()).tools.filter(tool => tool.name.startsWith('multi_')).map(tool => tool.name), ['multi_first', 'multi_second'])
  assert.deepEqual((await ctx.skills.list()).filter(skill => skill.name.startsWith('multi-')).map(skill => skill.name), ['multi-first-skill', 'multi-second-skill'])
  const diagnostics = await runtime.capabilityDiagnostics()
  assert.deepEqual(diagnostics.filter(item => item.targetKind === 'host').flatMap(item => item.tools.present), ['multi_first', 'multi_second'])
  assert.deepEqual(diagnostics.filter(item => item.targetKind === 'host').flatMap(item => item.skills.present), ['multi-first-skill', 'multi-second-skill'])
  const firstTool = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('multi-first'), name: 'multi_first', arguments: {} })
  assert.equal(firstTool.value, 'second-helper')
  assert.equal(runtime.clientTargets().length, 2)
  const [firstClient, secondClient] = runtime.clientTargets()
  assert.ok(firstClient && secondClient)
  const signal = new AbortController().signal
  await assert.rejects(runtime.reportClientWindow(firstClient.activationId, 'main', 'active', null, signal), /unknown-client-module/u)
  await runtime.reportClientWindow(firstClient.activationId, 'main', 'active', null, signal, firstClient.moduleId)
  assert.equal(clientHeartbeats.length, 0)
  await runtime.reportClientWindow(secondClient.activationId, 'other', 'active', null, signal, secondClient.moduleId)
  assert.equal((await runtime.capabilityDiagnostics()).find(row => row.targetKind === 'client')?.state, 'stale')
  await runtime.reportClientWindow(secondClient.activationId, 'main', 'active', null, signal, secondClient.moduleId)
  assert.equal(clientHeartbeats.length, 1)
  runtime.reportClientSlots(firstClient.activationId, firstClient.moduleId, 'main', [{ id: 'panel-first', slot: 'settings.section', present: true }])
  runtime.reportClientSlots(secondClient.activationId, secondClient.moduleId, 'other', [{ id: 'panel-second', slot: 'settings.section', present: true }])
  assert.equal((await runtime.capabilityDiagnostics()).find(row => row.targetKind === 'client')?.state, 'stale')
  runtime.reportClientSlots(secondClient.activationId, secondClient.moduleId, 'main', [{ id: 'panel-second', slot: 'settings.section', present: true }])
  assert.equal((await runtime.capabilityDiagnostics()).find(row => row.targetKind === 'client')?.state, 'active')
  assert.deepEqual(runtime.clientWindowStates().map(row => row.moduleId), [firstClient.moduleId, secondClient.moduleId,
    secondClient.moduleId])
  await runtime.reportClientWindow(firstClient.activationId, 'main', 'disconnected', null, signal, firstClient.moduleId)
  assert.equal((await runtime.capabilityDiagnostics()).find(row => row.targetKind === 'client')?.state, 'stale')
  enabled = false
  await runtime.reconcile(new AbortController().signal)
  assert.equal(probe.disposes, 2)
  assert.deepEqual(ctx.tools.schemas().filter(tool => tool.name.startsWith('multi_')), [])
  assert.deepEqual((await ctx.skills.list()).filter(skill => skill.name.startsWith('multi-')), [])
  assert.deepEqual(await runtime.capabilityDiagnostics(), [])
  assert.equal(runtime.clientTargets().length, 0)
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe')
})

void test('enterprise runtime rolls the whole product back when a replacement Host fails', async () => {
  const probe = { mounts: 0, disposes: 0 }
  ;(globalThis as typeof globalThis & { __dshEnterprisePluginProbe: typeof probe }).__dshEnterprisePluginProbe = probe
  const ctx = await runtimeContext()
  const v1 = pluginPackage('1.0.0')
  const v2 = pluginPackage('1.1.0', 'export const name = \'failing-replacement\'; export function apply() { throw new Error(\'replacement failed\') }')
  let releaseId = 'v1'
  let permissionRevision = 1
  let enabled = true
  let lease = 0
  const rollbackBodies: unknown[] = []
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device',
    request: async (path, _signal, init = {}) => {
      if (path === 'plugins/catalog') return [
        { id: 'v1', pluginId: 'runtime.probe', version: '1.0.0', digest: digest(v1), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 },
        { id: 'v2', pluginId: 'runtime.probe', version: '1.1.0', digest: digest(v2), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 },
      ]
      if (path === 'plugins/installations') return enabled ? [{ id: 'installation', releaseId, ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() }] : []
      if (path.endsWith('/upgrade')) {
        rollbackBodies.push(typeof init.body === 'string' ? JSON.parse(init.body) as unknown : null)
        releaseId = 'v1'
        permissionRevision += 1
        return { permissionRevision }
      }
      if (path.endsWith('/activate')) {
        lease += 1
        return { activationId: `00000000-0000-4000-8000-${String(lease).padStart(12, '0')}`, token: `token-${lease}` }
      }
      return {}
    },
    requestBytes: async path => path.includes('/v2/') ? v2 : v1,
  })

  await runtime.reconcile(new AbortController().signal)
  assert.equal((probe as typeof probe & { version: string }).version, '1.0.0')
  releaseId = 'v2'
  permissionRevision = 2
  await runtime.reconcile(new AbortController().signal)
  assert.equal((probe as typeof probe & { version: string }).version, '1.0.0')
  assert.equal(probe.mounts, 2)
  assert.equal(probe.disposes, 1)
  assert.deepEqual(rollbackBodies, [{ releaseId: 'v1', confirmPermissions: false, expectedReleaseId: 'v2', expectedPermissionRevision: 2 }])
  enabled = false
  await runtime.reconcile(new AbortController().signal)
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe')
})

void test('enterprise runtime handles browser mount fails', async () => {
  const probe = { mounts: 0, disposes: 0 }
  ;(globalThis as typeof globalThis & { __dshEnterprisePluginProbe: typeof probe }).__dshEnterprisePluginProbe = probe
  const ctx = await runtimeContext()
  const v1 = pluginPackage('1.0.0')
  const v2 = pluginPackage('1.1.0')
  let releaseId = 'v1'
  let permissionRevision = 1
  let enabled = true
  let lease = 0
  const rollbackBodies: unknown[] = []
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device',
    request: async (path, _signal, init = {}) => {
      if (path === 'plugins/catalog') return [
        { id: 'v1', pluginId: 'runtime.probe', version: '1.0.0', digest: digest(v1), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 },
        { id: 'v2', pluginId: 'runtime.probe', version: '1.1.0', digest: digest(v2), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 },
      ]
      if (path === 'plugins/installations') return enabled ? [{ id: 'installation', releaseId, ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() }] : []
      if (path.endsWith('/upgrade')) {
        rollbackBodies.push(typeof init.body === 'string' ? JSON.parse(init.body) as unknown : null)
        releaseId = 'v1'
        permissionRevision += 1
        return { permissionRevision }
      }
      if (path.endsWith('/activate')) {
        lease += 1
        return { activationId: `00000000-0000-4000-8000-${String(lease).padStart(12, '0')}`, token: `token-${lease}` }
      }
      return {}
    },
    requestBytes: async path => path.includes('/v2/') ? v2 : v1,
  })

  await runtime.reconcile(new AbortController().signal)
  assert.equal((probe as typeof probe & { version: string }).version, '1.0.0')
  releaseId = 'v2'
  permissionRevision = 2
  await runtime.reconcile(new AbortController().signal)
  const client = runtime.clientTargets()[0]
  assert.ok(client)
  await runtime.reportClientWindow(client.activationId, 'main', 'failed', 'Client bundle failed', new AbortController().signal, client.moduleId)
  assert.equal((probe as typeof probe & { version: string }).version, '1.0.0')
  assert.equal(probe.mounts, 3)
  assert.equal(probe.disposes, 2)
  assert.deepEqual(rollbackBodies, [{ releaseId: 'v1', confirmPermissions: false, expectedReleaseId: 'v2', expectedPermissionRevision: 2 }])
  enabled = false
  await runtime.reconcile(new AbortController().signal)
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe')
})

void test('enterprise runtime handles rollback revision is rejected', async () => {
  const probe = { mounts: 0, disposes: 0 }
  ;(globalThis as typeof globalThis & { __dshEnterprisePluginProbe: typeof probe }).__dshEnterprisePluginProbe = probe
  const ctx = await runtimeContext()
  const v1 = pluginPackage('1.0.0')
  const v2 = pluginPackage('1.1.0')
  let releaseId = 'v1'
  let permissionRevision = 1
  let enabled = true
  let lease = 0
  const rollbackBodies: unknown[] = []
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device',
    request: async (path, _signal, init = {}) => {
      if (path === 'plugins/catalog') return [
        { id: 'v1', pluginId: 'runtime.probe', version: '1.0.0', digest: digest(v1), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 },
        { id: 'v2', pluginId: 'runtime.probe', version: '1.1.0', digest: digest(v2), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 },
      ]
      if (path === 'plugins/installations') return enabled ? [{ id: 'installation', releaseId, ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() }] : []
      if (path.endsWith('/upgrade')) {
        rollbackBodies.push(typeof init.body === 'string' ? JSON.parse(init.body) as unknown : null)
        throw new Error('plugin/revision-conflict')
      }
      if (path.endsWith('/activate')) {
        lease += 1
        return { activationId: `00000000-0000-4000-8000-${String(lease).padStart(12, '0')}`, token: `token-${lease}` }
      }
      return {}
    },
    requestBytes: async path => path.includes('/v2/') ? v2 : v1,
  })

  await runtime.reconcile(new AbortController().signal)
  assert.equal((probe as typeof probe & { version: string }).version, '1.0.0')
  releaseId = 'v2'
  permissionRevision = 2
  await runtime.reconcile(new AbortController().signal)
  const client = runtime.clientTargets()[0]
  assert.ok(client)
  await runtime.reportClientWindow(client.activationId, 'main', 'failed', 'Client bundle failed', new AbortController().signal, client.moduleId)
  assert.equal(runtime.clientTargets().length, 0)
  assert.equal(probe.mounts, 2)
  assert.equal(probe.disposes, 2)
  assert.deepEqual(rollbackBodies, [{ releaseId: 'v1', confirmPermissions: false, expectedReleaseId: 'v2', expectedPermissionRevision: 2 }])
  enabled = false
  await runtime.reconcile(new AbortController().signal)
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe')
})

void test('enterprise runtime handles committed browser upgrade later fails', async () => {
  const probe = { mounts: 0, disposes: 0 }
  ;(globalThis as typeof globalThis & { __dshEnterprisePluginProbe: typeof probe }).__dshEnterprisePluginProbe = probe
  const ctx = await runtimeContext()
  const v1 = pluginPackage('1.0.0')
  const v2 = pluginPackage('1.1.0')
  let releaseId = 'v1'
  let permissionRevision = 1
  let enabled = true
  let lease = 0
  const rollbackBodies: unknown[] = []
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device',
    request: async (path, _signal, init = {}) => {
      if (path === 'plugins/catalog') return [
        { id: 'v1', pluginId: 'runtime.probe', version: '1.0.0', digest: digest(v1), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 },
        { id: 'v2', pluginId: 'runtime.probe', version: '1.1.0', digest: digest(v2), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 },
      ]
      if (path === 'plugins/installations') return enabled ? [{ id: 'installation', releaseId, ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() }] : []
      if (path.endsWith('/upgrade')) {
        rollbackBodies.push(typeof init.body === 'string' ? JSON.parse(init.body) as unknown : null)
        releaseId = 'v1'
        permissionRevision += 1
        return { permissionRevision }
      }
      if (path.endsWith('/activate')) {
        lease += 1
        return { activationId: `00000000-0000-4000-8000-${String(lease).padStart(12, '0')}`, token: `token-${lease}` }
      }
      return {}
    },
    requestBytes: async path => path.includes('/v2/') ? v2 : v1,
  })

  await runtime.reconcile(new AbortController().signal)
  assert.equal((probe as typeof probe & { version: string }).version, '1.0.0')
  releaseId = 'v2'
  permissionRevision = 2
  await runtime.reconcile(new AbortController().signal)
  const client = runtime.clientTargets()[0]
  assert.ok(client)
  await runtime.reportClientWindow(client.activationId, 'main', 'active', null, new AbortController().signal, client.moduleId)
  await runtime.reportClientWindow(client.activationId, 'main', 'failed', 'Client bundle failed', new AbortController().signal, client.moduleId)
  assert.equal((probe as typeof probe & { version: string }).version, '1.1.0')
  assert.equal(probe.mounts, 2)
  assert.equal(probe.disposes, 1)
  assert.deepEqual(rollbackBodies, [])
  enabled = false
  await runtime.reconcile(new AbortController().signal)
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe')
})

void test('enterprise runtime reports a failed Client mount and does not heartbeat a disconnect', async () => {
  const ctx = await runtimeContext()
  const archive = pluginPackage('1.0.0', 'export function apply() {}')
  const requests: Array<{ path: string; body: unknown }> = []
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device',
    request: async (path, _signal, init = {}) => {
      requests.push({ path, body: typeof init.body === 'string' ? JSON.parse(init.body) as unknown : null })
      if (path === 'plugins/catalog') return [{ id: 'release', pluginId: 'runtime.probe', version: '1.0.0', digest: digest(archive), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 }]
      if (path === 'plugins/installations') return [{ id: 'installation', releaseId: 'release', ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision: 1, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() }]
      if (path.endsWith('/activate')) {
        const targetKind = JSON.parse((init.body as string)) as { targetKind?: string }
        return { activationId: targetKind.targetKind === 'client' ? '00000000-0000-4000-8000-000000000002' : '00000000-0000-4000-8000-000000000001', token: 'token' }
      }
      return {}
    },
    requestBytes: async () => archive,
  })

  await runtime.reconcile(new AbortController().signal)
  const clientActivationId = runtime.clientTargets()[0]?.activationId
  assert.ok(clientActivationId)
  await runtime.reportClientWindow(clientActivationId, 'window-test', 'failed', 'broken bundle', new AbortController().signal)
  await runtime.reportClientWindow(clientActivationId, 'window-test', 'disconnected', null, new AbortController().signal)
  assert.ok(requests.some(request => request.path.endsWith('/heartbeat')
    && JSON.stringify(request.body) === JSON.stringify({
      activationId: clientActivationId, targetKind: 'client', observedState: 'failed', error: 'broken bundle',
    })))
  assert.equal(requests.filter(request => request.path.endsWith('/heartbeat')
    && (request.body as { activationId?: string }).activationId === clientActivationId).length, 1)
  await runtime.dispose()
  await ctx.fiber.dispose()
})

void test('enterprise runtime bounds a stalled Client window close during interruption', async (t) => {
  const probe = { mounts: 0, disposes: 0 }
  ;(globalThis as typeof globalThis & { __dshEnterprisePluginProbe: typeof probe }).__dshEnterprisePluginProbe = probe
  const ctx = await runtimeContext()
  const archive = pluginPackage('1.0.0')
  t.after(() => ctx.fiber.dispose())
  t.after(() => { Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe') })
  let releaseClose!: () => void
  const closeBarrier = new Promise<void>((resolve) => { releaseClose = resolve })
  t.after(() => { releaseClose() })
  let enabled = true
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device', cleanupTimeoutMs: 5,
    windowPlatform: { create: () => {}, close: () => closeBarrier, focus: () => {} },
    request: async (path, _signal, init = {}) => {
      if (path === 'plugins/catalog') return [{ id: 'release', pluginId: 'runtime.probe', version: '1.0.0', digest: digest(archive), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 }]
      if (path === 'plugins/installations') return enabled ? [{ id: 'installation', releaseId: 'release', pluginId: 'runtime.probe', ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision: 1, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() }] : []
      if (path.endsWith('/activate')) return { activationId: '00000000-0000-4000-8000-000000000001', token: 'token' }
      void init
      return {}
    },
    requestBytes: async () => archive,
  })

  await runtime.reconcile(new AbortController().signal)
  await runtime.clientWindows.open('runtime.probe', 'inspector', {})
  enabled = false
  const started = Date.now()
  await runtime.reconcile(new AbortController().signal)
  assert.ok(Date.now() - started < 500)
  assert.equal(runtime.clientTargets().length, 0)
  releaseClose()
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe')
})

void test('enterprise runtime disposes a target when active heartbeat fails before retrying', async () => {
  const probe = { mounts: 0, disposes: 0 }
  ;(globalThis as typeof globalThis & { __dshEnterprisePluginProbe: typeof probe }).__dshEnterprisePluginProbe = probe
  const ctx = await runtimeContext()
  const archive = pluginPackage('1.0.0')
  let failActiveHeartbeat = true
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device',
    request: async (path, _signal, init = {}) => {
      if (path === 'plugins/catalog') return [{ id: 'release', pluginId: 'runtime.probe', version: '1.0.0', digest: digest(archive), targets: ['host'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 }]
      if (path === 'plugins/installations') return [{ id: 'installation', releaseId: 'release', ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision: 1, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() }]
      if (path.endsWith('/activate')) return { activationId: '00000000-0000-4000-8000-000000000001', token: 'token' }
      if (path.endsWith('/heartbeat') && (JSON.parse((init.body as string)) as { observedState: string }).observedState === 'active' && failActiveHeartbeat) {
        failActiveHeartbeat = false
        throw new Error('heartbeat unavailable')
      }
      return {}
    },
    requestBytes: async () => archive,
  })

  await runtime.reconcile(new AbortController().signal)
  assert.equal(probe.mounts, 1)
  assert.equal(probe.disposes, 1)
  await runtime.reconcile(new AbortController().signal)
  assert.equal(probe.mounts, 2)
  assert.equal(probe.disposes, 1)
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe')
})

void test('enterprise runtime reactivates when the server rotates a same-version lease', async () => {
  const probe = { mounts: 0, disposes: 0 }
  ;(globalThis as typeof globalThis & { __dshEnterprisePluginProbe: typeof probe }).__dshEnterprisePluginProbe = probe
  const ctx = await runtimeContext()
  const archive = pluginPackage('1.0.0')
  let activationCount = 0
  let serverActivationId: string | null = null
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device',
    request: async (path) => {
      if (path === 'plugins/catalog') return [{ id: 'release', pluginId: 'runtime.probe', version: '1.0.0', digest: digest(archive), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 }]
      if (path === 'plugins/installations') return [{ id: 'installation', releaseId: 'release', ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision: 1, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() }]
      if (path === 'plugins/device-targets') return ['host', 'client'].map(targetKind => ({
        installationId: 'installation', pluginId: 'runtime.probe', releaseId: 'release', version: '1.0.0', targetKind,
        desiredState: 'enabled', observedState: 'active', permissionRevision: 1, activationId: serverActivationId,
      }))
      if (path.endsWith('/activate')) {
        activationCount += 1
        serverActivationId = `00000000-0000-4000-8000-${String(activationCount).padStart(12, '0')}`
        return { activationId: serverActivationId, token: 'token' }
      }
      return {}
    },
    requestBytes: async () => archive,
  })

  await runtime.reconcile(new AbortController().signal)
  assert.equal(probe.mounts, 1)
  assert.equal(runtime.clientTargets().length, 1)
  serverActivationId = '00000000-0000-4000-8000-000000000099'
  await runtime.reconcile(new AbortController().signal)
  assert.equal(activationCount, 4)
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe')
})

void test('enterprise runtime converges a server target without a local contribution', async () => {
  const ctx = await runtimeContext()
  const archive = pluginPackage('1.0.0')
  const requests: string[] = []
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device',
    request: async (path, _signal, init = {}) => {
      requests.push(`${init.method ?? 'GET'} ${path}`)
      if (path === 'plugins/catalog') return []
      if (path === 'plugins/installations') return [{
        id: 'installation', releaseId: 'release', pluginId: 'runtime.probe', ownerKind: 'personal', dataSpaceId: 'space',
        enabled: false, desiredState: 'disabled', observedState: 'stopping', permissionRevision: 1,
        config: {}, targetState: {}, updatedAt: new Date(0).toISOString(),
      }]
      if (path === 'plugins/device-targets') return [{
        installationId: 'installation', pluginId: 'runtime.probe', releaseId: 'release', version: '1.0.0', targetKind: 'host',
        desiredState: 'disabled', observedState: 'stopping', permissionRevision: 1, activationId: null,
      }]
      return {}
    },
    requestBytes: async () => archive,
  })

  await runtime.reconcile(new AbortController().signal)
  assert.ok(requests.includes('POST plugins/installations/installation/deactivate'))
  await runtime.dispose()
  await ctx.fiber.dispose()
})

void test('enterprise runtime completes uninstall when the device-target directory is unavailable', async () => {
  const ctx = await runtimeContext()
  const requests: string[] = []
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device',
    request: async (path, _signal, init = {}) => {
      requests.push(`${init.method ?? 'GET'} ${path}`)
      if (path === 'plugins/catalog') return []
      if (path === 'plugins/installations') return [{
        id: 'installation', releaseId: 'release', pluginId: 'runtime.probe', ownerKind: 'personal', dataSpaceId: 'space',
        enabled: false, desiredState: 'uninstalled', observedState: 'stopping', permissionRevision: 1,
        config: {}, targetState: {}, updatedAt: new Date(0).toISOString(),
      }]
      if (path === 'plugins/device-targets') throw new Error('device target directory unavailable')
      return {}
    },
    requestBytes: async () => { throw new Error('Unexpected package request') },
  })

  await runtime.reconcile(new AbortController().signal)
  assert.ok(requests.includes('POST plugins/installations/installation/uninstall/complete'))
  await runtime.dispose()
  await ctx.fiber.dispose()
})

void test('enterprise runtime automatically retries when lease revocation stalls', async () => {
  const probe = { mounts: 0, disposes: 0 }
  ;(globalThis as typeof globalThis & { __dshEnterprisePluginProbe: typeof probe }).__dshEnterprisePluginProbe = probe
  const ctx = await runtimeContext()
  const archive = pluginPackage('1.0.0')
  let enabled = true
  let uninstalled = false
  let revokeCalls = 0
  let completionCalls = 0
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device', cleanupTimeoutMs: 5,
    request: async (path) => {
      if (path === 'plugins/catalog') return [{ id: 'release', pluginId: 'runtime.probe', version: '1.0.0', digest: digest(archive), targets: ['host'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 }]
      if (path === 'plugins/installations') return uninstalled ? [{ id: 'installation', releaseId: 'release', ownerKind: 'personal', dataSpaceId: 'space', enabled: false, desiredState: 'uninstalled', observedState: 'stopping', permissionRevision: 1, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() }] : enabled ? [{ id: 'installation', releaseId: 'release', ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision: 1, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() }] : []
      if (path.endsWith('/activate')) return { activationId: '00000000-0000-4000-8000-000000000001', token: 'token' }
      if (path.endsWith('/deactivate')) {
        revokeCalls += 1
        if (revokeCalls === 1) await new Promise<void>(() => {})
      }
      if (path.endsWith('/uninstall/complete')) completionCalls += 1
      return {}
    },
    requestBytes: async () => archive,
  })

  await runtime.reconcile(new AbortController().signal)
  enabled = false
  uninstalled = true
  await runtime.reconcile(new AbortController().signal)
  assert.equal(probe.disposes, 1)
  await waitFor(() => completionCalls === 1)
  assert.ok(revokeCalls >= 2)
  assert.equal(completionCalls, 1)
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe')
})

void test('enterprise runtime stops independent targets in parallel when one cleanup stalls', async () => {
  const probe = { mounts: 0, disposes: 0 }
  ;(globalThis as typeof globalThis & { __dshEnterprisePluginProbe: typeof probe }).__dshEnterprisePluginProbe = probe
  const ctx = await runtimeContext()
  const archive = pluginPackage('1.0.0')
  let enabled = true
  let releaseStalledRevoke: (() => void) | undefined
  const stalledRevoke = new Promise<void>((resolve) => { releaseStalledRevoke = resolve })
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device', cleanupTimeoutMs: 10,
    request: async (path, _signal, init = {}) => {
      if (path === 'plugins/catalog') return [{ id: 'release', pluginId: 'runtime.probe', version: '1.0.0', digest: digest(archive), targets: ['host'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 }]
      if (path === 'plugins/installations') return enabled ? [
        { id: 'stalled', releaseId: 'release', pluginId: 'runtime.probe', ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision: 1, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() },
        { id: 'healthy', releaseId: 'release', pluginId: 'runtime.probe', ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision: 1, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() },
      ] : []
      if (path.endsWith('/activate')) return { activationId: `00000000-0000-4000-8000-${path.includes('/stalled/') ? '000000000041' : '000000000042'}`, token: 'token' }
      if (path.endsWith('/deactivate')) {
        const body = JSON.parse((init.body as string)) as { targetKind: string }
        if (body.targetKind === 'host' && path.includes('/stalled/')) await stalledRevoke
      }
      return {}
    },
    requestBytes: async () => archive,
  })

  await runtime.reconcile(new AbortController().signal)
  enabled = false
  const started = Date.now()
  await runtime.reconcile(new AbortController().signal)
  assert.ok(Date.now() - started < 500)
  releaseStalledRevoke?.()
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe')
})

void test('enterprise runtime bounds failed-start lease cleanup independently', async () => {
  const probe = { mounts: 0, disposes: 0 }
  ;(globalThis as typeof globalThis & { __dshEnterprisePluginProbe: typeof probe }).__dshEnterprisePluginProbe = probe
  const ctx = await runtimeContext()
  const healthyArchive = pluginPackage('1.0.0')
  const failingArchive = pluginPackage('1.0.0', `
    export const name = 'runtime-probe-failing-host'
    export function apply() { throw new Error('mount failed') }
  `)
  let stalled = true
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device', cleanupTimeoutMs: 10,
    request: async (path, _signal, init = {}) => {
      if (path === 'plugins/catalog') return [
        { id: 'release-failing', pluginId: 'runtime.probe', version: '1.0.0', digest: digest(failingArchive), targets: ['host'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 },
        { id: 'release-healthy', pluginId: 'runtime.probe', version: '1.0.0', digest: digest(healthyArchive), targets: ['host'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 },
      ]
      if (path === 'plugins/installations') return [
        { id: 'failing', releaseId: 'release-failing', pluginId: 'runtime.probe', ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision: 1, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() },
        { id: 'healthy', releaseId: 'release-healthy', pluginId: 'runtime.probe', ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision: 1, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() },
      ]
      if (path === 'plugins/device-targets') return []
      if (path.endsWith('/activate')) return { activationId: `00000000-0000-4000-8000-${path.includes('/failing/') ? '000000000041' : '000000000042'}`, token: 'token' }
      if (path.endsWith('/deactivate') && path.includes('/failing/') && (JSON.parse((init.body as string)) as { targetKind: string }).targetKind === 'host' && stalled) {
        stalled = false
        await new Promise<void>(() => {})
      }
      return {}
    },
    requestBytes: async path => path.includes('release-failing') ? failingArchive : healthyArchive,
  })

  const started = Date.now()
  await runtime.reconcile(new AbortController().signal)
  assert.ok(Date.now() - started < 500)
  assert.equal(probe.mounts, 1)
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe')
})

void test('enterprise runtime times out one pending Host activation while another plugin starts', async () => {
  const probe = { mounts: 0, disposes: 0 }
  ;(globalThis as typeof globalThis & { __dshEnterprisePluginProbe: typeof probe }).__dshEnterprisePluginProbe = probe
  const ctx = await runtimeContext()
  let releaseStalledActivation: (() => void) | undefined
  const stalledActivation = new Promise<void>((resolve) => { releaseStalledActivation = resolve })
  ;(globalThis as typeof globalThis & { __dshEnterpriseStalledActivation: () => Promise<void> }).__dshEnterpriseStalledActivation =
    () => stalledActivation
  const stalledArchive = pluginPackage('1.0.0', `
    export const name = 'runtime-stalled-host'
    export async function apply() { await globalThis.__dshEnterpriseStalledActivation() }
  `, 'runtime.stalled')
  const healthyArchive = pluginPackage('1.0.0', undefined, 'runtime.healthy')
  const heartbeats: unknown[] = []
  let lease = 0
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device', activationTimeoutMs: 500,
    request: async (path, _signal, init = {}) => {
      if (path === 'plugins/catalog') return [
        { id: 'release-stalled', pluginId: 'runtime.stalled', version: '1.0.0', digest: digest(stalledArchive), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 },
        { id: 'release-healthy', pluginId: 'runtime.healthy', version: '1.0.0', digest: digest(healthyArchive), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 },
      ]
      if (path === 'plugins/installations') return [
        { id: 'stalled', releaseId: 'release-stalled', pluginId: 'runtime.stalled', ownerKind: 'personal', dataSpaceId: 'space-stalled', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision: 1, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() },
        { id: 'healthy', releaseId: 'release-healthy', pluginId: 'runtime.healthy', ownerKind: 'personal', dataSpaceId: 'space-healthy', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision: 1, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() },
      ]
      if (path === 'plugins/device-targets') return []
      if (path.endsWith('/activate')) {
        lease += 1
        return { activationId: `00000000-0000-4000-8000-${String(lease).padStart(12, '0')}`, token: `token-${String(lease)}` }
      }
      if (path.endsWith('/heartbeat')) heartbeats.push(JSON.parse((init.body as string)))
      return {}
    },
    requestBytes: async path => path.includes('release-stalled') ? stalledArchive : healthyArchive,
  })

  const started = Date.now()
  await runtime.reconcile(new AbortController().signal)
  assert.ok(Date.now() - started < 1_000)
  assert.equal(probe.mounts, 1)
  assert.ok(heartbeats.some(value => (value as { observedState?: string }).observedState === 'failed'))
  releaseStalledActivation?.()
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe')
  Reflect.deleteProperty(globalThis, '__dshEnterpriseStalledActivation')
})

void test('enterprise runtime revokes a lease when reconciliation supersedes activation', async () => {
  const ctx = await runtimeContext()
  let releaseActivation: (() => void) | undefined
  const pendingActivation = new Promise<void>((resolve) => { releaseActivation = resolve })
  const archive = pluginPackage('1.0.0', `
    export const name = 'runtime-superseded-host'
    export async function apply() { await globalThis.__dshSupersededHostActivation() }
  `, 'runtime.superseded')
  ;(globalThis as typeof globalThis & { __dshSupersededHostActivation: () => Promise<void> }).__dshSupersededHostActivation =
    () => pendingActivation
  let enabled = true
  let activationCount = 0
  let deactivationCount = 0
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device',
    request: async (path, signal, init = {}) => {
      if (path === 'plugins/catalog') return [{ id: 'release', pluginId: 'runtime.superseded', version: '1.0.0', digest: digest(archive), targets: ['host', 'client'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 }]
      if (path === 'plugins/installations') return enabled ? [{ id: 'installation', releaseId: 'release', pluginId: 'runtime.superseded', ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision: 1, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() }] : []
      if (path === 'plugins/device-targets') return []
      if (path.endsWith('/activate')) {
        activationCount += 1
        return { activationId: `00000000-0000-4000-8000-${String(activationCount).padStart(12, '0')}`, token: 'token' }
      }
      if (path.endsWith('/deactivate')) {
        if (signal.aborted) throw new Error('cleanup request was aborted')
        deactivationCount += 1
      }
      void init
      return {}
    },
    requestBytes: async () => archive,
  })

  const first = runtime.reconcile(new AbortController().signal)
  await waitFor(() => activationCount > 0)
  enabled = false
  await runtime.reconcile(new AbortController().signal)
  await first
  assert.ok(deactivationCount >= 1)
  releaseActivation?.()
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshSupersededHostActivation')
})

void test('OAuth connection replaces a saved Token auth mode while retaining other installation settings', async (t) => {
  const ctx = await runtimeContext()
  t.after(() => ctx.fiber.dispose())
  const entries = unzipSync(pluginPackage('1.0.0'))
  const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as Record<string, unknown>
  manifest.permissions = ['authorization.oauth', 'credentials.read', 'credentials.write', 'mcp.connect']
  manifest.contributions = { mcpConnection: { auth: 'oauth', url: 'https://fixture.example/mcp' } }
  entries['manifest.json'] = encoder.encode(JSON.stringify(manifest))
  const integrity = Object.fromEntries(Object.entries(entries).filter(([path]) => path !== 'integrity.json').map(([path, bytes]) => [path, digest(bytes)]))
  const archive = zipSync({ ...entries, 'integrity.json': strToU8(JSON.stringify(integrity)) })
  let config: Record<string, unknown> = {
    auth: 'header', headerName: 'OLD_TOKEN_HEADER', toolCallTimeoutMs: 42000, mcpUrl: 'https://obsolete.example/mcp',
  }
  let enabled = true
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device',
    request: async (path, _signal, init = {}) => {
      if (path === 'plugins/catalog') return [{ id: 'release', pluginId: 'runtime.probe', version: '1.0.0', digest: digest(archive) }]
      if (path === 'plugins/installations') return [{ id: 'installation', releaseId: 'release', desiredState: enabled ? 'enabled' : 'disabled', enabled, permissionRevision: 1, config }]
      if (path === 'plugins/installations/installation' && init.method === 'PATCH') {
        assert.equal(typeof init.body, 'string')
        const patch = JSON.parse(init.body as string) as { enabled: boolean; config: Record<string, unknown> }
        config = patch.config; enabled = patch.enabled
        return {}
      }
      if (path === 'plugins/device-targets') return []
      throw new Error(`Unexpected request ${path}`)
    },
    requestBytes: async () => archive,
  })
  t.after(() => runtime.dispose())
  await runtime.configureConnection({ installationId: 'installation' }, new AbortController().signal)
  assert.deepEqual(config, {
    auth: 'oauth', headerName: 'OLD_TOKEN_HEADER', toolCallTimeoutMs: 42000, mcpUrl: 'https://fixture.example/mcp',
  })
  assert.equal(enabled, false)
})

void test('ordinary plugin setup validates inputs, authorizes writes and isolates secrets from API payloads', async (t) => {
  const ctx = await runtimeContext()
  t.after(() => ctx.fiber.dispose())
  const home = await mkdtemp(join(tmpdir(), 'plugin-settings-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  const entries = unzipSync(pluginPackage('1.0.0'))
  const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as Record<string, unknown>
  manifest.permissions = ['credentials.read', 'credentials.write']
  manifest.credentialDescriptors = [{ name: 'app-secret', kind: 'secret', label: 'App Secret' }]
  manifest.contributions = { configuration: { fields: [
    { name: 'baseUrl', label: 'Server URL', type: 'url', required: true, network: true },
    { name: 'limit', label: 'Limit', type: 'number', integer: true, min: 1, max: 50, default: 10 },
  ] } }
  entries['manifest.json'] = encoder.encode(JSON.stringify(manifest))
  const integrity = Object.fromEntries(Object.entries(entries).filter(([path]) => path !== 'integrity.json').map(([path, bytes]) => [path, digest(bytes)]))
  let archive = zipSync({ ...entries, 'integrity.json': strToU8(JSON.stringify(integrity)) })
  let config: Record<string, unknown> = { pluginOwned: 'retain' }
  let enabled = false
  let deny = false
  const patches: unknown[] = []
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device',
    request: async (path, _signal, init = {}) => {
      if (path === 'plugins/catalog') return [{ id: 'release', pluginId: 'runtime.probe', version: '1.0.0', digest: digest(archive) }]
      if (path === 'plugins/installations') return [{ id: 'installation', releaseId: 'release', desiredState: enabled ? 'enabled' : 'disabled', enabled, permissionRevision: 1, config }]
      if (path === 'plugins/installations/installation' && init.method === 'PATCH') {
        if (deny) throw new Error('forbidden')
        assert.equal(typeof init.body, 'string')
        const patch = JSON.parse(init.body as string) as { enabled: boolean; config?: Record<string, unknown> }
        patches.push(patch)
        if (patch.config) config = patch.config
        enabled = patch.enabled
        return {}
      }
      if (path === 'plugins/device-targets') return []
      throw new Error(`Unexpected request ${path}`)
    }, requestBytes: async () => archive,
  })
  t.after(() => runtime.dispose())
  const signal = new AbortController().signal
  const input = { installationId: 'installation', config: { baseUrl: 'https://knowledge.example/api' }, credentials: { 'app-secret': 'PRIVATE_SETTINGS_SECRET' } }
  assert.deepEqual((await runtime.settings('installation', signal)).credentials, [{ name: 'app-secret', label: 'App Secret', configured: false }])
  await assert.rejects(runtime.configureSettings({ ...input, config: { baseUrl: 'file:///etc/passwd' } }, signal), /not-configured: Server URL/)
  await assert.rejects(runtime.configureSettings({ ...input, config: { ...input.config, limit: 51 } }, signal), /not-configured: Limit/)
  await assert.rejects(runtime.configureSettings({ ...input, config: { injected: 'unexpected' } }, signal), /undeclared-setting/)
  await assert.rejects(runtime.configureSettings({ ...input, credentials: { undeclared: 'secret' } }, signal), /undeclared-setting/)
  await assert.rejects(runtime.configureSettings({ ...input, credentials: {} }, signal), /not-configured: App Secret/)
  await assert.rejects(runtime.configureSettings({ ...input, installationId: 'other' }, signal), /installation-unavailable/)
  assert.equal(patches.length, 0)
  const authorizedArchive = archive
  manifest.permissions = ['credentials.read']
  entries['manifest.json'] = encoder.encode(JSON.stringify(manifest))
  archive = zipSync({ ...entries, 'integrity.json': strToU8(JSON.stringify(Object.fromEntries(Object.entries(entries).filter(([path]) => path !== 'integrity.json').map(([path, bytes]) => [path, digest(bytes)])))) })
  await assert.rejects(runtime.configureSettings(input, signal), /unsupported-capability/)
  assert.equal(patches.length, 0)
  archive = authorizedArchive
  deny = true
  await assert.rejects(runtime.configureSettings(input, signal), /forbidden/)
  assert.equal((await runtime.settings('installation', signal)).credentials[0]?.configured, false)
  deny = false
  await runtime.configureSettings(input, signal)
  assert.equal(enabled, true)
  assert.deepEqual(config, { pluginOwned: 'retain', baseUrl: 'https://knowledge.example/api', limit: 10 })
  const settings = await runtime.settings('installation', signal)
  assert.deepEqual(settings.config, { baseUrl: 'https://knowledge.example/api', limit: 10 })
  assert.equal(settings.credentials[0]?.configured, true)
  assert.ok(!JSON.stringify({ settings, patches }).includes('PRIVATE_SETTINGS_SECRET'))
  const key = marketCredentialKey({ organizationId: 'organization', installationId: 'installation' }, 'app-secret')
  const savedCredential = await ctx.credentials.readRecord(key)
  assert.equal(savedCredential?.kind, 'grant')
  assert.deepEqual(savedCredential.payload, { name: 'app-secret', value: 'PRIVATE_SETTINGS_SECRET' })
  assert.equal(await ctx.credentials.readRecord(marketCredentialKey({ organizationId: 'organization', installationId: 'other' }, 'app-secret')), undefined)
  await runtime.configureSettings({ ...input, config: { limit: 20 }, credentials: {} }, signal)
  assert.equal(config.limit, 20)
  const retainedCredential = await ctx.credentials.readRecord(key)
  assert.equal(retainedCredential?.kind, 'grant')
  assert.deepEqual(retainedCredential.payload, { name: 'app-secret', value: 'PRIVATE_SETTINGS_SECRET' })
})

void test('configuration metadata rejects duplicate names and invalid network declarations', () => {
  const field = { name: 'endpoint', label: 'Endpoint', type: 'url', required: true }
  assert.equal(pluginConfiguration.safeParse({ fields: [field, field] }).success, false)
  assert.equal(pluginConfiguration.safeParse({ fields: [{ ...field, type: 'string', network: true }] }).success, false)
  assert.equal(pluginConfiguration.safeParse({ fields: [{ ...field, min: 5, max: 1 }] }).success, false)
  const specification = pluginConfiguration.parse({ fields: [field, { name: 'secure', label: 'TLS', type: 'boolean', default: true }, { name: 'roster', label: 'Roster', type: 'string-list' }] })
  assert.deepEqual(resolvePluginConfiguration(specification, { endpoint: 'https://example.com', roster: ['Alice'] }), { endpoint: 'https://example.com', secure: true, roster: ['Alice'] })
  assert.throws(() => resolvePluginConfiguration(specification, { endpoint: '' }), /not-configured: Endpoint/)
  assert.throws(() => resolvePluginConfiguration(specification, { endpoint: 'https://example.com', secure: 'true' }), /not-configured: TLS/)
  assert.throws(() => resolvePluginConfiguration(specification, { endpoint: 'https://example.com', roster: [''] }), /not-configured: Roster/)
})
