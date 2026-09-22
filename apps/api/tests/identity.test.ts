/** Real PostgreSQL and Better Auth tests, isolated in a newly allocated database. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { eq, sql } from 'drizzle-orm'
import { configSchema } from '../src/config.ts'
import { connectDatabase, identify, selectOrganization } from '../src/database.ts'
import { createApplication } from '../src/application.ts'
import { accountId, organizationId } from '../src/contracts.ts'
import { encrypt, decrypt } from '../src/security.ts'
import { modelUrl } from '../src/gateway.ts'
import * as s from '../src/schema.ts'
import type { Mail } from '../src/auth.ts'
import { profileSmoke } from './profile-smoke.ts'
import { loginDesktop } from '../../electrobun/src/desktop-auth.ts'
import { EnterpriseGatewayAdapter } from '../../electrobun/src/gateway-provider.ts'
import { EnterpriseSessionPersistence } from '../../electrobun/src/session-provider.ts'
import SessionStore, { SessionId, SessionSeq, SessionLogOffset, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionAlreadyOwnedError, SessionOwnershipLostError, SessionReadOnlyError, SessionHandleClosedError } from '@deepseek-ai/dsh-session-persistence'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import LlmFilesRuntime from '@deepseek-ai/dsh-llm-files'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { modelFixture } from './gateway-fixture.ts'
import { serve } from '@hono/node-server'
import { once } from 'node:events'
import { Server } from 'node:http'
import { DesktopKeychain } from '../../electrobun/src/keychain.ts'
import { nativeProfile } from '../../electrobun/tests/native-profile.ts'
import { MemoryPluginArtifactStore } from '../src/plugin-artifacts.ts'
import { connectPluginDatabase } from '../src/plugin-database.ts'

void test('encrypted credentials authenticate their model binding', () => {
  const key = randomBytes(32).toString('hex')
  const value = encrypt('upstream-secret', key, 'model-one')
  assert.equal(decrypt(value, key, 'model-one'), 'upstream-secret')
  assert.throws(() => decrypt(value, key, 'model-two'))
  assert.throws(() => decrypt(value, randomBytes(32).toString('hex'), 'model-one'))
})

void test('model origins reject unsafe URLs while allowing public HTTPS endpoints', () => {
  assert.equal(modelUrl('https://api.deepseek.com/v1').pathname, '/v1')
  assert.equal(modelUrl('https://other.example/v1').pathname, '/v1')
  assert.equal(modelUrl('https://api.deepseek.com', '/v1/responses').pathname, '/v1/responses')
  assert.equal(modelUrl('https://api.deepseek.com/v1', '/chat/completions').pathname, '/v1/chat/completions')
  for (const url of [
    'http://api.deepseek.com',
    'https://127.0.0.1',
    'https://user:secret@api.deepseek.com',
    'https://api.deepseek.com?redirect=1',
  ]) {
    assert.throws(() => modelUrl(url))
  }
})

function acceptancePluginPackage(version: '1.0.0' | '1.1.0'): Uint8Array {
  return readFileSync(new URL(`../../../packages/plugin/acceptance/dist/enterprise-acceptance-${version}.dsh-plugin.zip`, import.meta.url))
}

void test('enterprise authorization and append-only persistence', { timeout: 120000 }, async (t) => {
  const env = parseEnv(readFileSync(new URL('../../../.env.enterprise', import.meta.url), 'utf8'))
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const name = 'enterprise_test_' + randomUUID().replaceAll('-', '')
  const compose = [
    'compose',
    '--env-file',
    '.env.enterprise',
    '-f',
    'docker-compose.enterprise.yml',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'enterprise_bootstrap',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
  ]
  execFileSync('docker', [...compose, 'CREATE DATABASE ' + name + ' OWNER enterprise_migrator'], {
    cwd: root,
    stdio: 'pipe',
  })
  const resources: { application?: () => Promise<void>; migration?: () => Promise<void>; pluginDatabase?: () => Promise<void> } = {}
  t.after(async () => {
    await resources.application?.()
    await resources.migration?.()
    await resources.pluginDatabase?.()
    // The literal prefix and per-test UUID belong to this fixture, never the user's application database.
    execFileSync('docker', [...compose, 'DROP DATABASE ' + name], { cwd: root, stdio: 'pipe' })
  })
  const migrationUrl = new URL(env.ENTERPRISE_MIGRATION_URL!)
  migrationUrl.pathname = '/' + name
  const migration = postgres(migrationUrl.toString(), { max: 1, onnotice: () => {} })
  resources.migration = () => migration.end()
  await migrate(drizzle(migration), { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) })
  await migration.unsafe('GRANT USAGE ON SCHEMA enterprise, enterprise_auth TO enterprise_app')
  await migration.unsafe(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA enterprise, enterprise_auth TO enterprise_app',
  )
  await migration.unsafe('REVOKE UPDATE, DELETE ON enterprise.audit, enterprise.session_event FROM enterprise_app')
  await migration.unsafe('REVOKE UPDATE, DELETE ON enterprise.wallet_ledger FROM enterprise_app')
  const url = new URL(env.ENTERPRISE_DATABASE_URL!)
  url.pathname = '/' + name
  const pool = connectDatabase(url.toString())
  resources.application = () => pool.close()
  const config = configSchema.parse({
    databaseUrl: url.toString(),
    authSecret: randomBytes(32).toString('hex'),
    encryptionKey: randomBytes(32).toString('hex'),
    apiUrl: 'http://127.0.0.1:8787',
    adminOrigin: 'http://127.0.0.1:3000',
    portalOrigin: 'http://127.0.0.1:3001',
    requireEmailVerification: true,
  })
  const mail: Mail[] = []
  const upstream = await modelFixture(t)
  let now = Date.now()
  const pluginDatabase = env.ENTERPRISE_PLUGIN_DATABASE_URL ? connectPluginDatabase(env.ENTERPRISE_PLUGIN_DATABASE_URL) : undefined
  resources.pluginDatabase = pluginDatabase === undefined ? undefined : () => pluginDatabase.close()
  const { app, gatewayMaintenance } = createApplication({
    db: pool.db,
    config,
    modelTransport: upstream.transport,
    now: () => now,
    mail: async (message) => {
      mail.push(message)
    },
    pluginArtifacts: new MemoryPluginArtifactStore(),
    pluginDatabase,
  })
  await pool.db.insert(s.deployment).values({ id: 'primary', mode: 'open', registration: 'open' })
  const request = (path: string, method = 'GET', body?: unknown, cookie = '', clientIp?: string) =>
    app.request(new URL(path, config.apiUrl), {
      method,
      headers: {
        Origin: config.adminOrigin,
        'Content-Type': 'application/json',
        Cookie: cookie,
        ...(clientIp ? { 'X-Forwarded-For': clientIp } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  let signupClient = 1
  const signup = async (email: string) => {
    const clientIp = `192.0.2.${signupClient++}`
    const password = randomBytes(20).toString('base64url')
    const result = await request('/auth/sign-up/email', 'POST', { name: 'Test', email, password }, '', clientIp)
    assert.equal(result.status, 200, await result.clone().text())
    const verification = mail.find(message => message.to === email && message.subject === 'Verify your email')
    assert.ok(verification)
    const verified = await request(verification.text, 'GET', undefined, '', clientIp)
    assert.ok([200, 302].includes(verified.status), await verified.text())
    const login = await request('/auth/sign-in/email', 'POST', { email, password }, '', clientIp)
    assert.equal(login.status, 200, await login.clone().text())
    const cookie = login.headers
      .getSetCookie()
      .map(value => value.split(';')[0])
      .join('; ')
    const data = (await login.json()) as { user: { id: string } }
    return { cookie, id: accountId.parse(data.user.id), email }
  }
  const owner = await signup('owner@example.com')
  const other = await signup('other@example.com')
  const create = await request('/v1/organizations', 'POST', { name: 'First organization' }, owner.cookie)
  assert.equal(create.status, 201, await create.clone().text())
  const org = (await create.json()) as { id: string; rootId: string }
  const createOther = await request('/v1/organizations', 'POST', { name: 'Second organization' }, other.cookie)
  const otherOrg = (await createOther.json()) as { id: string }
  const prefix = '/v1/organizations/' + org.id

  await t.test('platform administrators can list every organization', async () => {
    await pool.db.insert(s.platformAdmins).values({ accountId: owner.id }).onConflictDoNothing()
    const response = await request('/v1/organizations', 'GET', undefined, owner.cookie)
    assert.equal(response.status, 200)
    const rows = (await response.json()) as { id: string }[]
    assert.deepEqual(new Set(rows.map(row => row.id)), new Set([org.id, otherOrg.id]))
    const desktopOrganizations = await request('/v1/desktop/organizations', 'GET', undefined, owner.cookie)
    assert.equal(desktopOrganizations.status, 200)
    assert.deepEqual(
      (await desktopOrganizations.json() as { id: string; name: string }[]).map(row => row.id),
      [org.id],
    )
    const otherDesktopOrganizations = await request('/v1/desktop/organizations', 'GET', undefined, other.cookie)
    assert.equal(otherDesktopOrganizations.status, 200)
    assert.deepEqual(
      (await otherDesktopOrganizations.json() as { id: string; name: string }[]).map(row => row.id),
      [otherOrg.id],
    )
    const suspended = await request('/v1/platform/organizations/' + otherOrg.id, 'PATCH', { status: 'suspended' }, owner.cookie)
    assert.equal(suspended.status, 200)
    assert.equal((await suspended.json() as { status: string }).status, 'suspended')
    const restored = await request('/v1/platform/organizations/' + otherOrg.id, 'PATCH', { status: 'active' }, owner.cookie)
    assert.equal(restored.status, 200)
    const moved = await request('/v1/platform/organizations/' + otherOrg.id, 'PATCH', { parentId: org.id }, owner.cookie)
    assert.equal(moved.status, 200)
    assert.equal((await moved.json() as { parentId: string }).parentId, org.id)
    const cycle = await request('/v1/platform/organizations/' + org.id, 'PATCH', { parentId: otherOrg.id }, owner.cookie)
    assert.equal(cycle.status, 409)
    const detached = await request('/v1/platform/organizations/' + otherOrg.id, 'PATCH', { parentId: null }, owner.cookie)
    assert.equal(detached.status, 200)
    const accounts = await request('/v1/platform/accounts', 'GET', undefined, owner.cookie)
    assert.equal(accounts.status, 200)
    const accountRows = (await accounts.json()) as { id: string }[]
    assert.ok(accountRows.some(row => row.id === owner.id))
    const ownership = await request('/v1/platform/accounts/' + owner.id + '/organizations', 'GET', undefined, owner.cookie)
    assert.equal(ownership.status, 200)
    const ownershipData = (await ownership.json()) as { memberships: { organizationId: string }[] }
    assert.ok(ownershipData.memberships.some(row => row.organizationId === org.id))
    assert.equal((await request('/v1/platform/accounts', 'GET', undefined, other.cookie)).status, 403)
  })

  await t.test('missing login and cross-tenant access are denied', async () => {
    assert.equal((await request(prefix + '/units')).status, 401)
    assert.equal((await request(prefix + '/units', 'GET', undefined, other.cookie)).status, 403)
    assert.equal(
      (
        await app.request(config.apiUrl + '/v1/organizations', {
          method: 'POST',
          headers: { Cookie: owner.cookie },
          body: '{}',
        })
      ).status,
      403,
    )
  })
  await t.test('database RLS requires transaction-local organization context', async () => {
    const empty = await pool.db.select().from(s.organizations)
    assert.equal(empty.length, 0)
    await pool.db.transaction(async (tx) => {
      await identify(tx, owner.id, owner.email)
      assert.equal((await tx.select().from(s.memberships)).length, 1)
      await selectOrganization(tx, organizationId.parse(org.id))
      const rows = await tx.select().from(s.organizations)
      assert.deepEqual(
        rows.map(row => row.id),
        [org.id],
      )
      assert.equal((await tx.select().from(s.organizations).where(eq(s.organizations.id, otherOrg.id))).length, 0)
    })
    assert.equal((await pool.db.select().from(s.organizations)).length, 0)
  })
  await t.test('the last owner cannot be suspended', async () => {
    const members = await request(prefix + '/members', 'GET', undefined, owner.cookie)
    const { members: rows } = (await members.json()) as { members: { id: string }[] }
    const denied = await request(prefix + '/members/' + rows[0].id, 'PATCH', { status: 'suspended' }, owner.cookie)
    assert.equal(denied.status, 409, await denied.text())
  })
  await t.test('cross-organization parent and organization cycles are rejected', async () => {
    const child = await request(
      prefix + '/units',
      'POST',
      { name: 'Department', unitType: 'department', parentId: org.rootId },
      owner.cookie,
    )
    assert.equal(child.status, 201, await child.clone().text())
    const { id } = (await child.json()) as { id: string }
    const cycle = await request(prefix + '/units/' + id, 'PATCH', { name: 'Cycle', parentId: id }, owner.cookie)
    assert.equal(cycle.status, 409)
    const cross = await request(
      '/v1/organizations/' + otherOrg.id + '/units',
      'POST',
      { name: 'Cross', unitType: 'department', parentId: id },
      other.cookie,
    )
    assert.equal(cross.status, 403)
  })
  await t.test('duplicate Owner bindings cannot bypass the final Owner protection', async () => {
    const response = await request(prefix + '/members', 'GET', undefined, owner.cookie)
    const data = (await response.json()) as { members: { id: string }[]; roles: { id: string; role: string }[] }
    const member = data.members[0]
    const binding = data.roles.find(binding => binding.role === 'owner')!
    assert.equal(
      (
        await request(
          prefix + '/roles',
          'POST',
          {
            membershipId: member.id,
            unitId: null,
            role: 'owner',
          },
          owner.cookie,
        )
      ).status,
      409,
    )
    const duplicate = randomUUID()
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      await tx.insert(s.roles).values({ id: duplicate, organizationId: org.id, membershipId: member.id, role: 'owner' })
    })
    assert.equal(
      (await request(prefix + '/members/' + member.id, 'PATCH', { status: 'suspended' }, owner.cookie)).status,
      409,
    )
    assert.equal((await request(prefix + '/roles/' + binding.id, 'DELETE', undefined, owner.cookie)).status, 409)
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      await tx.delete(s.roles).where(eq(s.roles.id, duplicate))
    })
  })
  await t.test('revoked invitations cannot grant membership and lists never disclose invitation tokens', async () => {
    const response = await request(
      prefix + '/invitations',
      'POST',
      { email: other.email, role: 'member' },
      owner.cookie,
    )
    const { id } = (await response.json()) as { id: string }
    assert.equal(response.status, 201)
    const invitation = [...mail]
      .reverse()
      .find(message => message.to === other.email && message.subject === 'Organization invitation')!
    const list = await request(prefix + '/invitations', 'GET', undefined, owner.cookie)
    assert.ok(!(await list.text()).includes('tokenHash'))
    assert.equal((await request(prefix + '/invitations/' + id, 'DELETE', undefined, owner.cookie)).status, 200)
    assert.equal(
      (
        await request(
          '/v1/invitations/accept',
          'POST',
          {
            token: new URL(invitation.text).searchParams.get('invitation'),
          },
          other.cookie,
        )
      ).status,
      403,
    )
  })
  await t.test('single writer, identical retries, conflicting replays and gaps', async () => {
    const id = randomUUID()
    assert.equal(
      (await request(prefix + '/sessions', 'POST', { id, header: { id, version: 2, createdAt: 1000, isSeeded: false } }, owner.cookie)).status,
      201,
    )
    const lease = await request(prefix + '/sessions/' + id + '/lease', 'POST', {}, owner.cookie)
    const { writer } = (await lease.json()) as { writer: string }
    assert.ok(writer)
    assert.equal((await request(prefix + '/sessions/' + id + '/lease', 'POST', {}, owner.cookie)).status, 409)
    const message = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
    const events = [{ seq: 0, time: 1000, type: 'user/message', data: message('private'), surfaceOp: 'append' }]
    const append = () => request(prefix + '/sessions/' + id + '/events', 'POST', { writer, events }, owner.cookie)
    assert.equal((await append()).status, 200)
    assert.equal((await append()).status, 200)
    const conflict = await request(
      prefix + '/sessions/' + id + '/events',
      'POST',
      { writer, events: [{ ...events[0], data: message('changed') }] },
      owner.cookie,
    )
    assert.equal(conflict.status, 409)
    const gap = await request(
      prefix + '/sessions/' + id + '/events',
      'POST',
      { writer, events: [{ ...events[0], seq: 4 }] },
      owner.cookie,
    )
    assert.equal(gap.status, 409)
    const read = await request(prefix + '/sessions/' + id + '/events', 'GET', undefined, owner.cookie)
    assert.equal(((await read.json()) as { events: unknown[] }).events.length, 1)
  })
  await t.test('native persistence round-trips pages, forks, live events and fences expired writers', async (nativeT) => {
    const registered = await request(prefix + '/runtimes', 'POST', { name: 'Persistence test', type: 'desktop', version: 'test', capabilities: [] }, owner.cookie)
    assert.equal(registered.status, 201, await registered.clone().text())
    const device = await registered.json() as { id: string; token: string; leaseUntil: string }
    const credential = JSON.stringify({
      apiOrigin: config.apiUrl,
      organizationId: org.id,
      runtimeId: device.id,
      token: device.token,
      leaseUntil: device.leaseUntil,
    })
    const settings = { apiUrl: config.apiUrl, keychainAccount: createHash('sha256').update(config.apiUrl).digest('hex') + ':' + org.id + ':' + device.id,
      keychainHelper: '/test/keychain-helper', requestTimeoutMs: 10000, maxResponseBytes: 16777216 }
    const io = { readCredential: async () => credential, request: (url: URL, init: RequestInit) => app.request(url, init) }
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const persistence = new EnterpriseSessionPersistence(ctx, settings, io)
    const secondContext = new Context()
    const second = new EnterpriseSessionPersistence(secondContext, settings, io)
    try {
      const id = SessionId(randomUUID())
      const header = { id, version: SESSION_FORMAT_VERSION, createdAt: 1000, isSeeded: false }
      const writer = await persistence.create(header)
      assert.ok(await second.stat(id), 'Create acknowledges durable server state, even before append')
      await assert.rejects(second.open(id, 'write'), SessionAlreadyOwnedError)
      const log: SessionEvent[] = Array.from({ length: 502 }, (_, index) => ({
        type: 'turn/start' as const, seq: SessionSeq(index), time: index, data: { turn: index + 1 },
      }))
      await writer.append(log)
      await writer.append([])
      assert.deepEqual(await writer.read(), log)
      assert.deepEqual(await writer.read(499, 2), log.slice(499, 501))
      const reader = await second.open(id, 'read')
      await assert.rejects(reader.flush(), SessionReadOnlyError)
      await assert.rejects(writer.append(log), /expected 502/)
      const before = await persistence.stat(id)
      await writer.append([{ type: 'turn/end', seq: SessionSeq(502), time: 503, data: { turn: 502, reason: { kind: 'completed' } } }])
      assert.notEqual((await persistence.stat(id))?.revision, before?.revision)
      assert.equal((await reader.read()).length, 503)
      await reader.close()
      await assert.rejects(reader.read(), SessionHandleClosedError)
      await writer.close()
      const reopened = await second.open(id, 'write')
      await reopened.close()

      const forkId = SessionId(randomUUID())
      const fork = await persistence.create(
        { ...header, id: forkId, isSeeded: true, parentSession: id },
        { inheritedEventCount: SessionLogOffset(2) },
      )
      await fork.append(log.slice(0, 2))
      await fork.close()
      const forkReader = await second.open(forkId, 'read')
      assert.equal(forkReader.inheritedEventCount, 2)
      assert.deepEqual(await forkReader.read(), log.slice(0, 2))
      await forkReader.close()

      assert.equal((await request(prefix + '/sessions', 'POST', {
        id: randomUUID(), header: { ...header, seedLength: 0 },
      }, owner.cookie)).status, 400)
      const rejectedId = SessionId(randomUUID())
      const rejected = await persistence.create({ ...header, id: rejectedId })
      await rejected.append([{ type: 'future/required', seq: SessionSeq(0), time: 1, data: {} }] as unknown as SessionEvent[])
      await rejected.close()
      await assert.rejects(second.open(rejectedId, 'write'), /unknown to this harness/)
      await assert.rejects(second.open(rejectedId, 'write'), /unknown to this harness/)

      let created!: () => void
      let releaseCreate!: () => void
      const creating = new Promise<void>((resolve) => { created = resolve })
      const resumeCreate = new Promise<void>((resolve) => { releaseCreate = resolve })
      const disposingContext = new Context()
      const disposing = new EnterpriseSessionPersistence(disposingContext, settings, { ...io, request: async (url, init) => {
        if (init.method === 'POST' && url.pathname.endsWith('/sessions')) { created(); await resumeCreate }
        return app.request(url, init)
      } })
      const disposingId = SessionId(randomUUID())
      const pendingCreate = disposing.create({ ...header, id: disposingId })
      let stopped: Promise<void> | undefined
      try {
        await Promise.race([creating, pendingCreate.then(() => { throw new Error('Create missed the transport barrier') })])
        stopped = disposingContext.fiber.dispose()
        releaseCreate()
        const stoppedHandle = await pendingCreate
        await stopped
        await assert.rejects(stoppedHandle.read(), SessionHandleClosedError)
        const releasedWriter = await second.open(disposingId, 'write')
        await releasedWriter.close()
      } finally {
        releaseCreate()
        await Promise.allSettled([pendingCreate, stopped ?? disposingContext.fiber.dispose()])
      }

      const live = ctx.sessions.create(SessionId(randomUUID()))
      const liveWriter = await persistence.create(live.header)
      live.append('turn/start', { turn: 1 })
      live.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      await ctx.sessions.flush(live)
      assert.equal((await liveWriter.read()).length, 2)
      await liveWriter.close()

      const expired = await persistence.open(id, 'write')
      await pool.db.transaction(async (tx) => {
        await selectOrganization(tx, organizationId.parse(org.id))
        const changed = await tx.update(s.conversations).set({ leaseUntil: new Date(0) }).where(eq(s.conversations.id, id)).returning()
        assert.equal(changed.length, 1)
      })
      await assert.rejects(expired.flush(), SessionOwnershipLostError)
      await assert.rejects(expired.close(), SessionOwnershipLostError)
      const replacement = await second.open(id, 'write')
      await replacement.flush()
      await replacement.close()

      let dropAcknowledgement = true
      const uncertainContext = new Context()
      const uncertain = new EnterpriseSessionPersistence(uncertainContext, settings, { ...io, request: async (url, init) => {
        const response = await app.request(url, init)
        if (dropAcknowledgement && init.method === 'POST' && url.pathname.endsWith('/events')) {
          dropAcknowledgement = false
          await response.body?.cancel()
          throw new Error('Transport disconnected after commit; secret fixture detail')
        }
        return response
      } })
      try {
        const uncertainId = SessionId(randomUUID())
        const uncertainWriter = await uncertain.create({ ...header, id: uncertainId })
        await assert.rejects(uncertainWriter.append(log.slice(0, 1)), SessionOwnershipLostError)
        await assert.rejects(uncertainWriter.append(log.slice(0, 1)), SessionOwnershipLostError)
        assert.equal((await second.stat(uncertainId))?.eventCount, 1, 'A lost acknowledgement must not cause a second append')
        await assert.rejects(uncertainWriter.close(), SessionOwnershipLostError)
        const reconciled = await second.open(uncertainId, 'write')
        assert.deepEqual(await reconciled.read(), log.slice(0, 1))
        await reconciled.close()
      } finally { await uncertainContext.fiber.dispose() }

      const batchPrefix = 'paged-' + randomUUID() + '-'
      await pool.db.transaction(async (tx) => {
        await selectOrganization(tx, organizationId.parse(org.id))
        await tx.insert(s.conversations).values(Array.from({ length: 101 }, (_, index) => ({
          id: batchPrefix + String(index), organizationId: org.id, accountId: owner.id,
          header: { ...header, id: batchPrefix + String(index) },
        })))
      })
      assert.equal((await persistence.list()).filter(item => item.header.id.startsWith(batchPrefix)).length, 101)

      await nativeT.test('built persistence loads through dsh with real Keychain and PostgreSQL', {
        skip: process.env.ENTERPRISE_TEST_KEYCHAIN !== '1' || process.platform !== 'darwin',
      }, async (profileT) => {
        const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
        assert.ok(server instanceof Server)
        profileT.after(() => new Promise<void>((resolve, reject) => {
          server.close((error) => { if (error) reject(error); else resolve() })
          server.closeAllConnections()
        }))
        await once(server, 'listening')
        const address = server.address()
        assert.ok(address && typeof address !== 'string')
        const apiUrl = 'http://127.0.0.1:' + String(address.port)
        const nativeSettings = { ...settings, apiUrl,
          keychainAccount: createHash('sha256').update(apiUrl).digest('hex') + ':' + org.id + ':' + device.id,
          keychainHelper: fileURLToPath(new URL('../../electrobun/build/native/keychain', import.meta.url)),
        }
        const store = new DesktopKeychain(nativeSettings.keychainHelper)
        profileT.after(() => store.delete(nativeSettings.keychainAccount))
        await store.set(nativeSettings.keychainAccount, JSON.stringify({ ...JSON.parse(credential), apiOrigin: apiUrl }))
        const profileId = randomUUID()
        const result = await nativeProfile(profileT, {
          rows: [{ id: 'persistence', name: fileURLToPath(new URL('../../electrobun/lib/session-provider.js', import.meta.url)), config: nativeSettings }],
          driver: `export const inject = ['sessionPersistence'];
export async function apply(ctx) {
  const header = ${JSON.stringify({ ...header, id: profileId })};
  const writer = await ctx.sessionPersistence.create(header);
  await writer.append(${JSON.stringify(log.slice(0, 2))});
  await writer.flush();
  await writer.close();
  const reader = await ctx.sessionPersistence.open(header.id, 'read');
  const events = await reader.read();
  await reader.close();
  console.log('ENTERPRISE_NATIVE_PROFILE ' + JSON.stringify(events));
}`,
        })
        assert.deepEqual(JSON.parse(result), log.slice(0, 2))
        assert.ok(!result.includes(device.token))
        assert.equal((await second.stat(SessionId(profileId)))?.eventCount, 2)
      })

      const revoked = await persistence.open(id, 'write')
      await request(prefix + '/runtimes/' + device.id, 'DELETE', undefined, owner.cookie)
      await assert.rejects(revoked.flush(), SessionOwnershipLostError)
      await assert.rejects(revoked.close())
    } finally {
      await Promise.all([ctx.fiber.dispose(), secondContext.fiber.dispose()])
      await request(prefix + '/runtimes/' + device.id, 'DELETE', undefined, owner.cookie)
    }
  })
  await t.test('private mode rejects a second organization', async () => {
    await pool.db
      .update(s.deployment)
      .set({ mode: 'private', registration: 'invite_only' })
      .where(eq(s.deployment.id, 'primary'))
    assert.equal((await request('/v1/organizations', 'POST', { name: 'Not permitted' }, owner.cookie)).status, 403)
    await pool.db.update(s.deployment).set({ mode: 'open', registration: 'open' }).where(eq(s.deployment.id, 'primary'))
  })
  await t.test('single-use desktop codes require the original PKCE verifier and revoked tokens fail', async () => {
    const verifier = randomBytes(32).toString('base64url')
    const authorize = await request(
      '/v1/desktop/authorize',
      'POST',
      {
        organizationId: org.id,
        challenge: createHash('sha256').update(verifier).digest('base64url'),
        callback: 'http://127.0.0.1:45678/callback',
        state: randomBytes(32).toString('hex'),
      },
      owner.cookie,
    )
    assert.equal(authorize.status, 200, await authorize.clone().text())
    const { callback } = (await authorize.json()) as { callback: string }
    const code = new URL(callback).searchParams.get('code')
    assert.equal(
      (await request('/desktop/token', 'POST', { code, verifier: randomBytes(32).toString('base64url') })).status,
      403,
    )
    const exchange = await request('/desktop/token', 'POST', { code, verifier })
    assert.equal(exchange.status, 200, await exchange.clone().text())
    const token = (await exchange.json()) as { token: string; runtimeId: string }
    assert.equal((await request('/desktop/token', 'POST', { code, verifier })).status, 403)
    const modelRequest = () =>
      app.request(config.apiUrl + prefix + '/models', { headers: { Authorization: 'Bearer ' + token.token } })
    const catalog = await modelRequest()
    assert.equal(catalog.status, 200)
    assert.equal(
      (
        await app.request(config.apiUrl + '/v1/platform/models', {
          headers: { Authorization: 'Bearer ' + token.token },
        })
      ).status,
      401,
    )
    await request(prefix + '/runtimes/' + token.runtimeId, 'DELETE', undefined, owner.cookie)
    assert.equal((await modelRequest()).status, 403)
  })
  await t.test('expired runtimes do not consume the registration quota', async () => {
    const expiredIds = [randomUUID(), randomUUID()]
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      for (const id of expiredIds) {
        const token = randomBytes(32).toString('base64url')
        await tx.insert(s.runtimes).values({
          id,
          organizationId: org.id,
          accountId: owner.id,
          name: 'expired desktop fixture',
          type: 'desktop',
          version: 'test',
          capabilities: [],
          tokenHash: createHash('sha256').update(token).digest('hex'),
          leaseUntil: new Date(0),
        })
      }
    })
    try {
      const verifier = randomBytes(32).toString('base64url')
      const authorize = await request('/v1/desktop/authorize', 'POST', {
        organizationId: org.id,
        challenge: createHash('sha256').update(verifier).digest('base64url'),
        callback: 'http://127.0.0.1:45678/callback',
        state: randomBytes(32).toString('hex'),
      }, owner.cookie)
      assert.equal(authorize.status, 200, await authorize.clone().text())
      const { callback } = (await authorize.json()) as { callback: string }
      const code = new URL(callback).searchParams.get('code')
      const exchange = await request('/desktop/token', 'POST', { code, verifier })
      assert.equal(exchange.status, 200, await exchange.clone().text())
      const token = (await exchange.json()) as { runtimeId: string }
      await request(prefix + '/runtimes/' + token.runtimeId, 'DELETE', undefined, owner.cookie)
      const registered = await request(prefix + '/runtimes', 'POST', {
        name: 'expired quota fixture', type: 'desktop', version: 'test', capabilities: [],
      }, owner.cookie)
      assert.equal(registered.status, 201, await registered.clone().text())
      await request(prefix + '/runtimes/' + (await registered.json() as { id: string }).id, 'DELETE', undefined, owner.cookie)
    } finally {
      for (const id of expiredIds) await request(prefix + '/runtimes/' + id, 'DELETE', undefined, owner.cookie)
    }
  })
  await t.test('model prices use CNY per million tokens and return human units', async () => {
    const created = await request('/v1/platform/models', 'POST', {
      name: 'CNY price fixture',
      baseUrl: 'https://api.deepseek.com',
      upstreamModel: 'fixture',
      apiKey: 'fixture-key',
      inputPriceCnyPerMillion: 2.5,
      cachedInputPriceCnyPerMillion: 0.25,
      outputPriceCnyPerMillion: 8,
      contextTokens: 1024,
      maxOutputTokens: 128,
    }, owner.cookie)
    assert.equal(created.status, 201, await created.clone().text())
    const { id } = await created.json() as { id: string }
    try {
      const models = await request('/v1/platform/models', 'GET', undefined, owner.cookie)
      assert.equal(models.status, 200, await models.clone().text())
      assert.equal((await request('/v1/platform/models', 'GET', undefined, other.cookie)).status, 403)
      const model = (await models.json() as Array<Record<string, unknown>>).find(value => value.id === id)
      assert.deepEqual(model && {
        baseUrl: model.baseUrl,
        upstreamModel: model.upstreamModel,
        input: model.inputPriceCnyPerMillion,
        cached: model.cachedInputPriceCnyPerMillion,
        output: model.outputPriceCnyPerMillion,
        timeout: model.modelCallTimeoutMs,
        videoAudioMode: model.videoAudioMode,
        legacyInputExposed: 'inputMicrosPerMillion' in model,
      }, { baseUrl: 'https://api.deepseek.com', upstreamModel: 'fixture', input: 2.5, cached: 0.25, output: 8, timeout: 300_000, videoAudioMode: 'visual-only', legacyInputExposed: false })
      assert.equal((await request('/v1/platform/models/' + id, 'PATCH', {
        maxRequestBytes: 1,
      }, owner.cookie)).status, 400)
      assert.equal((await request('/v1/platform/models/' + id, 'PATCH', {
        fileRefreshMarginSeconds: 604_800,
      }, owner.cookie)).status, 400)
      assert.equal((await request('/v1/platform/models/' + id, 'PATCH', {
        inputModalities: ['text', 'audio'],
      }, owner.cookie)).status, 400)
      assert.equal((await request('/v1/platform/models/' + id, 'PATCH', {
        fileInputPolicy: 'signed-url',
      }, owner.cookie)).status, 400)
      assert.equal((await request('/v1/platform/models/' + id, 'PATCH', {
        videoAudioMode: 'visual-and-audio',
      }, owner.cookie)).status, 400)
      for (const modelCallTimeoutMs of [999, 30 * 60 * 1_000 + 1]) {
        assert.equal((await request('/v1/platform/models/' + id, 'PATCH', {
          modelCallTimeoutMs,
        }, owner.cookie)).status, 400)
      }
      const patched = await request('/v1/platform/models/' + id, 'PATCH', {
        cachedInputPriceCnyPerMillion: 0.5,
        modelCallTimeoutMs: 240_000,
        inputModalities: ['text', 'video'],
        fileInputPolicy: 'provider-files',
        videoAudioMode: 'visual-and-audio',
      }, owner.cookie)
      assert.equal(patched.status, 200, await patched.clone().text())
      const [stored] = await pool.db.select().from(s.models).where(eq(s.models.id, id))
      assert.equal(stored?.cachedInputPriceMicrosCnyPerMillion, 500_000)
      assert.equal(stored?.modelCallTimeoutMs, 240_000)
      assert.equal(stored?.videoAudioMode, 'visual-and-audio')
    } finally {
      await request('/v1/platform/models/' + id, 'DELETE', undefined, owner.cookie)
    }
  })
  await t.test('enabled platform models are available to every organization without grants', async () => {
    const modelId = randomUUID()
    await pool.db.insert(s.models).values({
      id: modelId,
      name: 'Platform-wide fixture',
      baseUrl: 'https://api.deepseek.com',
      upstreamModel: 'fixture',
      secret: 'not-used',
      contextTokens: 1024,
      maxOutputTokens: 128,
      inputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0,
    })
    const runtimes: string[] = []
    try {
      for (const [organization, cookie] of [[org.id, owner.cookie], [otherOrg.id, other.cookie]] as const) {
        const registered = await request('/v1/organizations/' + organization + '/runtimes', 'POST', {
          name: 'Platform model fixture', type: 'desktop', version: 'test', capabilities: [],
        }, cookie)
        assert.equal(registered.status, 201, await registered.clone().text())
        const device = await registered.json() as { id: string; token: string }
        runtimes.push(device.id)
        const catalog = await app.request(config.apiUrl + '/v1/organizations/' + organization + '/models', {
          headers: { Authorization: 'Bearer ' + device.token },
        })
        assert.equal(catalog.status, 200, await catalog.clone().text())
        const model = (await catalog.json() as Array<Record<string, unknown>>).find(value => value.id === modelId)
        assert.ok(model)
        assert.equal('baseUrl' in model, false)
        assert.equal('upstreamModel' in model, false)
        assert.equal('secret' in model, false)
      }
      await request('/v1/platform/models/' + modelId, 'PATCH', { enabled: false }, owner.cookie)
      const registered = await request('/v1/organizations/' + org.id + '/runtimes', 'POST', {
        name: 'Disabled platform model fixture', type: 'desktop', version: 'test', capabilities: [],
      }, owner.cookie)
      assert.equal(registered.status, 201, await registered.clone().text())
      const disabled = await registered.json() as { id: string; token: string }
      runtimes.push(disabled.id)
      const catalog = await app.request(config.apiUrl + '/v1/organizations/' + org.id + '/models', {
        headers: { Authorization: 'Bearer ' + disabled.token },
      })
      assert.equal(catalog.status, 200)
      assert.ok(!(await catalog.json() as { id: string }[]).some(model => model.id === modelId))
    } finally {
      await pool.db.update(s.models).set({ enabled: true }).where(eq(s.models.id, modelId))
      for (const runtime of runtimes) {
        const organization = runtime === runtimes[1] ? otherOrg.id : org.id
        const cookie = organization === org.id ? owner.cookie : other.cookie
        await request('/v1/organizations/' + organization + '/runtimes/' + runtime, 'DELETE', undefined, cookie)
      }
      await pool.db.delete(s.models).where(eq(s.models.id, modelId))
    }
  })
  await t.test('native loopback login exchanges a real Better Auth authorization and saves only to Keychain', async () => {
    const saved: string[] = []
    const device = await loginDesktop({
      apiUrl: config.apiUrl, portalUrl: config.portalOrigin,
      signal: AbortSignal.timeout(15000),
      request: (input, init) => app.request(input instanceof Request ? input : String(input), init),
      keychain: { set: async (_account, value) => { saved.push(value) } },
      openBrowser: async (url) => {
        const parameters = Object.fromEntries(new URL(url).searchParams)
        const approval = await request('/v1/desktop/authorize', 'POST', { ...parameters, organizationId: org.id }, owner.cookie)
        assert.equal(approval.status, 200)
        const result = await approval.json() as { callback: string }
        assert.equal((await fetch(result.callback)).status, 204)
      },
    })
    assert.equal(saved.length, 1)
    const credential = JSON.parse(saved[0]) as { token: string }
    assert.ok(!JSON.stringify(device).includes(credential.token))
    assert.equal((await app.request(config.apiUrl + prefix + '/models', {
      headers: { Authorization: 'Bearer ' + credential.token },
    })).status, 200)
    assert.equal((await request(prefix + '/runtimes/' + device.runtimeId, 'DELETE', undefined, owner.cookie)).status, 200)
  })
  await t.test('redemption codes are one-time, paged, revocable, expiring, and tenant isolated', async () => {
    const created = await request('/v1/organizations', 'POST', { name: 'Wallet fixture organization' }, owner.cookie)
    assert.equal(created.status, 201, await created.clone().text())
    const walletOrg = await created.json() as { id: string }
    const walletPrefix = '/v1/organizations/' + walletOrg.id
    const initial = await request(walletPrefix + '/wallet', 'GET', undefined, owner.cookie)
    assert.equal(initial.status, 200, await initial.clone().text())
    assert.equal((await initial.json() as { balanceMicrosCny: number }).balanceMicrosCny, 0)

    const batchResponse = await request('/v1/platform/redemption-code-batches', 'POST', {
      amountCny: '0.5', count: 4, note: 'wallet behavior fixture',
    }, owner.cookie)
    assert.equal(batchResponse.status, 201, await batchResponse.clone().text())
    const batch = await batchResponse.json() as { batchId: string; codes: string[] }
    assert.equal(batch.codes.length, 4)
    const listed = await request('/v1/platform/redemption-codes?batchId=' + batch.batchId + '&limit=1', 'GET', undefined, owner.cookie)
    assert.equal(listed.status, 200, await listed.clone().text())
    const listedBody = await listed.json() as { items: Array<{ id: string; codeHint: string }>; nextCursor: string | null }
    assert.equal(listedBody.items.length, 1)
    assert.ok(listedBody.nextCursor)
    assert.ok(!JSON.stringify(listedBody).includes(batch.codes[0] ?? 'missing-code'))
    const next = await request('/v1/platform/redemption-codes?batchId=' + batch.batchId + '&limit=1&cursor=' + encodeURIComponent(listedBody.nextCursor!), 'GET', undefined, owner.cookie)
    assert.equal((await next.json() as { items: unknown[] }).items.length, 1)

    const firstCode = batch.codes[0]!
    assert.equal((await request(walletPrefix + '/wallet/redeem', 'POST', { code: firstCode }, owner.cookie)).status, 200)
    assert.equal((await request(walletPrefix + '/wallet/redeem', 'POST', { code: firstCode }, owner.cookie)).status, 409)
    const redeemedRows = await request('/v1/platform/redemption-codes?batchId=' + batch.batchId + '&status=redeemed', 'GET', undefined, owner.cookie)
    const redeemedId = (await redeemedRows.json() as { items: Array<{ id: string }> }).items[0]?.id
    assert.ok(redeemedId)
    assert.equal((await request('/v1/platform/redemption-codes/' + redeemedId + '/revoke', 'POST', undefined, owner.cookie)).status, 409)

    const concurrent = await Promise.all([
      request(walletPrefix + '/wallet/redeem', 'POST', { code: batch.codes[1] }, owner.cookie),
      request('/v1/organizations/' + otherOrg.id + '/wallet/redeem', 'POST', { code: batch.codes[1] }, other.cookie),
    ])
    assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409])
    const balances = await Promise.all([
      request(walletPrefix + '/wallet', 'GET', undefined, owner.cookie).then(response => response.json() as Promise<{ balanceMicrosCny: number }>),
      request('/v1/organizations/' + otherOrg.id + '/wallet', 'GET', undefined, other.cookie).then(response => response.json() as Promise<{ balanceMicrosCny: number }>),
    ])
    assert.equal(balances[0].balanceMicrosCny + balances[1].balanceMicrosCny, 1_000_000)

    const availableRows = await request('/v1/platform/redemption-codes?batchId=' + batch.batchId + '&status=available', 'GET', undefined, owner.cookie)
    const availableId = (await availableRows.json() as { items: Array<{ id: string }> }).items[0]?.id
    assert.ok(availableId)
    assert.equal((await request('/v1/platform/redemption-codes/' + availableId + '/revoke', 'POST', undefined, owner.cookie)).status, 200)
    const revokedRows = await request('/v1/platform/redemption-codes?batchId=' + batch.batchId + '&status=revoked', 'GET', undefined, owner.cookie)
    const revokedHint = (await revokedRows.json() as { items: Array<{ codeHint: string }> }).items[0]?.codeHint
    const revokedCode = batch.codes.find(code => code.endsWith(revokedHint ?? 'missing-hint'))
    assert.ok(revokedCode)
    assert.equal((await request(walletPrefix + '/wallet/redeem', 'POST', { code: revokedCode }, owner.cookie)).status, 409)

    const expiring = await request('/v1/platform/redemption-code-batches', 'POST', {
      amountCny: '1', count: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, owner.cookie)
    const expiringBatch = await expiring.json() as { batchId: string; codes: string[] }
    await pool.db.update(s.redemptionCodes).set({ expiresAt: new Date(0) }).where(eq(s.redemptionCodes.batchId, expiringBatch.batchId))
    assert.equal((await request(walletPrefix + '/wallet/redeem', 'POST', { code: expiringBatch.codes[0] }, owner.cookie)).status, 409)
  })
  await t.test('native LLM relays native paths and settles usage against the team wallet', async (caseOwner) => {
    const deviceResponse = await request(prefix + '/runtimes', 'POST', {
      name: 'native gateway fixture', type: 'desktop', version: '0.1.0', capabilities: [],
    }, owner.cookie)
    assert.equal(deviceResponse.status, 201)
    const device = await deviceResponse.json() as { id: string; token: string; leaseUntil: string }
    caseOwner.after(async () => {
      await pool.db.transaction(async (tx) => {
        await selectOrganization(tx, organizationId.parse(org.id))
        await tx.update(s.runtimes).set({ revokedAt: new Date() }).where(eq(s.runtimes.id, device.id))
        await tx.update(s.organizationWallets).set({ balanceMicrosCny: 1_000_000 })
          .where(eq(s.organizationWallets.organizationId, org.id))
      })
    })
    const id = randomUUID()
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      await tx.insert(s.models).values({ id, name: 'Relay fixture', baseUrl: 'https://api.deepseek.com',
        upstreamModel: 'fixture', secret: encrypt('fixture-upstream-key', config.encryptionKey, id),
        inputModalities: ['text', 'image', 'audio'], fileInputPolicy: 'provider-files',
        inputMicrosPerMillion: 0, outputMicrosPerMillion: 0,
        inputPriceMicrosCnyPerMillion: 2_000_000,
        cachedInputPriceMicrosCnyPerMillion: 500_000,
        outputPriceMicrosCnyPerMillion: 8_000_000,
        maxFileBytes: 16, maxRequestBytes: 24,
        maxOutputTokens: 128, contextTokens: 1024 })
    })
    const callsBeforeFunding = upstream.state.calls
    const unfunded = await app.request(config.apiUrl + '/model/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + device.token,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
        'X-DSH-Model': id,
      },
      body: JSON.stringify({ model: id, messages: [{ role: 'user', content: 'unfunded' }] }),
    })
    assert.equal(unfunded.status, 402, await unfunded.clone().text())
    assert.deepEqual(await unfunded.json(), { error: 'INSUFFICIENT_TEAM_BALANCE' })
    assert.equal(upstream.state.calls, callsBeforeFunding)
    await pool.db.insert(s.platformAdmins).values({ accountId: owner.id }).onConflictDoNothing()
    const batch = await request('/v1/platform/redemption-code-batches', 'POST', {
      amountCny: '1', count: 1, note: 'native relay fixture',
    }, owner.cookie)
    assert.equal(batch.status, 201, await batch.clone().text())
    const [code] = (await batch.json() as { codes: string[] }).codes
    assert.ok(code)
    const redeemed = await request(prefix + '/wallet/redeem', 'POST', { code }, owner.cookie)
    assert.equal(redeemed.status, 200, await redeemed.clone().text())
    assert.equal((await redeemed.json() as { balanceMicrosCny: number }).balanceMicrosCny, 1_000_000)
    const callsBeforeNamespaceChecks = upstream.state.calls
    const relayHeaders = {
      Authorization: 'Bearer ' + device.token,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    }
    const outsideNamespace = await app.request(config.apiUrl + '/chat/completions', {
      method: 'POST', headers: { ...relayHeaders, 'X-DSH-Model': id },
      body: JSON.stringify({ model: id, messages: [] }),
    })
    assert.equal(outsideNamespace.status, 404, await outsideNamespace.clone().text())
    const upstreamName = await app.request(config.apiUrl + '/model/chat/completions', {
      method: 'POST', headers: relayHeaders,
      body: JSON.stringify({ model: 'fixture', messages: [] }),
    })
    assert.equal(upstreamName.status, 400, await upstreamName.clone().text())
    const unavailableModel = randomUUID()
    const unavailable = await app.request(config.apiUrl + '/model/chat/completions', {
      method: 'POST', headers: { ...relayHeaders, 'X-DSH-Model': unavailableModel },
      body: JSON.stringify({ model: unavailableModel, messages: [] }),
    })
    assert.equal(unavailable.status, 403, await unavailable.clone().text())
    const mismatched = await app.request(config.apiUrl + '/model/chat/completions', {
      method: 'POST', headers: { ...relayHeaders, 'X-DSH-Model': id },
      body: JSON.stringify({ model: randomUUID(), messages: [] }),
    })
    assert.equal(mismatched.status, 400, await mismatched.clone().text())
    assert.equal(upstream.state.calls, callsBeforeNamespaceChecks)
    const runtimeResolution = await pool.db.execute(sql`
      SELECT id, organization_id, account_id, email, lease_until, revoked_at
      FROM enterprise_auth.resolve_runtime_token(${createHash('sha256').update(device.token).digest('hex')})
    `)
    assert.equal(runtimeResolution.length, 1)
    assert.equal(runtimeResolution[0]?.organization_id, org.id)
    const ctx = new Context()
    const filesService = await ctx.plugin(LlmFilesRuntime)
    caseOwner.after(() => filesService.dispose())
    const service = await ctx.plugin(LlmRuntime)
    caseOwner.after(() => service.dispose())
    const adapter = new EnterpriseGatewayAdapter({ apiUrl: config.apiUrl,
      keychainAccount: createHash('sha256').update(config.apiUrl).digest('hex') + ':' + org.id + ':' + device.id,
      keychainHelper: '/unused-helper', requestTimeoutMs: 10000, fileProcessingPollMs: 1,
      maxEventChars: 65536, maxResponseChars: 262144 }, {
      readCredential: () => Promise.resolve(JSON.stringify({ apiOrigin: config.apiUrl, organizationId: org.id,
        runtimeId: device.id, token: device.token, leaseUntil: device.leaseUntil })),
      request: (url, init) => app.request(url, init),
      files: ctx.llmFiles,
      resolveMedia: async ref => ({ mediaType: ref.mediaType,
        data: Uint8Array.from([...Buffer.from('RIFF', 'binary'), 0, 0, 0, 0, ...Buffer.from('WAVE', 'binary')]) }),
    })
    const disposeFiles = ctx.llmFiles.registerProvider(adapter.filesProvider())
    caseOwner.after(() => { disposeFiles() })
    const dispose = ctx.llm.registerAdapter(['enterprise'], adapter)
    caseOwner.after(() => { dispose() })
    const media = Uint8Array.from([...Buffer.from('RIFF', 'binary'), 0, 0, 0, 0, ...Buffer.from('WAVE', 'binary')])
    const attachmentId = AttachmentId(`sha256:${createHash('sha256').update(media).digest('hex')}`)
    const options = { provider: 'enterprise', model: id, messages: [createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'text', text: 'Reply' },
      { type: 'audio', attachment: { attachmentId, name: 'voice.wav', bytes: media.byteLength, mediaType: 'audio/wav' } },
    ] })] }
    const run = async () => {
      const chunks: StreamChunk[] = []
      for await (const chunk of ctx.llm.stream(options)) chunks.push(chunk)
      return chunks
    }
    upstream.state.mode = 'normal'
    const completed = await Promise.all([run(), run()])
    assert.equal(upstream.state.calls, 2, JSON.stringify(completed))
    assert.equal(upstream.state.fileUploads.length, 1)
    for (const request of upstream.state.requests as Array<{ messages: Array<{ content: unknown }> }>) {
      assert.deepEqual(request.messages[0]?.content, [
        { type: 'text', text: 'Reply' },
        { type: 'input_audio', input_audio: { file_id: 'file-1' } },
      ])
    }
    for (const chunks of completed) {
      assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
    }
    const heartbeat = await app.request(config.apiUrl + prefix + '/runtimes/' + device.id + '/heartbeat', {
      method: 'POST', headers: { Authorization: 'Bearer ' + device.token, 'Content-Type': 'application/json' }, body: '{}',
    })
    assert.equal(heartbeat.status, 200, await heartbeat.clone().text())
    const heartbeatBody = await heartbeat.json() as { policyRevision: number }
    const upload = (data: Uint8Array, name: string, mediaType: string) => {
      const form = new FormData()
      form.append('purpose', 'user_data')
      form.append('file', new Blob([data], { type: mediaType }), name)
      return app.request(config.apiUrl + '/model/files', {
        method: 'POST', headers: {
          Authorization: 'Bearer ' + device.token,
          'X-DSH-Model': id,
          'X-DSH-Policy-Revision': String(heartbeatBody.policyRevision),
          'X-DSH-Purpose': 'chat',
        }, body: form,
      })
    }
    upstream.state.compressFileResponses = true
    const replacement = await upload(media, 'voice.wav', 'audio/wav')
    assert.equal(replacement.status, 200)
    await replacement.arrayBuffer()
    upstream.state.compressFileResponses = false
    const fileHeaders = {
      Authorization: 'Bearer ' + device.token,
      'X-DSH-Model': id,
      'X-DSH-Policy-Revision': String(heartbeatBody.policyRevision),
      'X-DSH-Purpose': 'chat',
    }
    const fileStatus = await app.request(config.apiUrl + '/model/files/file-2', { headers: fileHeaders })
    assert.equal(fileStatus.status, 200, await fileStatus.clone().text())
    assert.deepEqual(await fileStatus.json(), { id: 'file-2', status: 'active' })
    const deletedFile = await app.request(config.apiUrl + '/model/files/file-2', { method: 'DELETE', headers: fileHeaders })
    assert.equal(deletedFile.status, 204, await deletedFile.clone().text())
    const expiredFile = await app.request(config.apiUrl + '/model/files/file-2', { headers: fileHeaders })
    assert.equal(expiredFile.status, 409, await expiredFile.clone().text())
    const image = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])
    const imageUpload = await upload(image, 'image.jpg', 'image/jpeg')
    assert.equal(imageUpload.status, 200, await imageUpload.clone().text())
    assert.equal(upstream.state.fileUploads.length, 3)
    assert.equal(upstream.state.secret, 'Bearer fixture-upstream-key')
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      const entries = await tx.select().from(s.usage).where(eq(s.usage.modelId, id))
      assert.equal(entries.length, 2)
      assert.deepEqual(entries.map(entry => entry.fileUploadCount).sort(), [0, 1])
      assert.equal(entries.reduce((total, entry) => total + entry.uploadedBytes, 0), media.byteLength)
      for (const entry of entries) {
        assert.equal(entry.status, 'settled')
        assert.equal(entry.protocol, 'openai-completions')
        assert.deepEqual(entry.inputModalities, ['text', 'audio'])
        assert.equal(entry.fileUploadFailures, 0)
        assert.equal(entry.reconciliationReason, null)
        assert.equal(entry.failureReason, null)
        assert.equal(entry.reservedMicros, 0)
        assert.equal(entry.actualMicros, null)
        assert.equal(entry.billedMicros, null)
        assert.equal(entry.inputTokens, 12)
        assert.equal(entry.cachedInputTokens, 5)
        assert.equal(entry.uncachedInputTokens, 7)
        assert.equal(entry.outputTokens, 8)
        assert.equal(entry.reasoningTokens, 3)
        assert.equal(entry.totalTokens, 20)
        assert.equal(entry.currency, 'CNY')
        assert.equal(entry.inputCostMicrosCny, 14)
        assert.equal(entry.cachedInputCostMicrosCny, 3)
        assert.equal(entry.outputCostMicrosCny, 64)
        assert.equal(entry.totalCostMicrosCny, 81)
      }
      const [budget] = await tx.select().from(s.subscriptions)
      assert.equal(budget.reservedMicros, 0)
      assert.equal(budget.spentMicros, 0)
    })
    const rejectedModelCall = (content: unknown) => app.request(config.apiUrl + '/model/chat/completions', {
      method: 'POST', headers: {
        Authorization: 'Bearer ' + device.token,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
        'X-DSH-Model': id,
        'X-DSH-Policy-Revision': String(heartbeatBody.policyRevision),
        'X-DSH-Purpose': 'chat',
      },
      body: JSON.stringify({ model: id, messages: [{ role: 'user', content }] }),
    })
    const permanentUrl = await rejectedModelCall([{ type: 'input_audio', input_audio: { audio_url: 'https://objects.example/audio.wav' } }])
    assert.equal(permanentUrl.status, 400, await permanentUrl.clone().text())
    const malformedBase64 = await rejectedModelCall([{ type: 'input_audio', input_audio: { data: 'not-base64!' } }])
    assert.equal(malformedBase64.status, 400, await malformedBase64.clone().text())
    const unissuedProviderFile = await rejectedModelCall([{ type: 'input_audio', input_audio: { file_id: 'file-unissued' } }])
    assert.equal(unissuedProviderFile.status, 409, await unissuedProviderFile.clone().text())
    const oversized = await rejectedModelCall(Array.from({ length: 3 }, () => ({
      type: 'input_audio', input_audio: { data: Buffer.from(media).toString('base64') },
    })))
    assert.equal(oversized.status, 413, await oversized.clone().text())
    assert.equal(upstream.state.calls, 2)
    const visibleUsage = await request(prefix + '/usage?scope=own', 'GET', undefined, owner.cookie)
    assert.equal(visibleUsage.status, 200, await visibleUsage.clone().text())
    assert.equal((await visibleUsage.json() as { items: Array<{ modelId: string }> }).items.filter(entry => entry.modelId === id).length, 2)
    const summary = await request('/v1/platform/usage/summary?modelId=' + id, 'GET', undefined, owner.cookie)
    assert.equal(summary.status, 200, await summary.clone().text())
    const summaryData = await summary.json() as Record<string, unknown>
    assert.deepEqual({ ...summaryData, from: 'range', to: 'range' }, {
      calls: 2,
      pricedCalls: 2,
      inputTokens: 24,
      cachedInputTokens: 10,
      outputTokens: 16,
      reasoningTokens: 6,
      totalTokens: 40,
      totalCostMicrosCny: 162,
      fileUploadCount: 1,
      uploadedBytes: media.byteLength,
      fileUploadFailures: 0,
      from: 'range',
      to: 'range',
      currency: 'CNY',
    })
    assert.doesNotThrow(() => new Date(String(summaryData.from)).toISOString())
    assert.doesNotThrow(() => new Date(String(summaryData.to)).toISOString())
    const protocolSummary = await request('/v1/platform/usage/summary?modelId=' + id + '&protocol=openai-completions&modality=audio', 'GET', undefined, owner.cookie)
    assert.equal(protocolSummary.status, 200, await protocolSummary.clone().text())
    assert.equal((await protocolSummary.json() as { calls: number }).calls, 2)
    const unsupportedModalitySummary = await request('/v1/platform/usage/summary?modelId=' + id + '&modality=video', 'GET', undefined, owner.cookie)
    assert.equal(unsupportedModalitySummary.status, 200, await unsupportedModalitySummary.clone().text())
    assert.equal((await unsupportedModalitySummary.json() as { calls: number }).calls, 0)
    const trend = await request('/v1/platform/usage/timeseries?modelId=' + id, 'GET', undefined, owner.cookie)
    assert.equal(trend.status, 200, await trend.clone().text())
    const trendData = await trend.json() as { values: Array<{ calls: number; totalCostMicrosCny: number }> }
    assert.equal(trendData.values.length, 1)
    assert.equal(trendData.values[0]?.calls, 2)
    assert.equal(trendData.values[0]?.totalCostMicrosCny, 162)
    const breakdown = await request('/v1/platform/usage/breakdown?groupBy=model&modelId=' + id, 'GET', undefined, owner.cookie)
    assert.equal(breakdown.status, 200, await breakdown.clone().text())
    const breakdownData = await breakdown.json() as { values: Array<{ id: string; calls: number }> }
    assert.deepEqual(breakdownData.values.map(value => ({ id: value.id, calls: value.calls })), [{ id, calls: 2 }])
    const records = await request('/v1/platform/usage/records?limit=1&modelId=' + id, 'GET', undefined, owner.cookie)
    assert.equal(records.status, 200, await records.clone().text())
    const recordPage = await records.json() as {
      items: Array<{ cachedInputTokens: number; totalCostMicrosCny: number }>
      nextCursor: string | null
    }
    assert.equal(recordPage.items[0]?.cachedInputTokens, 5)
    assert.equal(recordPage.items[0]?.totalCostMicrosCny, 81)
    assert.ok(recordPage.nextCursor)
    assert.equal((await request('/v1/platform/usage/summary', 'GET', undefined, other.cookie)).status, 403)
    const legacyUsageId = randomUUID()
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      await tx.insert(s.usage).values({
        id: legacyUsageId,
        organizationId: org.id,
        accountId: owner.id,
        runtimeId: device.id,
        modelId: id,
        purpose: 'chat',
        reservedMicros: 0,
        inputTokens: 3,
        outputTokens: 2,
        status: 'settled',
        idempotencyKey: randomUUID(),
        settledAt: new Date(),
      })
    })
    const mixed = await request('/v1/platform/usage/summary?modelId=' + id, 'GET', undefined, owner.cookie)
    assert.equal(mixed.status, 200, await mixed.clone().text())
    const mixedData = await mixed.json() as { calls: number; pricedCalls: number; totalTokens: number; totalCostMicrosCny: number }
    assert.equal(mixedData.calls, 3)
    assert.equal(mixedData.pricedCalls, 2)
    assert.equal(mixedData.totalTokens, 45)
    assert.equal(mixedData.totalCostMicrosCny, 162)
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      await tx.delete(s.usage).where(eq(s.usage.id, legacyUsageId))
    })
    const pendingCnyId = randomUUID()
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      await tx.insert(s.usage).values({
        id: pendingCnyId,
        organizationId: org.id,
        accountId: owner.id,
        runtimeId: device.id,
        modelId: id,
        purpose: 'chat',
        reservedMicros: 0,
        status: 'pending_reconciliation',
        idempotencyKey: randomUUID(),
        pricingVersion: 1,
        inputPriceMicrosCnyPerMillion: 2_000_000,
        cachedInputPriceMicrosCnyPerMillion: 500_000,
        outputPriceMicrosCnyPerMillion: 8_000_000,
        requestStartedAt: new Date(),
      })
    })
    const invalidReconciliation = await request('/v1/platform/organizations/' + org.id + '/usage/' + pendingCnyId + '/reconcile', 'POST', {
      outcome: 'settled', inputTokens: 12, cachedInputTokens: 13, outputTokens: 8,
    }, owner.cookie)
    assert.equal(invalidReconciliation.status, 400, await invalidReconciliation.clone().text())
    const reconciled = await request('/v1/platform/organizations/' + org.id + '/usage/' + pendingCnyId + '/reconcile', 'POST', {
      outcome: 'settled', inputTokens: 12, cachedInputTokens: 5, outputTokens: 8, reasoningTokens: 3, durationMs: 25,
    }, owner.cookie)
    assert.equal(reconciled.status, 200, await reconciled.clone().text())
    assert.deepEqual(await reconciled.json(), { id: pendingCnyId, status: 'settled', currency: 'CNY', totalCostMicrosCny: 81 })
    const duplicateReconciliation = await request('/v1/platform/organizations/' + org.id + '/usage/' + pendingCnyId + '/reconcile', 'POST', {
      outcome: 'settled', inputTokens: 12, cachedInputTokens: 5, outputTokens: 8, reasoningTokens: 3,
    }, owner.cookie)
    assert.equal(duplicateReconciliation.status, 409, await duplicateReconciliation.clone().text())
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      const [row] = await tx.select().from(s.usage).where(eq(s.usage.id, pendingCnyId))
      assert.equal(row?.currency, 'CNY')
      assert.equal(row?.totalTokens, 20)
      assert.equal(row?.totalCostMicrosCny, 81)
      const [wallet] = await tx.select().from(s.organizationWallets)
      assert.equal(wallet?.balanceMicrosCny, 999_757)
      const debits = await tx.select().from(s.walletLedger).where(eq(s.walletLedger.usageId, pendingCnyId))
      assert.equal(debits.length, 1)
      assert.equal(debits[0]?.amountMicrosCny, -81)
      assert.equal(debits[0]?.balanceAfterMicrosCny, 999_757)
    })
    upstream.state.mode = 'truncated'
    const incomplete = (await run()).at(-1)
    assert.ok(incomplete?.type === 'finish' && incomplete.reason.kind === 'error')
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      const entries = await tx.select().from(s.usage).where(eq(s.usage.modelId, id))
      assert.equal(entries.length, 4, JSON.stringify(entries.map(entry => ({ id: entry.id, status: entry.status,
        reason: entry.reconciliationReason }))))
      assert.equal(entries.filter(entry => entry.status === 'pending_reconciliation').length, 1)
      const [pending] = entries.filter(entry => entry.status === 'pending_reconciliation')
      assert.equal(pending?.protocol, 'openai-completions')
      assert.deepEqual(pending?.inputModalities, ['text', 'audio'])
      assert.equal(pending?.reconciliationReason, 'missing_or_invalid_usage')
      assert.equal(pending?.failureReason, null)
      assert.equal((await tx.select().from(s.subscriptions))[0].spentMicros, 0)
    })
    const pendingRecords = await request('/v1/platform/usage/records?modelId=' + id + '&protocol=openai-completions&modality=audio', 'GET', undefined, owner.cookie)
    assert.equal(pendingRecords.status, 200, await pendingRecords.clone().text())
    const pendingRecordPage = await pendingRecords.json() as { items: Array<{
      status: string
      occurredAt: string
      settledAt: string | null
      reconciliationReason: string | null
    }> }
    const pendingRecord = pendingRecordPage.items.find(entry => entry.status === 'pending_reconciliation')
    assert.equal(pendingRecord?.settledAt, null)
    assert.equal(pendingRecord?.reconciliationReason, 'missing_or_invalid_usage')
    assert.doesNotThrow(() => new Date(pendingRecord?.occurredAt ?? '').toISOString())
    upstream.state.mode = 'normal'
    const stale = await app.request(config.apiUrl + '/model/chat/completions', {
      method: 'POST', headers: {
        Authorization: 'Bearer ' + device.token,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
        'X-DSH-Model': id,
        'X-DSH-Policy-Revision': '999999',
      },
      body: JSON.stringify({ model: id, messages: [{ role: 'user', content: 'stale' }] }),
    })
    assert.equal(stale.status, 409, await stale.clone().text())
    assert.equal(upstream.state.calls, 3)
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      assert.equal((await tx.select().from(s.usage).where(eq(s.usage.modelId, id))).length, 4)
      assert.equal((await tx.select().from(s.subscriptions))[0].spentMicros, 0)
    })
    upstream.state.mode = 'rateLimited'
    const rateLimited = (await run()).at(-1)
    assert.ok(rateLimited?.type === 'finish' && rateLimited.reason.kind === 'error')
    assert.deepEqual(rateLimited.reason.kind === 'error' && rateLimited.reason.failure, {
      message: 'Enterprise model rate limit exceeded',
      code: 'RATE_LIMIT',
      status: 429,
    })
    await pool.db.update(s.models).set({ modelCallTimeoutMs: 25 }).where(eq(s.models.id, id))
    upstream.state.mode = 'silent'
    const timedOut = (await run()).at(-1)
    assert.ok(timedOut?.type === 'finish' && timedOut.reason.kind === 'error')
    assert.equal(timedOut.reason.kind === 'error' && timedOut.reason.failure.code, 'TIMEOUT')
    assert.equal(timedOut.reason.kind === 'error' && timedOut.reason.failure.status, 504)
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      const entries = await tx.select().from(s.usage).where(eq(s.usage.modelId, id))
      assert.equal(entries.length, 6)
      const timeout = entries.find(entry => entry.reconciliationReason === 'upstream_timeout')
      assert.equal(timeout?.status, 'pending_reconciliation')
      assert.equal(timeout?.failureReason, 'model_call_failed')
    })
    upstream.state.mode = 'normal'
    const persistenceFailureKey = randomUUID()
    await migration.unsafe('REVOKE INSERT ON enterprise.wallet_ledger FROM enterprise_app')
    try {
      const response = await app.request(config.apiUrl + '/model/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + device.token,
          'Content-Type': 'application/json',
          'Idempotency-Key': persistenceFailureKey,
          'X-DSH-Model': id,
          'X-DSH-Policy-Revision': String(heartbeatBody.policyRevision),
          'X-DSH-Purpose': 'chat',
        },
        body: JSON.stringify({ model: id, messages: [{ role: 'user', content: 'metering failure' }] }),
      })
      assert.equal(response.status, 200, await response.clone().text())
      const body = await response.text()
      assert.match(body, /Gateway reply/u)
      assert.match(body, /data:\[DONE\]/u)
    } finally {
      await migration.unsafe('GRANT INSERT ON enterprise.wallet_ledger TO enterprise_app')
    }
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      const [entry] = await tx.select().from(s.usage).where(eq(s.usage.idempotencyKey, persistenceFailureKey))
      assert.equal(entry?.status, 'pending_reconciliation')
      assert.equal(entry?.totalCostMicrosCny, null)
      const [wallet] = await tx.select().from(s.organizationWallets)
      assert.equal(wallet?.balanceMicrosCny, 999_757)
    })
    const usageBeforeOverdraw = await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      return new Set((await tx.select({ id: s.usage.id }).from(s.usage).where(eq(s.usage.modelId, id)))
        .map(entry => entry.id))
    })
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      await tx.update(s.organizationWallets).set({ balanceMicrosCny: 100 })
        .where(eq(s.organizationWallets.organizationId, org.id))
    })
    const overdrawnCalls = await Promise.all([run(), run()])
    for (const chunks of overdrawnCalls) {
      assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
    }
    let overdrawnUsage: Array<typeof s.usage.$inferSelect> = []
    const settlementDeadline = Date.now() + 2_000
    while (Date.now() < settlementDeadline) {
      overdrawnUsage = await pool.db.transaction(async (tx) => {
        await selectOrganization(tx, organizationId.parse(org.id))
        return (await tx.select().from(s.usage).where(eq(s.usage.modelId, id)))
          .filter(entry => !usageBeforeOverdraw.has(entry.id))
      })
      if (overdrawnUsage.length === 2 && overdrawnUsage.every(entry => entry.status === 'settled')) break
      await new Promise<void>((resolve) => { setImmediate(resolve) })
    }
    assert.equal(overdrawnUsage.length, 2)
    assert.equal(overdrawnUsage.every(entry => entry.status === 'settled'), true, JSON.stringify(overdrawnUsage))
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      const [wallet] = await tx.select().from(s.organizationWallets)
      assert.equal(wallet?.balanceMicrosCny, -62)
      for (const usage of overdrawnUsage) {
        const debit = await tx.select().from(s.walletLedger).where(eq(s.walletLedger.usageId, usage.id))
        assert.equal(debit.length, 1)
        assert.equal(debit[0]?.amountMicrosCny, -(usage.totalCostMicrosCny ?? -1))
      }
    })
    const insufficient = (await run()).at(-1)
    assert.ok(insufficient?.type === 'finish' && insufficient.reason.kind === 'error')
    assert.equal(insufficient.reason.kind === 'error' && insufficient.reason.failure.code, 'INSUFFICIENT_TEAM_BALANCE')
    assert.equal(upstream.state.calls, 8)
    const recoveryBatch = await request('/v1/platform/redemption-code-batches', 'POST', {
      amountCny: '0.0001', count: 1, note: 'negative balance recovery fixture',
    }, owner.cookie)
    assert.equal(recoveryBatch.status, 201, await recoveryBatch.clone().text())
    const [recoveryCode] = (await recoveryBatch.json() as { codes: string[] }).codes
    assert.ok(recoveryCode)
    const recovery = await request(prefix + '/wallet/redeem', 'POST', { code: recoveryCode }, owner.cookie)
    assert.equal(recovery.status, 200, await recovery.clone().text())
    assert.equal((await recovery.json() as { balanceMicrosCny: number }).balanceMicrosCny, 38)
    assert.deepEqual((await run()).at(-1), { type: 'finish', reason: { kind: 'stop' } })
    await request(prefix + '/runtimes/' + device.id, 'DELETE', undefined, owner.cookie)
    const revoked = (await run()).at(-1)
    assert.ok(revoked?.type === 'finish' && revoked.reason.kind === 'error')
    assert.equal(upstream.state.calls, 9)
    assert.equal(await gatewayMaintenance.cleanupExpired(), 0)
    assert.deepEqual(upstream.state.fileDeletes, ['/files/file-2'])
    now += 7 * 24 * 60 * 60 * 1_000 + 1
    upstream.state.fileDeleteStatus = 500
    assert.equal(await gatewayMaintenance.cleanupExpired(), 0)
    assert.deepEqual(upstream.state.fileDeletes, ['/files/file-2', '/files/file-3', '/files/file-4'])
    upstream.state.fileDeleteStatus = 404
    assert.equal(await gatewayMaintenance.cleanupExpired(), 2)
    assert.deepEqual(upstream.state.fileDeletes, [
      '/files/file-2', '/files/file-3', '/files/file-4', '/files/file-3', '/files/file-4',
    ])
    assert.equal(await gatewayMaintenance.cleanupExpired(), 0)
  })
  await t.test('duplicate model calls are rejected before a second upstream dispatch', async () => {
    const registered = await request(prefix + '/runtimes', 'POST', {
      name: 'idempotency fixture', type: 'desktop', version: '0.1.0', capabilities: [],
    }, owner.cookie)
    assert.equal(registered.status, 201)
    const device = await registered.json() as { id: string; token: string }
    const modelId = randomUUID()
    const callId = randomUUID()
    const key = randomUUID()
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      await tx.insert(s.models).values({ id: modelId, name: 'Fixture', baseUrl: 'https://api.deepseek.com',
        upstreamModel: 'fixture', secret: encrypt('fixture-upstream-key', config.encryptionKey, modelId), inputMicrosPerMillion: 0, outputMicrosPerMillion: 0,
        maxOutputTokens: 128, contextTokens: 1024,
      })
      await tx.insert(s.usage).values({ id: callId, organizationId: org.id, accountId: owner.id,
        runtimeId: device.id, modelId, purpose: 'chat', reservedMicros: 13, idempotencyKey: key,
      })
      await tx.update(s.subscriptions).set({ reservedMicros: 13, spentMicros: 0 })
    })
    const invoke = async (token: string, requestKey: string) => app.request(config.apiUrl + '/model/chat/completions', {
      method: 'POST', headers: {
        Authorization: 'Bearer ' + token,
        'Idempotency-Key': requestKey,
        'Content-Type': 'application/json',
        'X-DSH-Model': modelId,
        'X-DSH-Purpose': 'chat',
        'X-Relay-Fixture': requestKey,
      },
      body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'fixture' }] }),
    })
    assert.equal((await invoke(randomBytes(32).toString('base64url'), key)).status, 403)
    assert.equal((await invoke(device.token, 'short')).status, 400)
    const callsBefore = upstream.state.calls
    const existing = await invoke(device.token, key)
    assert.equal(existing.status, 409, await existing.clone().text())
    assert.equal(upstream.state.calls, callsBefore)
    const freshKey = randomUUID()
    upstream.state.mode = 'pause'
    const first = await invoke(device.token, freshKey)
    assert.equal(first.status, 200)
    const firstBody = first.text()
    await upstream.paused
    const duplicate = await invoke(device.token, freshKey)
    assert.equal(duplicate.status, 409, await duplicate.clone().text())
    assert.equal(upstream.state.calls, callsBefore + 1)
    upstream.release()
    await firstBody
    assert.equal(upstream.state.headers.at(-1)?.['x-relay-fixture'], freshKey)
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      assert.equal((await tx.select().from(s.usage).where(eq(s.usage.idempotencyKey, key))).length, 1)
      const [settled] = await tx.select().from(s.usage).where(eq(s.usage.idempotencyKey, freshKey))
      assert.equal(settled?.status, 'settled')
      assert.equal(settled?.totalCostMicrosCny, 0)
      assert.equal((await tx.select().from(s.subscriptions))[0].reservedMicros, 13)
      assert.equal((await tx.select().from(s.subscriptions))[0].spentMicros, 0)
      await tx.update(s.subscriptions).set({ reservedMicros: 0 })
    })
    upstream.state.mode = 'normal'
    upstream.state.responseHeaders = {
      Location: 'https://api.deepseek.com/provider-console',
      Server: 'provider-fixture',
      Link: '<https://api.deepseek.com/docs>; rel="help"',
      'X-Request-Id': 'safe-request-id',
    }
    upstream.state.responseMetadata = {
      model: 'fixture',
      endpoint: 'https://api.deepseek.com/provider-console',
      host: 'api.deepseek.com',
    }
    upstream.state.responseSplitMarker = 'api.deepseek.com'
    const arbitraryKey = randomUUID()
    const overview = await request(prefix + '/overview', 'GET', undefined, owner.cookie)
    const policyRevision = (await overview.json() as { organization: { policyRevision: number } }).organization.policyRevision
    const arbitrary = await app.request(config.apiUrl + '/model/vendor/native-operation?api-version=2026-09-18&trace=opaque', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + device.token,
        Cookie: 'must-not-reach-provider=1',
        'Content-Type': 'application/json',
        'Idempotency-Key': arbitraryKey,
        'X-DSH-Model': modelId,
        'X-DSH-Purpose': 'subagent',
        'X-DSH-Policy-Revision': String(policyRevision),
        'X-Provider-Feature': 'preserved',
      },
      body: JSON.stringify({ model: modelId, vendor_extension: { mode: 'opaque' }, input: 'relay' }),
    })
    assert.equal(arbitrary.status, 200, await arbitrary.clone().text())
    assert.equal(arbitrary.headers.get('location'), null)
    assert.equal(arbitrary.headers.get('server'), null)
    assert.equal(arbitrary.headers.get('link'), null)
    assert.equal(arbitrary.headers.get('x-request-id'), 'safe-request-id')
    const arbitraryBody = await arbitrary.text()
    assert.match(arbitraryBody, /Gateway reply/u)
    assert.ok(!arbitraryBody.includes('api.deepseek.com'))
    assert.ok(!arbitraryBody.includes('"model":"fixture"'))
    assert.ok(arbitraryBody.includes('"model":"' + modelId + '"'))
    upstream.state.responseHeaders = {}
    upstream.state.responseMetadata = {}
    upstream.state.responseSplitMarker = ''
    assert.equal(upstream.state.methods.at(-1), 'PATCH')
    assert.equal(upstream.state.paths.at(-1), '/vendor/native-operation?api-version=2026-09-18&trace=opaque')
    assert.deepEqual(upstream.state.requests.at(-1), {
      model: 'fixture', vendor_extension: { mode: 'opaque' }, input: 'relay',
    })
    const forwarded = upstream.state.headers.at(-1)
    assert.equal(forwarded?.['x-provider-feature'], 'preserved')
    assert.equal(forwarded?.authorization, 'Bearer fixture-upstream-key')
    assert.equal(forwarded?.cookie, undefined)
    assert.equal(forwarded?.['x-dsh-model'], undefined)
    assert.equal(forwarded?.['x-dsh-purpose'], undefined)
    assert.equal(forwarded?.['x-dsh-policy-revision'], undefined)
    const callsAfterArbitrary = upstream.state.calls
    assert.equal((await app.request(config.apiUrl + '/health', {
      headers: { Authorization: 'Bearer ' + device.token, 'X-DSH-Model': modelId },
    })).status, 200)
    assert.equal(upstream.state.calls, callsAfterArbitrary)
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      const [usage] = await tx.select().from(s.usage).where(eq(s.usage.idempotencyKey, arbitraryKey))
      assert.equal(usage?.purpose, 'subagent')
      assert.equal(usage?.status, 'settled')
    })
    await request(prefix + '/runtimes/' + device.id, 'DELETE', undefined, owner.cookie)
  })
  await t.test('team owners, administrators, and members receive distinct management access', async () => {
    const capacity = await request(
      '/v1/platform/organizations/' + org.id + '/subscription',
      'PUT',
      { plan: 'team-permissions', seats: 3, runtimes: 2 },
      owner.cookie,
    )
    assert.equal(capacity.status, 200, await capacity.clone().text())
    const administrator = await signup('team-admin@example.com')
    const member = await signup('team-member@example.com')
    const invite = async (actor: typeof owner, email: string, role: 'member' | 'administrator') => {
      const response = await request(prefix + '/invitations', 'POST', { email, role }, actor.cookie)
      const invitation = [...mail].reverse().find(message => message.to === email && message.subject === 'Organization invitation')
      return { response, invitation }
    }
    const adminInvite = await invite(owner, administrator.email, 'administrator')
    assert.equal(adminInvite.response.status, 201, await adminInvite.response.clone().text())
    assert.ok(adminInvite.invitation)
    assert.equal((await request('/v1/invitations/accept', 'POST', {
      token: new URL(adminInvite.invitation.text).searchParams.get('invitation'),
    }, administrator.cookie)).status, 200)

    assert.equal((await invite(administrator, member.email, 'administrator')).response.status, 403)
    const memberInvite = await invite(administrator, member.email, 'member')
    assert.equal(memberInvite.response.status, 201, await memberInvite.response.clone().text())
    assert.ok(memberInvite.invitation)
    assert.equal((await request('/v1/invitations/accept', 'POST', {
      token: new URL(memberInvite.invitation.text).searchParams.get('invitation'),
    }, member.cookie)).status, 200)

    const deniedSummary = await request(prefix + '/members/usage-summary', 'GET', undefined, member.cookie)
    assert.equal(deniedSummary.status, 403, await deniedSummary.clone().text())
    assert.equal((await request(prefix + '/usage?scope=organization', 'GET', undefined, member.cookie)).status, 403)
    assert.equal((await request(prefix + '/invitations', 'GET', undefined, member.cookie)).status, 403)
    const summary = await request(prefix + '/members/usage-summary', 'GET', undefined, administrator.cookie)
    assert.equal(summary.status, 200, await summary.clone().text())
    const members = (await summary.json() as {
      items: Array<{ membershipId: string; accountId: string; roles: string[] }>
    }).items
    assert.ok(members.some(item => item.accountId === owner.id && item.roles.includes('owner')))
    assert.ok(members.some(item => item.accountId === administrator.id && item.roles.includes('administrator')))
    assert.ok(members.some(item => item.accountId === member.id && item.roles.includes('member')))
    assert.equal((await request(prefix + '/usage?scope=organization&accountId=' + member.id, 'GET', undefined, administrator.cookie)).status, 200)
    assert.equal((await request(prefix + '/invitations', 'GET', undefined, administrator.cookie)).status, 200)

    const batch = await request('/v1/platform/redemption-code-batches', 'POST', { amountCny: '0.25', count: 1 }, owner.cookie)
    const [code] = (await batch.json() as { codes: string[] }).codes
    assert.ok(code)
    assert.equal((await request(prefix + '/wallet/redeem', 'POST', { code }, member.cookie)).status, 200)
    assert.equal((await request(prefix + '/wallet', 'GET', undefined, member.cookie)).status, 200)
    const ledger = await request(prefix + '/wallet/ledger', 'GET', undefined, member.cookie)
    assert.equal((await ledger.json() as { items: Array<{ kind: string }> }).items[0]?.kind, 'redemption_credit')
    for (const account of [administrator, member]) {
      const membership = members.find(item => item.accountId === account.id)
      assert.ok(membership)
      const suspended = await request(
        prefix + '/members/' + membership.membershipId,
        'PATCH',
        { status: 'suspended' },
        owner.cookie,
      )
      assert.equal(suspended.status, 200, await suspended.clone().text())
    }
  })
  await t.test('two invitation acceptances cannot exceed the remaining seat', async () => {
    await pool.db.insert(s.platformAdmins).values({ accountId: owner.id }).onConflictDoNothing()
    const plan = await request(
      '/v1/platform/organizations/' + org.id + '/subscription',
      'PUT',
      { plan: 'test', seats: 2, runtimes: 2 },
      owner.cookie,
    )
    assert.equal(plan.status, 200)
    const third = await signup('third@example.com')
    for (const actor of [other, third]) {
      assert.equal(
        (await request(prefix + '/invitations', 'POST', { email: actor.email, role: 'member' }, owner.cookie)).status,
        201,
      )
    }
    const accept = (actor: typeof other) => {
      const invitation = [...mail]
        .reverse()
        .find(message => message.subject === 'Organization invitation' && message.to === actor.email)
      assert.ok(invitation)
      return request(
        '/v1/invitations/accept',
        'POST',
        { token: new URL(invitation.text).searchParams.get('invitation') },
        actor.cookie,
      )
    }
    const results = await Promise.all([accept(other), accept(third)])
    assert.deepEqual(results.map(response => response.status).sort(), [200, 409])
    const member = results[0].status === 200 ? other : third
    assert.equal((await accept(member)).status, 403)
    const sessionId = randomUUID()
    assert.equal(
      (
        await request(
          prefix + '/sessions',
          'POST',
          {
            id: sessionId,
            header: { id: sessionId, version: 2, createdAt: 1000, isSeeded: false },
          },
          member.cookie,
        )
      ).status,
      201,
    )
    assert.equal((await request(prefix + '/sessions?scope=organization', 'GET', undefined, member.cookie)).status, 403)
    const own = await request(prefix + '/sessions', 'GET', undefined, owner.cookie)
    assert.ok(!((await own.json()) as { id: string }[]).some(item => item.id === sessionId))
    const all = await request(prefix + '/sessions?scope=organization', 'GET', undefined, owner.cookie)
    assert.ok(((await all.json()) as { id: string }[]).some(item => item.id === sessionId))
    assert.equal(
      (await request(prefix + '/sessions/' + sessionId + '/events', 'GET', undefined, owner.cookie)).status,
      200,
    )
    const audit = await request(prefix + '/audit', 'GET', undefined, owner.cookie)
    assert.ok(
      ((await audit.json()) as { action: string; resourceId: string; actorId: string }[]).some(
        event =>
          event.action === 'session.content_read' && event.resourceId === sessionId && event.actorId === owner.id,
      ),
    )
    const foreignId = randomUUID()
    assert.equal(
      (
        await request(
          '/v1/organizations/' + otherOrg.id + '/sessions',
          'POST',
          {
            id: foreignId,
            header: { id: foreignId, version: 2, createdAt: 1000, isSeeded: false },
          },
          other.cookie,
        )
      ).status,
      201,
    )
    assert.equal(
      (
        await request(
          '/v1/organizations/' + otherOrg.id + '/sessions/' + foreignId + '/events',
          'GET',
          undefined,
          owner.cookie,
        )
      ).status,
      403,
    )
    const scoped = await request(prefix + '/sessions?scope=organization', 'GET', undefined, owner.cookie)
    assert.equal(scoped.status, 200)
    assert.ok(!((await scoped.json()) as { id: string }[]).some(item => item.id === foreignId))
  })
  await t.test('unreviewed plugins and hard scan failures cannot be published', async () => {
    const submission = {
      manifest: { pluginId: 'test-plugin', version: '1.0.0', targets: ['desktop'], permissions: [], tools: [] },
      hostCode: 'ctx.on("ready", () => {})',
    }
    const release = await request(prefix + '/plugins', 'POST', submission, owner.cookie)
    assert.equal(release.status, 201, await release.clone().text())
    const { id, status } = (await release.json()) as { id: string; status: string }
    assert.equal(status, 'awaiting_ai')
    const reviewModelId = randomUUID()
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      await tx.insert(s.models).values({
        id: reviewModelId,
        name: 'Plugin review fixture',
        baseUrl: 'https://api.deepseek.com',
        upstreamModel: 'review-fixture',
        secret: encrypt('fixture-upstream-key', config.encryptionKey, reviewModelId),
        inputMicrosPerMillion: 0,
        outputMicrosPerMillion: 0,
        maxOutputTokens: 4096,
        contextTokens: 8192,
      })
    })
    config.reviewModelId = reviewModelId
    const reviewRuntimeResponse = await request(prefix + '/runtimes', 'POST', {
      name: 'plugin review fixture', type: 'desktop', version: '0.1.0', capabilities: [],
    }, owner.cookie)
    assert.equal(reviewRuntimeResponse.status, 201, await reviewRuntimeResponse.clone().text())
    const reviewRuntime = await reviewRuntimeResponse.json() as { id: string }
    assert.equal((await request(prefix + '/plugins/' + id + '/ai-review', 'POST', {
      runtimeId: randomUUID(),
    }, owner.cookie)).status, 403)
    upstream.state.responseContent = JSON.stringify({ verdict: 'pass', summary: 'Safe fixture', findings: [] })
    const reviewResponse = await request(prefix + '/plugins/' + id + '/ai-review', 'POST', {
      runtimeId: reviewRuntime.id,
    }, owner.cookie)
    assert.equal(reviewResponse.status, 200, await reviewResponse.clone().text())
    assert.equal(upstream.state.paths.at(-1), '/chat/completions')
    assert.equal(upstream.state.headers.at(-1)?.['x-dsh-internal-relay'], undefined)
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      const [reviewUsage] = await tx.select().from(s.usage).where(eq(s.usage.modelId, reviewModelId))
      assert.equal(reviewUsage?.purpose, 'plugin_review')
      assert.equal(reviewUsage?.status, 'settled')
    })
    upstream.state.responseContent = 'Gateway reply'
    const approval = await request(
      prefix + '/plugins/' + id + '/approve',
      'POST',
      { digest: '0'.repeat(64) },
      owner.cookie,
    )
    assert.equal(approval.status, 409)
    const bad = await request(
      prefix + '/plugins',
      'POST',
      { ...submission, manifest: { ...submission.manifest, version: '2.0.0' }, hostCode: 'process.exit(0)' },
      owner.cookie,
    )
    assert.equal(((await bad.json()) as { status: string }).status, 'scan_rejected')
    assert.equal((await request(prefix + '/plugins', 'POST', submission, owner.cookie)).status, 409)
  })
  await t.test('standard packages complete install, activation, upgrade, revocation, and retained-data recovery', async () => {
    const pluginModelId = randomUUID()
    await pool.db.insert(s.models).values({
      id: pluginModelId, name: 'Plugin model fixture', baseUrl: 'https://api.deepseek.com',
      upstreamModel: 'fixture', secret: encrypt('fixture-upstream-key', config.encryptionKey, pluginModelId),
      contextTokens: 8192, maxOutputTokens: 4096, inputMicrosPerMillion: 1, outputMicrosPerMillion: 1,
      inputModalities: ['text'],
    })
    await pool.db.transaction(async (tx) => {
      await identify(tx, owner.id, owner.email)
      await selectOrganization(tx, organizationId.parse(org.id))
      await tx.insert(s.organizationWallets).values({ organizationId: org.id, balanceMicrosCny: 100_000_000 })
        .onConflictDoUpdate({ target: s.organizationWallets.organizationId, set: { balanceMicrosCny: 100_000_000, updatedAt: new Date() } })
    })
    upstream.state.jsonResponse = true
    const upload = async (bytes: Uint8Array) => app.request(new URL(prefix + '/plugins/packages?visibility=private', config.apiUrl), {
      method: 'POST',
      headers: { Origin: config.adminOrigin, Cookie: owner.cookie, 'Content-Type': 'application/zip' },
      body: bytes,
    })
    const v1Response = await upload(acceptancePluginPackage('1.0.0'))
    assert.equal(v1Response.status, 201, await v1Response.clone().text())
    const v1 = await v1Response.json() as { id: string }
    const v2Response = await upload(acceptancePluginPackage('1.1.0'))
    assert.equal(v2Response.status, 201, await v2Response.clone().text())
    const v2 = await v2Response.json() as { id: string }

    const installedResponse = await request(prefix + `/plugins/${v1.id}/install`, 'POST', undefined, owner.cookie)
    assert.equal(installedResponse.status, 201, await installedResponse.clone().text())
    const installed = await installedResponse.json() as { id: string; dataSpaceId: string }
    assert.equal((await request(prefix + `/plugins/installations/${installed.id}`, 'PATCH', { enabled: true }, owner.cookie)).status, 200)
    const deviceId = 'lifecycle-device'
    assert.equal((await request(prefix + `/plugins/installations/${installed.id}/devices/${deviceId}`, 'PUT', { targetKind: 'host', enabled: true }, owner.cookie)).status, 200)
    const activateResponse = await request(prefix + `/plugins/installations/${installed.id}/activate`, 'POST', { deviceId, targetKind: 'host' }, owner.cookie)
    assert.equal(activateResponse.status, 201, await activateResponse.clone().text())
    const first = await activateResponse.json() as { activationId: string; token: string }
    const heartbeatPath = prefix + `/plugins/installations/${installed.id}/devices/${deviceId}/heartbeat`
    assert.equal((await request(heartbeatPath, 'POST', { activationId: first.activationId, targetKind: 'host', observedState: 'active', error: null }, owner.cookie)).status, 200)
    const runtimeRequest = (activationId: string, token: string) => app.request(new URL(`/v1/plugin-runtime/${activationId}/identity.current`, config.apiUrl), {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
    })
    const identity = await runtimeRequest(first.activationId, first.token)
    assert.equal(identity.status, 200, await identity.clone().text())
    assert.equal((await identity.json() as { userId: string }).userId, owner.id)
    const models = await app.request(new URL(`/v1/plugin-runtime/${first.activationId}/models.list`, config.apiUrl), {
      method: 'POST', headers: { Authorization: `Bearer ${first.token}`, 'Content-Type': 'application/json' }, body: '{}',
    })
    assert.equal(models.status, 200, await models.clone().text())
    assert.ok((await models.json() as { id: string }[]).some(model => model.id === pluginModelId))
    const modelText = await app.request(new URL(`/v1/plugin-runtime/${first.activationId}/models.text`, config.apiUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: pluginModelId, messages: [{ role: 'user', content: 'Reply with OK.' }], idempotencyKey: 'plugin-model-fixture-call' }),
    })
    assert.equal(modelText.status, 200, await modelText.clone().text())
    assert.equal((await modelText.json() as { text: string }).text, 'Gateway reply')
    const pluginUsage = await pool.db.transaction(async (tx) => {
      await identify(tx, owner.id, owner.email)
      await selectOrganization(tx, organizationId.parse(org.id))
      // oxlint-disable-next-line @stylistic/max-len -- The assertion mirrors the usage query fields.
      return tx.select({ runtimeId: s.usage.runtimeId, status: s.usage.status }).from(s.usage).where(eq(s.usage.pluginInstallationId, installed.id))
    })
    assert.deepEqual(pluginUsage, [{ runtimeId: null, status: 'settled' }])

    const permissionRejected = await request(prefix + `/plugins/installations/${installed.id}/upgrade`, 'POST', { releaseId: v2.id, confirmPermissions: false }, owner.cookie)
    assert.equal(permissionRejected.status, 409)
    const upgraded = await request(prefix + `/plugins/installations/${installed.id}/upgrade`, 'POST', { releaseId: v2.id, confirmPermissions: true }, owner.cookie)
    assert.equal(upgraded.status, 200, await upgraded.clone().text())
    assert.equal((await runtimeRequest(first.activationId, first.token)).status, 403)
    assert.equal((await request(heartbeatPath, 'POST', { activationId: first.activationId, targetKind: 'host', observedState: 'active', error: null }, owner.cookie)).status, 403)

    assert.equal((await request(prefix + `/plugins/installations/${installed.id}/devices/${deviceId}`, 'PUT', { targetKind: 'host', enabled: true }, owner.cookie)).status, 200)
    const secondResponse = await request(prefix + `/plugins/installations/${installed.id}/activate`, 'POST', { deviceId, targetKind: 'host' }, owner.cookie)
    assert.equal(secondResponse.status, 201, await secondResponse.clone().text())
    const second = await secondResponse.json() as { activationId: string; token: string }
    assert.equal((await request(heartbeatPath, 'POST', { activationId: second.activationId, targetKind: 'host', observedState: 'active', error: null }, owner.cookie)).status, 200)
    const uninstalled = await request(prefix + `/plugins/installations/${installed.id}`, 'DELETE', undefined, owner.cookie)
    assert.equal(uninstalled.status, 200, await uninstalled.clone().text())
    assert.equal((await uninstalled.json() as { dataSpaceId: string }).dataSpaceId, installed.dataSpaceId)
    assert.equal((await runtimeRequest(second.activationId, second.token)).status, 403)
    const reauthorized = await request(prefix + `/plugins/installations/${installed.id}/reauthorize`, 'POST', {}, owner.cookie)
    assert.equal(reauthorized.status, 200, await reauthorized.clone().text())
    assert.equal((await request(prefix + '/plugins/installations', 'GET', undefined, owner.cookie).then(response => response.json()) as { id: string; dataSpaceId: string }[])
      .find(item => item.id === installed.id)?.dataSpaceId, installed.dataSpaceId)
  })
  await t.test('the application role is not privileged', async () => {
    const roles = await pool.db.execute(sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`)
    assert.equal(roles[0].rolsuper, false)
    assert.equal(roles[0].rolbypassrls, false)
  })
  await t.test('built bundle starts through dsh and releases its listener on shutdown', async (t) => {
    await profileSmoke(t, config)
  })
})
