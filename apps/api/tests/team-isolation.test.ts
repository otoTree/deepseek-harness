/** Open-team isolation and private-company isolation against real PostgreSQL authorization. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import postgres from 'postgres'
import { hashPassword } from 'better-auth/crypto'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { PgDialect } from 'drizzle-orm/pg-core'
import { PostgresJsSession } from 'drizzle-orm/postgres-js'
import { createApplication } from '../src/application.ts'
import { configSchema } from '../src/config.ts'
import { connectDatabase, selectOrganization } from '../src/database.ts'
import { migrateEnterprise } from '../src/migrations.ts'
import { accountId, organizationId } from '../src/contracts.ts'
import { digest, hasRole, requirePermission } from '../src/security.ts'

void test('open and private deployment modes both require exact team membership', { timeout: 120_000 }, async (t) => {
  const container = 'dsh-team-isolation-' + randomUUID()
  const password = randomBytes(24).toString('hex')
  const docker = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe' })
  docker(['run', '-d', '--name', container, '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD=' + password, 'postgres:16-alpine'])
  const close: Array<() => Promise<void>> = []
  t.after(async () => {
    try { await Promise.all(close.map(dispose => dispose())) }
    finally { docker(['rm', '-fv', container]) }
  })
  const deadline = Date.now() + 30_000
  for (;;) {
    try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); break }
    catch { if (Date.now() >= deadline) throw new Error('Private PostgreSQL did not become ready') }
    await delay(20)
  }
  const port = docker(['port', container, '5432/tcp']).trim().split(':').at(-1)!
  const adminUrl = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} })
  close.push(() => admin.end())
  await admin.unsafe(`CREATE ROLE enterprise_app LOGIN PASSWORD '${password}'`)
  const migrationConfig = { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) }
  const dialect = new PgDialect()
  await dialect.migrate(readMigrationFiles(migrationConfig).filter(item => item.folderMillis < 1792627200001),
    new PostgresJsSession(admin, dialect, undefined), migrationConfig)
  const root = randomUUID(), team = randomUUID(), sibling = randomUUID()
  const platformOwner = randomUUID(), teamOwner = randomUUID(), siblingOwner = randomUUID()
  const rootMember = randomUUID(), teamMember = randomUUID(), siblingMember = randomUUID()
  await admin`INSERT INTO enterprise_auth.deployment (id, mode, registration, root_organization_id) VALUES ('primary', 'open', 'open', ${root})`
  const hashedPassword = await hashPassword(password)
  for (const [id, name] of [[platformOwner, 'platform'], [teamOwner, 'team'], [siblingOwner, 'sibling']]) {
    await admin`INSERT INTO enterprise_auth."user" (id, name, email) VALUES (${id}, ${name}, ${name + '@example.com'})`
    await admin`INSERT INTO enterprise_auth.account (id, user_id, account_id, provider_id, password) VALUES (${randomUUID()}, ${id}, ${id}, 'credential', ${hashedPassword})`
  }
  await admin`INSERT INTO enterprise_auth.platform_admin (account_id) VALUES (${platformOwner})`
  await admin`INSERT INTO enterprise.organization (id, root_id, name, kind) VALUES (${root}, ${root}, 'Platform', 'platform')`
  for (const [id, name] of [[team, 'First team'], [sibling, 'Second team']]) {
    await admin`INSERT INTO enterprise.organization (id, parent_id, root_id, name) VALUES (${id}, ${root}, ${root}, ${name})`
  }
  const memberships = [[root, platformOwner, rootMember], [team, teamOwner, teamMember], [sibling, siblingOwner, siblingMember]]
  for (const [organization, account, member] of memberships) {
    await admin`INSERT INTO enterprise.membership (id, organization_id, account_id) VALUES (${member}, ${organization}, ${account})`
    await admin`INSERT INTO enterprise.role_binding (id, organization_id, membership_id, role) VALUES (${randomUUID()}, ${organization}, ${member}, 'owner')`
    const unit = randomUUID()
    await admin`INSERT INTO enterprise.org_unit (id, organization_id, name, unit_type) VALUES (${unit}, ${organization}, 'Root', 'root')`
    await admin`INSERT INTO enterprise.unit_assignment (organization_id, membership_id, unit_id) VALUES (${organization}, ${member}, ${unit})`
    await admin`INSERT INTO enterprise.subscription (organization_id) VALUES (${organization})`
    await admin`INSERT INTO enterprise.invitation (id, organization_id, email, role, token_hash, inviter_id, expires_at) VALUES (${randomUUID()}, ${organization}, ${account + '@example.com'}, 'member', ${randomUUID()}, ${account}, now() + interval '1 day')`
  }
  await admin`UPDATE enterprise.subscription SET plan = 'enterprise', runtimes = 1 WHERE organization_id = ${root}`
  const teamRuntime = randomUUID(), siblingRuntime = randomUUID()
  const teamToken = randomBytes(32).toString('hex'), siblingToken = randomBytes(32).toString('hex')
  await admin`UPDATE enterprise.organization SET policy_revision = 7 WHERE id = ${root}`
  await admin`UPDATE enterprise.organization SET policy_revision = 2 WHERE id = ${team}`
  for (const [id, organization, token] of [[teamRuntime, team, teamToken], [siblingRuntime, sibling, siblingToken]]) {
    await admin`INSERT INTO enterprise.runtime (id, organization_id, account_id, name, type, version, capabilities, token_hash, lease_until)
      VALUES (${id}, ${organization}, ${teamOwner}, 'Desktop', 'desktop', 'test', '[]', ${digest(token)}, now() + interval '1 day')`
  }
  const [legacyAccess] = await admin`SELECT enterprise.find_membership_for_org(${team}, ${platformOwner}) AS id`
  assert.equal(legacyAccess.id, rootMember)
  await migrateEnterprise(admin, 'enterprise_app', migrationConfig)
  const [isolatedAccess] = await admin`SELECT enterprise.find_membership_for_org(${team}, ${platformOwner}) AS id`
  assert.equal(isolatedAccess.id, null)
  await admin.unsafe('GRANT USAGE ON SCHEMA enterprise, enterprise_auth TO enterprise_app')
  await admin.unsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA enterprise, enterprise_auth TO enterprise_app')
  let clientIp = 1
  // Both supported account configurations must return the same tenant-scoped directory.
  for (const [label, databaseUrl] of [['rls', `postgres://enterprise_app:${password}@127.0.0.1:${port}/postgres`], ['superuser', adminUrl]]) {
    await t.test(label, async () => {
      const pool = connectDatabase(databaseUrl)
      close.push(() => pool.close())
      const config = configSchema.parse({ databaseUrl, authSecret: password, encryptionKey: randomBytes(32).toString('hex'), apiUrl: 'http://127.0.0.1:8787', adminOrigin: 'http://127.0.0.1:3000', portalOrigin: 'http://127.0.0.1:3001', requireEmailVerification: false })
      const { app } = createApplication({ db: pool.db, config, mail: async () => {} })
      const cookies = new Map<string, string>()
      for (const id of [platformOwner, teamOwner, siblingOwner]) {
        const email = id === platformOwner ? 'platform@example.com' : id === teamOwner ? 'team@example.com' : 'sibling@example.com'
        const login = await app.request(new URL('/auth/sign-in/email', config.apiUrl), {
          method: 'POST', headers: { Origin: config.adminOrigin, 'Content-Type': 'application/json', 'X-Forwarded-For': `192.0.2.${clientIp++}` },
          body: JSON.stringify({ email, password }),
        })
        assert.equal(login.status, 200, await login.clone().text())
        cookies.set(id, login.headers.getSetCookie().map(value => value.split(';')[0]).join('; '))
      }
      const request = (organization: string, actor: string, path: string, method = 'GET', body?: unknown) => app.request(
        new URL(`/v1/organizations/${organization}/${path}`, config.apiUrl), {
          method, headers: { Cookie: cookies.get(actor)!, Origin: config.adminOrigin, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
      const overviewResponse = await request(team, teamOwner, 'overview')
      assert.equal(overviewResponse.status, 200, await overviewResponse.clone().text())
      const overview = await overviewResponse.json() as {
        organization: { id: string; kind: string }
        subscription: { organizationId: string; plan: string; seats: number }
      }
      assert.equal(overview.organization.id, team)
      assert.equal(overview.organization.kind, 'team')
      assert.equal(overview.subscription.organizationId, team)
      assert.equal(overview.subscription.plan, 'team')
      assert.equal('runtimes' in overview.subscription, false)
      const devices = await request(team, teamOwner, 'runtimes')
      assert.equal(devices.status, 200, await devices.clone().text())
      assert.deepEqual((await devices.json() as Array<{ id: string }>).map(item => item.id), [teamRuntime])
      assert.equal((await request(team, teamOwner, 'runtimes/' + siblingRuntime, 'DELETE')).status, 403)
      const heartbeat = await app.request(new URL(`/v1/organizations/${team}/runtimes/${siblingRuntime}/authorization`, config.apiUrl), {
        method: 'GET', headers: { Authorization: 'Bearer ' + siblingToken },
      })
      assert.equal(heartbeat.status, 403)
      const ownHeartbeat = await app.request(new URL(`/v1/organizations/${team}/runtimes/${teamRuntime}/authorization`, config.apiUrl), {
        method: 'GET', headers: { Authorization: 'Bearer ' + teamToken },
      })
      assert.equal(ownHeartbeat.status, 200, await ownHeartbeat.clone().text())
      assert.equal((await ownHeartbeat.json() as { policyRevision: number }).policyRevision, 2)
      const deviceInput = { name: 'New team device', type: 'desktop', version: 'test', capabilities: [] }
      const createdDevice = await request(team, teamOwner, 'runtimes', 'POST', deviceInput)
      assert.equal(createdDevice.status, 201, await createdDevice.clone().text())
      const device = await createdDevice.json() as { id: string }
      const additionalDevice = await request(team, teamOwner, 'runtimes', 'POST', deviceInput)
      assert.equal(additionalDevice.status, 201)
      await admin`DELETE FROM enterprise.runtime WHERE id = ${(await additionalDevice.json() as { id: string }).id}`
      assert.equal((await request(team, teamOwner, 'runtimes/' + device.id, 'DELETE')).status, 200)
      await admin`DELETE FROM enterprise.runtime WHERE id = ${device.id}`
      const policy = await app.request(new URL('/auth/deployment', config.apiUrl))
      assert.deepEqual(await policy.json(), { mode: 'open', registration: 'open' })
      const runtimeRequest = (organization: string, path: string, method = 'GET', body?: unknown) => app.request(
        new URL(`/v1/organizations/${organization}/${path}`, config.apiUrl), {
          method, headers: { Authorization: 'Bearer ' + teamToken, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
      assert.equal((await runtimeRequest(sibling, 'units')).status, 403)
      const unitResponse = await runtimeRequest(team, 'units')
      assert.equal(unitResponse.status, 200, await unitResponse.clone().text())
      const roots = await unitResponse.json() as Array<{ id: string; organizationId: string }>
      assert.equal(roots.length, 1)
      const selectedRoot = roots.at(0)
      assert.ok(selectedRoot)
      assert.equal(selectedRoot.organizationId, team)
      const teamRoot = selectedRoot.id
      const [otherRoot] = await admin<{ id: string }[]>`SELECT id FROM enterprise.org_unit WHERE organization_id = ${sibling} AND parent_id IS NULL`
      const departmentInput = { name: 'Research', parentId: teamRoot, unitType: 'department' }
      assert.equal((await runtimeRequest(team, 'units', 'POST', { ...departmentInput, parentId: otherRoot.id })).status, 403)
      const departmentResponse = await runtimeRequest(team, 'units', 'POST', departmentInput)
      assert.equal(departmentResponse.status, 201, await departmentResponse.clone().text())
      const department = await departmentResponse.json() as { id: string }
      const childResponse = await runtimeRequest(team, 'units', 'POST', { ...departmentInput, name: 'AI', parentId: department.id })
      assert.equal(childResponse.status, 201, await childResponse.clone().text())
      const child = await childResponse.json() as { id: string }
      assert.equal((await runtimeRequest(team, 'units/' + department.id, 'PATCH', { name: '   ', parentId: teamRoot })).status, 400)
      assert.equal((await runtimeRequest(team, 'units/' + department.id, 'PATCH', { name: 'Research', parentId: child.id })).status, 409)
      assert.equal((await runtimeRequest(team, 'units/' + department.id, 'PATCH', { name: 'Research', parentId: otherRoot.id })).status, 409)
      assert.equal((await runtimeRequest(team, 'units/' + otherRoot.id, 'PATCH', { name: 'Foreign', parentId: teamRoot })).status, 403)
      assert.equal((await runtimeRequest(team, 'units/' + otherRoot.id, 'DELETE')).status, 403)
      assert.equal((await runtimeRequest(team, 'units/' + teamRoot, 'DELETE')).status, 403)
      assert.equal((await runtimeRequest(team, 'units/' + teamRoot, 'PATCH', { name: 'Root', parentId: department.id })).status, 403)
      assert.equal((await runtimeRequest(team, 'units/' + department.id, 'DELETE')).status, 409)
      assert.equal((await runtimeRequest(team, 'members/' + teamMember + '/units', 'PUT', { unitIds: [child.id] })).status, 200)
      assert.equal((await runtimeRequest(team, 'units/' + child.id, 'DELETE')).status, 409)
      assert.equal((await runtimeRequest(team, 'members/' + teamMember + '/units', 'PUT', { unitIds: [otherRoot.id] })).status, 403)
      const [retained] = await admin`SELECT unit_id FROM enterprise.unit_assignment WHERE membership_id = ${teamMember}`
      assert.equal(retained.unit_id, child.id)
      assert.equal((await runtimeRequest(team, 'members/' + teamMember + '/units', 'PUT', { unitIds: [teamRoot] })).status, 200)
      const unitRole = randomUUID()
      await admin`INSERT INTO enterprise.role_binding (id, organization_id, membership_id, unit_id, role)
        VALUES (${unitRole}, ${team}, ${teamMember}, ${child.id}, 'member')`
      assert.equal((await runtimeRequest(team, 'units/' + child.id, 'DELETE')).status, 409)
      await admin`DELETE FROM enterprise.role_binding WHERE id = ${unitRole}`
      assert.equal((await runtimeRequest(team, 'units/' + child.id, 'PATCH', { name: 'ML', parentId: teamRoot })).status, 200)
      await admin`UPDATE enterprise.role_binding SET role = 'member' WHERE membership_id = ${teamMember}`
      try {
        assert.equal((await runtimeRequest(team, 'units', 'POST', departmentInput)).status, 403)
        assert.equal((await runtimeRequest(team, 'units/' + child.id, 'PATCH', { name: 'No', parentId: teamRoot })).status, 403)
        assert.equal((await runtimeRequest(team, 'units/' + child.id, 'DELETE')).status, 403)
        assert.equal((await runtimeRequest(team, 'members/' + teamMember + '/units', 'PUT', { unitIds: [child.id] })).status, 403)
      } finally {
        await admin`UPDATE enterprise.role_binding SET role = 'owner' WHERE membership_id = ${teamMember}`
      }
      assert.equal((await runtimeRequest(team, 'units/' + child.id, 'DELETE')).status, 200)
      assert.equal((await runtimeRequest(team, 'units/' + department.id, 'DELETE')).status, 200)
      for (const path of ['members', 'members/usage-summary', 'invitations']) {
        const response = await request(team, teamOwner, path)
        assert.equal(response.status, 200, await response.clone().text())
        if (path === 'invitations') {
          const invitations = await response.json() as Array<{ organizationId: string }>
          assert.deepEqual(invitations.map(item => item.organizationId), [team])
        } else {
          const value = await response.json() as {
            members?: Array<{ accountId: string }>
            items?: Array<{ accountId: string }>
            roles: Array<{ organizationId: string }>
            assignments: Array<{ organizationId: string }>
          }
          assert.deepEqual((value.members ?? value.items)!.map(item => item.accountId), [teamOwner])
          if (path === 'members') {
            assert.deepEqual(value.roles.map(item => item.organizationId), [team])
            assert.deepEqual(value.assignments.map(item => item.organizationId), [team])
          }
        }
        assert.equal((await request(team, platformOwner, path)).status, 403)
        assert.equal((await request(team, siblingOwner, path)).status, 403)
      }
      assert.equal((await request(team, teamOwner, 'members/' + siblingMember, 'PATCH', { status: 'suspended' })).status, 403)
      assert.equal((await request(team, teamOwner, 'members/' + siblingMember + '/units', 'PUT', { unitIds: [randomUUID()] })).status, 403)
      const [siblingRole] = await admin<{ id: string }[]>`SELECT id FROM enterprise.role_binding WHERE membership_id = ${siblingMember}`
      assert.equal((await request(team, teamOwner, 'roles/' + siblingRole.id, 'DELETE')).status, 403)
      const [siblingInvitation] = await admin<{ id: string }[]>`SELECT id FROM enterprise.invitation WHERE organization_id = ${sibling}`
      assert.equal((await request(team, teamOwner, 'invitations/' + siblingInvitation.id, 'DELETE')).status, 403)
      assert.equal((await request(team, teamOwner, 'members/' + teamMember, 'PATCH', { status: 'suspended' })).status, 409)
      const actor = { id: accountId.parse(platformOwner), email: 'platform@example.com' }
      const tenant = { actor, organizationId: organizationId.parse(team), membershipId: rootMember }
      await pool.db.transaction(async (tx) => {
        await selectOrganization(tx, tenant.organizationId)
        assert.equal(await hasRole(tx, tenant, ['owner']), false)
        await assert.rejects(() => requirePermission(tx, tenant, 'member.manage'), /Access denied/)
      })
      const signup = await app.request(new URL('/auth/sign-up/email', config.apiUrl), {
        method: 'POST', headers: { Origin: config.adminOrigin, 'Content-Type': 'application/json', 'X-Forwarded-For': `192.0.2.${clientIp++}` },
        body: JSON.stringify({ name: label, email: label + '@example.com', password }),
      })
      assert.equal(signup.status, 200, await signup.clone().text())
      const newAccount = await signup.json() as { user: { id: string } }
      const created = await app.request(new URL('/v1/organizations', config.apiUrl), {
        method: 'POST', headers: { Origin: config.adminOrigin, 'Content-Type': 'application/json', Cookie: signup.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') },
        body: JSON.stringify({ name: 'Independent team', defaultBudget: { mode: 'unlimited' } }),
      })
      assert.equal(created.status, 201, await created.clone().text())
      const { id } = await created.json() as { id: string }
      const [organization] = await admin`SELECT parent_id, root_id FROM enterprise.organization WHERE id = ${id}`
      assert.equal(organization.parent_id, null)
      assert.equal(organization.root_id, id)
      await admin`UPDATE enterprise.subscription SET seats = 2 WHERE organization_id = ${id}`
      const inviteToken = randomBytes(32).toString('hex')
      await admin`INSERT INTO enterprise.invitation (id, organization_id, email, role, token_hash, inviter_id, expires_at)
        VALUES (${randomUUID()}, ${id}, 'sibling@example.com', 'member', ${digest(inviteToken)}, ${newAccount.user.id}, now() + interval '1 day')`
      const accepted = await app.request(new URL('/v1/invitations/accept', config.apiUrl), {
        method: 'POST', headers: { Cookie: cookies.get(siblingOwner)!, Origin: config.adminOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken }),
      })
      assert.equal(accepted.status, 200, await accepted.clone().text())
      const acceptance = await accepted.json() as { organizationId: string; membershipId: string }
      assert.equal(acceptance.organizationId, id)
      const [assignment] = await admin`SELECT u.organization_id FROM enterprise.unit_assignment a
        JOIN enterprise.org_unit u ON u.id = a.unit_id WHERE a.membership_id = ${acceptance.membershipId}`
      assert.equal(assignment.organization_id, id)
      await admin`UPDATE enterprise_auth.deployment SET mode = 'private', registration = 'invite_only' WHERE id = 'primary'`
      try {
        assert.equal((await request(team, platformOwner, 'members')).status, 403)
        const privatePolicy = await app.request(new URL('/auth/deployment', config.apiUrl))
        assert.deepEqual(await privatePolicy.json(), { mode: 'private', registration: 'invite_only' })
        assert.equal((await request(team, platformOwner, 'units', 'POST', departmentInput)).status, 403)
        const authorized = await runtimeRequest(team, 'units', 'POST', departmentInput)
        assert.equal(authorized.status, 201)
        const department = await authorized.json() as { id: string }
        assert.equal((await runtimeRequest(team, 'units/' + department.id, 'DELETE')).status, 200)
        await pool.db.transaction(async (tx) => {
          await selectOrganization(tx, tenant.organizationId)
          assert.equal(await hasRole(tx, tenant, ['owner']), false)
          await assert.rejects(requirePermission(tx, tenant, 'member.manage'))
        })
      } finally {
        await admin`UPDATE enterprise_auth.deployment SET mode = 'open', registration = 'open' WHERE id = 'primary'`
      }
    })
  }
})
