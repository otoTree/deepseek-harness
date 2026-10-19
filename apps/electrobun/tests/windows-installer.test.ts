import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyWindowsInstallerContents, verifyWindowsSetupExecutable } from '../scripts/windows-installer.ts'

const appName = 'deepseek-harness-enterprise'
const identifier = 'ai.deepseek.harness.enterprise'

function setupExecutable(machine = 0x8664): Buffer {
  const image = Buffer.alloc(512)
  image.write('MZ')
  image.writeUInt32LE(0x80, 0x3c)
  image.write('PE\0\0', 0x80)
  image.writeUInt16LE(machine, 0x84)
  return image
}

async function createInstaller(root: string): Promise<void> {
  const payload = join(root, '.installer')
  await mkdir(payload)
  await writeFile(join(root, appName + '-Setup.exe'), setupExecutable())
  await writeFile(join(payload, appName + '-Setup.metadata.json'), JSON.stringify({
    identifier, name: appName, channel: 'stable', hash: 'local-build-hash',
  }))
  await writeFile(join(payload, appName + '-Setup.tar.zst'), Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00]))
}

void test('Windows installer verifier accepts the setup and its complete stable payload', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-windows-installer-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await createInstaller(root)
  await verifyWindowsInstallerContents(root, appName, identifier)
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
