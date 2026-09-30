/** Durable provider-neutral model tasks, adapter templates, and CNY settlement. */
import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import * as s from './schema.ts'
import type { ApiEnv, Services, TenantOperation } from './application.ts'
import { resourceId } from './contracts.ts'
import { decrypt, encrypt, forbidden, requirePlatform } from './security.ts'
import { modelUrl, openModel } from './gateway.ts'
import type { Transaction } from './database.ts'

const operationSchema = z.enum(['embedding.create', 'image.generate', 'video.generate', 'audio.synthesize', 'audio.transcribe'])
const statusSchema = z.enum(['processing', 'succeeded', 'failed', 'cancelled', 'unknown'])
const usageUnitSchema = z.enum(['token', 'image', 'second', 'character', 'request'])
const pathSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,240}$/u)
const mappingSchema = z.object({
  method: z.enum(['GET', 'POST']).default('POST'),
  path: z.string().min(1).max(500),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.record(z.string(), z.unknown()).default({}),
}).strict()
const parameterRuleSchema = z.object({
  type: z.enum(['string', 'number', 'integer', 'boolean', 'array', 'object']),
  required: z.boolean().default(false),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  values: z.array(z.union([z.string(), z.number(), z.boolean()])).max(100).optional(),
}).strict().superRefine((rule, context) => {
  if (rule.minimum !== undefined && rule.maximum !== undefined && rule.minimum > rule.maximum) {
    context.addIssue({ code: 'custom', path: ['maximum'], message: 'Maximum must be greater than or equal to minimum' })
  }
})
const configSchema = z.object({
  baseUrl: z.url(),
  failureBilling: z.enum(['free', 'usage']).default('free'),
  parameters: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/u), parameterRuleSchema).default({}),
  submit: mappingSchema,
  query: mappingSchema,
  response: z.object({
    status: pathSchema,
    statusValues: z.record(z.string(), statusSchema).refine(value => Object.keys(value).length > 0),
    providerTaskId: pathSchema.optional(),
    results: pathSchema.optional(),
    resultKind: z.enum(['embedding', 'image', 'video', 'audio', 'transcript']).optional(),
    resultUrl: pathSchema.optional(),
    resultContent: pathSchema.optional(),
    usage: z.array(z.object({ key: z.string().min(1).max(80), unit: usageUnitSchema, path: pathSchema }).strict()).max(16).default([]),
    errorCode: pathSchema.optional(),
    errorMessage: pathSchema.optional(),
  }).strict(),
}).strict()
const adapterInputSchema = z.object({
  publicModel: z.string().trim().min(1).max(200),
  operation: operationSchema,
  apiKey: z.string().min(1).max(4096),
  configuration: configSchema,
  prices: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u), z.string().regex(/^\d{1,12}$/u))
    .refine(value => Object.keys(value).length > 0),
  reserveMicrosCny: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((value, context) => {
  if ((value.operation === 'image.generate' || value.operation === 'video.generate') && value.reserveMicrosCny < 1) {
    context.addIssue({ code: 'custom', path: ['reserveMicrosCny'], message: 'Image and video tasks require a positive reservation' })
  }
  const usage = value.configuration.response.usage
  if (new Set(usage.map(item => item.key)).size !== usage.length) {
    context.addIssue({ code: 'custom', path: ['configuration', 'response', 'usage'], message: 'Usage keys must be unique' })
  }
  const usageKeys = new Set(usage.map(item => item.key))
  if (usageKeys.has('total_tokens') && (usageKeys.has('input_tokens') || usageKeys.has('output_tokens'))) {
    context.addIssue({ code: 'custom', path: ['configuration', 'response', 'usage'], message: 'Total tokens cannot be priced with input or output token details' })
  }
})
const createSchema = z.object({
  operation: operationSchema,
  model: z.string().trim().min(1).max(200),
  input: z.record(z.string(), z.unknown()).default({}),
  parameters: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().trim().min(16).max(128),
}).strict()
const querySchema = z.object({ taskId: resourceId }).strict()
const finalStates = new Set(['succeeded', 'failed', 'cancelled'])
const nowOf = (services: Services): Date => new Date(services.now?.() ?? Date.now())

type Config = z.infer<typeof configSchema>
type Outcome = {
  status: z.infer<typeof statusSchema>
  providerTaskId?: string
  results: unknown[]
  usage?: { complete: boolean; items: { key: string; unit: z.infer<typeof usageUnitSchema>; quantity: string; source: string; final: boolean }[] }
  error?: { code: string; message: string; retryable: boolean }
}

/** Read a dotted property path without evaluating expressions. */
export function readTemplatePath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

/** Expand only literal values and `{{path}}` references in an adapter template. */
export function expandAdapterTemplate(value: unknown, scope: Readonly<Record<string, unknown>>): unknown {
  if (typeof value === 'string') {
    const exact = /^\{\{([A-Za-z0-9_.-]+)\}\}$/u.exec(value)
    if (exact) return readTemplatePath(scope, exact[1]!)
    return value.replace(/\{\{([A-Za-z0-9_.-]+)\}\}/gu, (_match, path: string) => {
      const resolved = readTemplatePath(scope, path)
      return resolved === undefined ? '' : String(resolved)
    })
  }
  if (Array.isArray(value)) return value.map(item => expandAdapterTemplate(item, scope))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandAdapterTemplate(item, scope)]))
  }
  return value
}

function micros(value: unknown): bigint | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return BigInt(Math.ceil(value * 1_000_000))
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,6})?$/u.test(value)) return undefined
  const [whole = '0', fraction = ''] = value.split('.')
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
}

/** Convert complete adapter usage into integer CNY micro-yuan using its price snapshot. */
export function calculateTaskCost(
  usage: NonNullable<Outcome['usage']>,
  prices: Readonly<Record<string, string>>,
): number {
  if (!usage.complete || usage.items.some(item => !item.final)) throw new Error('Final usage is incomplete')
  const total = usage.items.reduce((sum, item) => {
    const rate = prices[item.key]
    const quantity = micros(item.quantity)
    if (rate === undefined || quantity === undefined) throw new Error(`Missing final price or quantity for ${item.key}`)
    const price = BigInt(rate)
    const divisor = item.unit === 'token' ? 1_000_000n : 1n
    return sum + (quantity * price + 1_000_000n * divisor - 1n) / (1_000_000n * divisor)
  }, 0n)
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Final task charge exceeds the supported wallet range')
  return Number(total)
}

function adapterSnapshot(task: typeof s.modelTasks.$inferSelect): { adapterId: string; configuration: Config; secret: string; prices: Record<string, string> } {
  const value = task.snapshot as { adapterId: string; configuration: Config; secret: string; prices: Record<string, string> }
  return value
}

function validateParameters(configuration: Config, values: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(values)) {
    if (configuration.parameters[key] === undefined) throw new HTTPException(400, { message: `Unsupported model parameter: ${key}` })
  }
  for (const [key, rule] of Object.entries(configuration.parameters)) {
    const value = values[key]
    if (value === undefined) {
      if (rule.required) throw new HTTPException(400, { message: `Missing model parameter: ${key}` })
      continue
    }
    const typeMatches = rule.type === 'array' ? Array.isArray(value)
      : rule.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : rule.type === 'integer' ? Number.isSafeInteger(value)
          : typeof value === rule.type
    if (!typeMatches) throw new HTTPException(400, { message: `Invalid type for model parameter: ${key}` })
    if (typeof value === 'number' && ((rule.minimum !== undefined && value < rule.minimum) || (rule.maximum !== undefined && value > rule.maximum))) {
      throw new HTTPException(400, { message: `Model parameter is outside its configured range: ${key}` })
    }
    if (rule.values !== undefined && !rule.values.some(candidate => candidate === value)) {
      throw new HTTPException(400, { message: `Model parameter has an unsupported value: ${key}` })
    }
  }
}

function safeTask(task: typeof s.modelTasks.$inferSelect) {
  const { snapshot: _snapshot, queryLeaseToken: _token, queryLeaseUntil: _lease, ...view } = task
  return view
}

function buildProviderRequest(mapping: Config['submit'] | Config['query'], scope: Record<string, unknown>, key: string, base: string) {
  const path = expandAdapterTemplate(mapping.path, scope)
  if (typeof path !== 'string') throw new Error('Adapter endpoint path must resolve to text')
  const url = modelUrl(base, path)
  const headers = Object.fromEntries(Object.entries(mapping.headers).map(([name, value]) => [name, expandAdapterTemplate(value, scope)])) as Record<string, string>
  headers.Authorization = `Bearer ${key}`
  headers['Content-Type'] = 'application/json'
  const body = expandAdapterTemplate(mapping.body, scope)
  return { url, init: { method: mapping.method, headers, ...(mapping.method === 'POST' ? { body: JSON.stringify(body) } : {}) } }
}

async function callAdapter(
  configuration: Config,
  secret: string,
  mapping: Config['submit'] | Config['query'],
  scope: Record<string, unknown>,
  services: Services,
  signal?: AbortSignal,
): Promise<Outcome> {
  const { url, init } = buildProviderRequest(mapping, scope, secret, configuration.baseUrl)
  const transport = services.modelTransport ?? openModel
  const response = await transport(url, init.body ?? '', secret, signal ?? new AbortController().signal, init.method, init.headers)
  const chunks: Buffer[] = []
  let size = 0
  for await (const value of response) {
    const chunk = Buffer.from(value)
    size += chunk.byteLength
    if (size > 4 * 1024 * 1024) {
      response.destroy()
      throw new HTTPException(502, { message: 'Provider task response exceeded the size limit' })
    }
    chunks.push(chunk)
  }
  if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
    throw new HTTPException(502, { message: `Provider request failed with ${response.statusCode ?? 500}` })
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const spec = configuration.response
  const mappedStatus = readTemplatePath(body, spec.status)
  const status = typeof mappedStatus === 'string' ? spec.statusValues[mappedStatus] : undefined
  if (!status) throw new HTTPException(502, { message: 'Provider response has an unmapped task status' })
  const rawResults = spec.results ? readTemplatePath(body, spec.results) : undefined
  const resultRows = Array.isArray(rawResults) ? rawResults : rawResults === undefined ? [] : [rawResults]
  const results = resultRows.map((row, index) => {
    const kind = spec.resultKind
    if (!kind) return { index, value: row }
    if (kind === 'transcript') return { kind, text: String(spec.resultContent ? readTemplatePath(row, spec.resultContent) ?? '' : row), index }
    if (kind === 'embedding') return { kind, index, vector: Array.isArray(row) ? row : readTemplatePath(row, 'embedding') }
    return { kind, index, url: String(spec.resultUrl ? readTemplatePath(row, spec.resultUrl) ?? '' : row) }
  })
  const items = spec.usage.flatMap((item) => {
    const amount = readTemplatePath(body, item.path)
    return amount === undefined || amount === null ? [] : [{ key: item.key, unit: item.unit, quantity: String(amount), source: item.path, final: finalStates.has(status) }]
  })
  const usage = spec.usage.length === 0 ? undefined : { complete: finalStates.has(status) && items.length === spec.usage.length, items }
  const idValue = spec.providerTaskId ? readTemplatePath(body, spec.providerTaskId) : undefined
  const code = spec.errorCode ? readTemplatePath(body, spec.errorCode) : undefined
  const message = spec.errorMessage ? readTemplatePath(body, spec.errorMessage) : undefined
  return {
    status,
    ...(typeof idValue === 'string' ? { providerTaskId: idValue } : {}),
    results,
    ...(usage === undefined ? {} : { usage }),
    ...(status === 'failed' ? { error: { code: String(code ?? 'provider_failed'), message: String(message ?? 'Provider reported a failed task'), retryable: false } } : {}),
  }
}

async function settleTask(
  tx: Transaction,
  task: typeof s.modelTasks.$inferSelect,
  now: Date,
): Promise<typeof s.modelTasks.$inferSelect> {
  if (!finalStates.has(task.status)) return task
  const snapshot = adapterSnapshot(task)
  const usage = task.usage as Outcome['usage'] | null
  if (task.status !== 'succeeded' && snapshot.configuration.failureBilling === 'free') {
    return finalizeTaskCharge(tx, task, 0, now)
  }
  if (!usage?.complete) {
    const [waiting] = await tx.update(s.modelTasks).set({
      billingStatus: 'awaiting_usage', reviewReason: 'final_usage_missing', updatedAt: now, version: task.version + 1,
    }).where(eq(s.modelTasks.id, task.id)).returning()
    return waiting!
  }
  let final: number
  try {
    final = task.status === 'succeeded' || snapshot.configuration.failureBilling === 'usage'
      ? calculateTaskCost(usage, snapshot.prices)
      : 0
  }
  catch {
    const [review] = await tx.update(s.modelTasks).set({ billingStatus: 'review_required', reviewReason: 'usage_or_price_invalid', updatedAt: now, version: task.version + 1 }).where(eq(s.modelTasks.id, task.id)).returning()
    return review!
  }
  return finalizeTaskCharge(tx, task, final, now)
}

async function finalizeTaskCharge(
  tx: Transaction,
  task: typeof s.modelTasks.$inferSelect,
  final: number,
  now: Date,
): Promise<typeof s.modelTasks.$inferSelect> {
  const [wallet] = await tx.select().from(s.organizationWallets).where(eq(s.organizationWallets.organizationId, task.organizationId)).for('update')
  if (!wallet) throw new Error('Organization wallet is unavailable')
  const reserved = task.reservedMicrosCny
  const release = Math.max(0, reserved - final)
  const overage = Math.max(0, final - reserved)
  const charge = Math.min(overage, wallet.balanceMicrosCny)
  const outstanding = overage - charge
  const balance = wallet.balanceMicrosCny + release - charge
  const entries = [
    { eventKey: 'settlement', kind: 'settle', amount: 0 },
    ...(release > 0 ? [{ eventKey: 'release', kind: 'release', amount: release }] : []),
    ...(charge > 0 ? [{ eventKey: 'overage', kind: 'charge', amount: -charge }] : []),
  ]
  for (const entry of entries) {
    const [existing] = await tx.select({ id: s.modelTaskLedger.id }).from(s.modelTaskLedger)
      .where(and(eq(s.modelTaskLedger.taskId, task.id), eq(s.modelTaskLedger.eventKey, entry.eventKey)))
    if (!existing) await tx.insert(s.modelTaskLedger).values({
      id: randomUUID(), organizationId: task.organizationId, taskId: task.id, accountId: task.accountId,
      runtimeId: task.runtimeId, eventKey: entry.eventKey, kind: entry.kind,
      amountMicrosCny: entry.amount, balanceAfterMicrosCny: balance, createdAt: now,
    })
  }
  if (release || charge) await tx.update(s.organizationWallets).set({
    balanceMicrosCny: balance, updatedAt: now, version: sql`${s.organizationWallets.version} + 1`,
  }).where(eq(s.organizationWallets.organizationId, task.organizationId))
  const [updated] = await tx.update(s.modelTasks).set({
    billingStatus: outstanding > 0 ? 'partially_collected' : 'settled',
    finalMicrosCny: final, collectedMicrosCny: final - outstanding, outstandingMicrosCny: outstanding,
    reviewReason: outstanding > 0 ? 'wallet_overage_unpaid' : null, settledAt: now, updatedAt: now, version: task.version + 1,
  }).where(and(eq(s.modelTasks.id, task.id), eq(s.modelTasks.version, task.version))).returning()
  if (!updated) throw new HTTPException(409, { message: 'Model task changed during settlement' })
  return updated
}

/** Mount model adapter administration and the tenant task API. */
export function mountModelTasks(app: Hono<ApiEnv>, services: Services, tenantOperation: TenantOperation): {
  scanDue(): Promise<number>
} {
  const { db, config } = services
  app.get('/v1/platform/model-adapters', async c => c.json(await db.transaction(async (tx) => {
    await requirePlatform(tx, c.get('actor'))
    await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
    const rows = await tx.select().from(s.modelAdapters).orderBy(asc(s.modelAdapters.publicModel), asc(s.modelAdapters.version))
    return rows.map(({ secret: _secret, configuration, ...row }) => ({ ...row, configuration: Object.fromEntries(Object.entries(configuration).filter(([key]) => key !== 'apiKey')) }))
  })))
  app.post('/v1/platform/model-adapters', async (c) => {
    const input = adapterInputSchema.parse(await c.req.json())
    modelUrl(input.configuration.baseUrl)
    const id = randomUUID()
    const inserted = await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const [latest] = await tx.select({ version: s.modelAdapters.version }).from(s.modelAdapters)
        .where(eq(s.modelAdapters.publicModel, input.publicModel)).orderBy(sql`${s.modelAdapters.version} DESC`).limit(1)
      const version = (latest?.version ?? 0) + 1
      await tx.update(s.modelAdapters).set({ enabled: false }).where(and(
        eq(s.modelAdapters.publicModel, input.publicModel), eq(s.modelAdapters.operation, input.operation),
      ))
      const [row] = await tx.insert(s.modelAdapters).values({
        id, publicModel: input.publicModel, operation: input.operation, version, enabled: true,
        configuration: input.configuration, secret: encrypt(input.apiKey, config.encryptionKey, id),
        prices: input.prices, reserveMicrosCny: input.reserveMicrosCny,
      }).returning({ id: s.modelAdapters.id, version: s.modelAdapters.version })
      return row!
    })
    return c.json(inserted, 201)
  })
  app.get('/v1/organizations/:organizationId/model-tasks/models', async c => c.json(await tenantOperation(c, async (tx) => {
    return tx.select({ model: s.modelAdapters.publicModel, operation: s.modelAdapters.operation, version: s.modelAdapters.version })
      .from(s.modelAdapters).where(eq(s.modelAdapters.enabled, true)).orderBy(asc(s.modelAdapters.publicModel))
  })))
  app.post('/v1/organizations/:organizationId/model-tasks', async (c) => {
    const input = createSchema.parse(await c.req.json())
    const task = await tenantOperation(c, async (tx, tenant) => {
      const [replay] = await tx.select().from(s.modelTasks).where(and(
        eq(s.modelTasks.organizationId, tenant.organizationId), eq(s.modelTasks.idempotencyKey, input.idempotencyKey),
      )).for('update')
      if (replay) {
        if (replay.accountId !== tenant.actor.id || replay.publicModel !== input.model || replay.operation !== input.operation) {
          throw new HTTPException(409, { message: 'Idempotency key was used for a different task' })
        }
        return { view: safeTask(replay), created: false as const }
      }
      const [adapter] = await tx.select().from(s.modelAdapters).where(and(
        eq(s.modelAdapters.publicModel, input.model), eq(s.modelAdapters.operation, input.operation), eq(s.modelAdapters.enabled, true),
      )).orderBy(sql`${s.modelAdapters.version} DESC`).limit(1)
      if (!adapter) throw new HTTPException(404, { message: 'Model operation is unavailable' })
      validateParameters(adapter.configuration as Config, input.parameters)
      const [wallet] = await tx.select().from(s.organizationWallets).where(eq(s.organizationWallets.organizationId, tenant.organizationId)).for('update')
      if (!wallet || wallet.balanceMicrosCny < adapter.reserveMicrosCny) throw new HTTPException(402, { message: 'INSUFFICIENT_TEAM_BALANCE' })
      const now = nowOf(services)
      const id = randomUUID()
      const created = await tx.insert(s.modelTasks).values({
        id, organizationId: tenant.organizationId, accountId: tenant.actor.id, runtimeId: tenant.actor.runtimeId ?? null,
        idempotencyKey: input.idempotencyKey, publicModel: input.model, operation: input.operation,
        adapterVersion: adapter.version,
        snapshot: { adapterId: adapter.id, configuration: adapter.configuration, secret: adapter.secret, prices: adapter.prices },
        input: input.input, parameters: input.parameters, status: 'submitting', results: [], usage: null,
        billingStatus: 'reserved', reservedMicrosCny: adapter.reserveMicrosCny, collectedMicrosCny: 0,
        outstandingMicrosCny: 0, nextQueryAt: now, createdAt: now, updatedAt: now,
      }).returning()
      const balance = wallet.balanceMicrosCny - adapter.reserveMicrosCny
      await tx.update(s.organizationWallets).set({ balanceMicrosCny: balance, updatedAt: now, version: sql`${s.organizationWallets.version} + 1` })
        .where(eq(s.organizationWallets.organizationId, tenant.organizationId))
      await tx.insert(s.modelTaskLedger).values({ id: randomUUID(), organizationId: tenant.organizationId, taskId: id,
        accountId: tenant.actor.id, runtimeId: tenant.actor.runtimeId ?? null, eventKey: 'reserve', kind: 'reserve',
        amountMicrosCny: -adapter.reserveMicrosCny, balanceAfterMicrosCny: balance, createdAt: now })
      return { view: safeTask(created![0]!), created: true as const }
    })
    if ('created' in task && !task.created) return c.json(task.view)
    const view = 'view' in task ? task.view : task
    if (view.status === 'submitting') {
      try {
        const stored = await db.transaction(async (tx) => {
          await tx.execute(sql`select set_config('enterprise.organization_id', ${view.organizationId}, true)`)
          const [row] = await tx.select().from(s.modelTasks).where(eq(s.modelTasks.id, view.id))
          return row!
        })
        const snapshot = adapterSnapshot(stored)
        const secret = decrypt(snapshot.secret, config.encryptionKey, snapshot.adapterId)
        const outcome = await callAdapter(snapshot.configuration, secret, snapshot.configuration.submit, {
          taskId: view.id, idempotencyKey: view.idempotencyKey, model: view.publicModel,
          input: view.input, parameters: view.parameters,
        }, services, c.req.raw.signal)
        return c.json(await saveOutcome(db, view.id, view.organizationId, outcome, services), 202)
      } catch (error) {
        return c.json(await recordSubmitFailure(db, view.id, view.organizationId, error, services), 202)
      }
    }
    return c.json(view, 200)
  })
  app.get('/v1/organizations/:organizationId/model-tasks/:taskId', async (c) => {
    const { taskId } = querySchema.parse({ taskId: c.req.param('taskId') })
    const task = await tenantOperation(c, async (tx, tenant) => {
      const [row] = await tx.select().from(s.modelTasks).where(and(eq(s.modelTasks.id, taskId), eq(s.modelTasks.accountId, tenant.actor.id)))
      if (!row) forbidden()
      if (finalStates.has(row.status) && row.billingStatus === 'settled') return safeTask(row)
      return safeTask(row)
    })
    const updated = await queryTask(db, task.id, task.organizationId, services, config.encryptionKey)
    return c.json(updated)
  })
  return { scanDue: () => scanDue(db, services, config.encryptionKey) }
}

async function saveOutcome(db: Services['db'], id: string, orgId: string, outcome: Outcome, services: Services, leaseToken?: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('enterprise.organization_id', ${orgId}, true)`)
    const [task] = await tx.select().from(s.modelTasks).where(eq(s.modelTasks.id, id)).for('update')
    if (!task) throw new Error('Model task is unavailable')
    if (leaseToken !== undefined && task.queryLeaseToken !== leaseToken) return safeTask(task)
    if (finalStates.has(task.status)) {
      const usage = outcome.usage
      if (task.billingStatus === 'settled' || task.billingStatus === 'partially_collected') return safeTask(task)
      if (!usage?.complete) {
        const now = nowOf(services)
        const [waiting] = await tx.update(s.modelTasks).set({
          queryLeaseToken: null, queryLeaseUntil: null, lastQueriedAt: now,
          nextQueryAt: new Date(now.getTime() + 5 * 60_000), updatedAt: now,
        }).where(eq(s.modelTasks.id, task.id)).returning()
        return safeTask(waiting!)
      }
      const [withUsage] = await tx.update(s.modelTasks).set({
        usage, queryLeaseToken: null, queryLeaseUntil: null, lastQueriedAt: nowOf(services),
        updatedAt: nowOf(services), version: task.version + 1,
      }).where(and(eq(s.modelTasks.id, task.id), eq(s.modelTasks.version, task.version))).returning()
      if (!withUsage) throw new HTTPException(409, { message: 'Model task changed while saving final usage' })
      return safeTask(await settleTask(tx, withUsage, nowOf(services)))
    }
    const now = nowOf(services)
    const [updated] = await tx.update(s.modelTasks).set({
      status: outcome.status, providerTaskId: outcome.providerTaskId ?? task.providerTaskId,
      results: outcome.results, usage: outcome.usage ?? task.usage, error: outcome.error ?? null,
      nextQueryAt: new Date(now.getTime() + (outcome.status === 'processing' ? 15_000 : 0)),
      lastQueriedAt: now, queryLeaseToken: null, queryLeaseUntil: null, updatedAt: now, version: task.version + 1,
    }).where(and(eq(s.modelTasks.id, task.id), eq(s.modelTasks.version, task.version))).returning()
    if (!updated) throw new HTTPException(409, { message: 'Model task changed while saving provider state' })
    const settled = await settleTask(tx, updated, now)
    return safeTask(settled)
  })
}

async function recordSubmitFailure(db: Services['db'], id: string, orgId: string, error: unknown, services: Services) {
  const outcome: Outcome = { status: 'unknown', results: [], error: { code: 'submit_uncertain', message: error instanceof Error ? error.message : 'Provider submission is uncertain', retryable: true } }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('enterprise.organization_id', ${orgId}, true)`)
    const [task] = await tx.select().from(s.modelTasks).where(eq(s.modelTasks.id, id)).for('update')
    if (!task || finalStates.has(task.status)) return task ? safeTask(task) : undefined
    const now = nowOf(services)
    const [updated] = await tx.update(s.modelTasks).set({ status: outcome.status, error: outcome.error, reviewReason: 'submit_uncertain',
      billingStatus: 'review_required', nextQueryAt: new Date(now.getTime() + 60_000), updatedAt: now, version: task.version + 1,
    }).where(eq(s.modelTasks.id, task.id)).returning()
    return safeTask(updated!)
  })
}

async function queryTask(db: Services['db'], id: string, orgId: string, services: Services, encryptionKey: string) {
  const lease = randomUUID()
  const claimed = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('enterprise.organization_id', ${orgId}, true)`)
    const [task] = await tx.select().from(s.modelTasks).where(eq(s.modelTasks.id, id)).for('update')
    if (!task) forbidden()
    if (finalStates.has(task.status) && task.billingStatus !== 'awaiting_usage' && task.billingStatus !== 'review_required') return { task, claimed: false }
    const now = nowOf(services)
    if (task.nextQueryAt > now || (task.queryLeaseUntil && task.queryLeaseUntil > now)) return { task, claimed: false }
    const [updated] = await tx.update(s.modelTasks).set({ queryLeaseToken: lease, queryLeaseUntil: new Date(now.getTime() + 120_000), updatedAt: now })
      .where(and(eq(s.modelTasks.id, id), eq(s.modelTasks.version, task.version))).returning()
    return { task: updated ?? task, claimed: updated !== undefined }
  })
  if (!claimed.claimed) return safeTask(claimed.task)
  const snapshot = adapterSnapshot(claimed.task)
  if (!claimed.task.providerTaskId) return recordSubmitFailure(db, id, orgId, new Error('Provider task id is unavailable'), services)
  try {
    const secret = decrypt(snapshot.secret, encryptionKey, snapshot.adapterId)
    const outcome = await callAdapter(snapshot.configuration, secret, snapshot.configuration.query, {
      taskId: id, providerTaskId: claimed.task.providerTaskId, model: claimed.task.publicModel,
      input: claimed.task.input, parameters: claimed.task.parameters,
    }, services)
    return await saveOutcome(db, id, orgId, outcome, services, lease)
  } catch (error) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('enterprise.organization_id', ${orgId}, true)`)
      const now = nowOf(services)
      const [task] = await tx.select().from(s.modelTasks).where(and(eq(s.modelTasks.id, id), eq(s.modelTasks.queryLeaseToken, lease))).for('update')
      if (!task) return safeTask(claimed.task)
      const [updated] = await tx.update(s.modelTasks).set({
        queryLeaseToken: null, queryLeaseUntil: null, lastQueriedAt: now,
        nextQueryAt: new Date(now.getTime() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(task.version, 5))),
        error: { code: 'query_failed', message: error instanceof Error ? error.message : 'Provider query failed', retryable: true },
        updatedAt: now, version: task.version + 1,
      }).where(eq(s.modelTasks.id, id)).returning()
      return safeTask(updated!)
    })
  }
}

async function scanDue(db: Services['db'], services: Services, encryptionKey: string): Promise<number> {
  const now = nowOf(services)
  const tasks = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
    const rows = await tx.select({ id: s.modelTasks.id, organizationId: s.modelTasks.organizationId }).from(s.modelTasks)
      .where(and(lte(s.modelTasks.createdAt, new Date(now.getTime() - 30 * 60_000)),
        lte(s.modelTasks.nextQueryAt, now), or(isNull(s.modelTasks.queryLeaseUntil), lte(s.modelTasks.queryLeaseUntil, now)),
        or(eq(s.modelTasks.billingStatus, 'reserved'), eq(s.modelTasks.billingStatus, 'awaiting_usage'), eq(s.modelTasks.billingStatus, 'review_required'))))
      .orderBy(asc(s.modelTasks.nextQueryAt)).limit(100)
    return rows
  })
  for (const task of tasks) await queryTask(db, task.id, task.organizationId, services, encryptionKey)
  return tasks.length
}
