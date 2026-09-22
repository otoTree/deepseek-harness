/** Authenticated model relay; the upstream request is otherwise opaque to the gateway. */
import { createHash, randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import {
  brotliDecompressSync,
  createBrotliDecompress,
  createGunzip,
  createInflate,
  gunzipSync,
  inflateSync,
} from 'node:zlib'
import type { IncomingMessage } from 'node:http'
import type { Readable } from 'node:stream'
import type { LookupAddress, LookupOptions } from 'node:dns'
import type { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { HTTPException } from 'hono/http-exception'
import { stream } from 'hono/streaming'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { inspectFileMediaType } from '@deepseek-ai/dsh-attachment'
import * as s from './schema.ts'
import { assertWalletFunded, debitWalletForUsage } from './wallet.ts'
import { organizationId, resourceId } from './contracts.ts'
import { digest, decrypt, forbidden } from './security.ts'
import { identify, selectOrganization } from './database.ts'
import { createModelUsageObserver, parseResponsesUsage, type ObservedModelUsage } from './model-stream.ts'
import type { ApiEnv, Services } from './application.ts'
import type { AccountId, OrganizationId, ResourceId } from './contracts.ts'
import type { InternalRelayAuthority, InternalRelayRuntime } from './internal-relay.ts'

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
  readonly path: string
  readonly method: string
}

type ModelFailureReporter = (message: string, details: unknown) => void

/**
 * Log transport failures without request headers, credentials, query parameters, or body content.
 *
 * @param target - platform model and relayed operation identity.
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
 * @param target - platform model and relayed operation identity.
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
 * @param target - platform model and relayed operation identity.
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
  readonly runtimeId?: ResourceId
  readonly modelId: ResourceId
  readonly purpose: z.infer<typeof relayPurpose>
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
  readonly pluginId?: string
  readonly pluginInstallationId?: string
  readonly pluginReleaseId?: string
  readonly pluginCallId?: string
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
    await assertWalletFunded(tx, claim.organizationId)
    return tx.insert(s.usage).values({
      id,
      organizationId: claim.organizationId,
      accountId: claim.accountId,
      ...(claim.runtimeId === undefined ? {} : { runtimeId: claim.runtimeId }),
      ...(claim.pluginId === undefined ? {} : { pluginId: claim.pluginId }),
      ...(claim.pluginInstallationId === undefined ? {} : { pluginInstallationId: claim.pluginInstallationId }),
      ...(claim.pluginReleaseId === undefined ? {} : { pluginReleaseId: claim.pluginReleaseId }),
      ...(claim.pluginCallId === undefined ? {} : { pluginCallId: claim.pluginCallId }),
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

async function markModelUsageFailed(
  db: Services['db'],
  organizationId: OrganizationId,
  id: ResourceId,
  failureReason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await selectOrganization(tx, organizationId)
    await tx.update(s.usage).set({
      status: 'failed',
      reconciliationReason: null,
      failureReason,
      settledAt: new Date(),
    }).where(and(eq(s.usage.id, id), eq(s.usage.status, 'pending_reconciliation')))
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
    await debitWalletForUsage(tx, {
      organizationId: settlement.organizationId,
      usageId: settlement.id,
      accountId: settlement.accountId,
      runtimeId: settlement.runtimeId,
      amountMicrosCny: costs.totalCostMicrosCny,
    })
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

const relayPurpose = z.enum(['chat', 'subagent', 'compaction', 'title', 'plugin_review', 'plugin_model'])
const relayNamespace = '/model'
const relayModelHeader = 'X-DSH-Model'
const relayPurposeHeader = 'X-DSH-Purpose'
const relayPolicyHeader = 'X-DSH-Policy-Revision'
const hopHeaders = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'host', 'content-length', 'cookie', 'authorization',
])
const providerIdentityResponseHeaders = new Set([
  'alt-svc', 'content-location', 'content-security-policy', 'link', 'location', 'nel',
  'refresh', 'report-to', 'reporting-endpoints', 'server', 'set-cookie', 'via', 'x-powered-by',
])

type RelayRuntime = InternalRelayRuntime

interface RelayFileAuthority {
  readonly receipt: ProviderFileReceipt
  readonly uploadedBytes: number
  attribution?: string
}

function forwardedRequestHeaders(headers: Headers): Record<string, string> {
  const forwarded: Record<string, string> = {}
  for (const [name, value] of headers) {
    const normalized = name.toLowerCase()
    if (hopHeaders.has(normalized) || normalized.startsWith('x-dsh-')) continue
    forwarded[name] = value
  }
  return forwarded
}

function fileIdFromPath(path: string): string | undefined {
  const match = /^\/files\/([^/]+)$/u.exec(path)
  if (!match?.[1]) return undefined
  try { return decodeURIComponent(match[1]) } catch { throw new HTTPException(400, { message: 'Provider file path is malformed' }) }
}

function observedJsonResponse(
  chunks: readonly Buffer[],
  contentEncoding: string | string[] | undefined,
  maxBytes: number,
): Record<string, unknown> | undefined {
  try {
    let bytes = Buffer.concat(chunks)
    const encodings = (Array.isArray(contentEncoding) ? contentEncoding.join(',') : contentEncoding ?? '')
      .split(',').map(value => value.trim().toLowerCase()).filter(value => value && value !== 'identity')
    for (const encoding of encodings.reverse()) {
      bytes = encoding === 'gzip' ? gunzipSync(bytes, { maxOutputLength: maxBytes })
        : encoding === 'deflate' ? inflateSync(bytes, { maxOutputLength: maxBytes })
          : encoding === 'br' ? brotliDecompressSync(bytes, { maxOutputLength: maxBytes })
            : Buffer.alloc(maxBytes + 1)
      if (bytes.byteLength > maxBytes) return undefined
    }
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : undefined
  } catch {
    // Compressed, oversized, or non-JSON provider responses remain transparent but grant no file authority.
    return undefined
  }
}

/** Extract provider usage from a non-streaming completion response. */
function observedJsonUsage(value: Record<string, unknown> | undefined, protocol: 'openai-completions' | 'openai-responses'): ObservedModelUsage | undefined {
  try {
    const usage = value?.usage
    if (protocol === 'openai-responses') return parseResponsesUsage(usage)
    if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) return undefined
    const fields = usage as Record<string, unknown>
    const promptTokens = fields.prompt_tokens
    const completionTokens = fields.completion_tokens
    if (!Number.isSafeInteger(promptTokens) || (promptTokens as number) < 0
      || !Number.isSafeInteger(completionTokens) || (completionTokens as number) < 0) return undefined
    const cachedPromptTokens = fields.prompt_tokens_details !== null
      && typeof fields.prompt_tokens_details === 'object' && !Array.isArray(fields.prompt_tokens_details)
      ? (fields.prompt_tokens_details as Record<string, unknown>).cached_tokens ?? fields.prompt_cache_hit_tokens ?? 0
      : fields.prompt_cache_hit_tokens ?? 0
    const reasoningTokens = fields.completion_tokens_details !== null
      && typeof fields.completion_tokens_details === 'object' && !Array.isArray(fields.completion_tokens_details)
      ? (fields.completion_tokens_details as Record<string, unknown>).reasoning_tokens
      : undefined
    const validReasoning = reasoningTokens === undefined
      || (Number.isSafeInteger(reasoningTokens) && (reasoningTokens as number) >= 0
        && (reasoningTokens as number) <= (completionTokens as number))
    if (!Number.isSafeInteger(cachedPromptTokens) || (cachedPromptTokens as number) < 0
      || (cachedPromptTokens as number) > (promptTokens as number) || !validReasoning) return undefined
    return {
      promptTokens: promptTokens as number,
      cachedPromptTokens: cachedPromptTokens as number,
      completionTokens: completionTokens as number,
      ...(reasoningTokens === undefined ? {} : { reasoningTokens: reasoningTokens as number }),
    }
  } catch {
    return undefined
  }
}

interface LiteralReplacement {
  readonly match: Buffer
  readonly replacement: Buffer
}

interface LiteralRedactor {
  feed(chunk: Uint8Array): Buffer
  finish(): Buffer
}

function literalRedactor(values: Readonly<Record<string, string>>): LiteralRedactor {
  const replacements: LiteralReplacement[] = Object.entries(values)
    .filter(([match]) => match.length > 0)
    .map(([match, replacement]) => ({ match: Buffer.from(match), replacement: Buffer.from(replacement) }))
  let pending: number[] = []
  const drain = (finished: boolean): Buffer => {
    const output: number[] = []
    while (pending.length > 0) {
      const prefixes = replacements.filter(replacement =>
        pending.every((byte, index) => replacement.match[index] === byte))
      const exact = prefixes.find(replacement => replacement.match.length === pending.length)
      if (exact && (finished || !prefixes.some(replacement => replacement.match.length > pending.length))) {
        output.push(...exact.replacement)
        pending = []
        continue
      }
      if (!finished && prefixes.length > 0) break
      const byte = pending.shift()
      if (byte !== undefined) output.push(byte)
    }
    return Buffer.from(output)
  }
  return {
    feed: (chunk) => {
      const output: Buffer[] = []
      for (const byte of chunk) {
        pending.push(byte)
        const ready = drain(false)
        if (ready.byteLength > 0) output.push(ready)
      }
      return Buffer.concat(output)
    },
    finish: () => drain(true),
  }
}

function textResponse(contentType: string | string[] | undefined): boolean {
  const value = (Array.isArray(contentType) ? contentType.join(',') : contentType ?? '').toLowerCase()
  return /^(?:text\/|application\/(?:json|[^;,]+\+json|xml|[^;,]+\+xml))(?:[^,]*)(?:,|$)/u.test(value)
}

function decodedTextBody(
  upstream: IncomingMessage,
  contentEncoding: string | string[] | undefined,
): { body: AsyncIterable<Uint8Array>; decoded: boolean; destroy: () => void } {
  const encodings = (Array.isArray(contentEncoding) ? contentEncoding.join(',') : contentEncoding ?? '')
    .split(',').map(value => value.trim().toLowerCase()).filter(value => value && value !== 'identity')
  let body: Readable = upstream
  for (const encoding of encodings.reverse()) {
    const decoder = encoding === 'gzip' ? createGunzip()
      : encoding === 'deflate' ? createInflate()
        : encoding === 'br' ? createBrotliDecompress()
          : undefined
    if (decoder === undefined) throw new HTTPException(502, { message: 'Upstream model used an unsupported content encoding' })
    body = body.pipe(decoder)
  }
  return { body, decoded: encodings.length > 0, destroy: () => { if (body !== upstream) body.destroy() } }
}

/** Mount the terminal native-path relay after every control-plane route. */
export function mountGateway(
  app: Hono<ApiEnv>,
  { db, config, modelTransport = openModel, now = Date.now, rateLimiter }: Services,
  internalRelay: InternalRelayAuthority,
): GatewayMaintenance {
  const fileCache = new Map<string, RelayFileAuthority>()

  const resolveRuntime = async (token: string): Promise<RelayRuntime> => db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT id, organization_id, account_id, email, lease_until, revoked_at
      FROM enterprise_auth.resolve_runtime_token(${digest(token)})
    `)
    const row = rows[0]
    const leaseUntil = row?.lease_until instanceof Date ? row.lease_until
      : typeof row?.lease_until === 'string' || typeof row?.lease_until === 'number'
        ? new Date(row.lease_until) : undefined
    if (!row || typeof row.id !== 'string' || typeof row.organization_id !== 'string'
      || typeof row.account_id !== 'string' || typeof row.email !== 'string' || row.revoked_at !== null
      || leaseUntil === undefined || Number.isNaN(leaseUntil.getTime()) || leaseUntil <= new Date()) forbidden()
    const runtime: RelayRuntime = {
      id: resourceId.parse(row.id),
      organizationId: organizationId.parse(row.organization_id),
      accountId: z.string().min(1).max(128).brand<'AccountId'>().parse(row.account_id),
      email: row.email,
    }
    await identify(tx, runtime.accountId, runtime.email)
    await selectOrganization(tx, runtime.organizationId)
    const [account] = await tx.select().from(s.user).where(eq(s.user.id, runtime.accountId))
    const [organization] = await tx.select().from(s.organizations).where(eq(s.organizations.id, runtime.organizationId))
    if (!account || !organization || organization.status !== 'active'
      || (config.requireEmailVerification && !account.emailVerified)) forbidden()
    return runtime
  })

  const resolveModel = async (
    runtime: RelayRuntime,
    modelId: ResourceId,
    policyRevision?: number,
  ): Promise<typeof s.models.$inferSelect> => db.transaction(async (tx) => {
    await identify(tx, runtime.accountId, runtime.email)
    await selectOrganization(tx, runtime.organizationId)
    const [organization] = await tx.select({ policyRevision: s.organizations.policyRevision })
      .from(s.organizations).where(eq(s.organizations.id, runtime.organizationId))
    if (!organization || (policyRevision !== undefined && organization.policyRevision !== policyRevision)) {
      throw new HTTPException(409, { message: 'Runtime model policy is stale' })
    }
    const [model] = await tx.select().from(s.models).where(eq(s.models.id, modelId))
    if (!model?.enabled) forbidden()
    modelUrl(model.baseUrl)
    return model
  })

  const authorizedFileIds = (runtime: RelayRuntime, modelId: string): Set<string> => {
    const prefix = [runtime.organizationId, runtime.accountId, modelId].join('\0') + '\0'
    const ids = new Set<string>()
    for (const [key, authority] of fileCache) {
      if (!key.startsWith(prefix)) continue
      if (authority.receipt.expiresAt > now()) ids.add(authority.receipt.fileId)
    }
    return ids
  }

  const forgetFileAuthority = (runtime: RelayRuntime, modelId: string, fileId: string): void => {
    const prefix = [runtime.organizationId, runtime.accountId, modelId].join('\0') + '\0'
    for (const [key, authority] of fileCache) {
      if (key.startsWith(prefix) && authority.receipt.fileId === fileId) fileCache.delete(key)
    }
  }

  const reserveFileUsage = (
    runtime: RelayRuntime,
    modelId: string,
    fileIds: ReadonlySet<string>,
  ): { token: string; keys: string[]; usage: UsageClaim['fileUsage'] } => {
    const token = randomUUID()
    const prefix = [runtime.organizationId, runtime.accountId, modelId].join('\0') + '\0'
    const keys: string[] = []
    let uploadedBytes = 0
    for (const [key, authority] of fileCache) {
      if (!key.startsWith(prefix) || authority.attribution !== undefined
        || !fileIds.has(authority.receipt.fileId) || authority.receipt.expiresAt <= now()) continue
      authority.attribution = token
      keys.push(key)
      uploadedBytes += authority.uploadedBytes
    }
    return { token, keys, usage: { uploads: keys.length, uploadedBytes, failures: 0 } }
  }

  const releaseFileUsage = (reservation: ReturnType<typeof reserveFileUsage>): void => {
    for (const key of reservation.keys) {
      const authority = fileCache.get(key)
      if (authority?.attribution === reservation.token) authority.attribution = undefined
    }
  }

  app.all(`${relayNamespace}/*`, async (c) => {
    const authorizedRuntime = internalRelay.consume(c.req.raw.headers)
    const runtime = authorizedRuntime ?? await resolveRuntime(
      z.string().min(32).max(200).parse(c.req.header('Authorization')?.replace(/^Bearer /u, '')),
    )
    c.set('actor', { id: runtime.accountId, email: runtime.email, runtimeId: runtime.id })
    const contentType = c.req.header('Content-Type') ?? ''
    const requestBytes = ['GET', 'HEAD'].includes(c.req.method)
      ? new Uint8Array()
      : new Uint8Array(await c.req.arrayBuffer())
    let jsonBody: Record<string, unknown> | undefined
    if (/^application\/json(?:;|$)/iu.test(contentType)) {
      let parsed: unknown
      try { parsed = JSON.parse(Buffer.from(requestBytes).toString('utf8')) as unknown } catch {
        throw new HTTPException(400, { message: 'Model request JSON is invalid' })
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new HTTPException(400, { message: 'Model request JSON must be an object' })
      }
      jsonBody = parsed as Record<string, unknown>
    }
    const headerModel = c.req.header(relayModelHeader)
    if (jsonBody?.model !== undefined && headerModel !== undefined && jsonBody.model !== headerModel) {
      throw new HTTPException(400, { message: 'Model body and relay header must select the same platform model' })
    }
    const selectedModel = resourceId.parse(jsonBody?.model ?? headerModel)
    const policyHeader = c.req.header(relayPolicyHeader)
    const policyRevision = policyHeader === undefined
      ? undefined
      : z.coerce.number().int().positive().parse(policyHeader)
    const purpose = relayPurpose.parse(c.req.header(relayPurposeHeader) ?? 'chat')
    const model = await resolveModel(runtime, selectedModel, policyRevision)
    const incoming = new URL(c.req.url)
    const upstreamPath = incoming.pathname.slice(relayNamespace.length)
    if (!upstreamPath.startsWith('/')) throw new HTTPException(404, { message: 'Model relay path is outside its namespace' })
    const target = modelUrl(model.baseUrl, upstreamPath + incoming.search)
    const failureTarget = { modelId: model.id, path: upstreamPath, method: c.req.method }
    const requestStartedAt = new Date()
    const isFilesPath = upstreamPath === '/files' || upstreamPath.startsWith('/files/')
    let attachmentDigest: string | undefined
    let attachmentBytes = 0
    if (upstreamPath === '/files' && c.req.method === 'POST') {
      if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
        throw new HTTPException(400, { message: 'Provider file upload must use multipart/form-data' })
      }
      const parsed = await new Request(c.req.url, { method: 'POST', headers: c.req.raw.headers, body: requestBytes }).formData()
      const file = parsed.get('file')
      if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
        throw new HTTPException(400, { message: 'Provider file upload is missing its file part' })
      }
      if (!file.name || /[\/\\\u0000-\u001f\u007f]/u.test(file.name)) {
        throw new HTTPException(400, { message: 'Provider file name is invalid' })
      }
      const data = new Uint8Array(await file.arrayBuffer())
      if (data.byteLength > model.maxFileBytes || data.byteLength > model.maxRequestBytes) {
        throw new HTTPException(413, { message: 'Provider file upload exceeds the selected model limit' })
      }
      const verified = inspectFileMediaType(data, file.type || 'application/octet-stream', file.name)
      if (file.type && verified !== file.type.toLowerCase()) {
        throw new HTTPException(400, { message: 'Provider file MIME type does not match its content' })
      }
      attachmentDigest = createHash('sha256').update(data).digest('hex')
      attachmentBytes = data.byteLength
    }
    const pathFileId = fileIdFromPath(upstreamPath)
    if (pathFileId !== undefined && !authorizedFileIds(runtime, model.id).has(pathFileId)) {
      throw new HTTPException(409, { message: 'PROVIDER_FILE_REFERENCE_EXPIRED' })
    }
    const media = jsonBody === undefined ? undefined : inspectMediaInput(jsonBody)
    if (media !== undefined) {
      if (media.bytes.some(bytes => bytes > model.maxFileBytes)
        || media.bytes.reduce((sum, bytes) => sum + bytes, 0) > model.maxRequestBytes) {
        throw new HTTPException(413, { message: 'Model media input exceeds the configured limit' })
      }
      const allowed = authorizedFileIds(runtime, model.id)
      if ([...media.fileIds].some(fileId => !allowed.has(fileId))) {
        throw new HTTPException(409, { message: 'PROVIDER_FILE_REFERENCE_EXPIRED' })
      }
    }
    const modalities = ['text', ...(media === undefined ? [] : [...media.modalities])]
      .filter((value, index, values) => values.indexOf(value) === index) as UsageClaim['inputModalities']
    const billable = !isFilesPath && jsonBody !== undefined
    const suppliedIdempotencyKey = c.req.header('Idempotency-Key')
    const idempotencyKey = suppliedIdempotencyKey === undefined
      ? randomUUID()
      : z.string().min(16).max(128).parse(suppliedIdempotencyKey)
    const rateLimitLease = billable ? await rateLimiter?.acquire({
      organizationId: runtime.organizationId,
      accountId: runtime.accountId,
      modelId: model.id,
    }) : undefined
    let rateLimitReleased = false
    const releaseRateLimit = async (): Promise<void> => {
      if (rateLimitReleased || rateLimitLease === undefined) return
      rateLimitReleased = true
      await rateLimitLease.release()
    }
    let usageClaimId: ResourceId | undefined
    const fileReservation = reserveFileUsage(runtime, model.id, media?.fileIds ?? new Set())
    try {
      usageClaimId = billable ? await claimModelUsage(db, {
        organizationId: runtime.organizationId,
        accountId: runtime.accountId,
        // Plugin activations are not rows in enterprise.runtime. Their usage is
        // attributed through pluginInstallationId/pluginCallId instead of
        // writing the activation id into the runtime foreign key.
        ...(runtime.pluginInstallationId === undefined ? { runtimeId: runtime.id } : {}),
        ...(runtime.pluginId === undefined ? {} : { pluginId: runtime.pluginId }),
        ...(runtime.pluginInstallationId === undefined ? {} : { pluginInstallationId: runtime.pluginInstallationId }),
        ...(runtime.pluginReleaseId === undefined ? {} : { pluginReleaseId: runtime.pluginReleaseId }),
        ...(runtime.pluginCallId === undefined ? {} : { pluginCallId: runtime.pluginCallId }),
        modelId: resourceId.parse(model.id),
        purpose,
        idempotencyKey,
        inputPriceMicrosCnyPerMillion: model.inputPriceMicrosCnyPerMillion,
        cachedInputPriceMicrosCnyPerMillion: model.cachedInputPriceMicrosCnyPerMillion,
        outputPriceMicrosCnyPerMillion: model.outputPriceMicrosCnyPerMillion,
        requestStartedAt,
        protocol: model.protocol as 'openai-completions' | 'openai-responses',
        inputModalities: modalities,
        fileUsage: fileReservation.usage,
      }) : undefined
    } catch (error) {
      releaseFileUsage(fileReservation)
      await releaseRateLimit()
      throw error
    }
    const abort = new AbortController()
    const deadline = AbortSignal.timeout(model.modelCallTimeoutMs)
    const onAbort = (): void => abort.abort(c.req.raw.signal.reason)
    c.req.raw.signal.addEventListener('abort', onAbort, { once: true })
    if (c.req.raw.signal.aborted) onAbort()
    let dispatched = false
    try {
      const upstreamBody = jsonBody === undefined
        ? requestBytes
        : Buffer.from(JSON.stringify({ ...jsonBody, model: model.upstreamModel }), 'utf8')
      dispatched = true
      const upstream = await modelTransport(
        target,
        upstreamBody,
        decrypt(model.secret, config.encryptionKey, model.id),
        AbortSignal.any([abort.signal, deadline]),
        c.req.method,
        forwardedRequestHeaders(c.req.raw.headers),
      )
      if (!upstream.statusCode) throw new HTTPException(502, { message: 'Upstream model returned no status' })
      const upstreamStatus = upstream.statusCode
      const upstreamRequestId = [upstream.headers['x-request-id'], upstream.headers['request-id']]
        .find(value => typeof value === 'string')
      const responseType = upstream.headers['content-type']
      const redactResponse = textResponse(responseType)
      const responseBody = redactResponse
        ? decodedTextBody(upstream, upstream.headers['content-encoding'])
        : { body: upstream as AsyncIterable<Uint8Array>, decoded: false, destroy: () => {} }
      const redactor = redactResponse
        ? literalRedactor({
          [target.origin]: '[platform-managed-upstream]',
          [target.hostname]: '[platform-managed-host]',
          [model.upstreamModel]: model.id,
        })
        : undefined
      if (upstreamStatus >= 400) reportModelStatus(failureTarget, upstreamStatus)
      c.status(upstreamStatus as ContentfulStatusCode)
      for (const [name, value] of Object.entries(upstream.headers)) {
        const normalized = name.toLowerCase()
        if (value !== undefined && !hopHeaders.has(normalized)
          && !(responseBody.decoded && normalized === 'content-encoding')
          && !providerIdentityResponseHeaders.has(normalized) && !normalized.startsWith('access-control-')) {
          c.header(name, Array.isArray(value) ? value.join(', ') : value)
        }
      }
      if (c.req.method === 'HEAD' || upstreamStatus === 204 || upstreamStatus === 205 || upstreamStatus === 304) {
        responseBody.destroy()
        upstream.destroy()
        c.req.raw.signal.removeEventListener('abort', onAbort)
        if (pathFileId !== undefined && c.req.method === 'DELETE' && upstreamStatus >= 200 && upstreamStatus < 300) {
          forgetFileAuthority(runtime, model.id, pathFileId)
        }
        if (usageClaimId !== undefined) {
          try {
            if (upstreamStatus >= 400) {
              await markModelUsageFailed(db, runtime.organizationId, usageClaimId, 'upstream_http_error')
            } else {
              await markModelUsagePending(db, runtime.organizationId, usageClaimId, 'non_stream_response')
            }
          } catch (error) { reportModelUsageFailure(failureTarget, error) }
        }
        try { await releaseRateLimit() } catch (error) { reportModelUsageFailure(failureTarget, error) }
        return c.body(null)
      }
      return stream(c, async (output) => {
        let aborted = false
        const observer = usageClaimId !== undefined && upstreamStatus >= 200 && upstreamStatus < 300
          && typeof responseType === 'string' && responseType.toLowerCase().startsWith('text/event-stream')
          ? createModelUsageObserver(config.modelUsageMaxEventChars)
          : undefined
        const fileResponse: Buffer[] = []
        let fileResponseBytes = 0
        let settlement: Promise<'settled' | 'failed'> | undefined
        const settle = (usage: ObservedModelUsage): Promise<'settled' | 'failed'> => (async () => {
          if (usageClaimId === undefined) return 'failed'
          try {
            await recordModelUsage(db, {
              id: usageClaimId,
              organizationId: runtime.organizationId,
              accountId: runtime.accountId,
              ...(runtime.pluginInstallationId === undefined ? { runtimeId: runtime.id } : {}),
              modelId: resourceId.parse(model.id),
              purpose,
              idempotencyKey,
              inputPriceMicrosCnyPerMillion: model.inputPriceMicrosCnyPerMillion,
              cachedInputPriceMicrosCnyPerMillion: model.cachedInputPriceMicrosCnyPerMillion,
              outputPriceMicrosCnyPerMillion: model.outputPriceMicrosCnyPerMillion,
              requestStartedAt,
              durationMs: Math.max(0, Date.now() - requestStartedAt.getTime()),
              ...(upstreamRequestId === undefined ? {} : { upstreamRequestId }),
              usage,
              protocol: model.protocol as 'openai-completions' | 'openai-responses',
              inputModalities: modalities,
              fileUsage: fileReservation.usage,
            })
            return 'settled'
          } catch (error) {
            reportModelUsageFailure(failureTarget, error)
            return 'failed'
          }
        })()
        const observe = async (chunk: Buffer): Promise<void> => {
          if (chunk.byteLength === 0) return
          await output.write(chunk)
          if ((attachmentDigest !== undefined || observer === undefined) && fileResponseBytes <= config.modelUsageMaxEventChars) {
            fileResponseBytes += chunk.byteLength
            if (fileResponseBytes <= config.modelUsageMaxEventChars) fileResponse.push(chunk)
          }
          const usage = observer?.feed(chunk)
          if (usage && settlement === undefined) settlement = settle(usage)
        }
        output.onAbort(() => { aborted = true; responseBody.destroy(); upstream.destroy() })
        try {
          for await (const value of responseBody.body) {
            await observe(redactor?.feed(value) ?? Buffer.from(value))
          }
          if (redactor) await observe(redactor.finish())
        } catch (error) {
          if (!aborted && !abort.signal.aborted) reportModelFailure(failureTarget, error)
        } finally {
          responseBody.destroy()
          upstream.destroy()
          c.req.raw.signal.removeEventListener('abort', onAbort)
          if (attachmentDigest !== undefined && upstreamStatus >= 200 && upstreamStatus < 300
            && fileResponseBytes <= config.modelUsageMaxEventChars) {
            const value = observedJsonResponse(
              fileResponse,
              responseBody.decoded ? undefined : upstream.headers['content-encoding'],
              config.modelUsageMaxEventChars,
            )
            if (typeof value?.id === 'string' && value.id.length > 0 && value.id.length <= 512) {
              const key = [runtime.organizationId, runtime.accountId, model.id, attachmentDigest].join('\0')
              fileCache.set(key, {
                receipt: { fileId: value.id, modelId: model.id, expiresAt: now() + model.filesTtlSeconds * 1_000 },
                uploadedBytes: attachmentBytes,
              })
            }
          }
          if (settlement === undefined && observer === undefined) {
            const usage = observedJsonUsage(
              observedJsonResponse(fileResponse, responseBody.decoded ? undefined : upstream.headers['content-encoding'], config.modelUsageMaxEventChars),
              model.protocol as 'openai-completions' | 'openai-responses',
            )
            if (usage) settlement = settle(usage)
          }
          const finalUsage = settlement === undefined ? observer?.finish() : undefined
          if (finalUsage) settlement = settle(finalUsage)
          const outcome = await settlement
          if (usageClaimId !== undefined && upstreamStatus >= 400) {
            try { await markModelUsageFailed(db, runtime.organizationId, usageClaimId, 'upstream_http_error') }
            catch (error) { reportModelUsageFailure(failureTarget, error) }
          } else if (usageClaimId !== undefined && outcome === undefined) {
            try {
              await markModelUsagePending(db, runtime.organizationId, usageClaimId,
                deadline.aborted ? 'upstream_timeout'
                  : observer === undefined ? 'non_stream_response' : 'missing_or_invalid_usage',
                aborted ? 'client_cancelled' : deadline.aborted ? 'model_call_failed' : undefined)
            } catch (error) { reportModelUsageFailure(failureTarget, error) }
          }
          if (pathFileId !== undefined && c.req.method === 'DELETE' && upstreamStatus >= 200 && upstreamStatus < 300) {
            forgetFileAuthority(runtime, model.id, pathFileId)
          }
          try { await releaseRateLimit() } catch (error) { reportModelUsageFailure(failureTarget, error) }
        }
      })
    } catch (error) {
      abort.abort()
      c.req.raw.signal.removeEventListener('abort', onAbort)
      if (usageClaimId !== undefined) {
        try {
          if (dispatched) await markModelUsagePending(db, runtime.organizationId, usageClaimId,
            deadline.aborted ? 'upstream_timeout' : 'upstream_transport_failure', 'model_call_failed')
          else await discardModelUsageClaim(db, runtime.organizationId, usageClaimId)
        } catch (usageError) { reportModelUsageFailure(failureTarget, usageError) }
      }
      try { await releaseRateLimit() } catch (releaseError) { reportModelUsageFailure(failureTarget, releaseError) }
      if (error instanceof HTTPException) throw error
      reportModelFailure(failureTarget, error)
      throw new HTTPException(deadline.aborted ? 504 : 502, {
        message: deadline.aborted ? 'Upstream model timed out' : 'Upstream model unavailable',
      })
    }
  })

  return {
    cleanupExpired: async (signal) => {
      let deleted = 0
      for (const [key, authority] of fileCache) {
        signal?.throwIfAborted()
        const receipt = authority.receipt
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
