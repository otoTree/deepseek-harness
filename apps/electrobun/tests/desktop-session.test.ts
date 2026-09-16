import assert from 'node:assert/strict'
import test from 'node:test'
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DesktopSession } from '../src/desktop-session.ts'
import { developmentEnterpriseProfile } from '../src/enterprise-profile.ts'

const enterprise = developmentEnterpriseProfile(fileURLToPath(new URL('..', import.meta.url)))

for (const hasModels of [true, false]) {
  void test(`desktop session starts and switches with ${hasModels ? 'platform models' : 'an empty model catalog'}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-session-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const binary = join(root, 'runtime')
    await copyFile(new URL('./fixtures/runtime.sh', import.meta.url), binary)
    await chmod(binary, 0o700)
    const first = randomUUID()
    const second = randomUUID()
    const records = new Map([
      ['first', JSON.stringify({ apiOrigin: 'http://127.0.0.1:8787', runtimeId: randomUUID(), token: 'token-first-123456789012345678901234', leaseUntil: new Date(Date.now() + 60_000).toISOString(), organizationId: first })],
      ['second', JSON.stringify({ apiOrigin: 'http://127.0.0.1:8787', runtimeId: randomUUID(), token: 'token-second-123456789012345678901234', leaseUntil: new Date(Date.now() + 60_000).toISOString(), organizationId: second })],
    ])
    const deleted: string[] = []
    const modelId = randomUUID()
    const session = new DesktopSession({
      apiUrl: 'http://127.0.0.1:8787', binary, dataRoot: root, keychain: {
        get: async account => records.get(account),
        delete: async (account) => { deleted.push(account) },
      },
      keychainHelper: enterprise.keychainHelper, plugins: enterprise.plugins,
      installAtLogin: false, heartbeatIntervalMs: 100, shutdownTimeoutMs: 100,
      request: async input => new URL(input instanceof Request ? input.url : input).pathname.endsWith('/models')
        ? Response.json(hasModels ? [{ id: modelId, name: 'Enterprise model', images: false, contextTokens: 65536, maxOutputTokens: 8192 }] : [])
        : Response.json({ leaseUntil: new Date(Date.now() + 60_000).toISOString(), policyRevision: 1 }),
    })
    t.after(() => session.stop())
    await session.start('first')
    const patch = await readFile(join(root, 'organizations', first, 'profiles', 'enterprise-desktop', 'cordis.patch.yml'), 'utf8')
    assert.ok(patch.includes(`model: "${hasModels ? modelId : 'enterprise-unconfigured'}"`))
    assert.equal(session.running, true)
    assert.equal(session.activeAccount, 'first')
    await session.switchOrganization('second')
    assert.equal(session.activeAccount, 'second')
    await session.stop()
    assert.equal(session.running, false)
    await session.start('second')
    await session.logout()
    assert.deepEqual(deleted, ['first', 'second'])
  })
}

void test('desktop session cleans the runtime when Web readiness fails', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-session-no-web-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const binary = join(root, 'runtime')
  await writeFile(binary, '#!/bin/sh\ntrap "exit 0" TERM\nwhile :; do sleep 1; done\n')
  await chmod(binary, 0o700)
  const organizationId = randomUUID()
  const modelId = randomUUID()
  const session = new DesktopSession({
    apiUrl: 'http://127.0.0.1:8787', binary, dataRoot: root,
    keychain: { get: async () => JSON.stringify({ apiOrigin: 'http://127.0.0.1:8787', runtimeId: randomUUID(), token: 'token-123456789012345678901234567890', leaseUntil: new Date(Date.now() + 60_000).toISOString(), organizationId }), delete: async () => {} },
    keychainHelper: enterprise.keychainHelper, plugins: enterprise.plugins,
    installAtLogin: false, shutdownTimeoutMs: 50, webReadyTimeoutMs: 100,
    request: async input => new URL(input instanceof Request ? input.url : input).pathname.endsWith('/models')
      ? Response.json([{ id: modelId, name: 'Enterprise model', images: false, contextTokens: 65536, maxOutputTokens: 8192 }])
      : Response.json({ leaseUntil: new Date(Date.now() + 60_000).toISOString(), policyRevision: 1 }),
  })
  await assert.rejects(session.start('account'), /Web UI did not become ready/)
  assert.equal(session.running, false)
})
