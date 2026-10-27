import { admitPaidCall, modelPublishedTo } from './team-governance.ts'
/** Durable model tasks shared by tenant HTTP endpoints and installation-scoped plugins. */
import { inspectFileMediaType } from '@deepseek-ai/dsh-attachment'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import * as s from './schema.ts'
import type { ApiEnv, Services, TenantOperation } from './application.ts'
import type { Actor } from './security.ts'
import type { OrganizationId } from './contracts.ts'
import { modelTaskListInput, resourceId, accountId as parseAccountId, organizationId as parseOrganizationId } from './contracts.ts'
import { decrypt, encrypt, enterTenant, forbidden, requirePermission, requirePlatform } from './security.ts'
import { modelUrl, openModel } from './gateway.ts'
import type { Transaction } from './database.ts'
import { lockOrganizationWallet, writeWalletBalance } from './wallet.ts'
import { resolveProvider } from './model-providers.ts'
import { downloadTaskAsset } from './model-task-assets.ts'
import {
  operationSchema, taskConfigSchema, finalStates, calculateTaskCost, decodeTaskOutcome,
  expandAdapterTemplate, resolveTaskParameters, seedanceRequest, taskReservation, taskPriceUnits,
  type TaskConfig, type TaskOutcome, type TaskUsage,
} from './model-task-rules.ts'
export { calculateTaskCost, expandAdapterTemplate, readTemplatePath } from './model-task-rules.ts'

const adapterInput = z.object({
  modelId: resourceId.optional(), publicModel: z.string().trim().min(1).max(200), operation: operationSchema,
  apiKey: z.string().min(1).max(4096).optional(), configuration: taskConfigSchema,
  prices: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u), z.string().regex(/^\d{1,12}$/u)),
  reserveMicrosCny: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((value, context) => {
  const required = value.configuration.billing === 'fixed-reservation' ? ['request']
    : value.configuration.driver === 'crl-seedance-v1' ? ['completion_tokens'] : value.configuration.response.usage.map(item => item.key)
  for (const key of required) {
    if (value.prices[key] === undefined || (value.configuration.videoReferencePrices &&
      value.configuration.videoReferencePrices[key] === undefined)) {
      context.addIssue({ code: 'custom', path: ['prices', key], message: 'Every usage measure requires a price' })
    }
  }
  if (required.length === 0) context.addIssue({ code: 'custom', path: ['prices'], message: 'A billing measure is required' })
})
const createInput = z.object({
  operation: operationSchema, model: resourceId,
  input: z.record(z.string(), z.unknown()).default({}), parameters: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().trim().min(16).max(128),
}).strict()
const referenceInput = z.array(z.object({ assetId: resourceId }).strict()).max(16)
const nowOf = (services: Services): Date => new Date(services.now?.() ?? Date.now())

type Task = typeof s.modelTasks.$inferSelect
type Snapshot = {
  adapterId: string
  configuration: TaskConfig
  secret: string
  credentialBinding?: string
  prices: Record<string, string>
  providerVersion?: number
  originalInput?: unknown
  originalParameters?: unknown
}
/** Verified caller identity; only platform-authenticated callers construct this value. */
export interface ModelTaskPrincipal {
  actor: Actor
  organizationId: OrganizationId
  installationId?: string
  releaseId?: string
  activationId?: string
}

function requireRow<T>(row: T | null | undefined): T {
  if (row === undefined || row === null) throw new Error('Model task database row is unavailable')
  return row
}

function snapshotOf(task: Task): Snapshot {
  const snapshot = task.snapshot as unknown as Snapshot
  return { ...snapshot, configuration: taskConfigSchema.parse({ ...snapshot.configuration,
    ...(task.engineVersion === 1 ? { missingUsagePolicy: 'await_usage' } : {}) }) }
}
function safeTask(task: Task) {
  const { snapshot: _snapshot, providerResults: _providerResults, providerTaskId: _providerTaskId,
    queryLeaseToken: _token, queryLeaseUntil: _lease, reservedMicrosCny, ...view } = task
  return { ...view, estimatedMicrosCny: reservedMicrosCny }
}
function ownerWhere(principal: ModelTaskPrincipal) {
  return and(eq(s.modelTasks.organizationId, principal.organizationId), eq(s.modelTasks.accountId, principal.actor.id),
    principal.installationId ? eq(s.modelTasks.pluginInstallationId, principal.installationId) : undefined)
}

/** HTTP diagnostics omit supplier bodies, credentials, and signed media URLs. */
class ProviderTaskHttpError extends Error {
  constructor(readonly statusCode: number, readonly retryable: boolean) {
    super(`Provider HTTP request failed with status ${statusCode}`)
  }
}

async function callAdapter(services: Services, snapshot: Snapshot, task: Task, submitting: boolean, input: Record<string, unknown>,
  signal: AbortSignal): Promise<TaskOutcome> {
  const config = snapshot.configuration
  const mapping = submitting ? config.submit : config.query
  const scope = { taskId: task.id, idempotencyKey: task.idempotencyKey, providerTaskId: task.providerTaskId,
    model: config.upstreamModel ?? task.publicModel, input, parameters: task.parameters }
  const path = expandAdapterTemplate(mapping.path, { ...scope,
    providerTaskId: task.providerTaskId ? encodeURIComponent(task.providerTaskId) : undefined })
  if (typeof path !== 'string') throw new Error('Adapter endpoint path must resolve to text')
  const secret = decrypt(snapshot.secret, services.config.encryptionKey, snapshot.credentialBinding ?? snapshot.adapterId)
  const body = submitting && config.driver === 'crl-seedance-v1'
    ? seedanceRequest(config, input, task.parameters) : expandAdapterTemplate(mapping.body, scope)
  const headers = Object.fromEntries(Object.entries(mapping.headers).map(([key, value]) => [key, String(expandAdapterTemplate(value,
    scope))]))
  headers['Content-Type'] = 'application/json'
  const response = await (services.modelTransport ?? openModel)(modelUrl(config.baseUrl, path),
    mapping.method === 'POST' ? JSON.stringify(body) : '', secret,
    AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]), mapping.method, headers)
  try {
    if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
      throw new ProviderTaskHttpError(response.statusCode ?? 500,
        config.retryableHttpStatuses.includes(response.statusCode ?? 500))
    }
    const chunks: Buffer[] = []
    let size = 0
    for await (const value of response as AsyncIterable<unknown>) {
      if (!(value instanceof Uint8Array)) throw new Error('Invalid provider response bytes')
      const chunk = Buffer.from(value)
      size += chunk.byteLength
      if (size > services.config.modelRequestBodyBytes) throw new Error('Provider task response exceeded the size limit')
      chunks.push(chunk)
    }
    return decodeTaskOutcome(config, JSON.parse(Buffer.concat(chunks).toString('utf8')), submitting)
  } finally { response.destroy() }
}

async function settleTask(tx: Transaction, task: Task, now: Date): Promise<Task> {
  if (!finalStates.has(task.status) || ['settled', 'partially_collected'].includes(task.billingStatus)) return task
  const snapshot = snapshotOf(task)
  const usage = task.usage as TaskUsage | null
  let final: number
  let billingBasis = 'provider_usage'
  if (task.status !== 'succeeded' && task.error?.code !== 'provider_output_invalid'
    && snapshot.configuration.failureBilling === 'free') { final = 0; billingBasis = 'failure_release' }
  else if (!usage?.complete &&
    task.engineVersion < 3 && snapshot.configuration.missingUsagePolicy === 'use_reserved') { final = task.reservedMicrosCny; billingBasis = 'reservation_fallback' }
  else if (!usage?.complete) {
    const [waiting] = await tx.update(s.modelTasks).set({ billingStatus: 'awaiting_usage', reviewReason: 'final_usage_missing',
      updatedAt: now, version: task.version + 1 }).where(eq(s.modelTasks.id, task.id)).returning()
    return requireRow(waiting)
  } else {
    try { final = calculateTaskCost(usage, snapshot.prices) }
    catch {
      const [review] = await tx.update(s.modelTasks).set({ billingStatus: 'review_required', reviewReason: 'usage_or_price_invalid',
        updatedAt: now, version: task.version + 1 }).where(eq(s.modelTasks.id, task.id)).returning()
      return requireRow(review)
    }
  }
  const settled = await finalizeTaskCharge(tx, task, final, now)
  const [updated] = await tx.update(s.modelTasks).set({ billingBasis }).where(eq(s.modelTasks.id, task.id)).returning()
  return updated ?? settled
}
async function finalizeTaskCharge(
  tx: Transaction,
  task: typeof s.modelTasks.$inferSelect,
  final: number,
  now: Date,
): Promise<typeof s.modelTasks.$inferSelect> {
  if (task.engineVersion >= 3) {
    const wallet = await lockOrganizationWallet(tx, parseOrganizationId.parse(task.organizationId))
    const balance = wallet.balanceMicrosCny - final
    await tx.insert(s.modelTaskLedger).values({ id: randomUUID(), organizationId: task.organizationId,
      taskId: task.id, accountId: task.accountId, runtimeId: task.runtimeId, eventKey: 'settlement', kind: 'charge',
      amountMicrosCny: -final, balanceAfterMicrosCny: balance, createdAt: now })
    await writeWalletBalance(tx, wallet, balance, now)
    const [updated] = await tx.update(s.modelTasks).set({ billingStatus: 'settled', finalMicrosCny: final,
      collectedMicrosCny: final, outstandingMicrosCny: 0, reviewReason: null, settledAt: now,
      updatedAt: now, version: task.version + 1 }).where(and(eq(s.modelTasks.id, task.id),
      eq(s.modelTasks.version, task.version))).returning()
    if (!updated) throw new HTTPException(409, { message: 'Model task changed during settlement' })
    return updated
  }
  const wallet = await lockOrganizationWallet(tx, parseOrganizationId.parse(task.organizationId))
  const reserved = task.reservedMicrosCny
  const release = Math.max(0, reserved - final)
  const overage = Math.max(0, final - reserved)
  const charge = Math.min(overage, Math.max(0, wallet.balanceMicrosCny))
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
  if (release || charge) await writeWalletBalance(tx, wallet, balance, now)
  const [updated] = await tx.update(s.modelTasks).set({
    billingStatus: outstanding > 0 ? 'partially_collected' : 'settled',
    finalMicrosCny: final, collectedMicrosCny: final - outstanding, outstandingMicrosCny: outstanding,
    reviewReason: outstanding > 0 ? 'wallet_overage_unpaid' : null, settledAt: now, updatedAt: now, version: task.version + 1,
  }).where(and(eq(s.modelTasks.id, task.id), eq(s.modelTasks.version, task.version))).returning()
  if (!updated) throw new HTTPException(409, { message: 'Model task changed during settlement' })
  return updated
}

/**
 * Create the single task application service used by HTTP and plugins.
 * @param services API dependencies.
 * @returns Authorized task operations and background maintenance.
 */
export function createModelTaskService(services: Services) {
  const { db, config } = services
  const tenant = async <T>(principal: ModelTaskPrincipal,
    run: (tx: Transaction) => Promise<T>): Promise<T> => db.transaction(async (tx) => {
    await enterTenant(tx, principal.actor, principal.organizationId, true)
    if (principal.installationId) {
      const [installation] = await tx.select().from(s.pluginInstallations).where(and(eq(s.pluginInstallations.id, principal.installationId),
        eq(s.pluginInstallations.organizationId, principal.organizationId))).for('share')
      if (!installation || installation.desiredState !== 'enabled' || installation.uninstalledAt
        || installation.releaseId !== principal.releaseId || !principal.activationId) forbidden()
      const [activation] = await tx.select().from(s.pluginActivations).where(and(eq(s.pluginActivations.id, principal.activationId),
        eq(s.pluginActivations.installationId, principal.installationId))).for('share')
      if (!activation || activation.revokedAt || activation.expiresAt <= new Date() ||
        activation.permissionRevision !== installation.permissionRevision) forbidden()
      const [device] = await tx.select().from(s.pluginDeviceActivations).where(and(eq(s.pluginDeviceActivations.installationId,
        principal.installationId),
      eq(s.pluginDeviceActivations.deviceId, activation.deviceId), eq(s.pluginDeviceActivations.targetKind,
        activation.targetKind))).for('share')
      const [release] = await tx.select().from(s.plugins).where(eq(s.plugins.id, installation.releaseId)).for('share')
      if (!device || device.accountId !== principal.actor.id || device.desiredState !== 'enabled' || !release ||
        release.revokedAt) forbidden()
    }
    return run(tx)
  })
  const read = (principal: ModelTaskPrincipal, id: string) => tenant(principal, async (tx) => {
    const [task] = await tx.select().from(s.modelTasks).where(and(eq(s.modelTasks.id, resourceId.parse(id)), ownerWhere(principal)))
    if (!task) forbidden()
    return safeTask(task)
  })
  const listPage = (principal: ModelTaskPrincipal, raw: unknown) => tenant(principal, async (tx) => {
    const input = modelTaskListInput.parse(raw)
    let cursor: { micros: string; id: string } | undefined
    if (input.cursor) {
      try {
        cursor = z.object({ micros: z.string().regex(/^\d{1,20}$/u), id: resourceId }).strict()
          .parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')))
      } catch { throw new HTTPException(400, { message: 'INVALID_TASK_CURSOR' }) }
    }
    const micros = sql<string>`(extract(epoch from ${s.modelTasks.createdAt}) * 1000000)::bigint::text`
    const tasks = await tx.select({ task: s.modelTasks, micros }).from(s.modelTasks).where(and(ownerWhere(principal),
      cursor ? sql`((extract(epoch from ${s.modelTasks.createdAt}) * 1000000)::bigint, ${s.modelTasks.id})
        < (${cursor.micros}::bigint, ${cursor.id}::text)` : undefined,
      input.status ? eq(s.modelTasks.status, input.status) : undefined,
      input.query ? sql`strpos(lower(${s.modelTasks.publicModel}), lower(${input.query})) > 0` : undefined,
    )).orderBy(sql`${s.modelTasks.createdAt} DESC`, sql`${s.modelTasks.id} DESC`).limit(input.limit + 1)
    const page = tasks.slice(0, input.limit), last = page.at(-1)
    return { items: page.map(row => safeTask(row.task)), nextCursor: tasks.length > input.limit && last
      ? Buffer.from(JSON.stringify({ micros: last.micros, id: last.task.id })).toString('base64url') : null }
  })
  const list = async (principal: ModelTaskPrincipal) => (await listPage(principal, { limit: 100 })).items
  const catalog = (principal: ModelTaskPrincipal) => tenant(principal, async (tx) => {
    const rows = await tx.select({ model: s.models, adapter: s.modelAdapters }).from(s.models)
      .innerJoin(s.modelProviders, and(eq(s.modelProviders.id, s.models.providerId), eq(s.modelProviders.enabled, true)))
      .innerJoin(s.modelAdapters, and(eq(s.modelAdapters.modelId, s.models.id), eq(s.modelAdapters.enabled, true)))
      .where(eq(s.models.enabled, true))
    return rows.filter(({ model }) => modelPublishedTo(model, principal.organizationId)).map(({ model, adapter }) => {
      const rules = taskConfigSchema.parse(adapter.configuration)
      return { id: model.id, model: model.id, name: model.name, operation: adapter.operation, version: adapter.version,
        inputModalities: model.inputModalities, outputModalities: model.outputModalities,
        parameters: rules.parameters, prices: adapter.prices, settlementUnits: taskPriceUnits(rules), reserve: rules.reserve,
        estimatedMicrosCny: adapter.reserveMicrosCny, videoReferencePrices: rules.videoReferencePrices,
        referenceKinds: Object.keys(rules.referenceMapping) }
    })
  })
  const prepare = async (tx: Transaction, principal: ModelTaskPrincipal, raw: unknown) => {
    const input = createInput.parse(raw)
    const [adapter] = await tx.select().from(s.modelAdapters).where(and(eq(s.modelAdapters.modelId, input.model),
      eq(s.modelAdapters.operation, input.operation), eq(s.modelAdapters.enabled, true))).orderBy(sql`${s.modelAdapters.version} DESC`).limit(1)
    const [model] = await tx.select().from(s.models).where(eq(s.models.id, input.model))
    if (!adapter || !model?.enabled || !model.providerId || !modelPublishedTo(model, principal.organizationId)) throw new HTTPException(404, { message: 'Model operation is unavailable' })
    const provider = await resolveProvider(tx, model.providerId)
    const rules = taskConfigSchema.parse({ ...adapter.configuration, baseUrl: provider.baseUrl,
      timeoutMs: provider.timeoutMs, retryableHttpStatuses: provider.retryableHttpStatuses })
    let parameters: Record<string, unknown>
    try { parameters = resolveTaskParameters(rules, input.parameters) }
    catch (error) { throw new HTTPException(400, { message: error instanceof Error ? error.message : 'Invalid model parameters' }) }
    if (rules.driver === 'crl-seedance-v1') z.string().min(1).parse(input.input.prompt)
    const references = referenceInput.parse(input.input.references ?? [])
    const resolvedReferences: { assetId: string; kind: 'image' | 'video' | 'audio' }[] = []
    for (const reference of references) {
      const [asset] = await tx.select().from(s.modelAssets).where(and(eq(s.modelAssets.id, reference.assetId),
        eq(s.modelAssets.organizationId, principal.organizationId), eq(s.modelAssets.accountId, principal.actor.id),
        principal.installationId ? eq(s.modelAssets.pluginInstallationId, principal.installationId) : undefined))
      if (!asset) forbidden()
      if (!rules.referenceMapping[asset.kind as 'image' | 'video' | 'audio']) throw new HTTPException(400, { message: 'Reference kind is not configured for this model' })
      resolvedReferences.push({ assetId: asset.id, kind: asset.kind as 'image' | 'video' | 'audio' })
    }
    const hasVideo = resolvedReferences.some(reference => reference.kind === 'video')
    if (hasVideo && !rules.videoReferencePrices) throw new HTTPException(409, { message: 'Video reference pricing is not configured' })
    const reservedMicrosCny = taskReservation(rules, parameters, adapter.reserveMicrosCny)
    return { input, adapter, model, provider, rules, parameters, resolvedReferences, reservedMicrosCny,
      prices: hasVideo ? requireRow(rules.videoReferencePrices) : adapter.prices, priceCondition: hasVideo ? 'video_reference' : 'standard' }
  }
  const preview = (principal: ModelTaskPrincipal, raw: unknown) => tenant(principal, async (tx) => {
    const prepared = await prepare(tx, principal, raw)
    return { model: prepared.model.id, adapterVersion: prepared.adapter.version, estimatedMicrosCny: prepared.reservedMicrosCny,
      prices: prepared.prices, priceCondition: prepared.priceCondition, settlementUnits: taskPriceUnits(prepared.rules),
      parameters: prepared.parameters, missingUsagePolicy: prepared.rules.missingUsagePolicy }
  })
  const create = (principal: ModelTaskPrincipal, raw: unknown) => tenant(principal, async (tx) => {
    const input = createInput.parse(raw)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${principal.organizationId + ':' + input.idempotencyKey}))`)
    const [existing] = await tx.select().from(s.modelTasks).where(and(eq(s.modelTasks.organizationId, principal.organizationId), eq(s.modelTasks.idempotencyKey, input.idempotencyKey))).for('update')
    if (existing) {
      const previous = existing.snapshot as unknown as Snapshot
      if (existing.accountId !== principal.actor.id || existing.pluginInstallationId !== (principal.installationId ?? null)
        || existing.modelId !== input.model || existing.operation !== input.operation
        || !isDeepStrictEqual(previous.originalInput ?? existing.input, input.input)
        || !isDeepStrictEqual(previous.originalParameters ?? existing.parameters, input.parameters)) {
        throw new HTTPException(409, { message: 'Idempotency key was used for a different task' })
      }
      return safeTask(existing)
    }
    if (!config.modelTaskAccepting) throw new HTTPException(503, { message: 'New model tasks are paused' })
    const prepared = await prepare(tx, principal, raw)
    const now = nowOf(services)
    const id = randomUUID()
    await admitPaidCall(tx, principal.organizationId, principal.actor.id, input.model, id, now,
      prepared.reservedMicrosCny > 0 || Object.values(prepared.prices).some(price => BigInt(price) > 0n))
    const [task] = await tx.insert(s.modelTasks).values({ id, organizationId: principal.organizationId, accountId: principal.actor.id,
      runtimeId: principal.actor.runtimeId ?? null, pluginInstallationId: principal.installationId ?? null,
      pluginReleaseId: principal.releaseId ?? null,
      engineVersion: 3, modelId: input.model, idempotencyKey: input.idempotencyKey, publicModel: prepared.model.name,
      operation: input.operation, adapterVersion: prepared.adapter.version,
      snapshot: { adapterId: prepared.adapter.id, configuration: prepared.rules, secret: prepared.provider.secret,
        credentialBinding: prepared.provider.credentialBinding, providerVersion: prepared.provider.version,
        prices: prepared.prices, priceCondition: prepared.priceCondition, originalInput: input.input,
        originalParameters: input.parameters },
      input: { ...input.input, references: prepared.resolvedReferences }, parameters: prepared.parameters,
      status: 'queued', results: [], billingStatus: 'pending', reservedMicrosCny: prepared.reservedMicrosCny,
      collectedMicrosCny: 0, outstandingMicrosCny: 0, nextQueryAt: now, createdAt: now, updatedAt: now,
    }).returning()
    return safeTask(requireRow(task))
  })
  const uploadAsset = (principal: ModelTaskPrincipal, raw: unknown) => tenant(principal, async (tx) => {
    await enterTenant(tx, principal.actor, principal.organizationId)
    const input = z.object({ assetId: resourceId, content: z.string().max(Math.ceil(config.modelTaskAssetMaxBytes / 3) * 4),
      contentType: z.string().regex(/^(?:image|video|audio)\/[a-z0-9.+-]+$/u) }).strict().parse(raw)
    const bytes = Buffer.from(input.content, 'base64')
    if (!bytes.length || bytes.byteLength > config.modelTaskAssetMaxBytes || bytes.toString('base64') !== input.content) throw new HTTPException(400, { message: 'Invalid reference content' })
    let mimeType: string | undefined
    try { mimeType = inspectFileMediaType(bytes, input.contentType, 'reference-upload') }
    catch { throw new HTTPException(400, { message: 'Reference MIME type cannot be verified' }) }
    if (mimeType !== input.contentType) throw new HTTPException(400, { message: 'Reference MIME type cannot be verified' })
    const checksum = createHash('sha256').update(bytes).digest('hex')
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.assetId}))`)
    const [existing] = await tx.select().from(s.modelAssets).where(eq(s.modelAssets.id, input.assetId))
    if (existing) {
      if (existing.accountId !== principal.actor.id || existing.organizationId !== principal.organizationId
        || existing.pluginInstallationId !== (principal.installationId ?? null) || existing.checksum !== checksum) throw new HTTPException(409, { message: 'Asset ID already used' })
      return { assetId: existing.id, mimeType: existing.mimeType, checksum }
    }
    if (!services.driveObjects) throw new HTTPException(503, { message: 'Asset storage is unavailable' })
    const objectKey = `model-assets/${principal.organizationId}/references/${input.assetId}`
    await services.driveObjects.put(objectKey, bytes, mimeType)
    await tx.insert(s.modelAssets).values({ id: input.assetId, organizationId: principal.organizationId,
      accountId: principal.actor.id, pluginInstallationId: principal.installationId, taskId: null, index: 0,
      kind: mimeType.split('/')[0] ?? '', objectKey, mimeType, byteLength: bytes.byteLength, checksum,
      expiresAt: new Date(nowOf(services).getTime() + config.modelTaskAssetRetentionSeconds * 1000) })
    return { assetId: input.assetId, mimeType, checksum }
  })
  const assetAccess = (principal: ModelTaskPrincipal, id: string) => tenant(principal, async (tx) => {
    const [asset] = await tx.select().from(s.modelAssets).where(and(eq(s.modelAssets.id, resourceId.parse(id)),
      eq(s.modelAssets.organizationId, principal.organizationId), eq(s.modelAssets.accountId, principal.actor.id),
      principal.installationId ? eq(s.modelAssets.pluginInstallationId, principal.installationId) : undefined))
    if (!asset) forbidden()
    if (asset.expiresAt && asset.expiresAt <= nowOf(services)) throw new HTTPException(410, { message: 'RESULT_RECOVERY_EXPIRED' })
    if (!services.driveObjects) throw new HTTPException(503, { message: 'Asset storage is unavailable' })
    const seconds = Math.min(config.driveSignedUrlSeconds,
      Math.ceil((asset.expiresAt?.getTime() ?? Infinity) / 1000 - nowOf(services).getTime() / 1000))
    return { assetId: asset.id, url: await services.driveObjects.createDownloadUrl(asset.objectKey, seconds),
      expiresAt: new Date(Math.min(nowOf(services).getTime() + config.driveSignedUrlSeconds * 1000,
        asset.expiresAt?.getTime() ?? Infinity)).toISOString(), recoverableUntil: asset.expiresAt?.toISOString() ?? null,
      mimeType: asset.mimeType }
  })
  const recover = (principal: ModelTaskPrincipal, id: string, action: 'cancel' | 'retry-save') => tenant(principal, async (tx) => {
    await tx.execute(sql`SELECT id FROM enterprise.organization WHERE id = ${principal.organizationId} FOR SHARE`)
    const [task] = await tx.select().from(s.modelTasks).where(and(eq(s.modelTasks.id, resourceId.parse(id)), ownerWhere(principal))).for('update')
    if (!task) forbidden()
    const now = nowOf(services)
    if (action === 'cancel') {
      if (finalStates.has(task.status)) return safeTask(task)
      const [updated] = await tx.update(s.modelTasks).set({ cancelRequestedAt: task.cancelRequestedAt ?? now,
        nextQueryAt: now, version: task.version + 1 }).where(eq(s.modelTasks.id, task.id)).returning()
      return safeTask(requireRow(updated))
    }
    if (task.status !== 'succeeded' || !task.providerResults || task.assetStatus === 'ready'
      || (task.queryLeaseUntil && task.queryLeaseUntil > now)) throw new HTTPException(409, { message: 'RESULT_SAVE_RETRY_UNAVAILABLE' })
    if (!task.assetTrackingUntil || task.assetTrackingUntil <= now) throw new HTTPException(410, { message: 'RESULT_RECOVERY_EXPIRED' })
    const [updated] = await tx.update(s.modelTasks).set({ assetStatus: 'pending', reviewReason: null, nextQueryAt: now,
      version: task.version + 1 }).where(eq(s.modelTasks.id, task.id)).returning()
    return safeTask(requireRow(updated))
  })
  return { read, list, listPage, catalog, preview, create, uploadAsset, assetAccess, recover,
    scanDue: (signal?: AbortSignal) => scanDue(services, signal) }
}

/**
 * Mount tenant task HTTP routes and immutable adapter publication.
 * @param app HTTP app.
 * @param services API dependencies.
 * @param tenantOperation Tenant authorization.
 * @returns Shared task service.
 */
export function mountModelTasks(app: Hono<ApiEnv>, services: Services, tenantOperation: TenantOperation) {
  const taskService = createModelTaskService(services)
  const { db, config } = services
  app.get('/v1/platform/model-adapters', async c => c.json(await db.transaction(async (tx) => {
    await requirePlatform(tx, c.get('actor'))
    await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
    const rows = await tx.select().from(s.modelAdapters).orderBy(asc(s.modelAdapters.publicModel), asc(s.modelAdapters.version))
    return rows.map(({ secret: _secret, ...row }) => row)
  })))
  app.post('/v1/platform/model-adapters', async (c) => {
    const input = adapterInput.parse(await c.req.json())
    modelUrl(input.configuration.baseUrl)
    const id = randomUUID()
    const published = await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      let modelId = input.modelId
      if (!modelId) {
        if (!input.apiKey) throw new HTTPException(400, { message: 'A platform model or provider credential is required' })
        modelId = resourceId.parse(id)
        await tx.insert(s.modelProviders).values({ id, name: input.publicModel })
        await tx.insert(s.modelProviderVersions).values({ providerId: id, version: 1, baseUrl: input.configuration.baseUrl,
          secret: encrypt(input.apiKey, config.encryptionKey, id), credentialBinding: id, timeoutMs: input.configuration.timeoutMs,
          retryableHttpStatuses: input.configuration.retryableHttpStatuses })
        await tx.insert(s.models).values({ id, name: input.publicModel, providerId: id, operations: [input.operation],
          inputModalities: ['text', ...Object.keys(input.configuration.referenceMapping)], outputModalities: [input.operation.split('.')[0] ?? ''], baseUrl: input.configuration.baseUrl, upstreamModel: input.configuration.upstreamModel ?? input.publicModel,
          secret: encrypt(input.apiKey, config.encryptionKey, id), contextTokens: 1024, maxOutputTokens: 1024,
          inputMicrosPerMillion: 0, outputMicrosPerMillion: 0 })
      }
      const [model] = await tx.select().from(s.models).where(eq(s.models.id, modelId)).for('update')
      if (!model?.providerId) throw new HTTPException(404, { message: 'Model not found' })
      const provider = await resolveProvider(tx, model.providerId)
      const [latest] = await tx.select({ version: s.modelAdapters.version }).from(s.modelAdapters)
        .where(and(eq(s.modelAdapters.modelId, modelId), eq(s.modelAdapters.operation, input.operation)))
        .orderBy(sql`${s.modelAdapters.version} DESC`).limit(1)
      const version = (latest?.version ?? 0) + 1
      await tx.update(s.modelAdapters).set({ enabled: false })
        .where(and(eq(s.modelAdapters.modelId, modelId), eq(s.modelAdapters.operation, input.operation)))
      await tx.update(s.models).set({
        inputModalities: [...new Set([...model.inputModalities, ...Object.keys(input.configuration.referenceMapping)])],
        operations: [...new Set([...model.operations, input.operation])],
        outputModalities: [...new Set([...model.outputModalities, input.operation.split('.')[0] ?? ''])] }).where(eq(s.models.id, modelId))
      await tx.insert(s.modelAdapters).values({ id, modelId, publicModel: input.publicModel,
        operation: input.operation, version, enabled: true,
        configuration: input.configuration, secret: provider.secret, prices: input.prices, reserveMicrosCny: input.reserveMicrosCny })
      return { id, modelId, version }
    })
    return c.json(published, 201)
  })
  app.get('/v1/platform/model-tasks', async c => c.json(await db.transaction(async (tx) => {
    await requirePlatform(tx, c.get('actor'))
    await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
    const rows = await tx.select().from(s.modelTasks).where(or(eq(s.modelTasks.status, 'unknown'),
      eq(s.modelTasks.billingStatus, 'review_required'), eq(s.modelTasks.billingStatus, 'partially_collected'),
      eq(s.modelTasks.assetStatus, 'review_required'))).orderBy(asc(s.modelTasks.createdAt)).limit(200)
    return rows.map(safeTask)
  })))
  app.post('/v1/platform/model-tasks/:taskId/resolve', async (c) => {
    const input = z.object({
      action: z.enum(['link_provider_task', 'confirm_free_failure', 'retry_assets', 'collect_debt', 'adjust_charge']),
      expectedVersion: z.number().int().positive(), evidence: z.string().trim().min(10).max(2000),
      providerTaskId: z.string().min(1).max(300).optional(),
      finalMicrosCny: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    }).strict().parse(await c.req.json())
    const id = resourceId.parse(c.req.param('taskId'))
    return c.json(await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const [task] = await tx.select().from(s.modelTasks).where(eq(s.modelTasks.id, id)).for('update')
      const now = nowOf(services)
      if (!task) throw new HTTPException(404, { message: 'Task not found' })
      await tx.execute(sql`select set_config('enterprise.organization_id', ${task.organizationId}, true)`)
      if (task.version !== input.expectedVersion || (task.queryLeaseUntil && task.queryLeaseUntil > now)) throw new HTTPException(409, { message: 'Task changed or is leased' })
      const invalid = () => { throw new HTTPException(409, { message: 'Resolution is not applicable to this task' }) }
      if (input.action === 'link_provider_task') {
        if (task.status !== 'unknown' || !input.providerTaskId) invalid()
        await tx.update(s.modelTasks).set({ providerTaskId: input.providerTaskId, status: 'processing',
          billingStatus: task.engineVersion >= 3 ? 'pending' : 'reserved', reviewReason: null, nextQueryAt: now }).where(eq(s.modelTasks.id, id))
      } else if (input.action === 'confirm_free_failure') {
        if (task.status !== 'unknown' || snapshotOf(task).configuration.failureBilling !== 'free' || task.settledAt) invalid()
        const [failed] = await tx.update(s.modelTasks).set({ status: 'failed', assetStatus: 'not_applicable',
          error: { code: 'operator_confirmed_failure', message: 'Confirmed after provider review', retryable: false } }).where(eq(s.modelTasks.id, id)).returning()
        await settleTask(tx, requireRow(failed), now)
      } else if (input.action === 'retry_assets') {
        if (task.status !== 'succeeded' || !task.providerResults || task.assetStatus === 'ready') invalid()
        if (!task.assetTrackingUntil || task.assetTrackingUntil <= now) throw new HTTPException(410, { message: 'RESULT_RECOVERY_EXPIRED' })
        await tx.update(s.modelTasks).set({ assetStatus: 'pending', reviewReason: null, nextQueryAt: now }).where(eq(s.modelTasks.id, id))
      } else {
        if (input.action === 'collect_debt' && (task.engineVersion >= 3 || task.billingStatus !== 'partially_collected')) invalid()
        if (input.action === 'adjust_charge' && (input.finalMicrosCny === undefined || !finalStates.has(task.status))) invalid()
        const final = input.action === 'collect_debt' ? requireRow(task.finalMicrosCny) : requireRow(input.finalMicrosCny)
        const wallet = await lockOrganizationWallet(tx, parseOrganizationId.parse(task.organizationId))
        const held = task.settledAt ? task.collectedMicrosCny : task.engineVersion >= 3 ? 0 : task.reservedMicrosCny
        const delta = task.engineVersion >= 3 ? held - final
          : final < held ? held - final : -Math.min(final - held, Math.max(0, wallet.balanceMicrosCny))
        const collected = held - delta
        const balance = wallet.balanceMicrosCny + delta
        await tx.insert(s.modelTaskLedger).values({ id: randomUUID(), taskId: id, organizationId: task.organizationId,
          accountId: task.accountId, runtimeId: task.runtimeId, eventKey: `resolution:${task.version}`, kind: 'adjustment',
          amountMicrosCny: delta, balanceAfterMicrosCny: balance, createdAt: now })
        await writeWalletBalance(tx, wallet, balance, now)
        await tx.update(s.modelTasks).set({ finalMicrosCny: final, collectedMicrosCny: collected,
          outstandingMicrosCny: final - collected, billingStatus: final > collected ? 'partially_collected' : 'settled',
          billingBasis: input.action === 'adjust_charge' ? 'audited_adjustment' : task.billingBasis, settledAt: now,
          reviewReason: final > collected ? 'wallet_overage_unpaid' : null }).where(eq(s.modelTasks.id, id))
      }
      await tx.insert(s.audit).values({ id: randomUUID(), organizationId: task.organizationId, actorId: c.get('actor').id,
        action: 'model_task.' + input.action, resourceId: id, detail: { evidence: input.evidence,
          previousVersion: task.version, previousFinalMicrosCny: task.finalMicrosCny,
          ...(input.finalMicrosCny === undefined ? {} : { finalMicrosCny: input.finalMicrosCny }) } })
      const [updated] = await tx.update(s.modelTasks).set({ version: sql`${s.modelTasks.version} + 1`, updatedAt: now }).where(eq(s.modelTasks.id, id)).returning()
      return safeTask(requireRow(updated))
    }))
  })
  const principal = async (c: import('hono').Context<ApiEnv>) => tenantOperation(c, (_tx, tenant) => Promise.resolve({ actor: tenant.actor, organizationId: tenant.organizationId }))
  app.get('/v1/organizations/:organizationId/model-tasks/models', async c => c.json(await taskService.catalog(await principal(c))))
  app.get('/v1/organizations/:organizationId/model-tasks', async c => c.json(await taskService.list(await principal(c))))
  app.get('/v1/organizations/:organizationId/model-tasks/page', async c => c.json(await taskService.listPage(await principal(c), c.req.query())))
  app.post('/v1/organizations/:organizationId/model-tasks/preview', async c => c.json(await taskService.preview(await principal(c), await c.req.json())))
  app.post('/v1/organizations/:organizationId/model-tasks', async c => c.json(await taskService.create(await principal(c), await c.req.json()), 202))
  app.get('/v1/organizations/:organizationId/model-tasks/:taskId', async c => c.json(await taskService.read(await principal(c), c.req.param('taskId'))))
  app.post('/v1/organizations/:organizationId/model-tasks/:taskId/cancel', async c => c.json(await taskService.recover(await principal(c), c.req.param('taskId'), 'cancel')))
  app.post('/v1/organizations/:organizationId/model-tasks/:taskId/retry-save', async c => c.json(await taskService.recover(await principal(c), c.req.param('taskId'), 'retry-save')))
  app.post('/v1/organizations/:organizationId/model-assets', async c => c.json(await taskService.uploadAsset(await principal(c), await c.req.json()), 201))
  app.get('/v1/organizations/:organizationId/model-assets/:assetId/access', async c => c.json(await taskService.assetAccess(await principal(c), c.req.param('assetId'))))
  return taskService
}
async function taskTransaction<T>(services: Services, organizationId: string, run: (tx: Transaction) => Promise<T>): Promise<T> {
  return services.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('enterprise.organization_id', ${organizationId}, true)`)
    return run(tx)
  })
}

async function processTask(services: Services, id: string, organizationId: string, parent: AbortSignal): Promise<void> {
  const lease = randomUUID()
  const claimed = await taskTransaction(services, organizationId, async (tx) => {
    await tx.execute(sql`SELECT id FROM enterprise.organization WHERE id = ${organizationId} FOR SHARE`)
    const [task] = await tx.select().from(s.modelTasks).where(eq(s.modelTasks.id, id)).for('update')
    const now = nowOf(services)
    if (!task || task.nextQueryAt > now || (task.queryLeaseUntil && task.queryLeaseUntil > now)) return undefined
    if (task.status === 'unknown' || (finalStates.has(task.status) && task.assetStatus !== 'pending'
      && !['awaiting_usage'].includes(task.billingStatus))) return undefined
    if ((task.status !== 'succeeded' && now.getTime() - task.createdAt.getTime() > services.config.modelTaskMaxAgeMs)
      || (task.assetStatus === 'pending' && task.assetTrackingUntil && task.assetTrackingUntil <= now)) {
      await tx.update(s.modelTasks).set({ status: finalStates.has(task.status) ? task.status : 'unknown',
        assetStatus: task.assetStatus === 'pending' ? 'review_required' : task.assetStatus,
        billingStatus: ['settled', 'partially_collected'].includes(task.billingStatus) ? task.billingStatus : 'review_required',
        reviewReason: 'task_deadline_exceeded', queryLeaseUntil: null, queryLeaseToken: null, updatedAt: now,
        nextQueryAt: new Date(now.getTime() + services.config.modelTaskMaxAgeMs) }).where(eq(s.modelTasks.id, id))
      return undefined
    }
    if (task.status === 'queued') {
      const [team] = await tx.select().from(s.organizations).where(eq(s.organizations.id, organizationId)).for('share')
      const [member] = await tx.select().from(s.memberships).where(and(eq(s.memberships.organizationId, organizationId),
        eq(s.memberships.accountId, task.accountId))).for('share')
      const [model] = task.modelId ? await tx.select().from(s.models).where(eq(s.models.id, task.modelId)) : []
      let admitted = team?.status === 'active' && member?.status === 'active' && model?.enabled
        && modelPublishedTo(model, organizationId)
      if (admitted && task.modelId) {
        try {
          const [user] = await tx.select().from(s.user).where(eq(s.user.id, task.accountId))
          if (!user) forbidden()
          const actor = { id: parseAccountId.parse(task.accountId), email: user.email }
          await requirePermission(tx, await enterTenant(tx, actor, parseOrganizationId.parse(organizationId)), 'model.use')
        }
        catch (error) {
          if (error instanceof HTTPException && [402, 403, 409].includes(error.status)) admitted = false
          else throw error
        }
      }
      if (task.pluginInstallationId) {
        const [installation] = await tx.select().from(s.pluginInstallations).where(eq(s.pluginInstallations.id,
          task.pluginInstallationId)).for('share')
        admitted = admitted && installation?.desiredState === 'enabled' && !installation.uninstalledAt
          && installation.releaseId === task.pluginReleaseId
      }
      if (!admitted || task.cancelRequestedAt) {
        const [cancelled] = await tx.update(s.modelTasks).set({ status: 'cancelled', assetStatus: 'not_applicable',
          error: { code: 'admission_revoked', message: 'Execution eligibility was revoked before submission', retryable: false },
          usage: { complete: true, items: [] }, updatedAt: now }).where(eq(s.modelTasks.id, id)).returning()
        await settleTask(tx, requireRow(cancelled), now)
        return undefined
      }
    }
    const [updated] = await tx.update(s.modelTasks).set({ queryLeaseToken: lease,
      queryLeaseUntil: new Date(now.getTime() + services.config.modelTaskLeaseMs),
      status: task.status === 'queued' ? 'submitting' : task.status, updatedAt: now,
    }).where(eq(s.modelTasks.id, id)).returning()
    return { task: requireRow(updated), submitting: task.status === 'queued', recoveredSubmission: task.status === 'submitting' }
  })
  if (!claimed) return
  const task = claimed.task
  let snapshot: Snapshot
  try { snapshot = snapshotOf(task) }
  catch {
    await taskTransaction(services, organizationId, tx => tx.update(s.modelTasks).set({ status: 'unknown',
      billingStatus: 'review_required', reviewReason: 'invalid_task_snapshot', queryLeaseToken: null, queryLeaseUntil: null })
      .where(and(eq(s.modelTasks.id, id), eq(s.modelTasks.queryLeaseToken, lease))))
    return
  }
  const controller = new AbortController()
  const signal = AbortSignal.any([parent, controller.signal])
  let heartbeat = Promise.resolve()
  const timer = setInterval(() => {
    heartbeat = heartbeat.then(async () => {
      const renewed = await taskTransaction(services, organizationId, tx => tx.update(s.modelTasks).set({
        queryLeaseUntil: new Date(nowOf(services).getTime() + services.config.modelTaskLeaseMs),
      }).where(and(eq(s.modelTasks.id, id), eq(s.modelTasks.queryLeaseToken, lease))).returning({ id: s.modelTasks.id }))
      if (!renewed.length) controller.abort()
    }).catch(() => { controller.abort() })
  }, Math.floor(services.config.modelTaskLeaseMs / 3))
  timer.unref()
  try {
    if (claimed.recoveredSubmission || (!claimed.submitting && !finalStates.has(task.status) && !task.providerTaskId)) {
      await taskTransaction(services, organizationId, tx => tx.update(s.modelTasks).set({ status: 'unknown', billingStatus: 'review_required',
        reviewReason: 'submit_uncertain', queryLeaseToken: null, queryLeaseUntil: null, updatedAt: nowOf(services) })
        .where(and(eq(s.modelTasks.id, id), eq(s.modelTasks.queryLeaseToken, lease))))
      return
    }
    if (task.cancelRequestedAt && !task.cancelAttemptedAt && task.providerTaskId && snapshot.configuration.cancel) {
      await taskTransaction(services, organizationId, tx => tx.update(s.modelTasks).set({ cancelAttemptedAt: nowOf(services) })
        .where(and(eq(s.modelTasks.id, id), eq(s.modelTasks.queryLeaseToken, lease))))
      try {
        await callAdapter(services, { ...snapshot, configuration: { ...snapshot.configuration,
          query: snapshot.configuration.cancel } }, task, false, task.input, signal)
      } catch { /* Cancellation is best effort; provider polling and settlement remain authoritative. */ }
    }
    let outcome: TaskOutcome
    if (finalStates.has(task.status) && task.providerResults && task.billingStatus !== 'awaiting_usage') {
      outcome = { status: task.status as TaskOutcome['status'], results: task.providerResults,
        ...(task.usage ? { usage: task.usage as TaskUsage } : {}) }
    } else {
      const input = { ...task.input }
      if (claimed.submitting) {
        const references = input.references as { assetId: string; kind: string }[] | undefined
        input.references = await Promise.all((references ?? []).map(async (reference) => {
          const [asset] = await taskTransaction(services, organizationId, tx => tx.select().from(s.modelAssets)
            .where(eq(s.modelAssets.id, reference.assetId)))
          if (!asset || !services.driveObjects) throw new Error('Reference asset is unavailable')
          return { kind: asset.kind,
            url: await services.driveObjects.createDownloadUrl(asset.objectKey, services.config.driveSignedUrlSeconds) }
        }))
      }
      outcome = await callAdapter(services, snapshot, task, claimed.submitting, input, signal)
    }
    const recorded = await taskTransaction(services, organizationId, async (tx) => {
      const [current] = await tx.select().from(s.modelTasks).where(and(eq(s.modelTasks.id, id), eq(s.modelTasks.queryLeaseToken, lease))).for('update')
      if (!current) return undefined
      if (finalStates.has(current.status) && outcome.status !== current.status) throw new Error('Provider terminal state changed')
      const now = nowOf(services)
      const [updated] = await tx.update(s.modelTasks).set({ status: outcome.status,
        providerTaskId: outcome.providerTaskId ?? current.providerTaskId,
        providerResults: outcome.results, usage: outcome.usage ?? current.usage, error: outcome.error ?? null,
        assetTrackingUntil: outcome.status === 'succeeded' ? current.assetTrackingUntil ?? new Date(now.getTime() + services.config.modelTaskMaxAgeMs) : current.assetTrackingUntil,
        assetStatus: outcome.status === 'succeeded' ? 'pending' : finalStates.has(outcome.status) ? 'not_applicable' : 'pending',
        nextQueryAt: new Date(now.getTime() + snapshot.configuration.pollIntervalMs), lastQueriedAt: now,
        updatedAt: now, version: current.version + 1 }).where(eq(s.modelTasks.id, id)).returning()
      return settleTask(tx, requireRow(updated), now)
    })
    if (!recorded) return
    if (outcome.status === 'succeeded') {
      const results: Record<string, unknown>[] = []
      for (const [index, result] of outcome.results.entries()) {
        if (result.kind === 'embedding' || result.kind === 'transcript') { results.push(result); continue }
        const [existing] = await taskTransaction(services, organizationId, tx => tx.select().from(s.modelAssets)
          .where(and(eq(s.modelAssets.taskId, id), eq(s.modelAssets.index, index))))
        let asset = existing
        if (!asset) {
          if (!services.driveObjects) throw new Error('Asset storage is unavailable')
          const downloaded = await (services.assetDownload ?? downloadTaskAsset)(String(result.url), services.config.modelTaskAssetMaxBytes,
            AbortSignal.any([signal, AbortSignal.timeout(snapshot.configuration.timeoutMs)]))
          if (!downloaded.mimeType.startsWith(String(result.kind) + '/')) throw new Error('Provider media kind does not match output')
          const assetId = randomUUID()
          const objectKey = `model-assets/${organizationId}/${id}/${index}/${assetId}`
          await services.driveObjects.put(objectKey, downloaded.bytes, downloaded.mimeType)
          asset = await taskTransaction(services, organizationId, async (tx) => {
            const [owned] = await tx.select({ id: s.modelTasks.id }).from(s.modelTasks).where(and(eq(s.modelTasks.id, id), eq(s.modelTasks.queryLeaseToken, lease))).for('update')
            if (!owned) throw new Error('Task lease expired during asset storage')
            const [saved] = await tx.insert(s.modelAssets).values({ id: assetId, organizationId, accountId: task.accountId,
              pluginInstallationId: task.pluginInstallationId, taskId: id, index, kind: String(result.kind),
              expiresAt: new Date(nowOf(services).getTime() + services.config.modelTaskAssetRetentionSeconds * 1000), objectKey,
              mimeType: downloaded.mimeType, byteLength: downloaded.bytes.byteLength, checksum: downloaded.checksum }).returning()
            return requireRow(saved)
          })
        }
        results.push({ kind: asset.kind, index, assetId: asset.id, mimeType: asset.mimeType,
          byteLength: asset.byteLength, checksum: asset.checksum, recoverableUntil: asset.expiresAt?.toISOString() ?? null })
      }
      await taskTransaction(services, organizationId, tx => tx.update(s.modelTasks).set({ results, assetStatus: 'ready',
        queryLeaseToken: null, queryLeaseUntil: null, updatedAt: nowOf(services) })
        .where(and(eq(s.modelTasks.id, id), eq(s.modelTasks.queryLeaseToken, lease))))
    } else {
      await taskTransaction(services, organizationId, tx => tx.update(s.modelTasks).set({ queryLeaseToken: null, queryLeaseUntil: null })
        .where(and(eq(s.modelTasks.id, id), eq(s.modelTasks.queryLeaseToken, lease))))
    }
  } catch (error) {
    await taskTransaction(services, organizationId, async (tx) => {
      const [current] = await tx.select().from(s.modelTasks).where(and(eq(s.modelTasks.id, id), eq(s.modelTasks.queryLeaseToken, lease))).for('update')
      if (!current) return
      const uncertain = current.status === 'submitting'
      const permanent = error instanceof Error && 'retryable' in error && error.retryable === false
      await tx.update(s.modelTasks).set({
        status: uncertain || (permanent && !finalStates.has(current.status)) ? 'unknown' : current.status, billingStatus: uncertain || permanent ? 'review_required' : current.billingStatus,
        reviewReason: uncertain ? 'submit_uncertain' : current.status === 'succeeded' ? 'asset_download_pending' : 'query_failed',
        error: { code: error instanceof ProviderTaskHttpError ? `provider_http_${error.statusCode}`
          : uncertain ? 'submit_uncertain' : current.status === 'succeeded' ? 'asset_download_pending' : 'query_failed',
        message: error instanceof ProviderTaskHttpError ? error.message : 'Provider operation requires retry or review',
        retryable: !uncertain && !permanent },
        nextQueryAt: new Date(nowOf(services).getTime() + Math.min(services.config.modelTaskRetryMaxMs,
          snapshot.configuration.pollIntervalMs * 2 ** Math.min(current.version, 5))),
        queryLeaseToken: null, queryLeaseUntil: null, updatedAt: nowOf(services), version: current.version + 1,
      }).where(eq(s.modelTasks.id, id))
    })
  } finally {
    clearInterval(timer)
    await heartbeat
  }
}

async function scanDue(services: Services, signal: AbortSignal = new AbortController().signal): Promise<number> {
  signal.throwIfAborted()
  const now = nowOf(services)
  const tasks = await services.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
    return tx.select({ id: s.modelTasks.id, organizationId: s.modelTasks.organizationId }).from(s.modelTasks)
      .where(and(lte(s.modelTasks.nextQueryAt, now), or(isNull(s.modelTasks.queryLeaseUntil), lte(s.modelTasks.queryLeaseUntil, now)),
        or(eq(s.modelTasks.status, 'queued'), eq(s.modelTasks.status, 'submitting'), eq(s.modelTasks.status, 'processing'),
          eq(s.modelTasks.billingStatus, 'awaiting_usage'), and(eq(s.modelTasks.status, 'succeeded'), eq(s.modelTasks.assetStatus, 'pending')))))
      .orderBy(asc(s.modelTasks.nextQueryAt)).limit(services.config.modelTaskConcurrency)
  })
  await Promise.all(tasks.map(task => processTask(services, task.id, task.organizationId, signal)))
  return tasks.length
}
