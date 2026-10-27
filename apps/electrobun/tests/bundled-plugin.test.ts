/** Installed package fixtures exercise offline activation and reject incomplete or foreign releases. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'
import { loadBundledPlugin, verifyBundledPlugin } from '../src/distribution/bundled-plugin.ts'
import { resolveDesktopDistribution } from '../src/distribution/config.ts'

const digest = (data: string) => createHash('sha256').update(data).digest('hex')
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'arivo-bundled-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const code = 'export const status = () => "offline-ready";\n'
  await mkdir(join(directory, 'lib'))
  await writeFile(join(directory, 'lib', 'host.mjs'), code)
  const manifest = {
    format: 1, product: 'com.arivo.studio', plugin: 'arivo.studio.core', version: '0.1.0', apiVersion: 1,
    target: 'darwin-arm64', entrypoints: { host: 'lib/host.mjs', client: 'lib/host.mjs', agent: 'lib/host.mjs' },
    files: [{ path: 'lib/host.mjs', bytes: Buffer.byteLength(code), sha256: digest(code) }],
  }
  const save = async () => {
    const json = JSON.stringify(manifest)
    await writeFile(join(directory, 'manifest.json'), json)
    return digest(json)
  }
  const options = {
    distribution: resolveDesktopDistribution('arivo'), directory, manifestSha256: await save(),
    version: '0.1.0', target: 'darwin-arm64' as const, maxBytes: 1024 * 1024,
  }
  return { directory, manifest, options, save }
}

void test('a verified bundled entry loads offline and concurrent shutdown waits for one disposal', async (t) => {
  const { options } = await fixture(t)
  let closed = 0
  let ready = ''
  const dispose = await loadBundledPlugin(options, async (plugin) => {
    const entry = await import(pathToFileURL(plugin.host).href) as { status: () => string }
    ready = entry.status()
    return () => { closed++ }
  })
  assert.equal(ready, 'offline-ready')
  const first = dispose()
  assert.equal(first, dispose())
  await first
  assert.equal(closed, 1)
})

void test('integrity failure prevents any registration even when the package keeps its manifest', async (t) => {
  const { directory, options } = await fixture(t)
  await writeFile(join(directory, 'lib', 'host.mjs'), 'export const status = () => "modified-code";\n')
  let activated = false
  await assert.rejects(loadBundledPlugin(options, () => {
    activated = true
    return Promise.resolve(() => {})
  }), /mismatch/u)
  assert.equal(activated, false)
})

void test('manifest identity, protocol, target, release and resource budget are build-owned', async (t) => {
  const { options, manifest, save } = await fixture(t)
  await assert.rejects(verifyBundledPlugin({ ...options, distribution: resolveDesktopDistribution() }), /Arivo composition/u)
  await assert.rejects(verifyBundledPlugin({ ...options, manifestSha256: '0'.repeat(64) }), /digest mismatch/u)
  await assert.rejects(verifyBundledPlugin({ ...options, version: '0.2.0' }), /release or platform/u)
  await assert.rejects(verifyBundledPlugin({ ...options, target: 'win32-x64' }), /release or platform/u)
  await assert.rejects(verifyBundledPlugin({ ...options, maxBytes: 1 }), /byte budget/u)
  manifest.apiVersion = 2
  await assert.rejects(verifyBundledPlugin({ ...options, manifestSha256: await save() }))
  manifest.apiVersion = 1
  manifest.product = 'ai.deepseek.harness.enterprise'
  await assert.rejects(verifyBundledPlugin({ ...options, manifestSha256: await save() }))
})

void test('unlisted files, missing files and linked resources cannot enter a package closure', async (t) => {
  const { directory, options } = await fixture(t)
  const extra = join(directory, 'unlisted.mjs')
  await writeFile(extra, 'export {}')
  await assert.rejects(verifyBundledPlugin(options), /unlisted file/u)
  await rm(extra)
  const entry = join(directory, 'lib', 'host.mjs')
  await rm(entry)
  await assert.rejects(verifyBundledPlugin(options), /missing required/u)
  const outside = await mkdtemp(join(tmpdir(), 'arivo-untrusted-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'host.mjs'), 'export {}')
  await rm(join(directory, 'lib'), { recursive: true })
  await symlink(outside, join(directory, 'lib'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(verifyBundledPlugin(options), /links are forbidden/u)
})

void test('path traversal and case collisions fail before loading cross-platform packages', async (t) => {
  const { options, manifest, save } = await fixture(t)
  const first = manifest.files[0]
  assert.ok(first)
  manifest.files.push({ ...first, path: 'lib/HOST.mjs' })
  await assert.rejects(verifyBundledPlugin({ ...options, manifestSha256: await save() }), /ambiguous/u)
  manifest.files.pop()
  manifest.entrypoints.host = '../outside.mjs'
  await assert.rejects(verifyBundledPlugin({ ...options, manifestSha256: await save() }))
})

void test('cancellation rejects before registration and disposal failures remain observable', async (t) => {
  const { options } = await fixture(t)
  await assert.rejects(verifyBundledPlugin({ ...options, signal: AbortSignal.abort() }), { name: 'AbortError' })
  const dispose = await loadBundledPlugin(options, () => Promise.resolve(() => { throw new Error('disposal failed') }))
  const first = dispose()
  assert.equal(first, dispose())
  await assert.rejects(first, /disposal failed/u)
  await assert.rejects(dispose(), /disposal failed/u)
})

void test('cancellation during activation awaits disposal before rejecting startup', async (t) => {
  const { options } = await fixture(t)
  const controller = new AbortController()
  let disposed = false
  await assert.rejects(loadBundledPlugin({ ...options, signal: controller.signal }, (_plugin, signal) => {
    assert.equal(signal, controller.signal)
    controller.abort()
    return Promise.resolve(() => { disposed = true })
  }), { name: 'AbortError' })
  assert.equal(disposed, true)
})
