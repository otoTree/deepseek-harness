/** Real PostgreSQL and Better Auth tests, isolated in a newly allocated database. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { and, eq, sql } from 'drizzle-orm'
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
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { modelFixture } from './gateway-fixture.ts'
import { serve } from '@hono/node-server'
import { once } from 'node:events'
import { Server } from 'node:http'
import { DesktopKeychain } from '../../electrobun/src/keychain.ts'
import { nativeProfile } from '../../electrobun/tests/native-profile.ts'

void test('encrypted credentials authenticate their model binding', () => {
  const key = randomBytes(32).toString('hex')
  const value = encrypt('upstream-secret', key, 'model-one')
  assert.equal(decrypt(value, key, 'model-one'), 'upstream-secret')
  assert.throws(() => decrypt(value, key, 'model-two'))
  assert.throws(() => decrypt(value, randomBytes(32).toString('hex'), 'model-one'))
})

void test('model origins reject unsafe URLs while allowing public HTTPS endpoints', () => {
  assert.equal(modelUrl('https://api.deepseek.com/v1').pathname, '/v1/chat/completions')
  assert.equal(modelUrl('https://other.example/v1').pathname, '/v1/chat/completions')
  for (const url of [
    'http://api.deepseek.com',
    'https://127.0.0.1',
    'https://user:secret@api.deepseek.com',
    'https://api.deepseek.com?redirect=1',
  ]) {
    assert.throws(() => modelUrl(url))
  }
})

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
  const resources: { application?: () => Promise<void>; migration?: () => Promise<void> } = {}
  t.after(async () => {
    await resources.application?.()
    await resources.migration?.()
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
  const { app } = createApplication({
    db: pool.db,
    config,
    modelTransport: upstream.transport,
    mail: async (message) => {
      mail.push(message)
    },
  })
  await pool.db.insert(s.deployment).values({ id: 'primary', mode: 'open', registration: 'open' })
  const request = (path: string, method = 'GET', body?: unknown, cookie = '') =>
    app.request(new URL(path, config.apiUrl), {
      method,
      headers: { Origin: config.adminOrigin, 'Content-Type': 'application/json', Cookie: cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const signup = async (email: string) => {
    const password = randomBytes(20).toString('base64url')
    const result = await request('/auth/sign-up/email', 'POST', { name: 'Test', email, password })
    assert.equal(result.status, 200, await result.clone().text())
    const verification = mail.find(message => message.to === email && message.subject === 'Verify your email')
    assert.ok(verification)
    const verified = await request(verification.text)
    assert.ok([200, 302].includes(verified.status), await verified.text())
    const login = await request('/auth/sign-in/email', 'POST', { email, password })
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
    assert.equal((await modelRequest()).status, 200)
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
        assert.ok((await catalog.json() as { id: string }[]).some(model => model.id === modelId))
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
  await t.test('native LLM settles one gateway call and refuses overlapping over-budget dispatch', async (caseOwner) => {
    const deviceResponse = await request(prefix + '/runtimes', 'POST', {
      name: 'native gateway fixture', type: 'desktop', version: '0.1.0', capabilities: [],
    }, owner.cookie)
    assert.equal(deviceResponse.status, 201)
    const device = await deviceResponse.json() as { id: string; token: string; leaseUntil: string }
    const id = randomUUID()
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      await tx.insert(s.models).values({ id, name: 'Metered fixture', baseUrl: 'https://api.deepseek.com',
        upstreamModel: 'fixture', secret: encrypt('fixture-upstream-key', config.encryptionKey, id),
        inputMicrosPerMillion: 100000, outputMicrosPerMillion: 100000, maxOutputTokens: 128, contextTokens: 1024 })
      await tx.update(s.subscriptions).set({ budgetMicros: 116, reservedMicros: 0, spentMicros: 0 })
    })
    const ctx = new Context()
    const service = await ctx.plugin(LlmRuntime)
    caseOwner.after(() => service.dispose())
    const adapter = new EnterpriseGatewayAdapter({ apiUrl: config.apiUrl,
      keychainAccount: createHash('sha256').update(config.apiUrl).digest('hex') + ':' + org.id + ':' + device.id,
      keychainHelper: '/unused-helper', requestTimeoutMs: 10000, maxEventChars: 65536, maxResponseChars: 262144 }, {
      readCredential: () => Promise.resolve(JSON.stringify({ apiOrigin: config.apiUrl, organizationId: org.id,
        runtimeId: device.id, token: device.token, leaseUntil: device.leaseUntil })),
      request: (url, init) => app.request(url, init),
    })
    const dispose = ctx.llm.registerAdapter(['enterprise'], adapter)
    caseOwner.after(() =>{  dispose() })
    const options = { provider: 'enterprise', model: id, messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Reply' }] })] }
    const run = async () => {
      const chunks: StreamChunk[] = []
      for await (const chunk of ctx.llm.stream(options)) chunks.push(chunk)
      return chunks
    }
    upstream.state.mode = 'pause'
    const first = run()
    let second: StreamChunk[]
    try {
      await Promise.race([upstream.paused, first.then(() => { throw new Error('Native call finished before the upstream pause') })])
      second = await run()
      assert.equal(upstream.state.calls, 1)
      await pool.db.transaction(async (tx) => {
        await selectOrganization(tx, organizationId.parse(org.id))
        assert.equal((await tx.select().from(s.subscriptions))[0].reservedMicros, 116)
      })
    } finally {
      upstream.release()
      await first
    }
    const completed = await first
    assert.deepEqual(completed.at(-1), { type: 'finish', reason: { kind: 'stop' } })
    assert.ok(second!.at(-1)?.type === 'finish')
    const refused = second!.at(-1)
    assert.ok(refused?.type === 'finish' && refused.reason.kind === 'error')
    assert.equal(upstream.state.secret, 'Bearer fixture-upstream-key')
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      const [usage] = await tx.select().from(s.usage).where(eq(s.usage.modelId, id))
      assert.equal(usage.status, 'settled')
      assert.equal(usage.inputTokens, 12)
      assert.equal(usage.outputTokens, 8)
      assert.equal(usage.actualMicros, 2)
      const [budget] = await tx.select().from(s.subscriptions)
      assert.equal(budget.reservedMicros, 0)
      assert.equal(budget.spentMicros, 2)
      await tx.update(s.subscriptions).set({ budgetMicros: 100000 })
    })
    upstream.state.mode = 'truncated'
    const incomplete = (await run()).at(-1)
    assert.ok(incomplete?.type === 'finish' && incomplete.reason.kind === 'error')
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      const rows = await tx.select().from(s.usage).where(eq(s.usage.modelId, id))
      assert.equal(rows.filter(row => row.status === 'pending_reconciliation').length, 1)
      assert.equal((await tx.select().from(s.subscriptions))[0].reservedMicros, 116)
      await tx.insert(s.platformAdmins).values({ accountId: owner.id }).onConflictDoNothing()
    })
    const pending = await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      const [row] = await tx.select().from(s.usage).where(and(eq(s.usage.modelId, id), eq(s.usage.status, 'pending_reconciliation')))
      return row.id
    })
    const reconciled = await request('/v1/platform/organizations/' + org.id + '/usage/' + pending + '/reconcile', 'POST', {
      outcome: 'settled', inputTokens: 12, outputTokens: 8, billedMicros: 2,
    }, owner.cookie)
    assert.equal(reconciled.status, 200, await reconciled.text())
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      const [row] = await tx.select().from(s.usage).where(eq(s.usage.id, pending))
      assert.equal(row.status, 'settled')
      assert.equal((await tx.select().from(s.subscriptions))[0].reservedMicros, 0)
      await tx.update(s.subscriptions).set({ reservedMicros: 0, spentMicros: 0 })
    })
    upstream.state.mode = 'normal'
    const stale = await app.request(config.apiUrl + prefix + '/model-call', {
      method: 'POST', headers: { Authorization: 'Bearer ' + device.token, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ model: id, runtimeId: device.id, policyRevision: 999999, messages: [{ role: 'user', content: 'stale' }] }),
    })
    assert.equal(stale.status, 409)
    assert.equal(upstream.state.calls, 2)
    await request(prefix + '/runtimes/' + device.id, 'DELETE', undefined, owner.cookie)
    const revoked = (await run()).at(-1)
    assert.ok(revoked?.type === 'finish' && revoked.reason.kind === 'error')
    assert.equal(upstream.state.calls, 2)
  })
  await t.test('duplicate model calls authenticate the device and serialize without changing the reservation', async () => {
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
        upstreamModel: 'fixture', secret: 'not-used', inputMicrosPerMillion: 0, outputMicrosPerMillion: 0,
        maxOutputTokens: 128, contextTokens: 1024,
      })
      await tx.insert(s.usage).values({ id: callId, organizationId: org.id, accountId: owner.id,
        runtimeId: device.id, modelId, purpose: 'chat', reservedMicros: 13, idempotencyKey: key,
      })
      await tx.update(s.subscriptions).set({ reservedMicros: 13 })
    })
    const invoke = async (token: string) => app.request(config.apiUrl + prefix + '/model-call', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ runtimeId: device.id, model: modelId, messages: [{ role: 'user', content: 'fixture' }] }),
    })
    assert.equal((await invoke(randomBytes(32).toString('base64url'))).status, 403)
    let unlock!: () => void
    let ready!: () => void
    const locked = new Promise<void>((resolve) => { ready = resolve })
    const released = new Promise<void>((resolve) => { unlock = resolve })
    const holder = pool.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${org.id}), hashtext(${key}))`)
      ready()
      await released
    })
    await locked
    const pending = [invoke(device.token), invoke(device.token)]
    try {
      const deadline = Date.now() + 10000
      while (true) {
        const waits = await migration`select count(*)::integer as count from pg_locks
          where locktype = 'advisory' and not granted and database = (select oid from pg_database where datname = current_database())`
        if (waits[0].count >= 2) break
        assert.ok(Date.now() < deadline, 'both API calls must reach the database-owned idempotency lock')
        await delay(20)
      }
    } finally {
      unlock()
      await holder
      await Promise.allSettled(pending)
    }
    for (const response of await Promise.all(pending)) {
      assert.equal(response.status, 409)
      assert.deepEqual(await response.json(), { error: 'IDEMPOTENCY_KEY_REUSED', callId, status: 'reserved' })
    }
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      assert.equal((await tx.select().from(s.usage).where(eq(s.usage.idempotencyKey, key))).length, 1)
      assert.equal((await tx.select().from(s.subscriptions))[0].reservedMicros, 13)
      await tx.update(s.subscriptions).set({ reservedMicros: 0 })
    })
    await request(prefix + '/runtimes/' + device.id, 'DELETE', undefined, owner.cookie)
  })
  await t.test('two invitation acceptances cannot exceed the remaining seat', async () => {
    await pool.db.insert(s.platformAdmins).values({ accountId: owner.id }).onConflictDoNothing()
    const plan = await request(
      '/v1/platform/organizations/' + org.id + '/subscription',
      'PUT',
      { plan: 'test', seats: 2, runtimes: 2, budgetMicros: 100000 },
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
    const approval = await request(
      prefix + '/plugins/' + id + '/approve',
      'POST',
      { digest: '0'.repeat(64) },
      owner.cookie,
    )
    assert.ok([409, 503].includes(approval.status))
    const bad = await request(
      prefix + '/plugins',
      'POST',
      { ...submission, manifest: { ...submission.manifest, version: '2.0.0' }, hostCode: 'process.exit(0)' },
      owner.cookie,
    )
    assert.equal(((await bad.json()) as { status: string }).status, 'scan_rejected')
    assert.equal((await request(prefix + '/plugins', 'POST', submission, owner.cookie)).status, 409)
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
