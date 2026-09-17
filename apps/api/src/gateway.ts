/** Authenticated model relay; the upstream request is otherwise opaque to the gateway. */
import { createHash, randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import type { IncomingMessage } from 'node:http'
import type { LookupAddress, LookupOptions } from 'node:dns'
import type { Context, Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { HTTPException } from 'hono/http-exception'
import { stream } from 'hono/streaming'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { inspectFileMediaType } from '@deepseek-ai/dsh-attachment'
import * as s from './schema.ts'
import { modelCall, modelFileReceipt, modelFileUpload, organizationId, resourceId } from './contracts.ts'
import { digest, decrypt, forbidden } from './security.ts'
import { identify, selectOrganization } from './database.ts'
import { createModelUsageObserver, type ObservedModelUsage } from './model-stream.ts'
import type { ApiEnv, Services, TenantOperation } from './application.ts'
import type { AccountId, OrganizationId, ResourceId } from './contracts.ts'

const blocked = new BlockList()
for (const [address, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(address, bits, 'ipv4')

interface InspectedMediaInput {
  readonly bytes: number[]
  readonly fileIds: Set<string>
  readonly modalities: Set<'image' | 'video' | 'audio' | 'document'>
}

function base64Bytes(value: string): number | undefined {
  const match = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.exec(value)
  if (!match) return undefined
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(value.length * 3 / 4) - padding)
}

function inspectMediaInput(value: unknown): InspectedMediaInput {
  const sizes: number[] = []
  const fileIds = new Set<string>()
  const modalities = new Set<'image' | 'video' | 'audio' | 'document'>()
  const inspectLocation = (location: unknown, keys: readonly string[]): void => {
    if (!location || typeof location !== 'object') throw new HTTPException(400, { message: 'Model media input is malformed' })
    const record = location as Record<string, unknown>
    if (typeof record.file_id === 'string' && record.file_id.length > 0 && record.file_id.length <= 512) {
      fileIds.add(record.file_id)
      return
    }
    for (const key of keys) {
      const candidate = record[key]
      if (typeof candidate !== 'string') continue
      if (key === 'data') {
        const bytes = base64Bytes(candidate)
        if (bytes === undefined) throw new HTTPException(400, { message: 'Model media Base64 is malformed' })
        sizes.push(bytes)
        return
      }
      const match = /^data:[^;,]+;base64,(.*)$/.exec(candidate)
      const bytes = match?.[1] === undefined ? undefined : base64Bytes(match[1])
      if (bytes === undefined) throw new HTTPException(400, { message: 'Permanent media URLs are not permitted' })
      sizes.push(bytes)
      return
    }
    throw new HTTPException(400, { message: 'Model media input has no supported file reference' })
  }
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      const match = /^data:[^;,]+;base64,([A-Za-z0-9+/]*={0,2})$/.exec(item)
      if (match) {
        const encoded = match[1] ?? ''
        const bytes = base64Bytes(encoded)
        if (bytes !== undefined) sizes.push(bytes)
      }
      return
    }
    if (Array.isArray(item)) { for (const child of item) visit(child); return }
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      if (record.type === 'image_url') { modalities.add('image'); inspectLocation(record.image_url, ['url']); return }
      if (record.type === 'video_url') { modalities.add('video'); inspectLocation(record.video_url, ['url']); return }
      if (record.type === 'input_image') { modalities.add('image'); inspectLocation(record, ['image_url']); return }
      if (record.type === 'input_video') { modalities.add('video'); inspectLocation(record, ['video_url']); return }
      if (record.type === 'input_audio') {
        modalities.add('audio')
        inspectLocation(record.input_audio ?? record, ['audio_url', 'data'])
        return
      }
      if (record.type === 'input_file') { modalities.add('document'); inspectLocation(record, ['file_data']); return }
      if (record.type === 'file') { modalities.add('document'); inspectLocation(record.file, ['file_data']); return }
      for (const child of Object.values(item)) visit(child)
    }
  }
  visit(value)
  return { bytes: sizes, fileIds, modalities }
}

/** Accept public HTTPS model endpoints; connection-time DNS separately requires public IPv4. */
export function modelUrl(base: string, path?: string): URL {
  const url = new URL(base)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    isIP(url.hostname) !== 0
  ) {
    throw new HTTPException(400, { message: 'Model endpoint is not permitted' })
  }
  if (path !== undefined) {
    if (!/^\/(?!\/)/.test(path) || path.length > 4096) throw new HTTPException(400, { message: 'Model path is not permitted' })
    const prefix = url.pathname.replace(/\/$/, '')
    const target = new URL(prefix + path, url.origin)
    url.pathname = target.pathname
    url.search = target.search
  }
  return url
}

/** Upstream transport. The body and URL are already the caller's requested values. */
export type ModelTransport = (
  url: URL,
  body: string | Uint8Array,
  secret: string,
  signal: AbortSignal,
  method?: string,
  headers?: Record<string, string>,
) => Promise<IncomingMessage>

/** Ephemeral provider file generation retained only in the API process. */
export interface ProviderFileReceipt {
  readonly fileId: string
  readonly expiresAt: number
  readonly modelId: string
}

/** Provider-file maintenance owned by the API plugin lifecycle. */
export interface GatewayMaintenance {
  cleanupExpired(signal?: AbortSignal): Promise<number>
}

/** One process-local provider upload shared by authenticated gateway requests. */
export interface SharedProviderUpload {
  readonly controller: AbortController
  promise: Promise<ProviderFileReceipt>
  settled: boolean
  waiters: number
  uploadedClaimed: boolean
}

/** One waiter's receipt and exclusive physical-upload usage attribution. */
export interface ProviderUploadWait {
  readonly receipt: ProviderFileReceipt
  readonly uploaded: boolean
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Provider file upload was cancelled.', { cause: signal.reason })
}

/**
 * Wait for a shared provider upload without allowing one cancelled waiter to
 * cancel work still owned by another waiter.
 * @param operation - Shared upload state for one provider/account/model/digest key.
 * @param signal - Cancellation owned by this waiter.
 * @returns The provider receipt and whether this waiter owns upload usage.
 */
export function waitForProviderUpload(operation: SharedProviderUpload, signal: AbortSignal): Promise<ProviderUploadWait> {
  signal.throwIfAborted()
  operation.waiters += 1
  let released = false
  const release = (cancelled = false): void => {
    if (released) return
    released = true
    operation.waiters -= 1
    if (cancelled && operation.waiters === 0 && !operation.settled) operation.controller.abort(abortError(signal))
  }
  const resultForWaiter = (receipt: ProviderFileReceipt): ProviderUploadWait => {
    if (operation.uploadedClaimed) return { receipt, uploaded: false }
    operation.uploadedClaimed = true
    return { receipt, uploaded: true }
  }
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      release(true)
      reject(abortError(signal))
    }
    signal.addEventListener('abort', abort, { once: true })
    void operation.promise.then((value) => {
      if (released) return
      signal.removeEventListener('abort', abort)
      release()
      resolve(resultForWaiter(value))
    }, (error: unknown) => {
      signal.removeEventListener('abort', abort)
      release()
      reject(error instanceof Error
        ? error
        : new Error('Provider file upload failed with a non-Error reason.', { cause: error }))
    })
  })
}

async function responseJson(response: IncomingMessage, signal: AbortSignal, maxBytes = 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  const abort = (): void => { response.destroy(abortError(signal)) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    for await (const chunk of response) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
      bytes += data.byteLength
      if (bytes > maxBytes) throw new HTTPException(502, { message: 'Provider Files API response exceeds the configured bound' })
      chunks.push(data)
    }
  } finally {
    signal.removeEventListener('abort', abort)
    response.destroy()
  }
  signal.throwIfAborted()
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new HTTPException(502, { message: 'Provider Files API returned invalid JSON' })
  }
}

function providerFile(value: unknown): { id: string; status: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HTTPException(502, { message: 'Provider Files API returned an invalid file object' })
  }
  const file = value as { id?: unknown; status?: unknown }
  if (typeof file.id !== 'string' || file.id.length === 0 || file.id.length > 512
    || typeof file.status !== 'string' || file.status.length === 0) {
    throw new HTTPException(502, { message: 'Provider Files API returned an invalid file object' })
  }
  return { id: file.id, status: file.status }
}

function canonicalBase64(value: string): Uint8Array {
  const data = Buffer.from(value, 'base64')
  if (data.toString('base64') !== value) throw new HTTPException(400, { message: 'File data must use canonical Base64' })
  return data
}

function multipartFile(data: Uint8Array, mediaType: string, name: string): { body: Uint8Array; contentType: string } {
  const boundary = `dsh-${randomUUID()}`
  const filename = encodeURIComponent(name).replace(/'/gu, '%27')
  const head = Buffer.from([
    `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nuser_data\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename*=UTF-8''${filename}\r\n`,
    `Content-Type: ${mediaType}\r\n\r\n`,
  ].join(''), 'utf8')
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  return {
    body: Buffer.concat([head, Buffer.from(data), tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    const abort = (): void => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void

/** IPv4 resolver used by the model transport and replaceable by focused tests. */
export type ModelAddressResolver = (
  hostname: string,
  options: { family: 4; all: true },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void

const systemModelResolver: ModelAddressResolver = (hostname, options, callback) => {
  lookup(hostname, options, callback)
}

/**
 * Build a Node connector lookup that rejects the complete DNS answer set when any address is not public IPv4.
 *
 * @param resolver - system resolver, replaceable by focused tests.
 * @returns a lookup callback compatible with both single-address and `all: true` callers.
 */
export function createModelLookup(resolver: ModelAddressResolver = systemModelResolver): (
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
) => void {
  return (hostname, options, callback) => {
    resolver(hostname, { family: 4, all: true }, (error, addresses) => {
      if (error) {
        callback(error, options.all === true ? [] : '', 4)
        return
      }
      if (addresses.length === 0) {
        const missing = Object.assign(new Error('Model DNS resolved to no IPv4 addresses'), {
          code: 'ENOTFOUND',
          hostname,
        })
        callback(missing, options.all === true ? [] : '', 4)
        return
      }
      if (addresses.some(address => address.family !== 4 || isIP(address.address) !== 4)) {
        callback(Object.assign(new Error('Model DNS returned an invalid IPv4 address'), {
          code: 'ERR_MODEL_DNS_INVALID_ADDRESS',
        }), options.all === true ? [] : '', 4)
        return
      }
      if (addresses.some(address => blocked.check(address.address, 'ipv4'))) {
        callback(Object.assign(new Error('Model DNS resolved to a forbidden address'), {
          code: 'ERR_MODEL_DNS_FORBIDDEN',
        }), options.all === true ? [] : '', 4)
        return
      }
      if (options.all === true) {
        callback(null, addresses.map(address => ({ ...address })))
        return
      }
      const [selected] = addresses
      if (selected === undefined) {
        callback(Object.assign(new Error('Model DNS answer set became empty'), {
          code: 'ERR_MODEL_DNS_EMPTY',
        }), '', 4)
        return
      }
      callback(null, selected.address, 4)
    })
  }
}

interface ModelFailureTarget {
  readonly modelId: string
  readonly upstreamOrigin: string
  readonly path: string
  readonly method: string
}

type ModelFailureReporter = (message: string, details: unknown) => void

/**
 * Log transport failures without request headers, credentials, query parameters, or body content.
 *
 * @param target - non-sensitive upstream request identity.
 * @param error - transport failure to summarize.
 * @param reporter - diagnostic sink, replaceable by focused tests.
 */
export function reportModelFailure(
  target: ModelFailureTarget,
  error: unknown,
  reporter: ModelFailureReporter = console.error,
): void {
  const failure = error instanceof Error
    ? {
      name: error.name,
      code: typeof (error as NodeJS.ErrnoException).code === 'string'
        ? (error as NodeJS.ErrnoException).code
        : undefined,
    }
    : { name: 'NonError' }
  reporter('[enterprise-gateway] upstream request failed', { ...target, error: failure })
}

/**
 * Log an upstream HTTP failure without response content or request secrets.
 *
 * @param target - non-sensitive upstream request identity.
 * @param status - upstream HTTP status.
 * @param reporter - diagnostic sink, replaceable by focused tests.
 */
export function reportModelStatus(
  target: ModelFailureTarget,
  status: number,
  reporter: ModelFailureReporter = console.error,
): void {
  reporter('[enterprise-gateway] upstream returned an error status', { ...target, status })
}

/** Log post-response metering failures without changing the relayed response.
 * @param target - non-sensitive upstream request identity.
 * @param error - metering failure to summarize.
 * @param reporter - diagnostic sink, replaceable by focused tests.
 */
export function reportModelUsageFailure(
  target: ModelFailureTarget,
  error: unknown,
  reporter: ModelFailureReporter = console.error,
): void {
  const failure = error instanceof Error
    ? {
      name: error.name,
      code: typeof (error as NodeJS.ErrnoException).code === 'string'
        ? (error as NodeJS.ErrnoException).code
        : 'ERR_MODEL_USAGE_PERSISTENCE',
    }
    : { name: 'NonError', code: 'ERR_MODEL_USAGE_PERSISTENCE' }
  reporter('[enterprise-gateway] usage persistence failed', { ...target, error: failure })
}

interface UsageSettlement {
  readonly id: ResourceId
  readonly organizationId: OrganizationId
  readonly accountId: AccountId
  readonly runtimeId: ResourceId
  readonly modelId: ResourceId
  readonly purpose: z.infer<typeof modelCall>['purpose']
  readonly idempotencyKey: string
  readonly inputPriceMicrosCnyPerMillion: number
  readonly cachedInputPriceMicrosCnyPerMillion: number
  readonly outputPriceMicrosCnyPerMillion: number
  readonly requestStartedAt: Date
  readonly durationMs: number
  readonly upstreamRequestId?: string
  readonly usage: ObservedModelUsage
  readonly protocol: 'openai-completions' | 'openai-responses'
  readonly inputModalities: readonly ('text' | 'image' | 'video' | 'audio' | 'document')[]
  readonly fileUsage: { readonly uploads: number; readonly uploadedBytes: number; readonly failures: number }
}

type UsageClaim = Omit<UsageSettlement, 'id' | 'durationMs' | 'upstreamRequestId' | 'usage'>

interface UsageCosts {
  readonly uncachedInputTokens: number
  readonly inputCostMicrosCny: number
  readonly cachedInputCostMicrosCny: number
  readonly outputCostMicrosCny: number
  readonly totalCostMicrosCny: number
}

const roundedMicrosCny = (tokens: number, priceMicrosCnyPerMillion: number): bigint =>
  (BigInt(tokens) * BigInt(priceMicrosCnyPerMillion) + 500_000n) / 1_000_000n

/** Calculate the CNY cost components saved beside one provider usage report. */
export function calculateUsageCosts(
  usage: ObservedModelUsage,
  prices: Pick<UsageSettlement,
    'inputPriceMicrosCnyPerMillion' | 'cachedInputPriceMicrosCnyPerMillion' | 'outputPriceMicrosCnyPerMillion'>,
): UsageCosts {
  const uncachedInputTokens = usage.promptTokens - usage.cachedPromptTokens
  const input = roundedMicrosCny(uncachedInputTokens, prices.inputPriceMicrosCnyPerMillion)
  const cached = roundedMicrosCny(usage.cachedPromptTokens, prices.cachedInputPriceMicrosCnyPerMillion)
  const output = roundedMicrosCny(usage.completionTokens, prices.outputPriceMicrosCnyPerMillion)
  const total = input + cached + output
  if ([input, cached, output, total].some(value => value > BigInt(Number.MAX_SAFE_INTEGER))) {
    throw Object.assign(new Error('Calculated model usage cost is outside the supported range'), {
      code: 'ERR_MODEL_USAGE_COST_RANGE',
    })
  }
  return {
    uncachedInputTokens,
    inputCostMicrosCny: Number(input),
    cachedInputCostMicrosCny: Number(cached),
    outputCostMicrosCny: Number(output),
    totalCostMicrosCny: Number(total),
  }
}

async function claimModelUsage(db: Services['db'], claim: UsageClaim): Promise<ResourceId> {
  const id = resourceId.parse(randomUUID())
  const inserted = await db.transaction(async (tx) => {
    await selectOrganization(tx, claim.organizationId)
    return tx.insert(s.usage).values({
      id,
      organizationId: claim.organizationId,
      accountId: claim.accountId,
      runtimeId: claim.runtimeId,
      modelId: claim.modelId,
      purpose: claim.purpose,
      reservedMicros: 0,
      status: 'pending_reconciliation',
      idempotencyKey: claim.idempotencyKey,
      requestStartedAt: claim.requestStartedAt,
      protocol: claim.protocol,
      inputModalities: [...claim.inputModalities],
      fileUploadCount: claim.fileUsage.uploads,
      uploadedBytes: claim.fileUsage.uploadedBytes,
      fileUploadFailures: claim.fileUsage.failures,
      reconciliationReason: 'awaiting_provider_usage',
      pricingVersion: 1,
      inputPriceMicrosCnyPerMillion: claim.inputPriceMicrosCnyPerMillion,
      cachedInputPriceMicrosCnyPerMillion: claim.cachedInputPriceMicrosCnyPerMillion,
      outputPriceMicrosCnyPerMillion: claim.outputPriceMicrosCnyPerMillion,
    }).onConflictDoNothing().returning({ id: s.usage.id })
  })
  if (inserted.length === 0) {
    throw new HTTPException(409, { message: 'Idempotency key already used' })
  }
  return id
}

async function discardModelUsageClaim(db: Services['db'], organizationId: OrganizationId, id: ResourceId): Promise<void> {
  await db.transaction(async (tx) => {
    await selectOrganization(tx, organizationId)
    await tx.delete(s.usage).where(and(eq(s.usage.id, id), eq(s.usage.status, 'pending_reconciliation')))
  })
}

async function markModelUsagePending(
  db: Services['db'],
  organizationId: OrganizationId,
  id: ResourceId,
  reconciliationReason: string,
  failureReason?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await selectOrganization(tx, organizationId)
    await tx.update(s.usage).set({ reconciliationReason, failureReason: failureReason ?? null })
      .where(and(eq(s.usage.id, id), eq(s.usage.status, 'pending_reconciliation')))
  })
}

async function recordModelUsage(db: Services['db'], settlement: UsageSettlement): Promise<void> {
  const costs = calculateUsageCosts(settlement.usage, settlement)
  await db.transaction(async (tx) => {
    await selectOrganization(tx, settlement.organizationId)
    const updated = await tx.update(s.usage).set({
      inputTokens: settlement.usage.promptTokens,
      cachedInputTokens: settlement.usage.cachedPromptTokens,
      uncachedInputTokens: costs.uncachedInputTokens,
      outputTokens: settlement.usage.completionTokens,
      reasoningTokens: settlement.usage.reasoningTokens ?? 0,
      totalTokens: settlement.usage.promptTokens + settlement.usage.completionTokens,
      currency: 'CNY',
      pricingVersion: 1,
      inputPriceMicrosCnyPerMillion: settlement.inputPriceMicrosCnyPerMillion,
      cachedInputPriceMicrosCnyPerMillion: settlement.cachedInputPriceMicrosCnyPerMillion,
      outputPriceMicrosCnyPerMillion: settlement.outputPriceMicrosCnyPerMillion,
      inputCostMicrosCny: costs.inputCostMicrosCny,
      cachedInputCostMicrosCny: costs.cachedInputCostMicrosCny,
      outputCostMicrosCny: costs.outputCostMicrosCny,
      totalCostMicrosCny: costs.totalCostMicrosCny,
      requestStartedAt: settlement.requestStartedAt,
      durationMs: settlement.durationMs,
      upstreamRequestId: settlement.upstreamRequestId,
      status: 'settled',
      reconciliationReason: null,
      failureReason: null,
      settledAt: new Date(),
    }).where(and(eq(s.usage.id, settlement.id), eq(s.usage.status, 'pending_reconciliation')))
      .returning({ id: s.usage.id })
    if (updated.length === 0) {
      throw Object.assign(new Error('Model usage claim is unavailable for settlement'), {
        code: 'ERR_MODEL_USAGE_CLAIM_MISSING',
      })
    }
  })
}

/** Send one request through the production HTTPS transport. */
export const openModel: ModelTransport = (url, body, secret, signal, method = 'POST', forwarded = {}) => new Promise((resolve, reject) => {
  const headers = Object.fromEntries(Object.entries(forwarded).filter(([name]) =>
    !['authorization', 'host', 'content-length', 'connection', 'transfer-encoding', 'content-type'].includes(name.toLowerCase())))
  const request = httpsRequest(url, {
    method, signal,
    headers: { ...headers, 'Content-Type': forwarded['Content-Type'] ?? forwarded['content-type'] ?? 'application/json', Authorization: `Bearer ${secret}`, 'User-Agent': 'deepseek-harness-enterprise/0.1.0' },
    lookup: createModelLookup(),
  }, resolve)
  request.once('error', reject)
  request.end(body)
})

/** Mount authenticated model calls without model-specific authorization or request rewriting. */
export function mountGateway(
  app: Hono<ApiEnv>,
  { db, config, modelTransport = openModel, now = Date.now }: Services,
  _tenantOperation: TenantOperation,
): GatewayMaintenance {
  const fileCache = new Map<string, ProviderFileReceipt>()
  const inflightFiles = new Map<string, SharedProviderUpload>()

  const resolveRuntimeModel = async (
    c: Context<ApiEnv>,
    organization: OrganizationId,
    input: { runtimeId: ResourceId; modelId: ResourceId; policyRevision?: number },
    token: string,
  ): Promise<typeof s.models.$inferSelect> => db.transaction(async (tx) => {
    const actor = c.get('actor')
    await identify(tx, actor.id, actor.email)
    await selectOrganization(tx, organization)
    const [runtime] = await tx
      .select()
      .from(s.runtimes)
      .where(and(
        eq(s.runtimes.id, input.runtimeId),
        eq(s.runtimes.organizationId, organization),
        eq(s.runtimes.accountId, actor.id),
        eq(s.runtimes.tokenHash, digest(token)),
        isNull(s.runtimes.revokedAt),
        gt(s.runtimes.leaseUntil, new Date()),
      ))
    if (!runtime) forbidden()
    if (input.policyRevision !== undefined) {
      const [tenant] = await tx.select({ policyRevision: s.organizations.policyRevision })
        .from(s.organizations).where(eq(s.organizations.id, organization))
      if (tenant?.policyRevision !== input.policyRevision) {
        throw new HTTPException(409, { message: 'Runtime model policy is stale' })
      }
    }
    const [model] = await tx.select().from(s.models).where(eq(s.models.id, input.modelId))
    if (!model?.enabled) forbidden()
    modelUrl(model.baseUrl)
    return model
  })

  const uploadProviderFile = async (
    model: typeof s.models.$inferSelect,
    data: Uint8Array,
    mediaType: string,
    name: string,
    signal: AbortSignal,
  ): Promise<ProviderFileReceipt> => {
    const secret = decrypt(model.secret, config.encryptionKey, model.id)
    const form = multipartFile(data, mediaType, name)
    const upload = await modelTransport(
      modelUrl(model.baseUrl, '/files'),
      form.body,
      secret,
      signal,
      'POST',
      { 'Content-Type': form.contentType },
    )
    if ((upload.statusCode ?? 500) < 200 || (upload.statusCode ?? 500) >= 300) {
      upload.destroy()
      throw new HTTPException(502, { message: 'Provider Files API rejected the upload' })
    }
    let file = providerFile(await responseJson(upload, signal))
    for (let attempt = 0; file.status === 'processing' && attempt < config.modelFilePollAttempts; attempt += 1) {
      await delay(config.modelFilePollIntervalMs, signal)
      const retrieved = await modelTransport(
        modelUrl(model.baseUrl, `/files/${encodeURIComponent(file.id)}`),
        '',
        secret,
        signal,
        'GET',
      )
      if ((retrieved.statusCode ?? 500) < 200 || (retrieved.statusCode ?? 500) >= 300) {
        retrieved.destroy()
        throw new HTTPException(502, { message: 'Provider Files API could not retrieve the uploaded file' })
      }
      const next = providerFile(await responseJson(retrieved, signal))
      if (next.id !== file.id) throw new HTTPException(502, { message: 'Provider Files API changed the uploaded file identity' })
      file = next
    }
    if (file.status === 'processing') throw new HTTPException(504, { message: 'Provider file processing timed out' })
    if (!['active', 'processed', 'succeeded', 'success'].includes(file.status)) {
      throw new HTTPException(502, { message: 'Provider file processing failed' })
    }
    return { fileId: file.id, expiresAt: now() + model.filesTtlSeconds * 1_000, modelId: model.id }
  }

  app.post('/v1/organizations/:organizationId/model-files', async (c) => {
    const input = modelFileUpload.parse(await c.req.json())
    const organization = organizationId.parse(c.req.param('organizationId'))
    const token = z.string().min(32).max(200).parse(c.req.header('Authorization')?.replace(/^Bearer /, ''))
    const model = await resolveRuntimeModel(c, organization, input, token)
    if (model.fileInputPolicy !== 'provider-files') {
      throw new HTTPException(400, { message: 'The selected model does not use the provider Files API' })
    }
    const data = canonicalBase64(input.data)
    if (data.byteLength > model.maxFileBytes) throw new HTTPException(413, { message: 'File exceeds the selected model limit' })
    const sha256 = createHash('sha256').update(data).digest('hex')
    if (input.attachmentId !== `sha256:${sha256}`) throw new HTTPException(400, { message: 'File digest does not match its attachment reference' })
    const verifiedMediaType = inspectFileMediaType(data, input.mediaType, input.name)
    if (verifiedMediaType !== input.mediaType.toLowerCase()) {
      throw new HTTPException(400, { message: 'File MIME type is not eligible for native model input' })
    }
    const key = [organization, c.get('actor').id, model.id, input.attachmentId].join('\0')
    let cached = fileCache.get(key)
    if (cached !== undefined && input.replaceFileId === cached.fileId) {
      fileCache.delete(key)
      cached = undefined
    }
    if (cached !== undefined && cached.expiresAt > now()) {
      return c.json(modelFileReceipt.parse({ fileId: cached.fileId, expiresAt: new Date(cached.expiresAt).toISOString(), uploaded: false }))
    }
    fileCache.delete(key)
    let operation = inflightFiles.get(key)
    if (operation?.controller.signal.aborted) {
      inflightFiles.delete(key)
      operation = undefined
    }
    if (operation === undefined) {
      const controller = new AbortController()
      const shared: SharedProviderUpload = {
        controller,
        settled: false,
        waiters: 0,
        uploadedClaimed: false,
        promise: undefined as never,
      }
      shared.promise = uploadProviderFile(model, data, verifiedMediaType, input.name, controller.signal)
        .then((receipt) => {
          shared.settled = true
          fileCache.set(key, receipt)
          return receipt
        }, (error: unknown) => {
          shared.settled = true
          throw error
        })
      inflightFiles.set(key, shared)
      void shared.promise.finally(() => {
        if (inflightFiles.get(key) === shared) inflightFiles.delete(key)
      }).catch(() => {})
      operation = shared
    }
    const { receipt, uploaded } = await waitForProviderUpload(operation, c.req.raw.signal)
    return c.json(modelFileReceipt.parse({ fileId: receipt.fileId, expiresAt: new Date(receipt.expiresAt).toISOString(), uploaded }))
  })

  app.post('/v1/organizations/:organizationId/model-call', async (c) => {
    const requestStartedAt = new Date()
    const input = modelCall.parse(await c.req.json())
    const organization = organizationId.parse(c.req.param('organizationId'))
    const suppliedIdempotencyKey = c.req.header('Idempotency-Key')
    const idempotencyKey = suppliedIdempotencyKey === undefined
      ? randomUUID()
      : z.string().min(16).max(128).parse(suppliedIdempotencyKey)
    const bodyModel = typeof input.body?.model === 'string' ? input.body.model : undefined
    const requestedModel = input.model ?? input.modelId ?? (() => {
      try { return bodyModel === undefined ? undefined : resourceId.parse(bodyModel) } catch { return undefined }
    })()
    if (!requestedModel) forbidden()
    const token = z
      .string()
      .min(32)
      .max(200)
      .parse(c.req.header('Authorization')?.replace(/^Bearer /, ''))
    const actor = c.get('actor')
    const model = await resolveRuntimeModel(c, organization, {
      runtimeId: input.runtimeId,
      modelId: requestedModel,
      ...(input.policyRevision === undefined ? {} : { policyRevision: input.policyRevision }),
    }, token)
    const expectedPath = model.protocol === 'openai-responses' ? '/responses'
      : model.protocol === 'openai-completions' ? '/chat/completions' : undefined
    if (expectedPath === undefined || (input.path !== undefined && input.path !== expectedPath)) {
      throw new HTTPException(400, { message: 'The selected model protocol does not allow this endpoint' })
    }
    if (input.inputModalities.some(modality => !model.inputModalities.includes(modality))) {
      throw new HTTPException(400, { message: 'The selected model does not support every declared input modality' })
    }
    if ((input.fileUsage.uploads > 0 || input.fileUsage.uploadedBytes > 0)
      && model.fileInputPolicy !== 'provider-files') {
      throw new HTTPException(400, { message: 'File upload usage requires the provider Files API policy' })
    }
    if (input.fileUsage.uploadedBytes > model.maxRequestBytes) {
      throw new HTTPException(413, { message: 'File upload usage exceeds the selected model limit' })
    }
    const url = modelUrl(model.baseUrl, expectedPath)
    const failureTarget = {
      modelId: model.id,
      upstreamOrigin: url.origin,
      path: url.pathname,
      method: input.method,
    }
    const usageClaimId = await claimModelUsage(db, {
      organizationId: organization,
      accountId: actor.id,
      runtimeId: input.runtimeId,
      modelId: resourceId.parse(model.id),
      purpose: input.purpose,
      idempotencyKey,
      inputPriceMicrosCnyPerMillion: model.inputPriceMicrosCnyPerMillion,
      cachedInputPriceMicrosCnyPerMillion: model.cachedInputPriceMicrosCnyPerMillion,
      outputPriceMicrosCnyPerMillion: model.outputPriceMicrosCnyPerMillion,
      requestStartedAt,
      protocol: model.protocol as 'openai-completions' | 'openai-responses',
      inputModalities: input.inputModalities,
      fileUsage: input.fileUsage,
    })
    const discardClaim = async () => {
      try {
        await discardModelUsageClaim(db, organization, usageClaimId)
      } catch (error) {
        reportModelUsageFailure(failureTarget, error)
      }
    }
    const abort = new AbortController()
    let upstreamDeadline: AbortSignal | undefined
    let dispatched = false
    const onAbort = () => {
      abort.abort()
    }
    c.req.raw.signal.addEventListener('abort', onAbort, { once: true })
    if (c.req.raw.signal.aborted) onAbort()
    try {
      const body = input.body ?? Object.fromEntries(Object.entries(input).filter(([key]) =>
        !['model', 'modelId', 'runtimeId', 'path', 'method', 'headers', 'policyRevision', 'purpose', 'inputModalities', 'fileUsage'].includes(key)))
      const media = inspectMediaInput(body)
      if ([...media.modalities].some(modality => !input.inputModalities.includes(modality))) {
        throw new HTTPException(400, { message: 'Declared modalities do not cover the model request body' })
      }
      if (media.bytes.some(bytes => bytes > model.maxFileBytes)
        || media.bytes.reduce((sum, bytes) => sum + bytes, 0) > model.maxRequestBytes) {
        throw new HTTPException(413, { message: 'Model media input exceeds the configured limit' })
      }
      if (media.fileIds.size > 0) {
        if (model.fileInputPolicy !== 'provider-files') {
          throw new HTTPException(400, { message: 'Provider file references require the provider Files API policy' })
        }
        const authorityPrefix = [organization, actor.id, model.id].join('\0') + '\0'
        const authorizedFileIds = new Set<string>()
        for (const [key, receipt] of fileCache) {
          if (!key.startsWith(authorityPrefix)) continue
          if (receipt.expiresAt <= now()) {
            fileCache.delete(key)
            continue
          }
          authorizedFileIds.add(receipt.fileId)
        }
        if ([...media.fileIds].some(fileId => !authorizedFileIds.has(fileId))) {
          throw new HTTPException(400, { message: 'Provider file reference is invalid for this account and model' })
        }
      }
      const upstreamBody = { ...(body as Record<string, unknown>), model: model.upstreamModel }
      dispatched = true
      upstreamDeadline = AbortSignal.timeout(model.modelCallTimeoutMs)
      const upstreamSignal = AbortSignal.any([abort.signal, upstreamDeadline])
      const upstream = await modelTransport(
        url,
        JSON.stringify(upstreamBody),
        decrypt(model.secret, config.encryptionKey, model.id),
        upstreamSignal,
        input.method,
        input.headers,
      )
      if (!upstream.statusCode) {
        reportModelFailure(failureTarget, Object.assign(new Error('Upstream model returned no status'), {
          code: 'ERR_MODEL_UPSTREAM_NO_STATUS',
        }))
        throw new HTTPException(502, { message: 'Upstream model returned no status' })
      }
      const upstreamStatus = upstream.statusCode
      const upstreamRequestId = [upstream.headers['x-request-id'], upstream.headers['request-id']]
        .find(value => typeof value === 'string')
      if (upstreamStatus >= 400) reportModelStatus(failureTarget, upstreamStatus)
      c.status(upstreamStatus as ContentfulStatusCode)
      for (const [name, value] of Object.entries(upstream.headers)) {
        if (value !== undefined && !['content-length', 'connection', 'transfer-encoding'].includes(name)) c.header(name, Array.isArray(value) ? value.join(', ') : value)
      }
      return stream(c, async (output) => {
        const outputState = { aborted: false }
        const contentType = upstream.headers['content-type']
        const observer = upstreamStatus >= 200
          && upstreamStatus < 300
          && typeof contentType === 'string'
          && contentType.toLowerCase().startsWith('text/event-stream')
          ? createModelUsageObserver(config.modelUsageMaxEventChars)
          : undefined
        let settlement: Promise<'settled' | 'failed'> | undefined
        const settle = async (usage: ObservedModelUsage): Promise<'settled' | 'failed'> => {
          try {
            await recordModelUsage(db, {
              id: usageClaimId,
              organizationId: organization,
              accountId: actor.id,
              runtimeId: input.runtimeId,
              modelId: resourceId.parse(model.id),
              purpose: input.purpose,
              idempotencyKey,
              inputPriceMicrosCnyPerMillion: model.inputPriceMicrosCnyPerMillion,
              cachedInputPriceMicrosCnyPerMillion: model.cachedInputPriceMicrosCnyPerMillion,
              outputPriceMicrosCnyPerMillion: model.outputPriceMicrosCnyPerMillion,
              requestStartedAt,
              durationMs: Math.max(0, Date.now() - requestStartedAt.getTime()),
              ...(upstreamRequestId === undefined ? {} : { upstreamRequestId }),
              usage,
              protocol: model.protocol as 'openai-completions' | 'openai-responses',
              inputModalities: input.inputModalities,
              fileUsage: input.fileUsage,
            })
            return 'settled'
          } catch (error) {
            reportModelUsageFailure(failureTarget, error)
            return 'failed'
          }
        }
        output.onAbort(() => {
          outputState.aborted = true
          upstream.destroy()
        })
        try {
          for await (const chunk of upstream as AsyncIterable<Uint8Array>) {
            const usage = observer?.feed(chunk)
            if (usage && settlement === undefined) {
              settlement = settle(usage)
              await settlement
            }
            await output.write(chunk)
          }
        } catch (error) {
          if (!outputState.aborted && !abort.signal.aborted) reportModelFailure(failureTarget, error)
        } finally {
          upstream.destroy()
          c.req.raw.signal.removeEventListener('abort', onAbort)
          const usage = settlement === undefined ? observer?.finish() : undefined
          if (usage) settlement = settle(usage)
          const outcome = await settlement
          if (outcome === undefined && dispatched) {
            try {
              await markModelUsagePending(db, organization, usageClaimId,
                upstreamDeadline?.aborted ? 'upstream_timeout'
                  : observer === undefined ? 'non_stream_response' : 'missing_or_invalid_usage',
                outputState.aborted ? 'client_cancelled'
                  : upstreamDeadline?.aborted ? 'model_call_failed' : undefined)
            } catch (error) { reportModelUsageFailure(failureTarget, error) }
          }
          if (outcome === undefined && !dispatched) await discardClaim()
        }
      })
    } catch (error) {
      const upstreamTimedOut = upstreamDeadline?.aborted === true && !abort.signal.aborted
      abort.abort()
      c.req.raw.signal.removeEventListener('abort', onAbort)
      if (!dispatched) await discardClaim()
      else {
        try { await markModelUsagePending(db, organization, usageClaimId,
          upstreamTimedOut ? 'upstream_timeout' : 'upstream_transport_failure', 'model_call_failed') }
        catch (usageError) { reportModelUsageFailure(failureTarget, usageError) }
      }
      if (error instanceof HTTPException) throw error
      reportModelFailure(failureTarget, error)
      throw new HTTPException(
        upstreamTimedOut ? 504 : 502,
        { message: upstreamTimedOut
          ? 'Upstream model timed out'
          : 'Upstream model unavailable' },
      )
    }
  })
  return {
    cleanupExpired: async (signal) => {
      let deleted = 0
      for (const [key, receipt] of fileCache) {
        signal?.throwIfAborted()
        if (receipt.expiresAt > now()) continue
        const [model] = await db.select().from(s.models).where(eq(s.models.id, receipt.modelId))
        if (model !== undefined) {
          const response = await modelTransport(
            modelUrl(model.baseUrl, `/files/${encodeURIComponent(receipt.fileId)}`),
            '',
            decrypt(model.secret, config.encryptionKey, model.id),
            signal ?? new AbortController().signal,
            'DELETE',
          )
          const status = response.statusCode ?? 500
          response.destroy()
          if (!((status >= 200 && status < 300) || status === 404)) continue
        }
        fileCache.delete(key)
        deleted += 1
      }
      return deleted
    },
  }
}
