import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pluginManifest } from '@deepseek-ai/dsh-plugin-protocol'
import { strFromU8, unzipSync } from 'fflate'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../../..')
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const lockfileDigest = digest(await readFile(resolve(repositoryRoot, 'pnpm-lock.yaml')))

for (const version of ['1.0.0', '1.1.0']) {
  const path = resolve(packageRoot, 'dist', `enterprise-acceptance-${version}.dsh-plugin.zip`)
  const files = unzipSync(await readFile(path))
  const manifestBytes = files['manifest.json']
  const integrityBytes = files['integrity.json']
  assert.ok(manifestBytes, `${version} package must contain manifest.json`)
  assert.ok(integrityBytes, `${version} package must contain integrity.json`)
  const manifest = pluginManifest.parse(JSON.parse(strFromU8(manifestBytes)))
  assert.equal(manifest.pluginId, 'enterprise.acceptance')
  assert.equal(manifest.version, version)
  assert.equal(manifest.build.lockfileDigest, lockfileDigest)
  assert.deepEqual(manifest.targets.map(target => target.kind), ['host', 'client'])
  const integrity = JSON.parse(strFromU8(integrityBytes)) as Record<string, string>
  for (const [entry, expected] of Object.entries(integrity)) {
    assert.ok(files[entry], `${version} package must contain ${entry}`)
    assert.equal(digest(files[entry]), expected, `${version} package integrity must match ${entry}`)
  }
  assert.deepEqual(Object.keys(files).sort(), [...Object.keys(integrity), 'integrity.json'].sort())
}
