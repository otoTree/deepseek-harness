import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { strToU8, zipSync } from 'fflate'
import { EnterprisePluginRuntime } from '../src/plugin-runtime.ts'

const encoder = new TextEncoder()
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

function pluginPackage(version: string): Uint8Array {
  const manifest = {
    schemaVersion: 1, pluginId: 'runtime.probe', name: 'Runtime probe', version,
    targets: [
      { kind: 'host', entry: 'host/index.js', compatibility: 'dsh-host>=1', contributions: ['host:probe'] },
      { kind: 'client', entry: 'client/index.js', compatibility: 'dsh-client>=1', contributions: ['client:probe'] },
    ],
    permissions: [], resources: [], migrations: [], contributions: [], dependencies: {},
    build: { runtime: 'node22', lockfileDigest: '0'.repeat(64) },
  }
  const manifestBytes = encoder.encode(`${JSON.stringify(manifest)}\n`)
  const host = encoder.encode(`
    export const name = 'runtime-probe-host'
    export function apply(ctx) {
      const probe = globalThis.__dshEnterprisePluginProbe
      probe.mounts += 1
      ctx.effect(() => () => { probe.disposes += 1 })
    }
  `)
  const client = encoder.encode("export const name = 'runtime-probe-client'; export function apply() {}\n")
  const entries = { 'manifest.json': manifestBytes, 'host/index.js': host, 'client/index.js': client }
  const integrity = Object.fromEntries(Object.entries(entries).map(([path, bytes]) => [path, digest(bytes)]))
  return zipSync({ ...entries, 'integrity.json': strToU8(`${JSON.stringify(integrity)}\n`) }, { level: 9 })
}

void test('enterprise runtime loads, upgrades, and removes real ZIP targets', async () => {
  const probe = { mounts: 0, disposes: 0 }
  ;(globalThis as typeof globalThis & { __dshEnterprisePluginProbe: typeof probe }).__dshEnterprisePluginProbe = probe
  const ctx = new Context()
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
  assert.equal(probe.disposes, 0)
  assert.equal(runtime.clientTargets().length, 1)
  const activeHeartbeat = requests.find(request => request.path.endsWith('/heartbeat'))
  assert.deepEqual(activeHeartbeat?.body, {
    activationId: '00000000-0000-4000-8000-000000000001', targetKind: 'host', observedState: 'active', error: null,
  })

  permissionRevision = 2
  await runtime.reconcile(new AbortController().signal)
  assert.equal(probe.mounts, 2)
  assert.equal(probe.disposes, 1)

  releaseId = 'release-v2'
  await runtime.reconcile(new AbortController().signal)
  assert.equal(probe.mounts, 3)
  assert.equal(probe.disposes, 2)
  assert.equal(runtime.clientTargets()[0]?.version, '1.1.0')

  enabled = false
  await runtime.reconcile(new AbortController().signal)
  assert.equal(probe.disposes, 3)
  assert.equal(runtime.clientTargets().length, 0)
  assert.equal(requests.filter(request => request.path.endsWith('/deactivate')).length, 6)
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe')
})

void test('enterprise runtime disposes a target when active heartbeat fails before retrying', async () => {
  const probe = { mounts: 0, disposes: 0 }
  ;(globalThis as typeof globalThis & { __dshEnterprisePluginProbe: typeof probe }).__dshEnterprisePluginProbe = probe
  const ctx = new Context()
  const archive = pluginPackage('1.0.0')
  let failActiveHeartbeat = true
  const runtime = new EnterprisePluginRuntime({
    ctx, apiUrl: 'https://enterprise.example', organizationId: 'organization', deviceId: async () => 'device',
    request: async (path, _signal, init = {}) => {
      if (path === 'plugins/catalog') return [{ id: 'release', pluginId: 'runtime.probe', version: '1.0.0', digest: digest(archive), targets: ['host'], permissions: [], tools: [], status: 'published', publishedAt: new Date(0).toISOString(), policyRevision: 1 }]
      if (path === 'plugins/installations') return [{ id: 'installation', releaseId: 'release', ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'preparing', permissionRevision: 1, config: {}, targetState: {}, updatedAt: new Date(0).toISOString() }]
      if (path.endsWith('/activate')) return { activationId: '00000000-0000-4000-8000-000000000001', token: 'token' }
      if (path.endsWith('/heartbeat') && JSON.parse(String(init.body)).observedState === 'active' && failActiveHeartbeat) {
        failActiveHeartbeat = false
        throw new Error('heartbeat unavailable')
      }
      return {}
    },
    requestBytes: async () => archive,
  })

  await assert.rejects(runtime.reconcile(new AbortController().signal), /heartbeat unavailable/)
  assert.equal(probe.mounts, 1)
  assert.equal(probe.disposes, 1)
  await runtime.reconcile(new AbortController().signal)
  assert.equal(probe.mounts, 2)
  assert.equal(probe.disposes, 1)
  await runtime.dispose()
  await ctx.fiber.dispose()
  Reflect.deleteProperty(globalThis, '__dshEnterprisePluginProbe')
})

void test('enterprise runtime converges a server target without a local contribution', async () => {
  const ctx = new Context()
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
