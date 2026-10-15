import test from 'node:test'
import assert from 'node:assert/strict'
import { pluginManifest, resolvePluginTargets } from '../src/index.ts'

test('plugin manifest accepts bounded client/host resources and migrations', () => {
  const parsed = pluginManifest.parse({
    schemaVersion: 2,
    pluginId: 'demo.plugin',
    name: 'Demo',
    version: '1.0.0',
    targets: [{ kind: 'host', entry: 'host/index.js', compatibility: '1', contributions: [] }],
    permissions: ['identity.read'],
    resources: [{ kind: 'objects', quotaBytes: 1024 }],
    migrations: [{ version: 1, statements: ['create table notes(id text)'] }],
    build: { runtime: 'node22', lockfileDigest: 'a'.repeat(64) },
  })
  assert.equal(parsed.resources[0]?.kind, 'objects')
})

test('plugin manifest requires the module-table id for Client targets', () => {
  const base = {
    schemaVersion: 2,
    pluginId: 'demo.plugin',
    name: 'Demo',
    version: '1.0.0',
    permissions: [],
    resources: [],
    migrations: [],
    build: { runtime: 'node22', lockfileDigest: 'a'.repeat(64) },
  }
  assert.equal(pluginManifest.parse({
    ...base,
    targets: [{ kind: 'client', entry: 'client/index.js', moduleId: '@example/demo-plugin', compatibility: '1', contributions: [
      { kind: 'slot', id: 'settings', slot: 'settings.section', multiplicity: 'one' },
      { kind: 'window', id: 'inspector', surface: 'plugin-window', multiplicity: 'many', titleKey: 'window.inspector.title', shell: 'minimal', defaultBounds: { width: 960, height: 720 } },
    ] }],
  }).targets[0]?.kind, 'client')
  assert.throws(() => pluginManifest.parse({
    ...base,
    targets: [{ kind: 'client', entry: 'client/index.js', compatibility: '1', contributions: [] }],
  }))
})

test('plugin manifest rejects cloud targets', () => {
  assert.throws(() => pluginManifest.parse({
    schemaVersion: 2,
    pluginId: 'demo.plugin',
    name: 'Demo',
    version: '1.0.0',
    targets: [{ kind: 'cloud', entry: 'cloud/index.js', compatibility: '1', contributions: [] }],
    permissions: [], resources: [], migrations: [],
    build: { runtime: 'node22', lockfileDigest: 'a'.repeat(64) },
  }))
})

test('plugin manifest requires unique resources and increasing migrations', () => {
  assert.throws(() => pluginManifest.parse({
    schemaVersion: 2,
    pluginId: 'demo.plugin',
    name: 'Demo',
    version: '1.0.0',
    targets: [{ kind: 'host', entry: 'host/index.js', compatibility: '1', contributions: [] }],
    permissions: [], resources: [{ kind: 'cache' }, { kind: 'cache' }],
    migrations: [{ version: 2, statements: ['select 1'] }, { version: 1, statements: ['select 1'] }],
    build: { runtime: 'node22', lockfileDigest: 'a'.repeat(64) },
  }))
})

test('plugin manifest rejects permissions outside the runtime capability vocabulary', () => {
  assert.throws(() => pluginManifest.parse({
    schemaVersion: 2,
    pluginId: 'demo.plugin',
    name: 'Demo',
    version: '1.0.0',
    targets: [{ kind: 'host', entry: 'host/index.js', compatibility: '1', contributions: [] }],
    permissions: ['filesystem.read'],
    resources: [],
    migrations: [],
    build: { runtime: 'node22', lockfileDigest: 'a'.repeat(64) },
  }))
})

test('plugin manifest rejects duplicate permissions', () => {
  assert.throws(() => pluginManifest.parse({
    schemaVersion: 2,
    pluginId: 'demo.plugin',
    name: 'Demo',
    version: '1.0.0',
    targets: [{ kind: 'host', entry: 'host/index.js', compatibility: '1', contributions: [] }],
    permissions: ['identity.read', 'identity.read'],
    resources: [],
    migrations: [],
    build: { runtime: 'node22', lockfileDigest: 'a'.repeat(64) },
  }))
})

test('plugin manifest accepts Host network policy and credential descriptors', () => {
  const parsed = pluginManifest.parse({
    schemaVersion: 2,
    pluginId: 'work.plugin',
    name: 'Work',
    version: '1.0.0',
    targets: [{ kind: 'host', entry: 'host/index.js', compatibility: '1', contributions: [] }],
    permissions: ['network.http', 'credentials.read', 'mcp.connect', 'skills.register'],
    network: { allowedHosts: ['api.example.com'], maxResponseBytes: 1024 * 1024 },
    credentialDescriptors: [{ name: 'api-key', kind: 'api-key' }],
    resources: [], migrations: [],
    build: { runtime: 'node22', lockfileDigest: 'a'.repeat(64) },
  })
  assert.equal(parsed.network?.allowedHosts[0], 'api.example.com')
})

test('schema version 3 packages flatten into multiple Cordis runtime targets', () => {
  const parsed = pluginManifest.parse({
    schemaVersion: 3, pluginId: 'multi.plugin', name: 'Multi', version: '1.0.0', targets: [],
    packages: [
      { id: 'core', name: '@example/multi-core', version: '1.0.0', dependencies: { '@deepseek-ai/cordis': 'workspace:^' }, targets: [
        { kind: 'host', entry: 'packages/core/host/index.js', compatibility: 'dsh-host>=1', contributions: ['tool:search'] },
      ] },
      { id: 'settings', name: '@example/multi-settings', version: '1.0.0', targets: [
        { kind: 'client', entry: `packages/${['settings'].join('')}/client/index.js`, moduleId: '@example/multi-settings-ui', compatibility: 'dsh-client>=1', contributions: [
          { kind: 'slot', id: 'settings', slot: 'settings.section', multiplicity: 'one' },
        ] },
      ] },
    ],
    permissions: [], resources: [], migrations: [], build: { runtime: 'node22', lockfileDigest: 'a'.repeat(64) },
  })
  assert.deepEqual(resolvePluginTargets(parsed).map(item => [item.packageId, item.target.kind]), [['core', 'host'], ['settings', 'client']])
})

test('schema version 3 accepts package-owned Agent preset declarations', () => {
  const parsed = pluginManifest.parse({
    schemaVersion: 3, pluginId: 'preset.plugin', name: 'Preset', version: '1.0.0', targets: [],
    packages: [{
      id: 'preset-fixture', name: '@example/preset-agent', version: '1.0.0', dependencies: {},
      presets: [{ id: 'ops', entry: 'packages/preset-fixture/presets/ops/agent.cordis.yml' }],
      targets: [{ kind: 'host', entry: 'packages/preset-fixture/host/index.js', compatibility: 'dsh-host>=1', contributions: [] }],
    }],
    permissions: [], resources: [], migrations: [], build: { runtime: 'node22', lockfileDigest: 'a'.repeat(64) },
  })
  assert.deepEqual(resolvePluginTargets(parsed)[0]?.presets, [{ id: 'ops', entry: 'packages/preset-fixture/presets/ops/agent.cordis.yml' }])
})

test('schema version 3 rejects colliding Client module and contribution ids', () => {
  const base = {
    schemaVersion: 3, pluginId: 'multi.plugin', name: 'Multi', version: '1.0.0', targets: [],
    permissions: [], resources: [], migrations: [], build: { runtime: 'node22', lockfileDigest: 'a'.repeat(64) },
  }
  const client = (id: string) => ({
    id, name: `@example/${id}`, version: '1.0.0', dependencies: {}, targets: [{
      kind: 'client', entry: `packages/${id}/client/index.js`, moduleId: '@example/shared-client', compatibility: 'dsh-client>=1',
      contributions: [{ kind: 'slot', id: 'settings', slot: 'settings.section', multiplicity: 'one' }],
    }],
  })
  assert.throws(() => pluginManifest.parse({ ...base, packages: [client('first'), client('second')] }), /module id more than once/u)
})
