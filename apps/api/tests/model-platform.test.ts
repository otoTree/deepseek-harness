/** Isolated PostgreSQL task lifecycle and wallet integration with a state-controlled provider. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { createServer, request as requestHttp } from 'node:http'
import { once } from 'node:events'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { eq, sql } from 'drizzle-orm'
import { configSchema } from '../src/config.ts'
import { connectDatabase, selectOrganization } from '../src/database.ts'
import { createApplication } from '../src/application.ts'
import { organizationId } from '../src/contracts.ts'
import { MemoryDriveObjectStore } from '../src/drive-storage.ts'
import * as s from '../src/schema.ts'

void test('durable tasks preserve snapshots and settle once across workers and restarts', { timeout: 120000 }, async (t) => {
  const env = parseEnv(readFileSync(new URL('../../../.env.enterprise', import.meta.url), 'utf8'))
  const name = 'enterprise_test_' + randomUUID().replaceAll('-', '')
  const compose = ['compose', '--env-file', '.env.enterprise', '-f', 'docker-compose.enterprise.yml', 'exec', '-T', 'postgres', 'psql', '-U', 'enterprise_bootstrap', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c']
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  execFileSync('docker', [...compose, 'CREATE DATABASE ' + name + ' OWNER enterprise_migrator'], { cwd: root, stdio: 'pipe' })
  const cleanup: (() => Promise<unknown>)[] = []
  t.after(async () => {
    for (const close of cleanup.reverse()) await close()
    execFileSync('docker', [...compose, 'DROP DATABASE ' + name], { cwd: root, stdio: 'pipe' })
  })
  const migrationUrl = new URL(env.ENTERPRISE_MIGRATION_URL!)
  migrationUrl.pathname = '/' + name
  const migration = postgres(migrationUrl.toString(), { max: 1, onnotice: () => {} })
  cleanup.push(() => migration.end())
  const migrationFolder = fileURLToPath(new URL('../migrations', import.meta.url))
  const priorMigrations = mkdtempSync(join(tmpdir(), 'dsh-model-migration-'))
  cleanup.push(async () => { rmSync(priorMigrations, { recursive: true, force: true }) })
  mkdirSync(join(priorMigrations, 'meta'))
  const journal = JSON.parse(readFileSync(join(migrationFolder, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] }
  const previousJournal = { ...journal, entries: journal.entries.filter(entry => entry.idx < 35) }
  writeFileSync(join(priorMigrations, 'meta/_journal.json'), JSON.stringify(previousJournal))
  for (const entry of previousJournal.entries) copyFileSync(join(migrationFolder, entry.tag + '.sql'), join(priorMigrations, entry.tag + '.sql'))
  await migrate(drizzle(migration), { migrationsFolder: priorMigrations })
  const legacyModel = randomUUID(), legacyAdapter = randomUUID(), legacyTask = randomUUID()
  const legacyOrg = randomUUID(), legacyOwner = randomUUID()
  const legacySnapshot = { adapterId: legacyAdapter, configuration: { baseUrl: 'https://legacy.example' }, prices: { request: '9' }, secret: 'legacy-envelope' }
  await migration.begin(async (tx) => {
    await tx`select set_config('enterprise.platform_admin', 'true', true)`
    await tx`select set_config('enterprise.organization_id', ${legacyOrg}, true)`
    await tx`insert into enterprise_auth."user" (id, name, email) values (${legacyOwner}, 'Historical fixture', 'historical@example.com')`
    await tx`insert into enterprise.organization (id, root_id, path, name) values (${legacyOrg}, ${legacyOrg}, ${'/' + legacyOrg + '/'}, 'Historical fixture')`
    await tx`insert into enterprise_auth.model (id, name, base_url, upstream_model, secret, enabled, context_tokens, max_output_tokens, input_micros_per_million, output_micros_per_million)
      values (${legacyModel}, 'Historical text', 'https://legacy.example', 'text-original', 'legacy-envelope', false, 1024, 1024, 0, 0)`
    await tx`insert into enterprise_auth.model_adapter (id, public_model, operation, version, enabled, secret, configuration, prices, reserve_micros_cny)
      values (${legacyAdapter}, 'Historical image', 'image.generate', 3, false, 'legacy-envelope', ${JSON.stringify({ baseUrl: 'https://legacy.example' })}::jsonb, ${JSON.stringify({ request: '9' })}::jsonb, 9)`
    await tx`insert into enterprise.model_task (id, organization_id, account_id, idempotency_key, public_model, operation, adapter_version, snapshot, input, parameters,
      status, billing_status, reserved_micros_cny, final_micros_cny, collected_micros_cny, created_at, settled_at)
      values (${legacyTask}, ${legacyOrg}, ${legacyOwner}, 'legacy-task-fixture', 'Historical image', 'image.generate', 3, ${JSON.stringify(legacySnapshot)}::jsonb, '{}', '{}', 'succeeded', 'settled', 9, 9, 9, '2000-01-01', '2000-01-01')`
    await tx`insert into enterprise.model_task_ledger (id, organization_id, account_id, task_id, event_key, kind, amount_micros_cny, balance_after_micros_cny)
      values (${randomUUID()}, ${legacyOrg}, ${legacyOwner}, ${legacyTask}, 'reserve', 'reserve', -9, 0)`
  })
  await migrate(drizzle(migration), { migrationsFolder: migrationFolder })
  await migrate(drizzle(migration), { migrationsFolder: migrationFolder })
  await t.test('migration preserves model identities, completed task snapshots, and append-only amounts', async () => {
    await migration.begin(async (tx) => {
      await tx`select set_config('enterprise.platform_admin', 'true', true)`
      const [model] = await tx`select id, provider_id from enterprise_auth.model where id = ${legacyModel}`
      assert.equal(model.id, legacyModel); assert.equal(model.provider_id, legacyModel)
      const [task] = await tx`select snapshot, model_id, engine_version, asset_status, final_micros_cny from enterprise.model_task where id = ${legacyTask}`
      assert.deepEqual(task.snapshot, legacySnapshot); assert.equal(task.model_id, legacyAdapter)
      assert.equal(task.engine_version, 1); assert.equal(task.asset_status, 'not_applicable'); assert.equal(Number(task.final_micros_cny), 9)
      const ledger = await tx`select amount_micros_cny from enterprise.model_task_ledger where task_id = ${legacyTask}`
      assert.equal(ledger.length, 1); assert.equal(Number(ledger[0].amount_micros_cny), -9)
    })
  })
  await migration.unsafe('GRANT USAGE ON SCHEMA enterprise, enterprise_auth TO enterprise_app')
  await migration.unsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA enterprise, enterprise_auth TO enterprise_app')
  const url = new URL(env.ENTERPRISE_DATABASE_URL!)
  url.pathname = '/' + name
  const pool = connectDatabase(url.toString())
  cleanup.push(() => pool.close())
  let now = Date.now()
  let submissions = 0
  let queries = 0
  let usage: unknown = 151078
  let failSubmission = false
  let failDownload = false
  let invalidOutput = false
  let providerFailed = false
  let submissionHttpStatus = 200
  let release: (() => void) | undefined
  let entered: (() => void) | undefined
  let blocked: Promise<void> | undefined
  const bodies: Record<string, unknown>[] = []
  const server = createServer((req, res) => { void (async () => {
    if (req.method === 'POST') {
      submissions++
      let raw = ''
      for await (const chunk of req) raw = raw + String(chunk)
      bodies.push(JSON.parse(raw) as Record<string, unknown>)
      entered?.()
      await blocked
      if (failSubmission) { req.socket.destroy(); return }
      if (submissionHttpStatus !== 200) { res.writeHead(submissionHttpStatus); res.end(JSON.stringify({ message: 'private supplier diagnostics' })); return }
      res.end(JSON.stringify({ id: `supplier-${submissions}` }))
    } else {
      queries++
      res.end(JSON.stringify({ status: providerFailed ? 'failed' : 'completed', content: invalidOutput ? {} : { video_url: 'https://assets.example/video.mp4' }, usage: usage === undefined ? {} : { completion_tokens: usage, total_tokens: usage } }))
    }
  })().catch(() => { res.destroy() }) })
  server.listen(0, '127.0.0.1')
  cleanup.push(async () => {
    release?.(); server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
    })
  })
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const config = configSchema.parse({ databaseUrl: url.toString(), authSecret: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex'), apiUrl: 'http://127.0.0.1:8787', adminOrigin: 'http://127.0.0.1:3000', portalOrigin: 'http://127.0.0.1:3001', requireEmailVerification: false })
  const objects = new MemoryDriveObjectStore()
  const bytes = Buffer.from('fixture-video')
  const services: Parameters<typeof createApplication>[0] = {
    db: pool.db, config, now: () => now, driveObjects: objects,
    modelTransport: async (target, body, _secret, signal, method) => new Promise((resolve, reject) => {
      const req = requestHttp({ host: '127.0.0.1', port: address.port, path: target.pathname, method, signal }, resolve)
      req.once('error', reject); req.end(body)
    }),
    assetDownload: async () => { if (failDownload) throw new Error('storage unavailable'); return { bytes, mimeType: 'video/mp4', checksum: createHash('sha256').update(bytes).digest('hex') } },
  }
  const { app, modelTaskMaintenance: worker } = createApplication(services)
  await pool.db.insert(s.deployment).values({ id: 'primary', mode: 'open', registration: 'open' })
  const request = (path: string, method = 'GET', body?: unknown, cookie = '') => app.request(new URL(path, config.apiUrl), {
    method, headers: { Origin: config.adminOrigin, 'Content-Type': 'application/json', Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const signup = await request('/auth/sign-up/email', 'POST', { name: 'Task owner', email: 'tasks@example.com', password: randomBytes(20).toString('hex') })
  assert.equal(signup.status, 200, await signup.clone().text())
  const cookie = signup.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const owner = (await signup.json()) as { user: { id: string } }
  await pool.db.insert(s.platformAdmins).values({ accountId: owner.user.id })
  const created = await request('/v1/organizations', 'POST', { name: 'Task integration' }, cookie)
  assert.equal(created.status, 201, await created.clone().text())
  const org = (await created.json()) as { id: string }
  const tenant = <T>(run: (tx: Parameters<Parameters<typeof pool.db.transaction>[0]>[0]) => Promise<T>) =>
    pool.db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId.parse(org.id))
      return run(tx)
    })
  const fundWallet = (balanceMicrosCny: number) => tenant(tx => tx.update(s.organizationWallets).set({ balanceMicrosCny })
    .where(eq(s.organizationWallets.organizationId, org.id)))
  await fundWallet(100_000_000)
  const configuration = { baseUrl: 'https://provider.example/v1', driver: 'crl-seedance-v1', upstreamModel: 'seedance-2-0',
    submit: { path: '/videos/generations' }, query: { method: 'GET', path: '/tasks/{{providerTaskId}}' },
    parameters: { duration: { type: 'integer', minimum: 4, maximum: 15, specialValues: [-1], default: 5 } },
    reserve: { quantityPath: 'settings.duration', microsCnyPerUnit: '1000000', quantityOverrides: { '-1': 15 } }, response: { status: 'status', statusValues: {} } }
  const published = await request('/v1/platform/model-adapters', 'POST', { publicModel: 'Seedance test', operation: 'video.generate', apiKey: 'fixture-secret', configuration, prices: { completion_tokens: '46000000' }, reserveMicrosCny: 1 }, cookie)
  assert.equal(published.status, 201, await published.clone().text())
  const model = (await published.json()) as { id: string; modelId: string }
  const prefix = '/v1/organizations/' + org.id + '/model-tasks'
  const payload = (key = randomUUID()) => ({ operation: 'video.generate', model: model.modelId, input: { prompt: 'Ocean' }, parameters: { duration: -1 }, idempotencyKey: key })
  const task = async (input = payload()) => {
    const response = await request(prefix, 'POST', input, cookie)
    assert.equal(response.status, 202, await response.clone().text())
    return await response.json() as { id: string; status: string }
  }
  const read = async (id: string) => {
    const response = await request(prefix + '/' + id, 'GET', undefined, cookie)
    assert.equal(response.status, 200)
    return await response.json() as {
      error?: { code: string; retryable: boolean }
      status: string
      assetStatus: string
      billingStatus: string
      billingBasis: string
      reviewReason: string | null
      version: number
      finalMicrosCny: number
      outstandingMicrosCny: number
      results: { assetId: string }[]
    }
  }
  await t.test('concurrent creates reserve once; query is read-only; competing workers submit once', async () => {
    const input = payload()
    const [first, duplicate] = await Promise.all([task(input), task(input)])
    assert.equal(first.id, duplicate.id)
    assert.equal(first.status, 'queued')
    assert.equal((await read(first.id)).status, 'queued')
    assert.equal(submissions, 0)
    const conflict = await request(prefix, 'POST', { ...input, input: { prompt: 'Different' } }, cookie)
    assert.equal(conflict.status, 409)
    const ready = new Promise<void>((resolve) => { entered = resolve })
    blocked = new Promise<void>((resolve) => { release = resolve })
    const running = worker.scanDue()
    await ready
    await createApplication(services).modelTaskMaintenance.scanDue()
    release!(); await running
    blocked = undefined; entered = undefined
    assert.equal(submissions, 1)
    assert.equal(bodies[0].duration, -1)
    assert.equal((await read(first.id)).status, 'processing')
    now += 30_000
    await createApplication(services).modelTaskMaintenance.scanDue()
    const done = await read(first.id)
    assert.equal(done.status, 'succeeded'); assert.equal(done.assetStatus, 'ready')
    assert.equal(done.billingStatus, 'settled'); assert.equal(done.finalMicrosCny, 6_949_588)
    assert.ok(done.results[0]?.assetId)
    assert.ok(!JSON.stringify(done).includes('assets.example'))
    await worker.scanDue()
    assert.equal(queries, 1)
    const ledger = await tenant(tx => tx.select().from(s.modelTaskLedger).where(eq(s.modelTaskLedger.taskId, first.id)))
    assert.equal(ledger.filter(row => row.eventKey === 'settlement').length, 1)
    assert.equal(ledger.reduce((sum, row) => sum + row.amountMicrosCny, 0), -6_949_588)
  })
  await t.test('missing usage falls back; asset retry does not regenerate or recharge', async () => {
    usage = undefined; failDownload = true
    const item = await task(); await worker.scanDue(); now += 30_000; await worker.scanDue()
    const pending = await read(item.id)
    assert.equal(pending.assetStatus, 'pending'); assert.equal(pending.billingStatus, 'settled')
    assert.equal(pending.billingBasis, 'reservation_fallback'); assert.equal(pending.finalMicrosCny, 15_000_000)
    const before = submissions; const queried = queries
    failDownload = false; now += 1_800_000
    await createApplication(services).modelTaskMaintenance.scanDue()
    assert.equal((await read(item.id)).assetStatus, 'ready')
    assert.equal(submissions, before); assert.equal(queries, queried)
  })
  await t.test('zero tokens release the hold; uncertain submission stays visible without resubmission', async () => {
    usage = 0
    const zero = await task(); await worker.scanDue(); now += 30_000; await worker.scanDue()
    assert.equal((await read(zero.id)).finalMicrosCny, 0)
    failSubmission = true
    const uncertain = await task(); await worker.scanDue()
    assert.equal((await read(uncertain.id)).status, 'unknown')
    const before = submissions; now += 1_800_000; await worker.scanDue()
    assert.equal(submissions, before)
    assert.equal((await read(uncertain.id)).billingStatus, 'review_required')
  })
  await t.test('HTTP rejection retains a safe status code and requires reconciliation without another POST', async () => {
    failSubmission = false; submissionHttpStatus = 400
    try {
      const rejected = await task(); await worker.scanDue()
      const result = await read(rejected.id)
      assert.equal(result.status, 'unknown')
      assert.equal(result.billingStatus, 'review_required')
      assert.equal(result.reviewReason, 'submit_uncertain')
      assert.equal(result.error?.code, 'provider_http_400')
      assert.equal(result.error?.retryable, false)
      assert.ok(!JSON.stringify(result).includes('private supplier diagnostics'))
      const before = submissions; now += 1_800_000; await worker.scanDue()
      assert.equal(submissions, before)
      const resolved = await request('/v1/platform/model-tasks/' + rejected.id + '/resolve', 'POST', {
        action: 'confirm_free_failure', expectedVersion: result.version, evidence: 'Fixture supplier confirmed rejection without charge',
      }, cookie)
      assert.equal(resolved.status, 200, await resolved.clone().text())
      assert.equal((await read(rejected.id)).finalMicrosCny, 0)
    } finally { submissionHttpStatus = 200 }
  })
  await t.test('overage debt and audited corrections preserve ledger totals and optimistic locking', async () => {
    failSubmission = false; usage = 1_000_000
    await fundWallet(16_000_000)
    const item = await task(); await worker.scanDue(); now += 30_000; await worker.scanDue()
    const debt = await read(item.id)
    assert.equal(debt.billingStatus, 'partially_collected'); assert.equal(debt.outstandingMicrosCny, 30_000_000)
    await fundWallet(40_000_000)
    const resolve = (input: unknown) => request('/v1/platform/model-tasks/' + item.id + '/resolve', 'POST', input, cookie)
    const input = { action: 'collect_debt', expectedVersion: debt.version, evidence: 'Fixture reviewed final provider usage' }
    const resolved = await resolve(input)
    assert.equal(resolved.status, 200, await resolved.clone().text())
    assert.equal((await resolve(input)).status, 409)
    const collected = await read(item.id)
    assert.equal(collected.outstandingMicrosCny, 0)
    assert.equal((await resolve({ action: 'adjust_charge', expectedVersion: collected.version, finalMicrosCny: 20_000_000, evidence: 'Fixture provider invoice correction' })).status, 200)
    const ledger = await tenant(tx => tx.select().from(s.modelTaskLedger).where(eq(s.modelTaskLedger.taskId, item.id)))
    assert.equal(ledger.reduce((sum, row) => sum + row.amountMicrosCny, 0), -20_000_000)
    const rows = await tenant(tx => tx.select().from(s.modelUsage).where(eq(s.modelUsage.id, item.id)))
    assert.equal(rows.length, 1); assert.equal(rows[0].totalCostMicrosCny, 20_000_000)
    const analytics = await request('/v1/platform/usage/summary?from=' + encodeURIComponent(new Date(now - 86_400_000).toISOString()) + '&to=' + encodeURIComponent(new Date(now + 86_400_000).toISOString()), 'GET', undefined, cookie)
    assert.equal(analytics.status, 200, await analytics.clone().text())
    const report = await analytics.json() as { totalCostMicrosCny: number }
    assert.equal(report.totalCostMicrosCny, 41_949_588)
  })
  await t.test('public directory groups text and media identities without transport credentials', async () => {
    const response = await request('/v1/organizations/' + org.id + '/models', 'GET', undefined, cookie)
    assert.equal(response.status, 200)
    const directory = await response.json() as { id: string; operations: string[]; operationConfigurations: { parameters: unknown }[] }[]
    const entry = directory.find(item => item.id === model.modelId)!
    assert.deepEqual(entry.operations, ['video.generate'])
    assert.ok(entry.operationConfigurations[0].parameters)
    assert.ok(!JSON.stringify(directory).includes('provider.example'))
  })
  await t.test('references use owned assets and condition prices remain frozen after publication', async () => {
    await fundWallet(100_000_000)
    const assets = '/v1/organizations/' + org.id + '/model-assets'
    const assetId = randomUUID()
    const upload = { assetId, contentType: 'video/mp4', content: Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109]).toString('base64') }
    assert.equal((await request(assets, 'POST', upload, cookie)).status, 201)
    assert.equal((await request(assets, 'POST', upload, cookie)).status, 201)
    assert.equal((await request(assets, 'POST', { ...upload, content: Buffer.from('invalid').toString('base64') }, cookie)).status, 400)
    const other = await request('/v1/organizations', 'POST', { name: 'Other asset tenant' }, cookie)
    const otherOrg = await other.json() as { id: string }
    assert.equal((await request('/v1/organizations/' + otherOrg.id + '/model-assets/' + assetId + '/access', 'GET', undefined, cookie)).status, 403)
    const input = { ...payload(), input: { prompt: 'Fixture video reference', references: [{ assetId }] } }
    assert.equal((await request(prefix + '/preview', 'POST', input, cookie)).status, 400)
    const publish = (price: string) => request('/v1/platform/model-adapters', 'POST', { modelId: model.modelId, publicModel: 'Seedance test', operation: 'video.generate',
      configuration: { ...configuration, referenceMapping: { video: { type: 'fixture_video', locationKey: 'fixture_url', role: 'fixture_reference' } }, videoReferencePrices: { completion_tokens: price } },
      prices: { completion_tokens: '46000000' }, reserveMicrosCny: 1 }, cookie)
    assert.equal((await publish('28000000')).status, 201)
    const preview = await request(prefix + '/preview', 'POST', input, cookie)
    assert.equal(preview.status, 200, await preview.clone().text())
    assert.equal((await preview.json() as { priceCondition: string }).priceCondition, 'video_reference')
    const frozen = await task(input)
    assert.equal((await publish('42000000')).status, 201)
    usage = 151078; await worker.scanDue(); now += 30_000; await worker.scanDue()
    assert.equal((await read(frozen.id)).finalMicrosCny, 4_230_184)
    const content = bodies.at(-1)!.content as { type: string; fixture_url?: { url: string } }[]
    assert.equal(content[1].type, 'fixture_video')
    assert.ok(content[1].fixture_url?.url)
  })
  await t.test('paused admission preserves idempotent reads and existing background execution', async () => {
    const input = payload(), pending = await task(input)
    config.modelTaskAccepting = false
    try {
      assert.equal((await task(input)).id, pending.id)
      assert.equal((await request(prefix, 'POST', payload(), cookie)).status, 503)
      usage = 'invalid'; await createApplication(services).modelTaskMaintenance.scanDue(); now += 30_000; await worker.scanDue()
      assert.equal((await read(pending.id)).billingBasis, 'reservation_fallback')
      assert.equal((await read(pending.id)).finalMicrosCny, 15_000_000)
    } finally { config.modelTaskAccepting = true }
  })
  await t.test('invalid successful output retains supplier charges while a confirmed free failure refunds', async () => {
    invalidOutput = true; usage = 1
    const invalid = await task()
    await worker.scanDue(); now += 30_000; await worker.scanDue()
    const charged = await read(invalid.id)
    assert.equal(charged.status, 'failed')
    assert.equal(charged.error?.code, 'provider_output_invalid')
    assert.equal(charged.finalMicrosCny, 46)
    assert.equal(charged.billingBasis, 'provider_usage')
    assert.equal(charged.assetStatus, 'not_applicable')
    providerFailed = true
    const failed = await task()
    await worker.scanDue(); now += 30_000; await worker.scanDue()
    assert.equal((await read(failed.id)).finalMicrosCny, 0)
    assert.equal((await read(failed.id)).billingBasis, 'failure_release')
    invalidOutput = false; providerFailed = false
  })
  await t.test('expired submission lease fences a late result without dispatching a second POST', async () => {
    const pending = await task()
    const ready = new Promise<void>((resolve) => { entered = resolve })
    blocked = new Promise<void>((resolve) => { release = resolve })
    const running = worker.scanDue(); await ready
    const dispatched = submissions
    now += config.modelTaskLeaseMs + 1
    await createApplication(services).modelTaskMaintenance.scanDue()
    release!(); await running; blocked = undefined; entered = undefined
    assert.equal(submissions, dispatched)
    assert.equal((await read(pending.id)).status, 'unknown')
    assert.equal((await read(pending.id)).billingStatus, 'review_required')
  })
  await t.test('provider revisions are immutable and tenant task internals remain hidden', async () => {
    await assert.rejects(pool.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const rows = await tx.update(s.modelProviderVersions).set({ baseUrl: 'https://changed.example' }).returning()
      assert.ok(rows.length, 'RLS prevents mutation')
    }))
    const response = await request(prefix, 'GET', undefined, cookie)
    const text = await response.text()
    assert.ok(!text.includes('fixture-secret')); assert.ok(!text.includes('credentialBinding'))
  })
})
