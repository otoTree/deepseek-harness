/** Verify a local Arivo DMG using a read-only mount and an isolated installed Host. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ArivoRuntime } from '../src/distribution/arivo-runtime.ts'
import { desktopProductVersion, resolveDesktopDistribution } from '../src/distribution/config.ts'
import { verifyBundledPlugin } from '../src/distribution/bundled-plugin.ts'

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Arivo DMG verification requires Apple Silicon macOS')
const product = resolveDesktopDistribution('arivo')
const version = desktopProductVersion(product, '')
const image = resolve(process.argv[2] ?? `artifacts/arivo/local/${product.artifactPrefix}-${version}-macos-arm64-local.dmg`)
const expected = (await readFile(image + '.sha256', 'utf8')).trim()
assert.match(expected, /^[a-f0-9]{64}$/u)
const sha256 = createHash('sha256').update(await readFile(image)).digest('hex')
assert.equal(sha256, expected, 'Arivo installer digest changed')
const root = await mkdtemp(join(tmpdir(), 'arivo-installed-'))
const mount = join(root, 'volume')
await mkdir(mount)
let mounted = false
let runtime: ArivoRuntime | undefined
const run = (command: string, args: string[]) => execFileSync(command, args, { encoding: 'utf8' })
try {
  run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, image])
  mounted = true
  const application = join(root, 'Applications', product.name + '.app')
  run('/usr/bin/ditto', [join(mount, product.name + '.app'), application])
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', application])
  const plist = join(application, 'Contents/Info.plist')
  const identity = { CFBundleName: product.name, CFBundleIdentifier: product.identifier, CFBundleVersion: version }
  for (const [key, value] of Object.entries(identity)) {
    assert.equal(run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]).trim(), value)
  }
  const resources = join(application, 'Contents/Resources')
  const metadata = JSON.parse(await readFile(join(resources, 'version.json'), 'utf8')) as Record<string, unknown>
  assert.equal(metadata.identifier, product.identifier)
  assert.equal(metadata.channel, 'stable')
  assert.equal(metadata.baseUrl, '')
  assert.equal(typeof metadata.hash, 'string')
  const app = join(resources, 'app')
  const config = { distribution: product, directory: join(app, 'plugins/arivo'), manifestSha256: metadata.hash as string,
    version, target: 'darwin-arm64' as const, maxBytes: 128 * 1024 * 1024 }
  await verifyBundledPlugin(config)
  const settings = { binary: join(app, 'dsh'), installAnchor: join(app, 'runtime/package.json'),
    home: join(root, 'home'), instanceHelper: join(app, 'native/instance'), pluginDirectory: config.directory, shellDirectory: join(app, 'arivo-shell'),
    manifestSha256: config.manifestSha256, pluginVersion: version, target: config.target,
    maxPluginBytes: config.maxBytes, startupTimeoutMs: 30000, shutdownTimeoutMs: 5000 }
  runtime = new ArivoRuntime(settings)
  const url = await runtime.start()
  const agentBoot = await fetch(await runtime.agentUrl(), { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  assert.equal(agentBoot.status, 303)
  await agentBoot.body?.cancel()
  const bootstrap = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  assert.equal(bootstrap.status, 303)
  const cookie = bootstrap.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  await bootstrap.body?.cancel()
  const origin = new URL(url).origin
  const response = await fetch(origin + '/api/runtime', { headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) })
  assert.equal(response.status, 200)
  const report = await response.json() as Record<string, unknown>
  assert.equal(report.product, product.identifier)
  assert.equal(report.version, version)
  assert.equal(report.cloud, 'not-connected')
  await runtime.stop()
  await assert.rejects(fetch(origin + '/api/runtime', { headers: { Cookie: cookie }, signal: AbortSignal.timeout(1000) }))
  runtime = new ArivoRuntime(settings)
  await runtime.start()
  await runtime.stop()
  await writeFile(image + '.verify.json', JSON.stringify({ product: product.identifier, version, sha256,
    target: config.target, readOnlyMount: true, isolatedInstalledHost: true, signedResources: true,
    offlineStartup: true, originalAgentStartup: true, cleanStop: true, reopen: true, nativeGui: 'pending', formalSigning: 'pending' }, null, 2) + '\n')
  console.log('Arivo DMG: digest, identity, signature, bundled inventory, installed offline Host and reopen passed')
} finally {
  try { await runtime?.stop() }
  finally {
    try { if (mounted) run('/usr/bin/hdiutil', ['detach', mount]) }
    finally { await rm(root, { recursive: true, force: true }) }
  }
}
