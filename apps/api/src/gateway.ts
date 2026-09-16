/** Authenticated model relay; the upstream request is otherwise opaque to the gateway. */
import { randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import type { IncomingMessage } from 'node:http'
import type { LookupAddress, LookupOptions } from 'node:dns'
import type { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { HTTPException } from 'hono/http-exception'
import { stream } from 'hono/streaming'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { z } from 'zod'
import * as s from './schema.ts'
import { modelCall, organizationId, resourceId } from './contracts.ts'
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
  body: string,
  secret: string,
  signal: AbortSignal,
  method?: string,
  headers?: Record<string, string>,
) => Promise<IncomingMessage>

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
    method, signal, timeout: 120000,
    headers: { ...headers, 'Content-Type': forwarded['Content-Type'] ?? forwarded['content-type'] ?? 'application/json', Authorization: `Bearer ${secret}`, 'User-Agent': 'deepseek-harness-enterprise/0.1.0' },
    lookup: createModelLookup(),
  }, resolve)
  request.once('error', reject)
  request.once('timeout', () => request.destroy(Object.assign(new Error('Model request timed out'), { code: 'ETIMEDOUT' })))
  request.end(body)
})

/** Mount authenticated model calls without model-specific authorization or request rewriting. */
export function mountGateway(
  app: Hono<ApiEnv>,
  { db, config, modelTransport = openModel }: Services,
  _tenantOperation: TenantOperation,
): void {
  app.post('/v1/organizations/:organizationId/model-call', async (c) => {
    const requestStartedAt = new Date()
    const input = modelCall.parse(await c.req.json())
    const organization = organizationId.parse(c.req.param('organizationId'))
    const actor = c.get('actor')
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
    const model = await db.transaction(async (tx) => {
      await identify(tx, actor.id, actor.email)
      await selectOrganization(tx, organization)
      const [runtime] = await tx
        .select()
        .from(s.runtimes)
        .where(
          and(
            eq(s.runtimes.id, input.runtimeId),
            eq(s.runtimes.organizationId, organization),
            eq(s.runtimes.accountId, actor.id),
            eq(s.runtimes.tokenHash, digest(token)),
            isNull(s.runtimes.revokedAt),
            gt(s.runtimes.leaseUntil, new Date()),
          ),
        )
      if (!runtime) forbidden()
      const [row] = await tx
        .select({ model: s.models })
        .from(s.models)
        .where(eq(s.models.id, requestedModel))
      if (!row || !row.model.enabled) forbidden()
      modelUrl(row.model.baseUrl)
      return row.model
    })
    const url = modelUrl(model.baseUrl, input.path)
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
    })
    const discardClaim = async () => {
      try {
        await discardModelUsageClaim(db, organization, usageClaimId)
      } catch (error) {
        reportModelUsageFailure(failureTarget, error)
      }
    }
    const abort = new AbortController()
    const onAbort = () => {
      abort.abort()
    }
    c.req.raw.signal.addEventListener('abort', onAbort, { once: true })
    if (c.req.raw.signal.aborted) onAbort()
    try {
      const body = input.body ?? Object.fromEntries(Object.entries(input).filter(([key]) =>
        !['model', 'modelId', 'runtimeId', 'path', 'method', 'headers', 'policyRevision', 'purpose'].includes(key)))
      const upstreamBody = { ...(body as Record<string, unknown>), model: model.upstreamModel }
      const upstream = await modelTransport(
        url,
        JSON.stringify(upstreamBody),
        decrypt(model.secret, config.encryptionKey, model.id),
        abort.signal,
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
          if (outcome === undefined) await discardClaim()
        }
      })
    } catch (error) {
      abort.abort()
      c.req.raw.signal.removeEventListener('abort', onAbort)
      await discardClaim()
      if (error instanceof HTTPException) throw error
      reportModelFailure(failureTarget, error)
      throw new HTTPException(502, { message: 'Upstream model unavailable' })
    }
  })
}
