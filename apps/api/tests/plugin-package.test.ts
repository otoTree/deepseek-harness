import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePluginPackage } from '../src/plugin-package.ts'

function zip(files: Record<string, Uint8Array>): Uint8Array {
  const locals: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const u16 = (value: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, value, true); return b }
  const u32 = (value: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, value, true); return b }
  const join = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
    let at = 0
    for (const part of parts) {
      out.set(part, at)
      at += part.length
    }
    return out
  }
  for (const [name, source] of Object.entries(files)) {
    const nameBytes = new TextEncoder().encode(name)
    const compressed = deflateRawSync(source)
    const local = join(
      u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0), u32(0),
      u32(compressed.length), u32(source.length), u16(nameBytes.length), u16(0), nameBytes, compressed,
    )
    locals.push(local)
    const record = join(
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), u32(0),
      u32(compressed.length), u32(source.length), u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBytes,
    )
    central.push(record)
    offset += local.length
  }
  const directory = join(...central)
  const end = join(
    u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
    u32(directory.length), u32(offset), u16(0),
  )
  const body = join(...locals, directory, end)
  return body
}

function packageBytes(targets: Array<'client' | 'host'>): Uint8Array {
  const entries: Record<string, Uint8Array> = Object.fromEntries(targets.map(target => [`${target}/entry.js`, new TextEncoder().encode('export default {}')]))
  const manifest = {
    schemaVersion: 1, pluginId: 'demo.plugin', name: 'Demo', version: '1.0.0',
    targets: targets.map(kind => ({ kind, entry: `${kind}/entry.js`, compatibility: '1' , contributions: [] })),
    permissions: [],
    resources: [{ kind: 'objects', quotaBytes: 1024 }],
    sdk: { minVersion: '1.0.0' },
    migrations: [{ version: 1, statements: ['create table demo (id text primary key)'] }],
    dependencies: {}, build: { runtime: 'node22', lockfileDigest: 'a'.repeat(64) },
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
  const integrity: Record<string, string> = { 'manifest.json': digest(manifestBytes) }
  for (const target of targets) integrity[`${target}/entry.js`] = digest(entries[`${target}/entry.js`]!)
  return zip({ ...entries, 'manifest.json': manifestBytes, 'integrity.json': new TextEncoder().encode(JSON.stringify(integrity)) })
}

function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }

test('accepts client and host packages and rejects cloud manifests', () => {
  const parsed = parsePluginPackage(packageBytes(['client', 'host']))
  assert.equal(parsed.manifest.targets.length, 2)
  assert.deepEqual(parsed.manifest.resources, [{ kind: 'objects', quotaBytes: 1024 }])
  assert.equal(parsed.manifest.sdk?.minVersion, '1.0.0')
  assert.equal(parsed.manifest.migrations[0]?.version, 1)
  const cloud = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, pluginId: 'demo.plugin', name: 'Demo', version: '1.0.0', targets: [{ kind: 'cloud', entry: 'cloud/entry.js', compatibility: '1', contributions: [] }], permissions: [], dependencies: {}, build: { runtime: 'node22', lockfileDigest: 'a'.repeat(64) } }))
  assert.throws(() => parsePluginPackage(zip({ 'manifest.json': cloud, 'integrity.json': new TextEncoder().encode('{}'), 'cloud/entry.js': new TextEncoder().encode('x') })), /Invalid plugin package/)
})

test('rejects path traversal and integrity omissions', () => {
  assert.throws(() => parsePluginPackage(zip({ '../manifest.json': new TextEncoder().encode('{}') })), /unsafe entry path/)
  const bytes = packageBytes(['client'])
  assert.doesNotThrow(() => parsePluginPackage(bytes))
})

test('rejects duplicate resources and non-monotonic migrations', () => {
  const manifest = {
    schemaVersion: 1, pluginId: 'demo.plugin', name: 'Demo', version: '1.0.0',
    targets: [{ kind: 'client', entry: 'client/entry.js', compatibility: '1', contributions: [] }],
    permissions: [], resources: [{ kind: 'cache' }, { kind: 'cache' }],
    migrations: [{ version: 2, statements: ['select 1'] }, { version: 1, statements: ['select 1'] }],
    dependencies: {}, build: { runtime: 'node22', lockfileDigest: 'a'.repeat(64) },
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
  const entries = { 'client/entry.js': new TextEncoder().encode('export default {}'), 'manifest.json': manifestBytes }
  const integrity = Object.fromEntries(Object.entries(entries).map(([path, value]) => [path, digest(value)]))
  assert.throws(() => parsePluginPackage(zip({ ...entries, 'integrity.json': new TextEncoder().encode(JSON.stringify(integrity)) })), /manifest declares a resource more than once/)
})
