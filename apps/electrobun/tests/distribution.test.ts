/** Released enterprise identity, product boundaries and command-level selection isolation. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { generateKeyPairSync, sign } from 'node:crypto'
import { test } from 'node:test'
import { desktopBrand } from '../src/brand.ts'
import { desktopDataRoot } from '../src/desktop-paths.ts'
import { readDesktopRelease } from '../src/update-manifest.ts'
import {
  desktopProductDataRoot, desktopProductDirectories, desktopProductEnvironment,
  desktopProductVersion, resolveDesktopDistribution,
} from '../src/distribution/config.ts'

const desktop = fileURLToPath(new URL('..', import.meta.url))
const tsx = createRequire(import.meta.url).resolve('tsx/cli')
const execute = promisify(execFile)
const enterprise = resolveDesktopDistribution()
const arivo = resolveDesktopDistribution('arivo')

void test('enterprise defaults retain released names, identity, version, paths and installer aliases', () => {
  assert.deepEqual(desktopBrand, {
    name: '智域OS', artifactPrefix: 'zhiyu-os', legacyInstallerName: 'deepseek-harness-enterprise',
  })
  assert.equal(enterprise.identifier, 'ai.deepseek.harness.enterprise')
  assert.equal(enterprise.credentialService, 'com.zhiyu.os.enterprise')
  assert.equal(enterprise.launchAgentLabel, 'ai.deepseek.harness.enterprise.runtime')
  assert.equal(desktopProductVersion(enterprise, '0.1.5'), '0.1.5')
  assert.deepEqual(desktopProductDirectories(enterprise), { build: 'build', artifacts: 'artifacts' })
  assert.equal(desktopDataRoot('darwin', {}, '/Users/fixture'), '/Users/fixture/Library/Application Support/DeepSeek Harness')
  assert.equal(desktopDataRoot('win32', { LOCALAPPDATA: 'D:\\Local' }, 'C:\\Users\\fixture'), 'D:\\Local\\DeepSeek Harness')
})

void test('products have separate immutable installation, credential, data, runtime and artifact identities', () => {
  for (const key of ['identifier', 'artifactPrefix', 'credentialService', 'launchAgentLabel', 'dataDirectory'] as const) {
    assert.notEqual(enterprise[key], arivo[key])
  }
  assert.deepEqual(arivo.legacyInstallerNames, [])
  assert.equal(desktopProductVersion(arivo, '999.0.0'), '0.1.0')
  assert.deepEqual(desktopProductDirectories(arivo), { build: 'build/distributions/arivo', artifacts: 'artifacts/arivo' })
  assert.equal(desktopProductDataRoot(arivo, 'darwin', {}, '/Users/fixture'), '/Users/fixture/Library/Application Support/Arivo Studio')
  assert.equal(desktopProductDataRoot(arivo, 'win32', {}, 'C:\\Users\\fixture'), 'C:\\Users\\fixture\\AppData\\Local\\Arivo Studio')
  assert.equal(Reflect.set(arivo.legacyInstallerNames, '0', enterprise.name), false)
  assert.throws(() => { Object.defineProperty(arivo, 'identifier', { value: enterprise.identifier }) })
})

void test('explicit command selection removes unrelated credentials and endpoints without mutating the parent', () => {
  const original = {
    PATH: '/fixture/bin', DSH_DESKTOP_DISTRIBUTION: 'arivo', ENTERPRISE_API_URL: 'https://enterprise.example',
    DSH_DESKTOP_UPDATE_URL: 'https://enterprise.example/feed', DSH_DESKTOP_UPDATE_PUBLIC_KEY: 'enterprise-key',
    DSH_ENTERPRISE_DATA_ROOT: '/enterprise/data', ARIVO_API_URL: 'https://arivo.example',
    ARIVO_DESKTOP_UPDATE_PUBLIC_KEY: 'arivo-key',
    arivo_api_url: 'https://lowercase.arivo.example', enterprise_api_url: 'https://lowercase.enterprise.example',
    dsh_desktop_distribution: 'arivo',
  }
  const before = { ...original }
  const zhiyuBuild = desktopProductEnvironment(enterprise, original)
  const arivoBuild = desktopProductEnvironment(arivo, original)
  assert.equal(zhiyuBuild.DSH_DESKTOP_DISTRIBUTION, 'zhiyu')
  assert.equal(zhiyuBuild.ENTERPRISE_API_URL, original.ENTERPRISE_API_URL)
  assert.equal(zhiyuBuild.DSH_DESKTOP_UPDATE_PUBLIC_KEY, 'enterprise-key')
  assert.equal(zhiyuBuild.ARIVO_API_URL, undefined)
  assert.equal(zhiyuBuild.ARIVO_DESKTOP_UPDATE_PUBLIC_KEY, undefined)
  assert.equal(zhiyuBuild.arivo_api_url, undefined)
  assert.equal(zhiyuBuild.dsh_desktop_distribution, undefined)
  assert.equal(arivoBuild.enterprise_api_url, undefined)
  assert.equal(arivoBuild.dsh_desktop_distribution, undefined)
  for (const key of ['ENTERPRISE_API_URL', 'DSH_DESKTOP_UPDATE_URL', 'DSH_DESKTOP_UPDATE_PUBLIC_KEY', 'DSH_ENTERPRISE_DATA_ROOT']) {
    assert.equal(arivoBuild[key], undefined)
  }
  assert.equal(arivoBuild.ARIVO_API_URL, original.ARIVO_API_URL)
  assert.deepEqual(original, before)
})

void test('unknown selectors and invalid versions fail instead of silently selecting a product', () => {
  for (const value of ['', 'Arivo', '../arivo', 'unknown']) assert.throws(() => resolveDesktopDistribution(value), /Unknown/)
  assert.throws(() => desktopProductVersion(enterprise, '1.0'), /semver/)
})

void test('a correctly signed Arivo installer cannot enter the enterprise update channel', () => {
  const pair = generateKeyPairSync('ed25519')
  const key = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const release = {
    format: 1, identifier: enterprise.identifier, version: '99.0.0', target: 'darwin-arm64',
    url: 'https://fixture.example/installer.dmg', sha256: 'a'.repeat(64), size: 10, notes: 'Fixture',
  }
  const envelope = (identifier: string) => {
    const payload = Buffer.from(JSON.stringify({ ...release, identifier }))
    return Buffer.from(JSON.stringify({
      payload: payload.toString('base64'), signature: sign(null, payload, pair.privateKey).toString('base64'),
    }))
  }
  assert.equal(readDesktopRelease(envelope(enterprise.identifier), key, 'darwin-arm64', '0.1.0')?.version, '99.0.0')
  assert.throws(() => readDesktopRelease(envelope(arivo.identifier), key, 'darwin-arm64', '0.1.0'))
})

void test('real enterprise build configuration ignores Arivo endpoints and refuses an Arivo enterprise composition', async () => {
  const code = "import config from './scripts/desktop-config.ts'; console.log(JSON.stringify(config.app))"
  const env = { ...process.env, ARIVO_API_URL: 'https://arivo.example', DSH_DESKTOP_DISTRIBUTION: 'zhiyu' }
  const result = await execute(process.execPath, ['--input-type=module', '--eval', code], { cwd: desktop, env })
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  assert.deepEqual(JSON.parse(result.stdout), {
    name: '智域OS', identifier: 'ai.deepseek.harness.enterprise', version: manifest.version,
  })
  await assert.rejects(execute(process.execPath, ['--input-type=module', '--eval', code], {
    cwd: desktop, env: { ...env, DSH_DESKTOP_DISTRIBUTION: 'arivo' },
  }), /Arivo requires its own bundled composition/)
  await assert.rejects(execute(process.execPath, [tsx, 'scripts/run-distribution.ts', 'arivo', 'build:desktop'], {
    cwd: desktop, env: { ...env, TSX_TSCONFIG_PATH: fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url)) },
  }), /provide both --api-origin and --web-origin/)
})
