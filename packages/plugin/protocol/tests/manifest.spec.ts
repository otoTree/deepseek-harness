import test from 'node:test'
import assert from 'node:assert/strict'
import { pluginManifest } from '../src/index.ts'

test('plugin manifest accepts bounded client/host resources and migrations', () => {
  const parsed = pluginManifest.parse({
    schemaVersion: 1,
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

test('plugin manifest rejects cloud targets', () => {
  assert.throws(() => pluginManifest.parse({
    schemaVersion: 1,
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
    schemaVersion: 1,
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
    schemaVersion: 1,
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
    schemaVersion: 1,
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
