/** Real HTTP authorization against a private PostgreSQL cluster and in-memory object storage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import postgres from 'postgres'
import { and, eq } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { PgDialect } from 'drizzle-orm/pg-core'
import { PostgresJsSession } from 'drizzle-orm/postgres-js'
import { createApplication } from '../src/application.ts'
import { configSchema } from '../src/config.ts'
import { connectDatabase, identify, selectOrganization } from '../src/database.ts'
import { migrateEnterprise } from '../src/migrations.ts'
import { accountId, organizationId, driveSharingPolicy } from '../src/contracts.ts'
import { MemoryDriveObjectStore } from '../src/drive-storage.ts'
import * as s from '../src/schema.ts'

void test('sharing requests reject ambiguous or empty audiences', () => {
  const base = { organizationId: randomUUID(), permission: 'viewer', memberIds: [], departments: [] }
  assert.equal(driveSharingPolicy.safeParse({ ...base, scope: 'selected' }).success, false)
  assert.equal(driveSharingPolicy.safeParse({ ...base, scope: 'organization', memberIds: ['member'] }).success, false)
  assert.equal(driveSharingPolicy.safeParse({ ...base, scope: 'selected', memberIds: ['member', 'member'] }).success, false)
  assert.equal(driveSharingPolicy.safeParse({ ...base, scope: 'selected', departments: [{ id: randomUUID() }] }).success, false)
})

void test('cloud drive enforces member, department, inherited and organization audiences', { timeout: 120_000 }, async (t) => {
  const container = 'dsh-drive-sharing-' + randomUUID()
  const password = randomBytes(24).toString('hex')
  const docker = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe' })
  docker(['run', '-d', '--name', container, '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD=' + password, 'postgres:16-alpine'])
  const cleanup: { pool?: () => Promise<void>; admin?: () => Promise<void> } = {}
  t.after(async () => {
    try { await cleanup.pool?.() }
    finally {
      try { await cleanup.admin?.() }
      finally { docker(['rm', '-fv', container]) }
    }
  })
  const deadline = Date.now() + 30_000
  for (;;) {
    try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); break }
    catch { if (Date.now() >= deadline) throw new Error('Private PostgreSQL did not become ready') }
    await delay(20)
  }
  const port = docker(['port', container, '5432/tcp']).trim().split(':').at(-1)!
  const admin = postgres(`postgres://postgres:${password}@127.0.0.1:${port}/postgres`, { max: 1, onnotice: () => {} })
  cleanup.admin = () => admin.end()
  await admin.unsafe(`CREATE ROLE enterprise_app LOGIN PASSWORD '${password}'`)
  const migrationConfig = { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) }
  const dialect = new PgDialect()
  // Populate the last released drive schema before applying the sharing migration.
  await dialect.migrate(readMigrationFiles(migrationConfig).filter(item => item.folderMillis < 1792627200000),
    new PostgresJsSession(admin, dialect, undefined), migrationConfig)
  const legacyAccount = randomUUID(), legacyOrganization = randomUUID(), legacySpace = randomUUID(), legacyNode = randomUUID()
  await admin`INSERT INTO enterprise_auth."user" (id, name, email) VALUES (${legacyAccount}, 'Legacy', 'legacy@example.com')`
  await admin`INSERT INTO enterprise.organization (id, root_id, name) VALUES (${legacyOrganization}, ${legacyOrganization}, 'Legacy organization')`
  await admin`INSERT INTO enterprise.membership (id, organization_id, account_id) VALUES (${randomUUID()}, ${legacyOrganization}, ${legacyAccount})`
  await admin`INSERT INTO enterprise.drive_space (id, organization_id, kind, name) VALUES (${legacySpace}, ${legacyOrganization}, 'organization', 'Legacy space')`
  await admin`INSERT INTO enterprise.drive_node (id, space_id, name, kind) VALUES (${legacyNode}, ${legacySpace}, 'Legacy folder', 'folder')`
  await migrateEnterprise(admin, 'enterprise_app', migrationConfig)
  const [legacy] = await admin`SELECT sharing FROM enterprise.drive_node WHERE id = ${legacyNode}`
  assert.equal((legacy.sharing as { scope: string }).scope, 'organization')
  const [legacyAccess] = await admin`SELECT enterprise.drive_node_access(${legacyNode}, ${legacyAccount}, ${legacyOrganization}) AS access`
  assert.equal(legacyAccess.access, 2)
  await admin.unsafe('GRANT USAGE ON SCHEMA enterprise, enterprise_auth TO enterprise_app')
  await admin.unsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA enterprise, enterprise_auth TO enterprise_app')
  const pool = connectDatabase(`postgres://enterprise_app:${password}@127.0.0.1:${port}/postgres`)
  cleanup.pool = () => pool.close()
  const config = configSchema.parse({ databaseUrl: `postgres://enterprise_app:${password}@127.0.0.1:${port}/postgres`, authSecret: password, encryptionKey: randomBytes(32).toString('hex'), apiUrl: 'http://127.0.0.1:8787', adminOrigin: 'http://127.0.0.1:3000', portalOrigin: 'http://127.0.0.1:3001', requireEmailVerification: false })
  const objects = new MemoryDriveObjectStore()
  const { app } = createApplication({ db: pool.db, config, mail: async () => {}, driveObjects: objects })
  await pool.db.insert(s.deployment).values({ id: 'primary', mode: 'open', registration: 'open' })
  let requestNumber = 1
  const request = (path: string, cookie: string, method = 'GET', body?: unknown) => app.request(new URL(path, config.apiUrl), {
    method, headers: { Origin: config.adminOrigin, 'Content-Type': 'application/json', Cookie: cookie, 'X-Forwarded-For': cookie ? '192.0.2.10' : `192.0.2.${requestNumber++}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  async function signup(name: string) {
    const response = await request('/auth/sign-up/email', '', 'POST', { name, email: name + '@example.com', password: randomBytes(20).toString('hex') })
    assert.equal(response.status, 200, await response.clone().text())
    const value = await response.json() as { user: { id: string } }
    return { id: accountId.parse(value.user.id), cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') }
  }
  const owner = await signup('owner'), member = await signup('member'), child = await signup('child'), outsider = await signup('outsider')
  const created = await request('/v1/organizations', owner.cookie, 'POST', { name: 'Acme', defaultBudget: { mode: 'unlimited' } })
  assert.equal(created.status, 201, await created.clone().text())
  const org = await created.json() as { id: string; rootId: string }
  const second = await request('/v1/organizations', outsider.cookie, 'POST', { name: 'Other organization', defaultBudget: { mode: 'unlimited' } })
  assert.equal(second.status, 201, await second.clone().text())
  const secondOrg = await second.json() as { id: string }
  const otherPrefix = `/v1/organizations/${secondOrg.id}/drive`
  const prefix = `/v1/organizations/${org.id}/drive`
  const department = randomUUID(), subdepartment = randomUUID(), unrelated = randomUUID()
  const memberMembership = randomUUID(), childMembership = randomUUID(), outsiderMembership = randomUUID()
  await pool.db.transaction(async (tx) => {
    await identify(tx, owner.id, 'owner@example.com')
    await selectOrganization(tx, organizationId.parse(org.id))
    await tx.insert(s.units).values([
      { id: department, organizationId: org.id, parentId: org.rootId, name: 'Engineering', unitType: 'department' },
      { id: subdepartment, organizationId: org.id, parentId: department, name: 'Platform', unitType: 'department' },
      { id: unrelated, organizationId: org.id, parentId: org.rootId, name: 'Finance', unitType: 'department' },
    ])
    const assignments = [[member, memberMembership, department], [child, childMembership, subdepartment],
      [outsider, outsiderMembership, unrelated]] as const
    for (const [user, id, unitId] of assignments) {
      await tx.insert(s.memberships).values({ id, organizationId: org.id, accountId: user.id })
      await tx.insert(s.roles).values({ id: randomUUID(), organizationId: org.id, membershipId: id, role: 'member' })
      await tx.insert(s.assignments).values({ organizationId: org.id, membershipId: id, unitId })
    }
  })
  const response = await request(prefix + '/spaces', owner.cookie)
  assert.equal(response.status, 200, await response.clone().text())
  const spaces = await response.json() as Array<{ id: string; kind: string }>
  const personal = spaces.find(space => space.kind === 'personal')!.id, organization = spaces.find(space => space.kind === 'organization')!.id
  const policy = (scope: 'private' | 'selected' | 'organization', permission: 'viewer' | 'member' = 'viewer', memberIds: string[] = [], departments: Array<{ id: string; includeDescendants: boolean }> = []) => ({ organizationId: org.id, scope, permission, memberIds, departments })
  async function share(id: string, value: ReturnType<typeof policy> | null) {
    const response = await request(`${prefix}/files/${id}/sharing`, owner.cookie, 'PUT', { policy: value })
    assert.equal(response.status, 200, await response.clone().text())
    return response.json() as Promise<{ audienceCount: number; inheritedFrom: string | null }>
  }
  async function upload(spaceId: string, name: string, parentId: string | null = null, cookie = owner.cookie) {
    const bytes = new TextEncoder().encode('Confidential')
    const response = await request(prefix + '/uploads', cookie, 'POST', { spaceId, name, parentId, size: bytes.byteLength, contentType: 'text/plain', checksum: createHash('sha256').update(bytes).digest('hex') })
    assert.equal(response.status, 200, await response.clone().text())
    const session = await response.json() as { nodeId: string; uploadId: string; versionId: string; uploadUrl: string }
    objects.seed(decodeURIComponent(session.uploadUrl.slice('memory://upload/'.length)), bytes, 'text/plain')
    return session
  }
  async function commit(uploadId: string, cookie = owner.cookie) {
    const result = await request(prefix + '/uploads/commit', cookie, 'POST', { uploadId })
    assert.equal(result.status, 200, await result.clone().text())
  }
  async function visible(spaceId: string, cookie: string, query = '') {
    const result = await request(`${prefix}/${query ? 'search' : 'files'}?spaceId=${spaceId}${query ? '&query=' + query : ''}`, cookie)
    assert.equal(result.status, 200, await result.clone().text())
    return (await result.json() as { items: Array<{ id: string }> }).items.map(item => item.id)
  }
  const file = await upload(organization, 'confidential.txt'); await commit(file.uploadId)
  assert.deepEqual(await visible(organization, member.cookie), [])
  assert.deepEqual(await visible(organization, member.cookie, 'confidential'), [])
  for (const suffix of ['', '/download', '/versions', '/descriptions', '/sharing']) assert.equal((await request(`${prefix}/files/${file.nodeId}${suffix}`, member.cookie)).status, 403)
  assert.equal((await share(file.nodeId, policy('selected', 'viewer', [member.id]))).audienceCount, 2)
  assert.deepEqual(await visible(organization, member.cookie), [file.nodeId])
  assert.equal((await request(`${prefix}/files/${file.nodeId}/download`, member.cookie)).status, 200)
  assert.equal((await request(`${prefix}/files/${file.nodeId}`, member.cookie, 'PATCH', { spaceId: organization, name: 'stolen.txt' })).status, 403)
  assert.equal((await request(`${prefix}/files/${file.nodeId}/sharing`, member.cookie, 'PUT', { policy: policy('organization') })).status, 403)
  assert.equal((await request(`${prefix}/files/${file.nodeId}/sharing`, owner.cookie, 'PUT', { policy: policy('selected', 'viewer', [randomUUID()]) })).status, 400)
  const foreignPolicy = await request(`${prefix}/files/${file.nodeId}/sharing`, owner.cookie, 'PUT', {
    policy: { ...policy('organization'), organizationId: randomUUID() },
  })
  assert.equal(foreignPolicy.status, 403)
  await share(file.nodeId, policy('selected', 'viewer', [], [{ id: department, includeDescendants: false }]))
  assert.deepEqual(await visible(organization, member.cookie), [file.nodeId])
  assert.deepEqual(await visible(organization, child.cookie), [])
  await share(file.nodeId, policy('selected', 'member', [], [{ id: department, includeDescendants: true }]))
  assert.deepEqual(await visible(organization, child.cookie), [file.nodeId])
  assert.deepEqual(await visible(organization, outsider.cookie), [])
  const edited = await request(`${prefix}/files/${file.nodeId}`, child.cookie, 'PATCH', { spaceId: organization, name: 'confidential-edited.txt' })
  assert.equal(edited.status, 200, await edited.clone().text())
  const checkpoint = await request(`${prefix}/changes?spaceId=${organization}`, outsider.cookie)
  const cursor = (await checkpoint.json() as { cursor: string }).cursor
  const pending = await upload(organization, 'revoked.txt', null, child.cookie)
  // A department transfer changes access without rewriting the file's saved audience.
  await pool.db.transaction(async (tx) => {
    await selectOrganization(tx, organizationId.parse(org.id))
    await tx.update(s.assignments).set({ unitId: unrelated }).where(and(
      eq(s.assignments.membershipId, childMembership), eq(s.assignments.unitId, subdepartment),
    ))
  })
  assert.equal((await request(`${prefix}/files/${file.nodeId}/download`, child.cookie)).status, 403)
  await commit(pending.uploadId, child.cookie)
  await share(file.nodeId, policy('organization'))
  assert.ok((await visible(organization, outsider.cookie)).includes(file.nodeId))
  await share(file.nodeId, policy('private'))
  const changes = await request(`${prefix}/changes?spaceId=${organization}&cursor=${encodeURIComponent(cursor)}`, outsider.cookie)
  assert.deepEqual((await changes.json() as { items: unknown[] }).items, [])
  const privateFile = await upload(personal, 'personal.txt'); await commit(privateFile.uploadId)
  await share(privateFile.nodeId, policy('selected', 'member', [member.id]))
  const shared = await request(`${prefix}/files?spaceId=${organization}&shared=true`, member.cookie)
  assert.equal(shared.status, 200, await shared.clone().text())
  const sharedItems = (await shared.json() as { items: Array<{ id: string; spaceId: string }> }).items
  assert.deepEqual(sharedItems.map(item => item.id), [privateFile.nodeId])
  assert.equal(sharedItems[0].spaceId, personal)
  assert.equal((await request(`${prefix}/files/${privateFile.nodeId}/sharing`, member.cookie, 'PUT', { policy: policy('organization') })).status, 403)
  const folderResponse = await request(prefix + '/folders', owner.cookie, 'POST', { spaceId: personal, parentId: null, name: 'Shared folder' })
  const folder = await folderResponse.json() as { id: string }
  const nested = await upload(personal, 'nested.txt', folder.id); await commit(nested.uploadId)
  await share(folder.id, policy('selected', 'member', [member.id]))
  assert.equal((await request(`${prefix}/files/${nested.nodeId}/download`, member.cookie)).status, 200)
  const inherited = await request(`${prefix}/files/${nested.nodeId}/sharing`, owner.cookie)
  assert.equal((await inherited.json() as { inheritedFrom: string }).inheritedFrom, folder.id)
  const pendingVersion = await upload(personal, 'pending.txt', folder.id, member.cookie)
  await share(folder.id, policy('private'))
  assert.equal((await request(prefix + '/uploads/commit', member.cookie, 'POST', { uploadId: pendingVersion.uploadId })).status, 403)
  assert.equal((await request(`${prefix}/files/${nested.nodeId}/download`, member.cookie)).status, 403)
  await share(nested.nodeId, policy('selected', 'viewer', [outsider.id]))
  assert.equal((await request(`${prefix}/files/${nested.nodeId}/download`, outsider.cookie)).status, 200)
  assert.equal((await request(`${otherPrefix}/files/${nested.nodeId}/download`, outsider.cookie)).status, 403)
  assert.equal((await request(`${otherPrefix}/files/${file.nodeId}`, outsider.cookie)).status, 403)
  await share(nested.nodeId, null)
  assert.equal((await request(`${prefix}/files/${nested.nodeId}/download`, outsider.cookie)).status, 403)
  await share(folder.id, policy('selected', 'viewer', [member.id]))
  await share(nested.nodeId, null)
  const moved = await request(`${prefix}/files/${nested.nodeId}`, owner.cookie, 'PATCH', { spaceId: personal, parentId: null })
  assert.equal(moved.status, 200, await moved.clone().text())
  assert.equal((await request(`${prefix}/files/${nested.nodeId}/download`, member.cookie)).status, 200)
  const movedPolicy = await request(`${prefix}/files/${nested.nodeId}/sharing`, owner.cookie)
  assert.equal((await movedPolicy.json() as { inheritedFrom: string | null }).inheritedFrom, null)
  const returned = await request(`${prefix}/files/${nested.nodeId}`, owner.cookie, 'PATCH', { spaceId: personal, parentId: folder.id })
  assert.equal(returned.status, 200, await returned.clone().text())
  const cycle = await request(`${prefix}/files/${folder.id}`, owner.cookie, 'PATCH', { spaceId: personal, parentId: folder.id })
  assert.equal(cycle.status, 409)
  const deleted = await request(`${prefix}/files/${folder.id}`, owner.cookie, 'DELETE')
  assert.equal(deleted.status, 200)
  assert.equal((await request(`${prefix}/files/${nested.nodeId}/download`, owner.cookie)).status, 403)
})
