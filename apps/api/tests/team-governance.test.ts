/** Real tenant HTTP requests, independent PostgreSQL, and deterministic settlement/upload races. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, readFile, writeFile, readdir, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import postgres from 'postgres'
import { eq, sql } from 'drizzle-orm'
import { createApplication } from '../src/application.ts'
import { configSchema } from '../src/config.ts'
import { connectDatabase, selectOrganization } from '../src/database.ts'
import { migrateEnterprise } from '../src/migrations.ts'
import { digest, encrypt } from '../src/security.ts'
import { organizationId } from '../src/contracts.ts'
import { ensureRootAccess } from '../src/provisioning.ts'
import { budgetMonth } from '../src/team-governance.ts'
import { MemoryDriveObjectStore } from '../src/drive-storage.ts'
import { cleanupDrive } from '../src/drive-capacity.ts'
import { modelFixture } from './gateway-fixture.ts'
import * as s from '../src/schema.ts'

void test('team governance applies the same resource rules to HTTP, settlement, and recovery', { timeout: 120000 }, async (t) => {
  const container = 'dsh-governance-' + randomUUID()
  const password = randomBytes(24).toString('hex')
  const docker = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe' })
  docker(['run', '-d', '--name', container, '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD=' + password, 'postgres:16-alpine'])
  // oxlint-disable-next-line prefer-const -- Teardown is registered before database initialization can fail.
  let migration: ReturnType<typeof postgres> | undefined
  // oxlint-disable-next-line prefer-const -- Teardown observes the initialized pool after setup.
  let pool: ReturnType<typeof connectDatabase> | undefined
  t.after(async () => {
    try { await pool?.close(); await migration?.end() }
    finally { docker(['rm', '-fv', container]) }
  })
  const deadline = Date.now() + 30000
  for (;;) {
    try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); break }
    catch { if (Date.now() >= deadline) throw new Error('PostgreSQL readiness deadline exceeded') }
    await delay(25)
  }
  const port = docker(['port', container, '5432/tcp']).trim().split(':').at(-1)!
  const url = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`
  migration = postgres(url, { max: 1, onnotice: () => {} })
  await migration.unsafe(`CREATE ROLE enterprise_app LOGIN PASSWORD '${password}'`)
  const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))
  const historicalMigrations = await mkdtemp(join(tmpdir(), 'dsh-v40-migrations-'))
  t.after(() => rm(historicalMigrations, { recursive: true, force: true }))
  await mkdir(join(historicalMigrations, 'meta'))
  const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number }[] }
  await writeFile(join(historicalMigrations, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.filter(entry => entry.idx <= 40) }))
  for (const file of await readdir(migrationsFolder)) if (file.endsWith('.sql')) await copyFile(join(migrationsFolder, file), join(historicalMigrations, file))
  await migrateEnterprise(migration, 'enterprise_app', { migrationsFolder: historicalMigrations })
  await migration.unsafe('GRANT USAGE ON SCHEMA enterprise, enterprise_auth TO enterprise_app')
  await migration.unsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA enterprise, enterprise_auth TO enterprise_app')
  await migration.unsafe('REVOKE UPDATE, DELETE ON enterprise.billing_attribution, enterprise.handover, enterprise.audit FROM enterprise_app')
  const root = randomUUID()
  await migration`INSERT INTO enterprise_auth.deployment (id, mode, registration, root_organization_id) VALUES ('primary', 'open', 'open', ${root})`
  const appUrl = new URL(url); appUrl.username = 'enterprise_app'
  pool = connectDatabase(appUrl.href)
  class FaultStore extends MemoryDriveObjectStore {
    failDelete = false
    override delete(key: string) { return this.failDelete ? Promise.reject(new Error('Storage unavailable')) : super.delete(key) }
  }
  const objects = new FaultStore()
  const fixture = await modelFixture(t)
  let now = new Date('2026-10-23T08:00:00Z').getTime()
  const config = configSchema.parse({ databaseUrl: url, authSecret: password, encryptionKey: randomBytes(32).toString('hex'),
    apiUrl: 'http://127.0.0.1:8787', adminOrigin: 'http://127.0.0.1:4000', portalOrigin: 'http://127.0.0.1:4000',
    drivePersonalQuotaBytes: 80, driveOrganizationQuotaBytes: 100 })
  let failMail = false
  const deliveries: { to: string; text: string }[] = []
  const services = { db: pool.db, config, mail: async (value: { to: string; text: string }) => { if (failMail) throw new Error('offline'); deliveries.push(value) }, driveObjects: objects, modelTransport: fixture.transport, now: () => now }
  const { app } = createApplication(services)
  let requestNumber = 1
  const request = (path: string, cookie: string, method = 'GET', body?: unknown) => app.request(new URL(path, config.apiUrl), {
    method, headers: { Cookie: cookie, Origin: config.adminOrigin, 'Content-Type': 'application/json',
      'X-Forwarded-For': `192.0.2.${requestNumber++}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const signup = async (name: string) => {
    const response = await request('/auth/sign-up/email', '', 'POST', { name, email: name + '@example.com', password })
    assert.equal(response.status, 200, await response.clone().text())
    const value = await response.json() as { user: { id: string } }
    return { id: value.user.id, cookie: response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ') }
  }
  const owner = await signup('owner'), member = await signup('member'), operator = await signup('platform')
  const policy = { defaultBudget: { mode: 'limited', amountMicrosCny: 15 }, timeZone: 'Asia/Shanghai', storageBytes: 100, personalStorageBytes: 80 }
  const created = await request('/v1/organizations', owner.cookie, 'POST', { name: 'Company', defaultBudget: policy.defaultBudget })
  assert.equal(created.status, 201, await created.clone().text())
  const team = await created.json() as { id: string; rootId: string }
  const memberId = randomUUID(), modelId = randomUUID(), runtimeId = randomUUID(), runtimeToken = randomBytes(32).toString('hex')
  await migration.begin(async (tx) => {
    await tx`select set_config('enterprise.platform_admin', 'true', true)`
    await tx`select set_config('enterprise.organization_id', ${team.id}, true)`
    await tx`UPDATE enterprise_auth.deployment SET root_organization_id = ${team.id} WHERE id = 'primary'`
    await tx`INSERT INTO enterprise_auth.platform_admin (account_id) VALUES (${operator.id})`
    await tx`UPDATE enterprise.subscription SET seats = 10 WHERE organization_id = ${team.id}`
    await tx`UPDATE enterprise.organization_wallet SET balance_micros_cny = 100 WHERE organization_id = ${team.id}`
    await tx`INSERT INTO enterprise.membership (id, organization_id, account_id) VALUES (${memberId}, ${team.id}, ${member.id})`
    await tx`INSERT INTO enterprise.role_binding (id, organization_id, membership_id, role) VALUES (${randomUUID()}, ${team.id}, ${memberId}, 'member')`
    await tx`INSERT INTO enterprise.runtime (id, organization_id, account_id, name, type, version, capabilities, token_hash, expires_at)
      VALUES (${runtimeId}, ${team.id}, ${member.id}, 'Desktop', 'desktop', 'test', '[]', ${digest(runtimeToken)}, now() + interval '1 day')`
    await tx`INSERT INTO enterprise_auth.model (id, name, base_url, upstream_model, secret, context_tokens, max_output_tokens,
      input_micros_per_million, output_micros_per_million, input_price_micros_cny_per_million, output_price_micros_cny_per_million, cached_input_price_micros_cny_per_million)
      VALUES (${modelId}, 'Fixture', 'https://model.example/v1', 'fixture', ${encrypt('fixture-key', config.encryptionKey, modelId)}, 4096, 1024, 0, 0, 1000000, 1000000, 1000000)`
  })
  const historicalUsage = randomUUID()
  await migration.begin(async (tx) => {
    await tx`select set_config('enterprise.organization_id', ${team.id}, true)`
    await tx`INSERT INTO enterprise.usage (id, organization_id, account_id, model_id, purpose, reserved_micros,
      status, currency, total_cost_micros_cny, idempotency_key, created_at, request_started_at, duration_ms,
      pricing_version, input_tokens, cached_input_tokens, uncached_input_tokens, output_tokens, reasoning_tokens, total_tokens,
      input_price_micros_cny_per_million, cached_input_price_micros_cny_per_million, output_price_micros_cny_per_million,
      input_cost_micros_cny, cached_input_cost_micros_cny, output_cost_micros_cny)
      VALUES (${historicalUsage}, ${team.id}, ${member.id}, ${modelId}, 'legacy', 0, 'settled', 'CNY', 17,
        ${historicalUsage}, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', 1, 1, 17, 0, 17, 0, 0, 17,
        1000000, 1000000, 1000000, 17, 0, 0)`
    await tx`UPDATE enterprise.subscription SET plan = 'legacy-plan' WHERE organization_id = ${team.id}`
  })
  await migrateEnterprise(migration, 'enterprise_app', { migrationsFolder })
  const [importedPlan] = await migration`SELECT seats FROM enterprise_auth.subscription_plan WHERE code = 'legacy-plan'`
  assert.equal(importedPlan?.seats, 10)
  const [historical] = await migration`SELECT month, department_ids FROM enterprise.billing_attribution WHERE id = ${historicalUsage}`
  assert.equal(historical?.month, '2026-09'); assert.deepEqual(historical?.department_ids, [])
  const [retainedUsage] = await migration`SELECT total_cost_micros_cny FROM enterprise.usage WHERE id = ${historicalUsage}`
  assert.equal(Number(retainedUsage?.total_cost_micros_cny), 17)
  const base = `/v1/organizations/${team.id}`
  async function governance(cookie = owner.cookie) {
    const response = await request(base + '/governance', cookie)
    assert.equal(response.status, 200, await response.clone().text())
    return response.json() as Promise<{ version: number; members: { id: string; spentMicrosCny: number }[]; balanceMicrosCny: number }>
  }
  const action = async (change: unknown, cookie = owner.cookie) => {
    const state = await governance(cookie)
    return request(base + '/governance/actions', cookie, 'POST', { expectedVersion: state.version, reason: 'Governance acceptance', change })
  }
  const callModel = (application = app) => application.request(new URL('/model/chat/completions', config.apiUrl), { method: 'POST',
    headers: { Authorization: 'Bearer ' + runtimeToken, 'Content-Type': 'application/json', 'X-DSH-Model': modelId },
    body: JSON.stringify({ model: modelId, stream: true, messages: [{ role: 'user', content: 'hello' }] }) })
  await t.test('desktop bearer credentials read capabilities, billing and task pages without browser cookies', async () => {
    for (const path of ['/capabilities', '/wallet/summary', '/usage?scope=own&limit=100', '/model-tasks/page?limit=10']) {
      const response = await app.request(new URL(base + path, config.apiUrl), { headers: { Authorization: 'Bearer ' + runtimeToken } })
      assert.equal(response.status, 200, path + ': ' + await response.clone().text())
    }
    const invalid = await app.request(new URL(base + '/usage?scope=own&limit=200', config.apiUrl), { headers: { Authorization: 'Bearer ' + runtimeToken } })
    assert.equal(invalid.status, 400)
    const foreign = await app.request(new URL('/v1/organizations/' + randomUUID() + '/model-tasks/page', config.apiUrl), { headers: { Authorization: 'Bearer ' + runtimeToken } })
    assert.equal(foreign.status, 403)
  })
  await t.test('plan catalog enforces platform identity, versioned edits and referenced deletion protection', async () => {
    assert.equal((await request('/v1/platform/plans', owner.cookie)).status, 403)
    const values = { name: 'Business', description: 'Reference plan', seats: 15, priceMicrosCny: 99000000, enabled: true, resourcePolicy: null }
    const create = await request('/v1/platform/plans', operator.cookie, 'POST', { code: 'business', reason: 'Create plan', values })
    assert.equal(create.status, 201, await create.clone().text())
    const edit = await request('/v1/platform/plans/business', operator.cookie, 'PATCH', { expectedVersion: 1, reason: 'Adjust seats', values: { ...values, seats: 20 } })
    assert.equal(edit.status, 200, await edit.clone().text())
    assert.equal((await request('/v1/platform/plans/business', operator.cookie, 'PATCH', { expectedVersion: 1, reason: 'Stale edit', values })).status, 409)
    const state = await governance()
    const assign = await request(`/v1/platform/organizations/${team.id}/governance/actions`, operator.cookie, 'POST', {
      expectedVersion: state.version, reason: 'Assign plan', change: { action: 'subscription', plan: 'business', planVersion: 2, seats: 20 },
    })
    assert.equal(assign.status, 200, await assign.clone().text())
    assert.equal((await request('/v1/platform/plans/business', operator.cookie, 'DELETE', { expectedVersion: 2, reason: 'Referenced' })).status, 409)
    const before = await governance()
    assert.equal(before.balanceMicrosCny, 100)
    assert.equal((await request('/v1/platform/plans/business', operator.cookie, 'PATCH', { expectedVersion: 2, reason: 'Stop assignments', values: { ...values, enabled: false } })).status, 200)
    const disabled = await request(`/v1/platform/organizations/${team.id}/governance/actions`, operator.cookie, 'POST', {
      expectedVersion: before.version, reason: 'Disabled', change: { action: 'subscription', plan: 'business', planVersion: 3, seats: 15 },
    })
    assert.equal(disabled.status, 409)
    const unused = await request('/v1/platform/plans', operator.cookie, 'POST', { code: 'unused', reason: 'Unused plan', values })
    assert.equal(unused.status, 201)
    assert.equal((await request('/v1/platform/plans/unused', operator.cookie, 'DELETE', { expectedVersion: 1, reason: 'Remove unused' })).status, 200)
  })
  await t.test('calendar month follows the selected time zone', () => {
    assert.equal(budgetMonth(new Date('2026-10-31T16:00:00Z'), 'Asia/Shanghai'), '2026-11')
  })
  await t.test('ordinary members cannot change budgets and platform identity does not enter customer teams', async () => {
    const response = await action({ action: 'budget', membershipId: memberId, budget: { mode: 'unlimited' } }, member.cookie)
    assert.equal(response.status, 403)
    assert.equal((await request(base + '/governance', operator.cookie)).status, 403)
    assert.equal((await request(`/v1/platform/organizations/${team.id}/governance`, operator.cookie)).status, 200)
  })
  await t.test('mail failure preserves the invitation and resend and repeated acceptance reuse membership', async () => {
    const newcomer = await signup('newcomer')
    failMail = true
    const created = await request(base + '/invitations', owner.cookie, 'POST', { email: 'newcomer@example.com' })
    assert.equal(created.status, 201)
    const invitation = await created.json() as { id: string; deliveryStatus: string }
    assert.equal(invitation.deliveryStatus, 'failed')
    failMail = false
    const resend = await request(base + '/invitations/' + invitation.id + '/resend', owner.cookie, 'POST')
    assert.equal(resend.status, 200)
    const link = new URL(deliveries.at(-1)!.text)
    assert.equal(link.pathname, '/account')
    const token = link.searchParams.get('invitation')!
    assert.equal((await request('/v1/invitations/' + token, member.cookie)).status, 403)
    const accepted = await request('/v1/invitations/accept', newcomer.cookie, 'POST', { token })
    assert.equal(accepted.status, 200)
    assert.deepEqual(await (await request('/v1/invitations/accept', newcomer.cookie, 'POST', { token })).json(), await accepted.json())
  })
  await t.test('all membership and role entry points protect the final effective Owner', async () => {
    const [ownerMembership] = await migration<Record<string, string>[]>`SELECT id FROM enterprise.membership WHERE organization_id = ${team.id} AND account_id = ${owner.id}`
    const rejected = await action({ action: 'member-state', membershipId: ownerMembership.id, status: 'suspended' })
    assert.equal(rejected.status, 409)
    const denyOwner = await request(base + '/roles', owner.cookie, 'POST', { membershipId: ownerMembership.id, unitId: null, role: 'owner', effect: 'deny' })
    assert.equal(denyOwner.status, 409)
    const legacy = await request(base + '/members/' + ownerMembership.id, owner.cookie, 'PATCH', { status: 'removed' })
    assert.equal(legacy.status, 409)
  })
  await t.test('overlapping calls may exceed the member budget and later calls stop', async () => {
    fixture.state.mode = 'pause'
    const first = await callModel()
    if (first.status !== 200) assert.fail(await first.text())
    const firstBody = first.text()
    await fixture.paused
    const second = await callModel()
    assert.equal(second.status, 200)
    const secondBody = second.text()
    fixture.release()
    await Promise.all([firstBody, secondBody])
    const state = await governance()
    assert.equal(state.members.find(item => item.id === memberId)?.spentMicrosCny, 40)
    assert.equal(state.balanceMicrosCny, 60)
    const rejected = await callModel()
    assert.equal(rejected.status, 402)
    assert.match(await rejected.text(), /MEMBER_BUDGET_EXHAUSTED/)
    assert.equal(fixture.state.calls, 2)
  })
  await t.test('Owner exemption retains spending and removing Owner restores the same budget', async () => {
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(team.id))
      await tx.insert(s.roles).values({ id: randomUUID(), organizationId: team.id, membershipId: memberId, role: 'owner' })
    })
    const response = await callModel(); assert.equal(response.status, 200); await response.text()
    await pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(team.id))
      await tx.delete(s.roles).where(eq(s.roles.membershipId, memberId))
      await tx.insert(s.roles).values({ id: randomUUID(), organizationId: team.id, membershipId: memberId, role: 'member' })
    })
    assert.equal((await callModel()).status, 402)
    assert.equal((await governance()).members.find(item => item.id === memberId)?.spentMicrosCny, 60)
  })
  await t.test('versions, trash and concurrent uploads share one team capacity', async () => {
    const spacesResponse = await request(base + '/drive/spaces', owner.cookie)
    const spaces = await spacesResponse.json() as { id: string; kind: string }[]
    const spaceId = spaces.find(item => item.kind === 'personal')!.id
    const upload = (name: string) => request(base + '/drive/uploads', owner.cookie, 'POST', { spaceId, parentId: null,
      name, size: 60, contentType: 'text/plain' })
    const responses = await Promise.all([upload('first.txt'), upload('second.txt')])
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 413])
    const admitted = await responses.find(response => response.status === 200)!.json() as { uploadId: string; uploadUrl: string }
    await objects.put(decodeURIComponent(admitted.uploadUrl.slice('memory://upload/'.length)), Buffer.alloc(60), 'text/plain')
    const committed = await request(base + '/drive/uploads/commit', owner.cookie, 'POST', { uploadId: admitted.uploadId })
    assert.equal(committed.status, 200, await committed.clone().text())
    const node = await committed.json() as { nodeId: string }
    assert.equal((await request(base + '/drive/files/' + node.nodeId, owner.cookie, 'DELETE')).status, 200)
    const stats = await (await request(base + '/drive/capacity', owner.cookie)).json() as { team: { usedBytes: number; trashBytes: number } }
    assert.equal(stats.team.usedBytes, 60); assert.equal(stats.team.trashBytes, 60)
    assert.equal((await upload('third.txt')).status, 413)
    assert.equal((await request(base + '/drive/files/' + node.nodeId + '/permanent', owner.cookie, 'DELETE')).status, 200)
    assert.equal(await cleanupDrive(services, new AbortController().signal), 1)
    assert.equal((await upload('after-cleanup.txt')).status, 200)
  })
  await t.test('cross-space moves transfer capacity and copying media only charges retained bytes', async () => {
    const spaces = await (await request(base + '/drive/spaces', owner.cookie)).json() as { id: string; kind: string }[]
    const personal = spaces.find(item => item.kind === 'personal')!.id
    const shared = spaces.find(item => item.kind === 'organization')!.id
    const uploads = await migration<Record<string, string>[]>`SELECT id FROM enterprise.drive_upload WHERE organization_id = ${team.id} AND status = 'created'`
    for (const upload of uploads) await request(base + '/drive/uploads/' + upload.id, owner.cookie, 'DELETE')
    now += 24 * 60 * 60 * 1000
    await cleanupDrive(services, new AbortController().signal)
    const upload = await (await request(base + '/drive/uploads', owner.cookie, 'POST', { spaceId: personal, name: 'move.txt', size: 30, contentType: 'text/plain' })).json() as { uploadId: string; uploadUrl: string }
    await objects.put(decodeURIComponent(upload.uploadUrl.slice('memory://upload/'.length)), Buffer.alloc(30), 'text/plain')
    const node = await (await request(base + '/drive/uploads/commit', owner.cookie, 'POST', { uploadId: upload.uploadId })).json() as { nodeId: string }
    assert.equal((await request(base + '/drive/files/' + node.nodeId, owner.cookie, 'PATCH', { spaceId: shared, parentId: null })).status, 409)
    const moved = await request(base + '/drive/files/' + node.nodeId, owner.cookie, 'PATCH', { spaceId: shared, parentId: null, confirmSharing: true })
    assert.equal(moved.status, 200, await moved.clone().text())
    const copy = { requestId: randomUUID(), source: { kind: 'file', nodeId: node.nodeId }, spaceId: personal, parentId: null, name: 'copy.txt' }
    const saved = await request(base + '/drive/imports', owner.cookie, 'POST', copy)
    assert.equal(saved.status, 200, await saved.clone().text())
    const duplicate = await request(base + '/drive/imports', owner.cookie, 'POST', copy)
    assert.equal(duplicate.status, 200)
    assert.equal((await duplicate.json() as { nodeId: string }).nodeId, (await saved.json() as { nodeId: string }).nodeId)
    const stats = await (await request(base + '/drive/capacity', owner.cookie)).json() as { team: { usedBytes: number }; personal: { usedBytes: number } }
    assert.equal(stats.team.usedBytes, 60); assert.equal(stats.personal.usedBytes, 30)
  })
  await t.test('publication revocation rejects the next execution and optimistic updates retain the audit', async () => {
    await migration`UPDATE enterprise_auth.deployment SET root_organization_id = ${team.id} WHERE id = 'primary'`
    const otherTeam = await (await request('/v1/organizations', owner.cookie, 'POST', { name: 'Audience target', defaultBudget: { mode: 'unlimited' } })).json() as { id: string }
    const payload = { audience: { mode: 'selected', organizationIds: [otherTeam.id] }, expectedPublicationRevision: 1, reason: 'Restrict published audience' }
    const changed = await request('/v1/platform/models/' + modelId, operator.cookie, 'PATCH', payload)
    assert.equal(changed.status, 200, await changed.clone().text())
    assert.equal((await request('/v1/platform/models/' + modelId, operator.cookie, 'PATCH', payload)).status, 409)
    assert.equal((await callModel()).status, 403)
    assert.equal((await request('/v1/platform/models/' + modelId, operator.cookie, 'PATCH', { audience: { mode: 'all', organizationIds: [] }, expectedPublicationRevision: 2, reason: 'Restore published audience' })).status, 200)
  })
  await t.test('department grants do not grant team administration and explicit denies affect the next call', async () => {
    const [rootUnit] = await migration<Record<string, string>[]>`SELECT id FROM enterprise.org_unit WHERE organization_id = ${team.id} AND parent_id IS NULL`
    const custom = await request(base + '/roles/custom', owner.cookie, 'POST', { name: 'Scoped budget', permissionIds: ['budget.manage'] })
    assert.equal(custom.status, 201)
    const role = await custom.json() as { id: string }
    const bind = await request(base + '/roles/custom/' + role.id + '/bindings', owner.cookie, 'POST', { membershipId: memberId, unitId: rootUnit.id })
    assert.equal(bind.status, 201)
    assert.equal((await action({ action: 'budget', membershipId: memberId, budget: { mode: 'unlimited' } }, member.cookie)).status, 403)
    const denial = await request(base + '/roles/custom', owner.cookie, 'POST', { name: 'Deny model', permissionIds: ['model.use'] })
    const deniedRole = await denial.json() as { id: string }
    const binding = await (await request(base + '/roles/custom/' + deniedRole.id + '/bindings', owner.cookie, 'POST', { membershipId: memberId, unitId: null, effect: 'deny' })).json() as { id: string }
    const calls = fixture.state.calls
    assert.equal((await callModel()).status, 403)
    assert.equal(fixture.state.calls, calls)
    assert.equal((await request(base + '/roles/' + binding.id, owner.cookie, 'DELETE')).status, 200)
  })
  await t.test('free calls remain available at zero personal budget and zero team balance', async () => {
    assert.equal((await action({ action: 'budget', membershipId: memberId, budget: { mode: 'limited', amountMicrosCny: 0 } })).status, 200)
    const [wallet] = await migration<Record<string, string>[]>`SELECT balance_micros_cny AS balance FROM enterprise.organization_wallet WHERE organization_id = ${team.id}`
    await migration`UPDATE enterprise.organization_wallet SET balance_micros_cny = 0 WHERE organization_id = ${team.id}`
    await migration`UPDATE enterprise_auth.model SET input_price_micros_cny_per_million = 0, output_price_micros_cny_per_million = 0, cached_input_price_micros_cny_per_million = 0 WHERE id = ${modelId}`
    try {
      const response = await callModel(); assert.equal(response.status, 200); await response.text()
      const [after] = await migration<Record<string, string>[]>`SELECT balance_micros_cny FROM enterprise.organization_wallet WHERE organization_id = ${team.id}`
      assert.equal(Number(after.balance_micros_cny), 0)
    } finally {
      await migration`UPDATE enterprise_auth.model SET input_price_micros_cny_per_million = 1000000, output_price_micros_cny_per_million = 1000000, cached_input_price_micros_cny_per_million = 1000000 WHERE id = ${modelId}`
      await migration`UPDATE enterprise.organization_wallet SET balance_micros_cny = ${wallet.balance} WHERE organization_id = ${team.id}`
    }
    assert.equal((await callModel()).status, 402)
  })
  await t.test('immutable versions reject stale commits and late upload bytes cannot alter retained files', async () => {
    const otherTeam = await (await request('/v1/organizations', owner.cookie, 'POST', { name: 'Version checks', defaultBudget: { mode: 'unlimited' } })).json() as { id: string }
    const prefix = `/v1/organizations/${otherTeam.id}/drive`
    const spaces = await (await request(prefix + '/spaces', owner.cookie)).json() as { id: string; kind: string }[]
    const spaceId = spaces.find(space => space.kind === 'personal')!.id
    const upload = async (nodeId?: string) => {
      const response = await request(prefix + '/uploads', owner.cookie, 'POST', { spaceId, name: 'retained.txt', size: 5, contentType: 'text/plain', ...(nodeId ? { nodeId } : {}) })
      assert.equal(response.status, 200, await response.clone().text())
      const result = await response.json() as { nodeId: string; uploadId: string; uploadUrl: string; versionId: string }
      await objects.put(decodeURIComponent(result.uploadUrl.slice('memory://upload/'.length)), Buffer.from('first'), 'text/plain')
      return result
    }
    const first = await upload()
    assert.equal((await request(prefix + '/uploads/commit', owner.cookie, 'POST', { uploadId: first.uploadId })).status, 200)
    const [stored] = await migration<Record<string, string>[]>`SELECT object_key, checksum FROM enterprise.drive_version WHERE id = ${first.versionId}`
    await objects.put(decodeURIComponent(first.uploadUrl.slice('memory://upload/'.length)), Buffer.from('other'), 'text/plain')
    assert.equal((await objects.inspect(stored.object_key)).checksum, stored.checksum)
    const [left, right] = await Promise.all([upload(first.nodeId), upload(first.nodeId)])
    assert.equal((await request(prefix + '/uploads/commit', owner.cookie, 'POST', { uploadId: left.uploadId })).status, 200)
    assert.equal((await request(prefix + '/uploads/commit', owner.cookie, 'POST', { uploadId: right.uploadId })).status, 409)
    await request(prefix + '/files/' + first.nodeId, owner.cookie, 'DELETE')
    await request(prefix + '/files/' + first.nodeId + '/permanent', owner.cookie, 'DELETE')
    objects.failDelete = true
    try { await cleanupDrive(services, new AbortController().signal) } finally { objects.failDelete = false }
    const stats = await (await request(prefix + '/capacity', owner.cookie)).json() as { team: { usedBytes: number } }
    assert.equal(stats.team.usedBytes, 10)
    await cleanupDrive(services, new AbortController().signal)
    const cleared = await (await request(prefix + '/capacity', owner.cookie)).json() as { team: { usedBytes: number } }
    assert.equal(cleared.team.usedBytes, 0)
  })
  await t.test('cross-month settlement stays in the admission month and attribution cannot be rewritten', async () => {
    assert.equal((await action({ action: 'budget', membershipId: memberId, budget: { mode: 'unlimited' } })).status, 200)
    now = new Date('2026-10-31T15:59:59Z').getTime()
    const supplier = await modelFixture(t)
    supplier.state.mode = 'pause'
    const delayed = createApplication({ ...services, modelTransport: supplier.transport }).app
    const response = await callModel(delayed)
    if (response.status !== 200) assert.fail(await response.text())
    const body = response.text()
    await supplier.paused
    now += 2000
    supplier.release(); await body
    const state = await governance()
    assert.equal(state.members.find(item => item.id === memberId)?.spentMicrosCny, 0)
    const [attribution] = await migration<Record<string, string>[]>`SELECT a.month FROM enterprise.billing_attribution a JOIN enterprise.usage u ON u.id = a.id
      WHERE a.account_id = ${member.id} ORDER BY a.created_at DESC LIMIT 1`
    assert.equal(attribution.month, '2026-10')
    await assert.rejects(pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(team.id))
      await tx.execute(sql`UPDATE enterprise.billing_attribution SET month = '2026-11' WHERE account_id = ${member.id}`)
    }), (error: unknown) => error instanceof Error && (error.cause as { code?: string } | undefined)?.code === '42501')
  })
  await t.test('billing scopes enforce finance permission and keep cross-month costs in the original month', async () => {
    assert.equal((await request(base + '/wallet/summary?scope=organization', member.cookie)).status, 403)
    assert.equal((await request(base + '/wallet/ledger?scope=organization', member.cookie)).status, 403)
    assert.equal((await request(base + '/wallet', member.cookie)).status, 403)
    assert.equal((await request(base + '/wallet/redeem', member.cookie, 'POST', { code: 'member-cannot-credit-team' })).status, 403)
    const ownLedger = await (await request(base + '/wallet/ledger', member.cookie)).json() as { items: { balanceAfterMicrosCny: number | null }[] }
    assert.ok(ownLedger.items.length > 0)
    assert.ok(ownLedger.items.every(item => item.balanceAfterMicrosCny === null))
    const own = await request(base + '/wallet/summary?month=2026-10', member.cookie)
    assert.equal(own.status, 200, await own.clone().text())
    const costs = await own.json() as { settledMicrosCny: number; pendingCount: number; balanceMicrosCny: number | null }
    assert.ok(costs.settledMicrosCny > 0); assert.equal(costs.balanceMicrosCny, null)
    const current = await (await request(base + '/wallet/summary', member.cookie)).json() as { settledMicrosCny: number; month: string }
    assert.equal(current.month, '2026-11'); assert.equal(current.settledMicrosCny, 0)
    const teamCosts = await request(base + '/wallet/summary?scope=organization&month=2026-10', owner.cookie)
    assert.equal(teamCosts.status, 200, await teamCosts.clone().text())
    assert.ok((await teamCosts.json() as { settledMicrosCny: number }).settledMicrosCny >= costs.settledMicrosCny)
  })
  await t.test('offboarding custody exposes metadata without content or sharing privileges', async () => {
    const source = await signup('offboarding')
    await request(base + '/invitations', owner.cookie, 'POST', { email: 'offboarding@example.com' })
    const token = new URL(deliveries.at(-1)!.text).searchParams.get('invitation')!
    assert.equal((await request('/v1/invitations/accept', source.cookie, 'POST', { token })).status, 200)
    const [sourceMembership] = await migration<Record<string, string>[]>`SELECT id FROM enterprise.membership WHERE organization_id = ${team.id} AND account_id = ${source.id}`
    const spaces = await (await request(base + '/drive/spaces', source.cookie)).json() as { id: string; kind: string }[]
    const spaceId = spaces.find(item => item.kind === 'personal')!.id
    const upload = await request(base + '/drive/uploads', source.cookie, 'POST', { spaceId, name: 'handover.txt', size: 1, contentType: 'text/plain' })
    assert.equal(upload.status, 200, await upload.clone().text())
    const item = await upload.json() as { uploadId: string; uploadUrl: string; nodeId: string }
    await objects.put(decodeURIComponent(item.uploadUrl.slice('memory://upload/'.length)), Buffer.from('a'), 'text/plain')
    assert.equal((await request(base + '/drive/uploads/commit', source.cookie, 'POST', { uploadId: item.uploadId })).status, 200)
    assert.equal((await action({ action: 'member-state', membershipId: sourceMembership.id, status: 'suspended' })).status, 200)
    const handover = await action({ action: 'handover', membershipId: sourceMembership.id, targetMembershipId: memberId })
    assert.equal(handover.status, 200, await handover.clone().text())
    const custody = await request(base + '/drive/custody', member.cookie)
    assert.equal(custody.status, 200)
    assert.ok((await custody.json() as { items: { id: string }[] }).items.some(row => row.id === item.nodeId))
    assert.equal((await request(base + '/drive/files/' + item.nodeId + '/download', member.cookie)).status, 403)
    assert.equal((await request(base + '/drive/files/' + item.nodeId + '/sharing', member.cookie, 'PUT', { policy: { organizationId: team.id, scope: 'organization', permission: 'viewer', memberIds: [], departments: [] } })).status, 403)
  })
  await t.test('directory approval retains team identity and final Owner protection and rolls back department changes', async () => {
    const [ownerMembership] = await migration<Record<string, string>[]>`SELECT id FROM enterprise.membership WHERE organization_id = ${team.id} AND account_id = ${owner.id}`
    async function preview(records: unknown) {
      const source = 'module.exports = () => (' + JSON.stringify(records) + ')'
      const scriptResponse = await request(base + '/sync-scripts', owner.cookie, 'POST', { name: 'Acceptance sync ' + randomUUID(), source })
      assert.equal(scriptResponse.status, 201)
      const script = await scriptResponse.json() as { id: string }
      const response = await request(base + '/sync-scripts/' + script.id + '/test', owner.cookie, 'POST', {})
      assert.equal(response.status, 200)
      const run = await response.json() as { id: string }
      const diffs = await (await request(base + '/sync-diffs', owner.cookie)).json() as { id: string; runId: string; version: number }[]
      return { run, diff: diffs.find(item => item.runId === run.id)! }
    }
    const ownerDiff = await preview({ memberships: [{ externalId: ownerMembership.id, userExternalId: owner.id, active: false }] })
    const denied = await request(base + '/sync-diffs/' + ownerDiff.diff.id, owner.cookie, 'PATCH', { decision: 'approved', version: 1 })
    assert.equal(denied.status, 409); assert.match(await denied.text(), /FINAL_OWNER_REQUIRED/)
    const identityDiff = await preview({ users: [{ externalId: member.id, email: 'replacement@example.com', name: 'Changed' }] })
    assert.equal((await request(base + '/sync-diffs/' + identityDiff.diff.id, owner.cookie, 'PATCH', { decision: 'approved', version: 1 })).status, 409)
    const [rootUnit] = await migration<Record<string, string>[]>`SELECT id FROM enterprise.org_unit WHERE organization_id = ${team.id} AND parent_id IS NULL`
    const departmentId = randomUUID()
    const created = await preview({ departments: [{ externalId: departmentId, name: 'Sales', parentId: rootUnit.id, changeType: 'create' }] })
    assert.equal((await request(base + '/sync-diffs/' + created.diff.id, owner.cookie, 'PATCH', { decision: 'approved', version: 1 })).status, 200)
    const updated = await preview({ departments: [{ externalId: departmentId, name: 'Revenue', parentId: rootUnit.id }] })
    assert.equal((await request(base + '/sync-diffs/' + updated.diff.id, owner.cookie, 'PATCH', { decision: 'approved', version: 1 })).status, 200)
    const rollback = await request(base + '/sync-runs/' + updated.run.id + '/rollback', owner.cookie, 'POST')
    assert.equal(rollback.status, 201)
    const compensation = await rollback.json() as { compensatingRunId: string }
    const diffs = await (await request(base + '/sync-diffs', owner.cookie)).json() as { id: string; runId: string }[]
    const diff = diffs.find(item => item.runId === compensation.compensatingRunId)!
    assert.equal((await request(base + '/sync-diffs/' + diff.id, owner.cookie, 'PATCH', { decision: 'approved', version: 1 })).status, 200)
    const [department] = await migration<Record<string, string>[]>`SELECT name FROM enterprise.org_unit WHERE id = ${departmentId}`
    assert.equal(department.name, 'Sales')
    const crossTeam = await preview({ organizations: [{ externalId: randomUUID(), name: 'Child business', changeType: 'create' }] })
    assert.equal((await request(base + '/sync-diffs/' + crossTeam.diff.id, owner.cookie, 'PATCH', { decision: 'approved', version: 1 })).status, 422)
  })
  await t.test('team management checks configuration versions and pages audit records', async () => {
    const created = await request(base + '/roles/custom', owner.cookie, 'POST', { name: 'Versioned permission', permissionIds: ['audit.read'] })
    const role = await created.json() as { id: string }
    const change = { name: 'Updated permission', permissionIds: ['audit.read'], expectedVersion: 1 }
    assert.equal((await request(base + '/roles/custom/' + role.id, owner.cookie, 'PATCH', change)).status, 200)
    assert.equal((await request(base + '/roles/custom/' + role.id, owner.cookie, 'PATCH', change)).status, 409)
    const provider = await request(base + '/identity-providers', owner.cookie, 'POST', { name: 'Enterprise login', protocol: 'oidc', issuer: 'https://identity.example' })
    const identity = await provider.json() as { id: string }
    assert.equal((await request(base + '/identity-providers/' + identity.id, owner.cookie, 'PATCH', { name: 'New login', expectedVersion: 1 })).status, 200)
    assert.equal((await request(base + '/identity-providers/' + identity.id, owner.cookie, 'PATCH', { name: 'Stale login', expectedVersion: 1 })).status, 409)
    assert.equal((await request(base + '/audit-page', member.cookie)).status, 403)
    const first = await request(base + '/audit-page?limit=1', owner.cookie)
    assert.equal(first.status, 200)
    const page = await first.json() as { items: { id: string }[]; nextCursor: string }
    assert.equal(page.items.length, 1); assert.ok(page.nextCursor)
    const next = await request(base + '/audit-page?limit=1&cursor=' + encodeURIComponent(page.nextCursor), owner.cookie)
    assert.equal(next.status, 200)
    assert.notEqual((await next.json() as { items: { id: string }[] }).items[0].id, page.items[0].id)
  })
  await t.test('platform directory pages independently of membership and subscription expiry blocks new execution and enrollment', async () => {
    const page = await request('/v1/platform/organizations?limit=1', operator.cookie)
    assert.equal(page.status, 200)
    const first = await page.json() as { items: { id: string }[]; nextCursor: string }
    assert.equal(first.items.length, 1)
    assert.ok(first.nextCursor)
    const next = await request('/v1/platform/organizations?limit=1&cursor=' + first.nextCursor, operator.cookie)
    assert.equal(next.status, 200)
    assert.notEqual((await next.json() as { items: { id: string }[] }).items[0].id, first.items[0].id)
    assert.equal((await request('/v1/platform/organizations', member.cookie)).status, 403)
    const state = await governance()
    const expired = await request(`/v1/platform/organizations/${team.id}/governance/actions`, operator.cookie, 'POST', {
      expectedVersion: state.version, reason: 'Contract expiry acceptance',
      change: { action: 'subscription', plan: 'team', seats: 10, expiresAt: new Date(now - 1).toISOString() },
    })
    assert.equal(expired.status, 200, await expired.clone().text())
    try {
      const denied = await callModel()
      assert.equal(denied.status, 403)
      assert.match(await denied.text(), /SUBSCRIPTION_EXPIRED/)
      const provision = await request('/v1/platform/accounts', operator.cookie, 'POST', {
        email: 'expired-employee@example.com', name: 'Expired employee', password, organizationNodeId: team.id,
      })
      assert.equal(provision.status, 409); assert.match(await provision.text(), /SUBSCRIPTION_EXPIRED/)
      assert.equal((await migration`SELECT id FROM enterprise_auth."user" WHERE email = 'expired-employee@example.com'`).length, 0)
      assert.equal((await request(base + '/wallet/summary', member.cookie)).status, 200)
      assert.equal((await request(base + '/drive/spaces', member.cookie)).status, 200)
    } finally {
      await migration`UPDATE enterprise.subscription SET expires_at = NULL WHERE organization_id = ${team.id}`
    }
  })
  await t.test('repeat provisioning cannot restore an intentionally removed Owner grant', async () => {
    const [grant] = await migration<Record<string, string>[]>`SELECT r.* FROM enterprise.role_binding r JOIN enterprise.membership m ON m.id = r.membership_id
      WHERE r.organization_id = ${team.id} AND m.account_id = ${owner.id} AND r.role = 'owner' AND r.unit_id IS NULL LIMIT 1`
    await migration`DELETE FROM enterprise.role_binding WHERE id = ${grant.id}`
    try {
      await pool.db.transaction(tx => ensureRootAccess(tx, team.id, owner.id, 'enterprise'))
      const roles = await migration<Record<string, string>[]>`SELECT id FROM enterprise.role_binding WHERE id = ${grant.id}`
      assert.equal(roles.length, 0)
    } finally {
      await migration`INSERT INTO enterprise.role_binding (id, organization_id, membership_id, role, effect) VALUES (${grant.id}, ${team.id}, ${grant.membership_id}, 'owner', 'allow')`
    }
  })
  await t.test('platform member provisioning checks seats and rolls back the new account on refusal', async () => {
    const [subscription] = await migration<{ seats: number }[]>`SELECT seats FROM enterprise.subscription WHERE organization_id = ${team.id}`
    await migration`UPDATE enterprise.subscription SET seats = (
      SELECT count(*) FROM enterprise.membership WHERE organization_id = ${team.id} AND status = 'active'
    ) WHERE organization_id = ${team.id}`
    try {
      const response = await request('/v1/platform/accounts', operator.cookie, 'POST', {
        email: 'over-seats@example.com', name: 'Excess employee', password, organizationNodeId: team.id, role: 'member',
      })
      assert.equal(response.status, 409, await response.clone().text())
      assert.match(await response.text(), /SEAT_LIMIT_EXCEEDED/)
      assert.equal((await migration`SELECT id FROM enterprise_auth."user" WHERE email = 'over-seats@example.com'`).length, 0)
    } finally {
      await migration`UPDATE enterprise.subscription SET seats = ${subscription.seats} WHERE organization_id = ${team.id}`
    }
  })
  await t.test('state mutations reject stale versions and paused teams retain management reads', async () => {
    const state = await governance()
    assert.equal((await request(base + '/governance/actions', operator.cookie, 'POST', { expectedVersion: state.version, reason: 'No membership', change: { action: 'team-state', status: 'suspended' } })).status, 403)
    const paused = await request(`/v1/platform/organizations/${team.id}/governance/actions`, operator.cookie, 'POST', {
      expectedVersion: state.version, reason: 'Pause acceptance', change: { action: 'team-state', status: 'suspended' },
    })
    assert.equal(paused.status, 200, await paused.clone().text())
    assert.equal((await request(base + '/governance', owner.cookie)).status, 200)
    const provision = await request('/v1/platform/accounts', operator.cookie, 'POST', {
      email: 'paused-employee@example.com', name: 'Paused employee', password, organizationNodeId: team.id,
    })
    assert.equal(provision.status, 409); assert.match(await provision.text(), /TEAM_INACTIVE/)
    assert.equal((await migration`SELECT id FROM enterprise_auth."user" WHERE email = 'paused-employee@example.com'`).length, 0)
    const response = await callModel(); assert.equal(response.status, 403); assert.match(await response.text(), /TEAM_SUSPENDED/)
    const stale = await request(`/v1/platform/organizations/${team.id}/governance/actions`, operator.cookie, 'POST', {
      expectedVersion: state.version, reason: 'Stale acceptance', change: { action: 'team-state', status: 'active' },
    })
    assert.equal(stale.status, 409)
  })
  await t.test('platform account recovery requires a reason and revision, audits the target and revokes old credentials', async () => {
    const target = await signup('recoverable')
    await migration`select set_config('enterprise.platform_admin', 'true', false)`
    const deviceId = randomUUID()
    await migration`INSERT INTO enterprise.runtime (id, organization_id, account_id, name, type, version, capabilities, token_hash, expires_at)
      VALUES (${deviceId}, ${team.id}, ${target.id}, 'Recovery device', 'desktop', 'test', '[]', ${digest('recovery-device')}, now() + interval '1 day')`
    const detail = await request(`/v1/platform/accounts/${target.id}/organizations`, operator.cookie)
    const displayed = await detail.json() as { account: { updatedAt: string } }
    const path = `/v1/platform/accounts/${target.id}/password`
    const payload = { password: password + '-new', expectedUpdatedAt: displayed.account.updatedAt, reason: 'Verified employee recovery request' }
    assert.equal((await request(path, operator.cookie, 'POST', { password: payload.password })).status, 400)
    assert.equal((await request(path, member.cookie, 'POST', payload)).status, 403)
    assert.equal((await request(path, operator.cookie, 'POST', { ...payload, reason: '' })).status, 400)
    const recovered = await request(path, operator.cookie, 'POST', payload)
    assert.equal(recovered.status, 200, await recovered.clone().text())
    assert.equal((await request(path, operator.cookie, 'POST', payload)).status, 409)
    assert.equal((await migration<Record<string, string>[]>`SELECT id FROM enterprise_auth.session WHERE user_id = ${target.id}`).length, 0)
    const [device] = await migration<Record<string, string>[]>`SELECT revoked_at FROM enterprise.runtime WHERE id = ${deviceId}`
    assert.ok(device.revoked_at)
    const [audit] = await migration<{ detail: Record<string, unknown> }[]>`SELECT detail FROM enterprise.audit
      WHERE action = 'account.password_recovered' AND resource_id = ${target.id}`
    assert.deepEqual(audit.detail, { reason: payload.reason })
    assert.doesNotMatch(JSON.stringify(audit), /password-new/)
    const latest = await (await request(`/v1/platform/accounts/${target.id}/organizations`, operator.cookie)).json() as { account: { updatedAt: string } }
    assert.equal((await request(`/v1/platform/accounts/${target.id}`, operator.cookie, 'PATCH', {
      email: 'recovered@example.com', expectedUpdatedAt: latest.account.updatedAt, reason: 'Verified email correction',
    })).status, 200)
    const [identity] = await migration<{ email: string; email_verified: boolean }[]>`SELECT email, email_verified FROM enterprise_auth."user" WHERE id = ${target.id}`
    assert.equal(identity.email, 'recovered@example.com'); assert.equal(identity.email_verified, false)
  })
  now += 1
})
