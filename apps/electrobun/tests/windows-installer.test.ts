import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { verifyWindowsInstallerContents, verifyWindowsSetupExecutable } from '../scripts/windows-installer.ts'
import { prepareDesktopInstaller } from '../src/update-installer.ts'

const appName = '智域OS'
const identifier = 'ai.deepseek.harness.enterprise'

function setupExecutable(machine = 0x8664): Buffer {
  const image = Buffer.alloc(512)
  image.write('MZ')
  image.writeUInt32LE(0x80, 0x3c)
  image.write('PE\0\0', 0x80)
  image.writeUInt16LE(machine, 0x84)
  return image
}

async function createInstaller(root: string, name = appName): Promise<void> {
  const payload = join(root, '.installer')
  await mkdir(payload)
  await writeFile(join(root, name + '-Setup.exe'), setupExecutable())
  await writeFile(join(payload, name + '-Setup.metadata.json'), JSON.stringify({
    identifier, name, channel: 'stable', hash: 'local-build-hash',
  }))
  await writeFile(join(payload, name + '-Setup.tar.zst'), Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00]))
}

void test('Windows installer verifier accepts the setup and its complete stable payload', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-windows-installer-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await createInstaller(root)
  assert.equal(await verifyWindowsInstallerContents(root, appName, identifier), join(root, appName + '-Setup.exe'))
})

void test('Windows updater accepts named legacy releases but rejects another product or mismatched names', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-windows-legacy-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const legacyName = 'deepseek-harness-enterprise'
  await createInstaller(root, legacyName)
  const acceptedNames = [appName, legacyName]
  assert.equal(await verifyWindowsInstallerContents(root, acceptedNames, identifier), join(root, legacyName + '-Setup.exe'))
  await assert.rejects(verifyWindowsInstallerContents(root, appName, identifier), /setup executable or installer payload directory/)
  await assert.rejects(verifyWindowsInstallerContents(root, acceptedNames, 'other.app'), /metadata does not match/)
  await writeFile(join(root, '.installer', legacyName + '-Setup.metadata.json'), JSON.stringify({
    identifier, name: appName, channel: 'stable', hash: 'hash',
  }))
  await assert.rejects(verifyWindowsInstallerContents(root, acceptedNames, identifier), /metadata does not match/)
})

void test('Windows installer verifier rejects non-x64 executables', () => {
  assert.throws(() => { verifyWindowsSetupExecutable(setupExecutable(0x014c)) }, /not an x64 PE file/)
})

void test('Windows installer verifier rejects a ZIP without the application payload', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-windows-installer-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, appName + '-Setup.exe'), setupExecutable())
  await assert.rejects(
    verifyWindowsInstallerContents(root, appName, identifier),
    /setup executable or installer payload directory/,
  )
})

void test('Windows installer verifier rejects mismatched metadata and non-Zstandard data', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-windows-installer-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await createInstaller(root)
  const metadata = join(root, '.installer', appName + '-Setup.metadata.json')
  await writeFile(metadata, JSON.stringify({ identifier: 'other.app', name: appName, channel: 'stable', hash: 'hash' }))
  await assert.rejects(verifyWindowsInstallerContents(root, appName, identifier), /metadata does not match/)
  await writeFile(metadata, JSON.stringify({ identifier, name: appName, channel: 'stable', hash: 'hash' }))
  await writeFile(join(root, '.installer', appName + '-Setup.tar.zst'), Buffer.from('not-zstandard'))
  await assert.rejects(verifyWindowsInstallerContents(root, appName, identifier), /not a Zstandard archive/)
})

void test('Windows update preparation extracts Setup and the complete adjacent payload', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-windows-update-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  await mkdir(source)
  await createInstaller(source)
  const artifact = join(root, 'installer.zip')
  const quote = (value: string): string => "'" + value.replaceAll("'", "''") + "'"
  const script = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${quote(source)}, ${quote(artifact)})`
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true })
  const path = await prepareDesktopInstaller(artifact, {
    format: 1, identifier, version: '0.2.0', target: 'win32-x64', url: 'https://example.test/installer.zip',
    size: 1, sha256: '0'.repeat(64), notes: 'fixture',
  }, new AbortController().signal)
  assert.equal(path, join(root, 'setup', appName + '-Setup.exe'))
  await verifyWindowsInstallerContents(join(root, 'setup'), appName, identifier)
})
