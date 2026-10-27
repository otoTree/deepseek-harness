/** Real PostgreSQL startup checks own a private cluster, databases and subprocesses. */
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import postgres from 'postgres'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { PgDialect } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { initializeEnterprise } from '../src/initialize.ts'
import { migrateEnterprise } from '../src/migrations.ts'
import { connectDatabase } from '../src/database.ts'
import { configSchema } from '../src/config.ts'
import { createAuth } from '../src/auth.ts'
import { createApplication } from '../src/application.ts'
import { LocalAccount } from '../../electrobun/src/local-account.ts'
import { desktopCredential } from '../src/contracts.ts'
import { createInitialDeployment } from '../src/provisioning.ts'
import { desktopReleaseAcceptance } from './desktop-release-acceptance.ts'
import { profileSmoke } from './profile-smoke.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))

async function until(ready: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 30_000
  while (!await ready()) {
    if (Date.now() >= deadline) throw new Error('PostgreSQL fixture did not reach the expected state')
    await delay(20)
  }
}

function entrypoint(t: TestContext, env: NodeJS.ProcessEnv) {
  const child = spawn('sh', ['infra/enterprise/docker/api-entrypoint.sh', process.execPath,
    '--input-type=module', '-e', `console.log('Application started; initialization credentials cleared: ' +
      !['ENTERPRISE_MIGRATION_URL', 'ENTERPRISE_BOOTSTRAP_EMAIL', 'ENTERPRISE_BOOTSTRAP_PASSWORD'].some(key => key in process.env))`], {
    cwd: root, env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  let output = '', errors = ''
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
  let closed = false
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => { closed = true; resolve({ code, signal }) })
  })
  void done.catch(() => {})
  t.after(async () => {
    if (!closed && child.pid) process.kill(-child.pid, 'SIGKILL')
    await done
  })
  return { done: async () => {
    const result = await done
    assert.equal(result.signal, null, errors)
    return { ...result, output, errors }
  } }
}

void test('container initialization rejects absent database credentials and different targets', async () => {
  await assert.rejects(initializeEnterprise({}), /ENTERPRISE_DATABASE_URL is required/)
  await assert.rejects(initializeEnterprise({
    ENTERPRISE_DATABASE_URL: 'postgres://enterprise_app@localhost/first',
    ENTERPRISE_MIGRATION_URL: 'postgres://enterprise_migrator@localhost/second',
  }), /same database host, port and database/)
})

void test('container startup initializes and upgrades a dedicated PostgreSQL installation', {
  timeout: 120_000, skip: process.platform === 'win32' && 'Container entrypoint uses a POSIX shell and process groups',
}, async (t) => {
  const container = 'dsh-initialize-test-' + randomUUID()
  const password = randomBytes(32).toString('hex')
  const docker = (args: string[], input?: string) => execFileSync('docker', args, {
    cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input,
  })
  docker(['run', '-d', '--name', container, '-p', '127.0.0.1::5432',
    '-e', 'POSTGRES_PASSWORD=' + password, 'postgres:16-alpine'])
  t.after(() => { docker(['rm', '-fv', container]) })
  await until(async () => {
    try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); return true }
    catch { return false /* pg_isready returns nonzero while this private cluster starts. */ }
  })
  const port = docker(['port', container, '5432/tcp']).trim().split(':').at(-1)!
  const admin = postgres(`postgres://postgres:${password}@127.0.0.1:${port}/postgres`, { max: 1, onnotice: () => {} })
  t.after(() => admin.end())
  const appRole = 'business "account@$.' + randomUUID().slice(0, 8)
  const migrationRole = 'schema "owner@$.' + randomUUID().slice(0, 8)
  const dialect = new PgDialect()
  const appPassword = randomBytes(24).toString('hex') + '@:/%'
  const migrationPassword = randomBytes(24).toString('hex') + '@:/%'
  for (const [role, secret] of [[appRole, appPassword], [migrationRole, migrationPassword]]) {
    const [statement] = await admin<{ query: string }[]>`
      select format('create role %I login password %L', ${role}::text, ${secret}::text) as query`
    await admin.unsafe(statement.query)
  }

  await t.test('configured account names initialize without the development role names', async (t) => {
    const { env, inspector } = await fixture(t)
    const created = await entrypoint(t, env).done()
    assert.equal(created.code, 0, created.errors)
    assert.equal(await initializeEnterprise(env), 'existing')
    const [permissions] = await inspector`select
      has_function_privilege(${appRole}, 'enterprise.find_membership_for_org(text,text)', 'EXECUTE') as membership,
      has_function_privilege(${appRole}, 'enterprise.list_active_organizations_for_account(text)', 'EXECUTE') as directory,
      has_function_privilege(${appRole}, 'enterprise_auth.resolve_runtime_token(text)', 'EXECUTE') as runtime,
      has_table_privilege(${appRole}, 'enterprise.installation', 'UPDATE') as installation`
    assert.deepEqual(permissions, { membership: true, directory: true, runtime: true, installation: false })
    const migrationConfig = { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) }
    const hashes = await inspector<{ hash: string }[]>`select hash from drizzle.__drizzle_migrations order by created_at`
    assert.deepEqual(hashes.map(row => row.hash), readMigrationFiles(migrationConfig).map(migration => migration.hash))
    const config = configSchema.parse({ databaseUrl: env.ENTERPRISE_DATABASE_URL,
      authSecret: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex'),
      apiUrl: 'http://127.0.0.1:8787', adminOrigin: 'http://127.0.0.1:4000', portalOrigin: 'http://127.0.0.1:8787' })
    await profileSmoke(t, config)
  })

  async function fixture(owner: TestContext) {
    const name = 'initialize_' + randomUUID().replaceAll('-', '')
    await admin`create database ${admin(name)} owner ${admin.unsafe(dialect.escapeName(migrationRole))}`
    const env = {
      ENTERPRISE_DATABASE_URL: `postgres://${encodeURIComponent(appRole)}:${encodeURIComponent(appPassword)}@127.0.0.1:${port}/${name}`,
      ENTERPRISE_MIGRATION_URL: `postgres://${encodeURIComponent(migrationRole)}:${encodeURIComponent(migrationPassword)}@127.0.0.1:${port}/${name}`,
      ENTERPRISE_BOOTSTRAP_EMAIL: 'owner@example.com',
      ENTERPRISE_BOOTSTRAP_PASSWORD: 'Initial-owner-password-123!',
    }
    const inspector = postgres(`postgres://postgres:${password}@127.0.0.1:${port}/${name}`, { max: 1, onnotice: () => {} })
    owner.after(() => inspector.end())
    return { env, inspector }
  }

  await t.test('platform schemas and extension views survive initialization and restart', async (t) => {
    const { env, inspector } = await fixture(t)
    await inspector`create schema metric_helpers`
    await inspector`create table metric_helpers.samples (value text)`
    await inspector`insert into metric_helpers.samples values ('keep metrics')`
    await inspector`create view metric_helpers.latest as select value from metric_helpers.samples`
    await inspector`create schema user_management`
    await inspector`create table user_management.accounts (value text)`
    await inspector`insert into user_management.accounts values ('keep platform account')`
    await inspector`create extension pg_stat_statements with schema public`
    const before = await inspector`select c.oid, n.nspname, c.relname, c.relowner
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('metric_helpers', 'user_management', 'public') order by c.oid`
    const created = await entrypoint(t, env).done()
    assert.equal(created.code, 0, created.errors)
    const restarted = await entrypoint(t, { ...env,
      ENTERPRISE_BOOTSTRAP_EMAIL: undefined, ENTERPRISE_BOOTSTRAP_PASSWORD: undefined,
    }).done()
    assert.equal(restarted.code, 0, restarted.errors)
    assert.deepEqual(await inspector`select c.oid, n.nspname, c.relname, c.relowner
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('metric_helpers', 'user_management', 'public') order by c.oid`, before)
    assert.equal((await inspector`select value from metric_helpers.latest`)[0]?.value, 'keep metrics')
    assert.equal((await inspector`select value from user_management.accounts`)[0]?.value, 'keep platform account')
    assert.equal((await inspector`select count(*) from enterprise_auth.platform_admin`)[0]?.count, '1')
  })

  await t.test('one postgres URL initializes, starts the API and preserves the administrator on restart', async (t) => {
    const { env, inspector } = await fixture(t)
    const database = new URL(env.ENTERPRISE_DATABASE_URL)
    database.username = 'postgres'
    database.password = password
    const single = { ...env, ENTERPRISE_DATABASE_URL: database.href, ENTERPRISE_MIGRATION_URL: undefined }
    const created = await entrypoint(t, single).done()
    assert.equal(created.code, 0, created.errors)
    const before = await inspector`select * from enterprise_auth.account`
    const restarted = await entrypoint(t, { ...single,
      ENTERPRISE_BOOTSTRAP_EMAIL: undefined, ENTERPRISE_BOOTSTRAP_PASSWORD: undefined,
    }).done()
    assert.equal(restarted.code, 0, restarted.errors)
    assert.deepEqual(await inspector`select * from enterprise_auth.account`, before)
    const config = configSchema.parse({ databaseUrl: database.href,
      authSecret: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex'),
      apiUrl: 'http://127.0.0.1:8787', adminOrigin: 'http://127.0.0.1:4000', portalOrigin: 'http://127.0.0.1:8787' })
    await profileSmoke(t, config)
  })

  await t.test('signed desktop installers publish through platform administration', async (t) => {
    const { env } = await fixture(t)
    await initializeEnterprise(env)
    await desktopReleaseAcceptance(t, env)
  })

  await t.test('desktop registration, login and team entry use only the API origin', async (t) => {
    const { env, inspector } = await fixture(t)
    await initializeEnterprise(env)
    const application = connectDatabase(env.ENTERPRISE_DATABASE_URL)
    t.after(() => application.close())
    const config = configSchema.parse({ databaseUrl: env.ENTERPRISE_DATABASE_URL,
      authSecret: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex'),
      apiUrl: 'https://api.example.com', adminOrigin: 'https://unavailable-admin.invalid', portalOrigin: 'https://unavailable-portal.invalid' })
    const { app } = createApplication({ db: application.db, config, mail: async () => {} })
    const actual: unknown[] = []
    let savedCredential: z.infer<typeof desktopCredential> | undefined
    const account = new LocalAccount({
      apiUrl: config.apiUrl,
      request: async (input, init) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        assert.equal(url.origin, config.apiUrl)
        assert.equal(request.headers.get('Origin'), config.apiUrl)
        const response = await app.request(request)
        actual.push({ method: request.method, url: request.url, origin: request.headers.get('Origin'), status: response.status })
        return response
      },
      keychain: { set: async (_key, value) => {
        const { apiOrigin, ...credential } = desktopCredential.extend({ apiOrigin: z.url() }).parse(JSON.parse(value))
        assert.equal(apiOrigin, config.apiUrl)
        savedCredential = credential
        actual.push('credential-saved')
      }, delete: async () => {} },
      enter: async () => { actual.push('workspace-entered') }, logout: async () => {},
      openExternal: async () => assert.fail('Email login must stay in the bundled account UI'),
    })
    const signal = AbortSignal.timeout(15000)
    assert.equal((await account.state(signal)).user, null)
    await account.run({ action: 'register', name: 'Desktop User', email: 'desktop@example.com', password: 'Desktop-fixture-password-123!' }, signal)
    await account.run({ action: 'login', email: 'desktop@example.com', password: 'Desktop-fixture-password-123!' }, signal)
    await account.run({ action: 'create', name: 'Desktop team', defaultBudget: { mode: 'unlimited' } }, signal)
    const state = await account.state(signal)
    assert.equal(state.user?.email, 'desktop@example.com')
    const organization = state.organizations.find(item => item.name === 'Desktop team')
    assert.ok(organization)
    await account.run({ action: 'enter', organizationId: organization.id }, signal)
    const expected = JSON.parse(readFileSync(new URL('./expected/desktop-account.json', import.meta.url), 'utf8')) as unknown
    assert.deepEqual(actual, expected)
    assert.ok(savedCredential)
    const device = savedCredential
    const deviceRequest = (path: string) => app.request(new URL(`/v1/organizations/${device.organizationId}/${path}`, config.apiUrl), {
      headers: { Authorization: `Bearer ${device.token}` }, signal,
    })
    const authorization = `runtimes/${device.runtimeId}/authorization`
    await inspector`update enterprise.runtime set expires_at = now() + interval '1 minute' where id = ${device.runtimeId}`
    assert.equal((await deviceRequest('models')).status, 200)
    const [renewed] = await inspector<{ expires_at: Date }[]>`select expires_at from enterprise.runtime where id = ${device.runtimeId}`
    assert.ok(new Date(renewed.expires_at).getTime() > Date.now() + config.loginSessionSeconds * 900)
    assert.equal((await deviceRequest(authorization)).status, 200)
    const [unchanged] = await inspector<{ expires_at: Date }[]>`select expires_at from enterprise.runtime where id = ${device.runtimeId}`
    assert.equal(new Date(unchanged.expires_at).getTime(), new Date(renewed.expires_at).getTime())
    await inspector`update enterprise.runtime set expires_at = '2000-01-01' where id = ${device.runtimeId}`
    assert.equal((await deviceRequest('models')).status, 403)
    assert.equal((await deviceRequest(authorization)).status, 403)
    await inspector`update enterprise.runtime set expires_at = now() + interval '1 day', revoked_at = now() where id = ${device.runtimeId}`
    assert.equal((await deviceRequest(authorization)).status, 403)
    await inspector`update enterprise.runtime set revoked_at = null where id = ${device.runtimeId}`
    await inspector`update enterprise.membership set status = 'suspended' where organization_id = ${device.organizationId} and account_id = ${device.accountId}`
    assert.equal((await deviceRequest('models')).status, 403)
    const denied = await app.request(config.apiUrl + '/v1/organizations', {
      method: 'POST', headers: { Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' }, body: '{}',
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null)
    const loginDenied = await app.request(config.apiUrl + '/auth/sign-in/email', {
      method: 'POST', headers: { Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'desktop@example.com', password: 'Desktop-fixture-password-123!' }),
    })
    assert.equal(loginDenied.status, 403)
  })

  await t.test('first start creates a login and restart preserves credentials, policy and data', async (t) => {
    const { env, inspector } = await fixture(t)
    const created = await entrypoint(t, env).done()
    assert.equal(created.code, 0, created.errors)
    const [user] = await inspector`select id from enterprise_auth."user"`
    assert.ok(user?.id)
    const application = connectDatabase(env.ENTERPRISE_DATABASE_URL)
    t.after(() => application.close())
    const config = configSchema.parse({ databaseUrl: env.ENTERPRISE_DATABASE_URL,
      authSecret: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex'), apiUrl: 'https://api.example.com',
      adminOrigin: 'https://admin.example.com', portalOrigin: 'https://api.example.com' })
    const auth = createAuth(application.db, config, async () => {})
    const login = await auth.handler(new Request('https://api.example.com/auth/sign-in/email', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.adminOrigin },
      body: JSON.stringify({ email: env.ENTERPRISE_BOOTSTRAP_EMAIL, password: env.ENTERPRISE_BOOTSTRAP_PASSWORD }),
    }))
    assert.equal(login.status, 200, await login.clone().text())
    await login.arrayBuffer()
    assert.equal((await inspector`select account_id from enterprise_auth.platform_admin`)[0]?.account_id, user.id)
    await inspector`update enterprise_auth.deployment set registration = 'disabled'`
    await inspector`update enterprise.organization set name = 'Saved organization'`
    await inspector`update enterprise.membership set status = 'suspended'`
    const before = await inspector`select * from enterprise_auth.account`
    const restarted = await entrypoint(t, { ...env,
      ENTERPRISE_BOOTSTRAP_EMAIL: 'replacement@example.com', ENTERPRISE_BOOTSTRAP_PASSWORD: 'Replacement-password-123!',
    }).done()
    assert.equal(restarted.code, 0, restarted.errors)
    assert.deepEqual(await inspector`select * from enterprise_auth.account`, before)
    assert.equal((await inspector`select count(*) from enterprise_auth."user"`)[0]?.count, '1')
    assert.equal((await inspector`select registration from enterprise_auth.deployment`)[0]?.registration, 'disabled')
    assert.equal((await inspector`select name from enterprise.organization`)[0]?.name, 'Saved organization')
    assert.equal((await inspector`select status from enterprise.membership`)[0]?.status, 'suspended')
    assert.equal(await initializeEnterprise({ ...env, ENTERPRISE_BOOTSTRAP_EMAIL: undefined, ENTERPRISE_BOOTSTRAP_PASSWORD: undefined }), 'existing')
    const [permissions] = await inspector`select
      has_table_privilege(${appRole}, 'enterprise.audit', 'UPDATE') as audit,
      has_table_privilege(${appRole}, 'enterprise.session_event', 'DELETE') as events,
      has_table_privilege(${appRole}, 'enterprise.wallet_ledger', 'UPDATE') as wallet,
      has_table_privilege(${appRole}, 'enterprise.model_task_ledger', 'DELETE') as tasks`
    assert.deepEqual(permissions, { audit: false, events: false, wallet: false, tasks: false })
    const expected = readFileSync(new URL('./expected/container-initialization.txt', import.meta.url), 'utf8')
    assert.equal(created.output + restarted.output, expected)
  })

  await t.test('simultaneous entrypoints wait on the same database lock and create one administrator', async (t) => {
    const { env, inspector } = await fixture(t)
    await inspector`select pg_advisory_lock(731937125)`
    const first = entrypoint(t, env)
    const second = entrypoint(t, env)
    try {
      await until(async () => {
        const [row] = await inspector`select count(*) from pg_stat_activity
          where datname = current_database() and usename = ${migrationRole} and wait_event = 'advisory'`
        return row?.count === '2'
      })
    } finally { await inspector`select pg_advisory_unlock(731937125)` }
    const outcomes = await Promise.all([first.done(), second.done()])
    for (const outcome of outcomes) assert.equal(outcome.code, 0, outcome.errors)
    assert.equal(outcomes.filter(outcome => outcome.output.includes('deployment initialized')).length, 1)
    assert.equal((await inspector`select count(*) from enterprise_auth.platform_admin`)[0]?.count, '1')
  })

  await t.test('startup applies a pending migration while preserving an existing deployment', async (t) => {
    const { env, inspector } = await fixture(t)
    const folder = fileURLToPath(new URL('../migrations', import.meta.url))
    const prior = mkdtempSync(join(tmpdir(), 'enterprise-prior-migrations-'))
    t.after(() => { rmSync(prior, { recursive: true, force: true }) })
    mkdirSync(join(prior, 'meta'))
    const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[]
    }
    const previous = { ...journal, entries: journal.entries.slice(0, -1) }
    writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify(previous))
    for (const entry of previous.entries) copyFileSync(join(folder, entry.tag + '.sql'), join(prior, entry.tag + '.sql'))
    const migrator = postgres(env.ENTERPRISE_MIGRATION_URL, { max: 1, onnotice: () => {} })
    t.after(() => migrator.end())
    await migrator`create schema enterprise`
    await migrator`create schema enterprise_auth`
    await migrator`create schema drizzle`
    await migrator`grant usage on schema enterprise, enterprise_auth to ${migrator.unsafe(dialect.escapeName(appRole))}`
    await migrator`alter default privileges in schema enterprise, enterprise_auth
      grant select, insert, update, delete on tables to ${migrator.unsafe(dialect.escapeName(appRole))}`
    await migrator`create table enterprise.installation (id text primary key)`
    await migrator`insert into enterprise.installation values ('deepseek-enterprise-local')`
    await migrateEnterprise(migrator, appRole, { migrationsFolder: prior })
    const application = connectDatabase(env.ENTERPRISE_DATABASE_URL)
    t.after(() => application.close())
    const rootId = randomUUID()
    await application.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(731937124)`)
      const account = await createInitialDeployment(tx, {
        email: env.ENTERPRISE_BOOTSTRAP_EMAIL, password: env.ENTERPRISE_BOOTSTRAP_PASSWORD, root: rootId, mode: 'open',
      })
      // Seed the preceding schema using its columns; current Drizzle inserts include new migration fields.
      const membershipId = randomUUID()
      await tx.execute(sql`select set_config('enterprise.organization_id', ${rootId}, true)`)
      await tx.execute(sql`insert into enterprise.organization (id, root_id, name, kind)
        values (${rootId}, ${rootId}, 'Platform', 'platform')`)
      await tx.execute(sql`insert into enterprise.org_unit (id, organization_id, name, unit_type)
        values (${rootId}, ${rootId}, 'Platform', 'root')`)
      await tx.execute(sql`insert into enterprise.membership (id, organization_id, account_id, status)
        values (${membershipId}, ${rootId}, ${account}, 'active')`)
      await tx.execute(sql`insert into enterprise.role_binding (id, organization_id, membership_id, role, effect)
        values (${randomUUID()}, ${rootId}, ${membershipId}, 'owner', 'allow')`)
      await tx.execute(sql`insert into enterprise.unit_assignment (organization_id, membership_id, unit_id)
        values (${rootId}, ${membershipId}, ${rootId})`)
      await tx.execute(sql`insert into enterprise.subscription (organization_id, plan) values (${rootId}, 'enterprise')`)
      await tx.execute(sql`insert into enterprise.organization_wallet (organization_id) values (${rootId})`)
    })
    const before = await inspector`select * from enterprise_auth.account`
    assert.equal((await inspector`select count(*) from drizzle.__drizzle_migrations`)[0]?.count, String(previous.entries.length))
    assert.equal(await initializeEnterprise(env), 'existing')
    assert.equal((await inspector`select count(*) from drizzle.__drizzle_migrations`)[0]?.count, String(journal.entries.length))
    assert.deepEqual(await inspector`select * from enterprise_auth.account`, before)
    assert.equal((await inspector`select root_organization_id from enterprise_auth.deployment`)[0]?.root_organization_id, rootId)
  })

  await t.test('missing or weak bootstrap credentials stop startup before application launch', async (t) => {
    const { env, inspector } = await fixture(t)
    const result = await entrypoint(t, { ...env, ENTERPRISE_BOOTSTRAP_PASSWORD: 'short' }).done()
    assert.notEqual(result.code, 0)
    assert.doesNotMatch(result.output, /Application started/)
    assert.doesNotMatch(result.errors, /Initial-owner-password/)
    assert.equal((await inspector`select to_regclass('enterprise_auth."user"') as relation`)[0]?.relation, null)
    await assert.rejects(initializeEnterprise({ ...env, ENTERPRISE_BOOTSTRAP_EMAIL: undefined }), /ENTERPRISE_BOOTSTRAP_EMAIL/)
  })

  for (const namespace of ['public', 'enterprise', 'enterprise_auth', 'drizzle']) {
    await t.test(`unmarked data in ${namespace} is preserved and rejected`, async (t) => {
      const { env, inspector } = await fixture(t)
      await inspector`create schema if not exists ${inspector(namespace)}
        authorization ${inspector.unsafe(dialect.escapeName(migrationRole))}`
      await inspector`create table ${inspector(namespace)}.existing_data (value text)`
      await inspector`insert into ${inspector(namespace)}.existing_data values ('preserve me')`
      if (namespace === 'public') await inspector`create extension pg_stat_statements with schema public`
      const result = await entrypoint(t, env).done()
      assert.notEqual(result.code, 0)
      assert.doesNotMatch(result.output, /Application started/)
      assert.match(result.errors, /unmarked, non-empty database/)
      assert.match(result.errors, new RegExp(`${namespace}\\.existing_data`))
      assert.equal((await inspector`select value from ${inspector(namespace)}.existing_data`)[0]?.value, 'preserve me')
      assert.equal((await inspector`select to_regclass('enterprise.installation') as relation`)[0]?.relation, null)
    })
  }

  await t.test('the supplied passwords are required and one configured database owner can initialize', async (t) => {
    const { env } = await fixture(t)
    const invalid = new URL(env.ENTERPRISE_DATABASE_URL)
    invalid.password = 'incorrect-password'
    await assert.rejects(initializeEnterprise({ ...env, ENTERPRISE_DATABASE_URL: invalid.href }),
      error => error instanceof Error && error.cause instanceof Error && /password authentication failed/.test(error.cause.message))
    const invalidMigration = new URL(env.ENTERPRISE_MIGRATION_URL)
    invalidMigration.password = 'incorrect-password'
    await assert.rejects(initializeEnterprise({ ...env, ENTERPRISE_MIGRATION_URL: invalidMigration.href }),
      /password authentication failed/)
    const shared = { ...env, ENTERPRISE_DATABASE_URL: env.ENTERPRISE_MIGRATION_URL }
    assert.equal(await initializeEnterprise(shared), 'created')
    assert.equal(await initializeEnterprise({ ...shared, ENTERPRISE_MIGRATION_URL: '' }), 'existing')
  })

  await t.test('existing installations reject policy mismatch and missing administrators', async (t) => {
    const { env, inspector } = await fixture(t)
    await initializeEnterprise(env)
    await assert.rejects(initializeEnterprise({ ...env, ENTERPRISE_MODE: 'private' }), /ENTERPRISE_MODE/)
    await inspector`delete from enterprise_auth.platform_admin`
    await assert.rejects(initializeEnterprise(env), /no platform administrator/)
    assert.equal((await inspector`select count(*) from enterprise_auth.platform_admin`)[0]?.count, '0')
  })

  await t.test('insufficient schema permissions and existing accounts prevent bootstrap', async (t) => {
    const { env, inspector } = await fixture(t)
    await inspector`create schema enterprise`
    await assert.rejects(initializeEnterprise(env), /permission denied|must be owner/)
    await inspector`drop schema enterprise`
    await initializeEnterprise(env)
    await inspector`delete from enterprise_auth.deployment`
    await assert.rejects(initializeEnterprise(env), /already contains accounts/)
    assert.equal((await inspector`select count(*) from enterprise_auth."user"`)[0]?.count, '1')
  })
})
