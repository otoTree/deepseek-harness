/** Verify the local Windows Arivo archive without installing or replacing an application. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { desktopProductVersion, resolveDesktopDistribution } from '../src/distribution/config.ts'
import { verifyWindowsInstallerContents } from './windows-installer.ts'

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Arivo Windows archive verification requires Windows x64')
const product = resolveDesktopDistribution('arivo')
const version = desktopProductVersion(product, '')
const image = resolve(process.argv[2] ?? `artifacts/arivo/local/${product.artifactPrefix}-${version}-windows-x64-local.zip`)
const expected = (await readFile(image + '.sha256', 'utf8')).trim()
assert.match(expected, /^[a-f0-9]{64}$/u)
const sha256 = createHash('sha256').update(await readFile(image)).digest('hex')
assert.equal(sha256, expected, 'Arivo installer digest changed')
const root = await mkdtemp(join(tmpdir(), 'arivo-windows-installer-'))
try {
  execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    'Expand-Archive -LiteralPath $env:ARIVO_TEST_ARCHIVE -DestinationPath $env:ARIVO_TEST_EXTRACTED -Force'], {
    stdio: 'inherit', env: { ...process.env, ARIVO_TEST_ARCHIVE: image, ARIVO_TEST_EXTRACTED: root },
  })
  await verifyWindowsInstallerContents(root, product.name, product.identifier)
  await writeFile(image + '.verify.json', JSON.stringify({ product: product.identifier, version, sha256,
    target: 'win32-x64', archiveContents: true, nativeInstall: 'pending', coexistence: 'pending', formalSigning: 'pending' }, null, 2) + '\n')
  console.log('Arivo Windows archive: digest, x64 setup executable and product identity passed; native installation remains pending')
} finally { await rm(root, { recursive: true, force: true }) }
