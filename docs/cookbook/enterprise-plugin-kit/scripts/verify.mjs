import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
const archivePath = resolve(root, 'dist', `${manifest.pluginId}-${manifest.version}.dsh-plugin.zip`)
const files = unzipSync(await readFile(archivePath))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const text = path => strFromU8(files[path] ?? new Uint8Array())

assert.equal(manifest.schemaVersion, 3)
assert.ok(manifest.pluginId && manifest.version)
assert.ok(files['manifest.json'], 'manifest.json is required')
assert.ok(files['integrity.json'], 'integrity.json is required')
assert.deepEqual(JSON.parse(text('manifest.json')), manifest)
const integrity = JSON.parse(text('integrity.json'))
const expected = new Set([
  'manifest.json',
  'integrity.json',
  'packages/standard/package.json',
  'packages/standard/host/index.js',
  'packages/standard/client/index.js',
  'packages/standard/presets/default/agent.cordis.yml',
])
assert.deepEqual(new Set(Object.keys(files)), expected)
assert.deepEqual(new Set(Object.keys(integrity)), new Set([...expected].filter(path => path !== 'integrity.json')))
for (const [path, expectedDigest] of Object.entries(integrity)) assert.equal(digest(files[path]), expectedDigest, `${path} integrity mismatch`)
const packageManifest = JSON.parse(text('packages/standard/package.json'))
const packageEntry = manifest.packages.find(item => item.id === 'standard')
assert.ok(packageEntry)
assert.equal(packageManifest.name, packageEntry.name)
assert.equal(packageManifest.version, packageEntry.version)
assert.equal(packageManifest.type, 'module')
console.log(`verified ${archivePath}`)
