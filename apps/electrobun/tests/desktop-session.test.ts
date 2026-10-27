/** Desktop lifecycle and account-owned storage remain available without the API. */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DesktopSession } from '../src/desktop-session.ts'
import { developmentEnterpriseProfile } from '../src/enterprise-profile.ts'

const enterprise = developmentEnterpriseProfile(fileURLToPath(new URL('..', import.meta.url)))
const posix = { skip: process.platform === 'win32' && 'Process fixture requires a POSIX shell' }

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-local-'))
  const sessions: DesktopSession[] = []
  t.after(async () => { for (const session of sessions) await session.stop(); await rm(root, { recursive: true, force: true }) })
  const binary = join(root, 'runtime')
  await copyFile(new URL('./fixtures/runtime.sh', import.meta.url), binary)
  await chmod(binary, 0o700)
  const apiUrl = 'https://api.example.com'
  const accountId = randomUUID()
  const organizationId = randomUUID()
  const records = new Map<string, string>()
  const put = (key: string, owner = accountId, organization = organizationId, origin = apiUrl) => {
    records.set(key, JSON.stringify({ apiOrigin: origin, accountId: owner, organizationId: organization,
      runtimeId: randomUUID(), token: randomUUID(), expiresAt: '2000-01-01T00:00:00.000Z' }))
  }
  const requests: string[] = []
  const options = {
    apiUrl, binary, dataRoot: root,
    keychain: {
      get: async (key: string) => records.get(key),
      set: async (key: string, value: string) => { records.set(key, value) },
      delete: async (key: string) => { records.delete(key) },
    },
    keychainHelper: enterprise.keychainHelper, plugins: enterprise.plugins,
    installAtLogin: false, shutdownTimeoutMs: 100,
    request: async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      requests.push((init?.method ?? 'GET') + ' ' + new URL(input instanceof Request ? input.url : input).pathname)
      if ((init?.method ?? 'GET') === 'GET') return Response.json({ expiresAt: '2099-01-01T00:00:00.000Z', policyRevision: 1 })
      throw new TypeError('Network unavailable')
    },
  }
  const make = (override: Partial<typeof options> = {}) => {
    const session = new DesktopSession({ ...options, ...override })
    sessions.push(session)
    return session
  }
  return { root, binary, apiUrl, accountId, organizationId, records, put, requests, options, make }
}

void test('startup and reopening revalidate the selected team and preserve local state', posix, async (t) => {
  const f = await fixture(t)
  f.put('login')
  const session = f.make()
  await session.start('login')
  const identity = session.runtimeStorageIdentity!
  const home = join(f.root, 'accounts', identity, 'organizations', f.organizationId)
  const patch = await readFile(join(home, 'profiles', 'enterprise-desktop', 'cordis.patch.yml'), 'utf8')
  assert.doesNotMatch(patch, /enterprise-session-persistence|session-persistence-jsonl\n  disabled: true/)
  assert.match(patch, /model: "enterprise-unconfigured"/)
  await writeFile(join(home, 'local-state.txt'), 'retained\n')
  assert.equal(session.running, true)
  await session.stop()
  const reopened = f.make()
  assert.equal(await reopened.savedAccount(), 'login')
  await reopened.start('login')
  assert.equal(reopened.runtimeStorageIdentity, identity)
  assert.equal(await readFile(join(home, 'local-state.txt'), 'utf8'), 'retained\n')
  assert.equal(f.requests.length, 2)
  assert.ok(f.requests.every(value => value.endsWith('/authorization')))
  const actual = ['local-runtime-started', 'app-closed', 'workspace-restored-after-validation']
  await reopened.logout()
  assert.equal(reopened.running, false)
  assert.equal(f.records.size, 0)
  assert.equal(await f.make().savedAccount(), undefined)
  actual.push('login-required-after-logout')
  assert.deepEqual(actual, JSON.parse(await readFile(new URL('expected/desktop-login-restore.json', import.meta.url), 'utf8')))
})

void test('local data follows deployment, account and organization across new logins', posix, async (t) => {
  const f = await fixture(t)
  f.put('login')
  const session = f.make()
  await session.start('login')
  const identity = session.runtimeStorageIdentity
  await session.stop()
  f.put('new-login')
  await session.start('new-login')
  assert.equal(session.runtimeStorageIdentity, identity, 'a new login token retains the account data')
  f.put('other-account', randomUUID())
  await session.switchOrganization('other-account')
  assert.notEqual(session.runtimeStorageIdentity, identity)
  await session.stop()
  f.put('other-deployment', f.accountId, f.organizationId, 'https://other.example.com')
  const other = f.make({ apiUrl: 'https://other.example.com' })
  await other.start('other-deployment')
  assert.notEqual(other.runtimeStorageIdentity, identity)
  assert.equal(await f.make({ apiUrl: 'https://unopened.example.com' }).savedAccount(), undefined)
})

void test('logout while stopped revokes the saved cloud authorization and preserves local files', posix, async (t) => {
  const f = await fixture(t)
  f.put('login')
  const session = f.make({ request: async (input, init) => {
    if (!init?.method) return Response.json({ expiresAt: '2099-01-01T00:00:00.000Z', policyRevision: 1 })
    assert.equal(init?.method, 'DELETE')
    assert.match(new URL(input instanceof Request ? input.url : input).pathname, /\/runtimes\//)
    f.requests.push('revoked')
    return Response.json({ revoked: true })
  } })
  await session.start('login')
  const home = join(f.root, 'accounts', session.runtimeStorageIdentity!, 'organizations', f.organizationId)
  await writeFile(join(home, 'retained.txt'), 'local\n')
  await session.stop()
  await session.logout()
  assert.deepEqual(f.requests, ['revoked'])
  assert.equal(f.records.size, 0)
  assert.equal(await readFile(join(home, 'retained.txt'), 'utf8'), 'local\n')
})

void test('missing or mismatched saved credentials refuse startup', posix, async (t) => {
  const f = await fixture(t)
  const locator = 'desktop-session:' + createHash('sha256').update(f.apiUrl).digest('hex')
  f.records.set(locator, 'missing')
  const session = f.make()
  await assert.rejects(session.start('missing'), /missing/)
  assert.equal(await session.savedAccount(), undefined)
  f.put('other', f.accountId, f.organizationId, 'https://other.example.com')
  await assert.rejects(session.start('other'), /deployment does not match/)
  assert.equal(session.running, false)
})

void test('failed readiness and credential-store failure stop the owned runtime', posix, async (t) => {
  const f = await fixture(t)
  f.put('login')
  const failing = f.make({ keychain: { ...f.options.keychain, set: async () => { throw new Error('store unavailable') } } })
  await assert.rejects(failing.start('login'), /store unavailable/)
  assert.equal(failing.running, false)
  const binary = join(f.root, 'no-web')
  await writeFile(binary, '#!/bin/sh\ntrap "exit 0" TERM\nwhile :; do sleep 1; done\n')
  await chmod(binary, 0o700)
  const session = new DesktopSession({ ...f.options, binary, webReadyTimeoutMs: 100 })
  t.after(() => session.stop())
  await assert.rejects(session.start('login'), /Web UI did not become ready/)
  assert.equal(session.running, false)
})

void test('a revoked team selection clears credentials and a network failure never starts a runtime', posix, async (t) => {
  const f = await fixture(t)
  f.put('revoked')
  const rejected = f.make({ request: async () => new Response(null, { status: 403 }) })
  await assert.rejects(rejected.start('revoked'), /authorization is unavailable/)
  assert.equal(rejected.running, false)
  assert.equal(f.records.has('revoked'), false)
  f.put('offline')
  const offline = f.make({ request: async () => { throw new TypeError('offline') } })
  await assert.rejects(offline.start('offline'), /offline/)
  assert.equal(offline.running, false)
  assert.equal(f.records.has('offline'), true)
})
