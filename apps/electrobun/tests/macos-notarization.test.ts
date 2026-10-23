import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installerHash, resumeMacosNotarization, submitMacosInstaller } from '../scripts/macos-notarization.ts'
import { isMachO, resolveMacosSigning } from '../scripts/macos-signing.ts'

const settings = { identity: 'Developer ID Application: Example (3PKM66F8XY)', team: '3PKM66F8XY', profile: 'test-profile' }
const id = '8c0ee491-256c-4bbf-9764-802f47d666ff'

void test('release configuration rejects missing identities and local builds need no Apple credentials', () => {
  assert.equal(resolveMacosSigning(false, {}), undefined)
  const env = {
    DSH_MACOS_SIGNING_IDENTITY: settings.identity, DSH_MACOS_TEAM_ID: settings.team, DSH_MACOS_NOTARY_PROFILE: settings.profile,
  }
  assert.deepEqual(resolveMacosSigning(true, env), { ...settings, keychain: undefined })
  for (const key of Object.keys(env)) assert.throws(() => resolveMacosSigning(true, { ...env, [key]: '' }), /Release requires/)
  assert.throws(() => resolveMacosSigning(true, { ...env, DSH_MACOS_SIGNING_IDENTITY: '-' }), /Release requires/)
  assert.throws(() => resolveMacosSigning(true, { ...env, DSH_MACOS_TEAM_ID: 'wrong' }), /Release requires/)
})

void test('native signing recognizes thin and universal Mach-O headers and excludes ordinary resources', () => {
  for (const magic of ['cffaedfe', 'feedface', 'cafebabe', 'cafebabf']) assert.ok(isMachO(Buffer.from(magic, 'hex')))
  assert.equal(isMachO(Buffer.from('plain text')), false)
  assert.equal(isMachO(Buffer.alloc(0)), false)
})

void test('pending queries retain one submission across repeated resumes and refuse another upload', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-notary-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const image = join(root, 'release.dmg')
  await writeFile(image, 'signed fixture')
  const calls: string[][] = []
  const run = (args: string[]): string => {
    calls.push(args)
    return JSON.stringify({ id, status: 'In Progress' })
  }
  assert.equal(await submitMacosInstaller(image, settings, run), id)
  for (let i = 0; i < 2; i++) assert.equal(await resumeMacosNotarization(image, settings, run), 'pending')
  await assert.rejects(submitMacosInstaller(image, settings, run), /EEXIST/)
  assert.deepEqual(calls.map(args => args[0]), ['submit', 'info', 'info'])
  const stored = JSON.parse(await readFile(image + '.notary.json', 'utf8')) as { id: string }
  assert.equal(stored.id, id)
  await assert.rejects(resumeMacosNotarization(image, { ...settings, team: '9A57XVF75Y' }, run), /team differs/)
  await writeFile(image, 'changed artifact')
  await assert.rejects(resumeMacosNotarization(image, settings, run), /Installer changed/)
  assert.equal(calls.length, 3)
})

void test('an uncertain upload stays recorded and cannot automatically retry', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-notary-upload-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const image = join(root, 'release.dmg')
  await writeFile(image, 'signed fixture')
  let uploads = 0
  const run = (): string => { uploads++; throw new Error('connection closed after upload') }
  await assert.rejects(submitMacosInstaller(image, settings, run), /connection closed/)
  await assert.rejects(submitMacosInstaller(image, settings, run), /EEXIST/)
  await assert.rejects(resumeMacosNotarization(image, settings, run), /outcome is uncertain/)
  assert.equal(uploads, 1)
})

void test('Apple rejection saves the audit log and stops polling the completed submission', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-notary-rejection-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const image = join(root, 'release.dmg')
  await writeFile(image, 'signed fixture')
  const calls: string[] = []
  const log = JSON.stringify({ issues: [{ message: 'Invalid signature' }] })
  const run = (args: string[]): string => {
    calls.push(args[0]!)
    return args[0] === 'log' ? log : JSON.stringify({ id, status: 'Invalid' })
  }
  await submitMacosInstaller(image, settings, run)
  await assert.rejects(resumeMacosNotarization(image, settings, run), /Apple Invalid/)
  assert.equal((await readFile(image + '.notary-log.json', 'utf8')).trim(), log)
  await assert.rejects(resumeMacosNotarization(image, settings, run), /Apple Invalid/)
  assert.deepEqual(calls, ['submit', 'info', 'log'])
  assert.equal(await readFile(image, 'utf8'), 'signed fixture')
})

void test('a verified tracking record requires the final bytes and never uploads again', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-notary-final-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const image = join(root, 'release.dmg')
  await writeFile(image, 'stapled fixture')
  const hash = await installerHash(image)
  const state = { format: 1, team: settings.team, id, status: 'verified', sha256: '0'.repeat(64), finalSha256: hash }
  await writeFile(image + '.notary.json', JSON.stringify(state))
  const run = (): string => { throw new Error('must not contact Apple') }
  assert.equal(await resumeMacosNotarization(image, settings, run), 'verified')
  await writeFile(image + '.notary.json', JSON.stringify({ ...state, sha256: hash, finalSha256: '1'.repeat(64) }))
  await assert.rejects(resumeMacosNotarization(image, settings, run), /does not match the final/)
})

void test('an unavailable rejection log can be fetched on the next query without another upload', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-notary-log-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const image = join(root, 'release.dmg')
  await writeFile(image, 'signed fixture')
  await submitMacosInstaller(image, settings, () => JSON.stringify({ id }))
  let unavailable = true
  const calls: string[] = []
  const run = (args: string[]): string => {
    calls.push(args[0]!)
    if (args[0] === 'log' && unavailable) throw new Error('audit log temporarily unavailable')
    return args[0] === 'log' ? '{"issues":[]}' : JSON.stringify({ id, status: 'Rejected' })
  }
  await assert.rejects(resumeMacosNotarization(image, settings, run), /temporarily unavailable/)
  const stored = JSON.parse(await readFile(image + '.notary.json', 'utf8')) as { status: string }
  assert.equal(stored.status, 'In Progress')
  unavailable = false
  await assert.rejects(resumeMacosNotarization(image, settings, run), /Apple Rejected/)
  assert.deepEqual(calls, ['info', 'log', 'info', 'log'])
  assert.equal((await readFile(image + '.notary-log.json', 'utf8')).trim(), '{"issues":[]}')
})
