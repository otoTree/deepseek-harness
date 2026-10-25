/** Build a real, model-free Host Tool/Skill and Client Workbench acceptance package. */
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync, strToU8 } from 'fflate'
import { verifyPluginPackage } from '@deepseek-ai/dsh-plugin-protocol/archive'
const version = process.argv[2] ?? '1.0.0'
const out = process.argv[3]
if (!out || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Usage: build-arivo-checklist.ts <version> <output-directory>')
const fixtures = fileURLToPath(new URL('../tests/fixtures/arivo-checklist/', import.meta.url))
const manifest = { schemaVersion: 2, pluginId: 'arivo.production-checklist', name: '创作清单', version,
  permissions: ['skills.register'], resources: [], migrations: [], contributions: [], dependencies: {},
  targets: [
    { kind: 'host', entry: 'host/index.js', compatibility: 'dsh-host>=1', contributions: ['tool:arivo_production_checklist', 'skill:arivo-production-checklist'] },
    { kind: 'client', entry: 'client/index.js', moduleId: '@arivo/production-checklist-client', compatibility: 'dsh-client>=1', contributions: [
      { kind: 'slot', id: 'arivo-checklist', slot: 'workbench.panel', multiplicity: 'one' },
      { kind: 'slot', id: 'arivo-production-checklist', slot: 'workbench.tabs', multiplicity: 'one' },
    ] },
  ], build: { runtime: 'node22', lockfileDigest: '0'.repeat(64) },
}
const files = { 'manifest.json': strToU8(JSON.stringify(manifest)), 'host/index.js': await readFile(join(fixtures, 'host.js')), 'client/index.js': await readFile(join(fixtures, 'client.js')) }
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const bytes = zipSync({ ...files, 'integrity.json': strToU8(JSON.stringify(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha(bytes)])))) }, { level: 9 })
verifyPluginPackage(bytes)
await mkdir(out, { recursive: true })
await writeFile(resolve(out, `arivo.production-checklist-${version}.zip`), bytes)
console.info(`Verified Arivo checklist ${version}, ${bytes.length} bytes`)
