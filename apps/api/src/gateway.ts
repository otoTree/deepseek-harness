/** Bounded model calls reserve PostgreSQL budget before any upstream request. */
import { randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import type { IncomingMessage } from 'node:http'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { stream } from 'hono/streaming'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import * as s from './schema.ts'
import { modelCall } from './contracts.ts'
import { modelEvents } from './model-stream.ts'
import { selectOrganization } from './database.ts'
import { digest, decrypt, forbidden } from './security.ts'
import type { ApiEnv, Services, TenantOperation } from './application.ts'
import { NoopRateLimiter } from './rate-limit.ts'

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
export function modelUrl(base: string): URL {
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
  url.pathname = url.pathname.replace(/\/$/, '') + '/chat/completions'
  return url
}

/** Upstream transport only; tenant authorization and budget remain in the gateway. */
export type ModelTransport = (url: URL, body: string, secret: string, signal: AbortSignal) => Promise<IncomingMessage>

const openModel: ModelTransport = (url, body, secret, signal) => new Promise((resolve, reject) => {
  const request = httpsRequest(url, {
    method: 'POST', signal, timeout: 120000,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, 'User-Agent': 'deepseek-harness-enterprise/0.1.0' },
    lookup: (hostname, _options, callback) => {
      lookup(hostname, { family: 4 }, (error, address) => {
        if (error) { callback(error, '', 4); return }
        if (blocked.check(address, 'ipv4')) { callback(new Error('Model DNS resolved to a forbidden address'), '', 4); return }
        callback(null, address, 4)
      })
    },
  }, resolve)
  request.once('error', reject)
  request.once('timeout', () => request.destroy(new Error('Model request timed out')))
  request.end(body)
})

/** Mount authenticated streaming calls; uncertain attempts retain their reservation for reconciliation. */
export function mountGateway(
  app: Hono<ApiEnv>,
  { db, config, modelTransport = openModel, rateLimiter = new NoopRateLimiter() }: Services,
  tenantOperation: TenantOperation,
): void {
  app.post('/v1/organizations/:organizationId/model-call', async (c) => {
    const input = modelCall.parse(await c.req.json())
    const key = z.string().min(16).max(128).parse(c.req.header('Idempotency-Key'))
    const token = z
      .string()
      .min(32)
      .max(200)
      .parse(c.req.header('Authorization')?.replace(/^Bearer /, ''))
    const rateLease = await rateLimiter.acquire({
      organizationId: z.string().parse(c.req.param('organizationId')),
      accountId: c.get('actor').id,
      modelId: input.model,
    })
    const releaseRateLease = async () => {
      try {
        await rateLease.release()
      } catch {
        // PostgreSQL remains authoritative; a release failure is reconciled by the Redis key expiry.
      }
    }
    const callId = randomUUID()
    const reservePromise = tenantOperation(c, async (tx, tenant) => {
      const [runtime] = await tx
        .select()
        .from(s.runtimes)
        .where(
          and(
            eq(s.runtimes.id, input.runtimeId),
            eq(s.runtimes.accountId, tenant.actor.id),
            eq(s.runtimes.tokenHash, digest(token)),
            isNull(s.runtimes.revokedAt),
            gt(s.runtimes.leaseUntil, new Date()),
          ),
        )
      if (!runtime) forbidden()
      const [organization] = await tx.select().from(s.organizations)
      if (!organization || (input.policyRevision !== undefined && input.policyRevision !== organization.policyRevision)) {
        throw new HTTPException(409, { message: 'Model policy revision changed' })
      }
      // Serialize identical keys across API instances before observing or reserving budget.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${tenant.organizationId}), hashtext(${key}))`)
      const [previous] = await tx.select().from(s.usage).where(eq(s.usage.idempotencyKey, key))
      if (previous) {
        if (previous.accountId !== tenant.actor.id || previous.runtimeId !== runtime.id) forbidden()
        return { kind: 'existing' as const, callId: previous.id, status: previous.status }
      }
      const [row] = await tx
        .select({ model: s.models })
        .from(s.models)
        .where(and(eq(s.models.id, input.model), eq(s.models.enabled, true)))
      if (!row) forbidden()
      const model = row.model
      modelUrl(model.baseUrl)
      const maximum = Math.min(input.max_tokens ?? model.maxOutputTokens, model.maxOutputTokens)
      const amount = Math.ceil(
        (model.contextTokens * model.inputMicrosPerMillion + maximum * model.outputMicrosPerMillion) / 1_000_000,
      )
      const [budget] = await tx
        .update(s.subscriptions)
        .set({ reservedMicros: sql`${s.subscriptions.reservedMicros} + ${amount}` })
        .where(
          sql`${s.subscriptions.spentMicros} + ${s.subscriptions.reservedMicros} + ${amount} <= ${s.subscriptions.budgetMicros}`,
        )
        .returning()
      if (!budget) throw new HTTPException(402, { message: 'Budget exhausted' })
      await tx.insert(s.usage).values({
        id: callId,
        organizationId: tenant.organizationId,
        accountId: tenant.actor.id,
        runtimeId: runtime.id,
        modelId: model.id,
        purpose: input.purpose,
        reservedMicros: amount,
        idempotencyKey: key,
      })
      return { kind: 'reserved' as const, model, amount, maximum, organizationId: tenant.organizationId }
    })
    let reserved: Awaited<typeof reservePromise>
    try {
      reserved = await reservePromise
    } catch (error) {
      await releaseRateLease()
      throw error
    }
    if (reserved.kind === 'existing') {
      await releaseRateLease()
      return c.json({ error: 'IDEMPOTENCY_KEY_REUSED', callId: reserved.callId, status: reserved.status }, 409)
    }
    const abort = new AbortController()
    const onAbort = () => {
      abort.abort()
    }
    c.req.raw.signal.addEventListener('abort', onAbort, { once: true })
    if (c.req.raw.signal.aborted) onAbort()
    let observed: { prompt_tokens: number; completion_tokens: number } | undefined
    let complete = false
    let settled = false
    const settle = async () => {
      if (settled) return
      settled = true
      c.req.raw.signal.removeEventListener('abort', onAbort)
      try {
        await db.transaction(async (tx) => {
          await selectOrganization(tx, reserved.organizationId)
          if (!complete || !observed) {
            await tx.update(s.usage).set({ status: 'pending_reconciliation' }).where(eq(s.usage.id, callId))
            return
          }
          const cost = Math.ceil(
            (observed.prompt_tokens * reserved.model.inputMicrosPerMillion +
              observed.completion_tokens * reserved.model.outputMicrosPerMillion) /
              1_000_000,
          )
          await tx
            .update(s.usage)
            .set({
              status: 'settled',
              actualMicros: cost,
              billedMicros: cost,
              inputTokens: observed.prompt_tokens,
              outputTokens: observed.completion_tokens,
              settledAt: new Date(),
            })
            .where(eq(s.usage.id, callId))
          await tx.update(s.subscriptions).set({
            reservedMicros: sql`${s.subscriptions.reservedMicros} - ${reserved.amount}`,
            spentMicros: sql`${s.subscriptions.spentMicros} + ${cost}`,
          })
        })
      } finally {
        await releaseRateLease()
      }
    }
    try {
      const url = modelUrl(reserved.model.baseUrl)
      const upstream = await modelTransport(url, JSON.stringify({
        model: reserved.model.upstreamModel,
        messages: input.messages,
        tools: input.tools,
        temperature: input.temperature,
        max_tokens: reserved.maximum,
        stop: input.stop,
        stream: true,
        stream_options: { include_usage: true },
      }), decrypt(reserved.model.secret, config.encryptionKey, reserved.model.id), abort.signal)
      if (upstream.statusCode !== 200) {
        upstream.destroy()
        throw new HTTPException(502, { message: 'Upstream model rejected the request' })
      }
      c.header('Content-Type', 'text/event-stream')
      c.header('Cache-Control', 'no-store')
      return stream(c, async (output) => {
        output.onAbort(() => {
          abort.abort()
        })
        try {
          for await (const event of modelEvents(upstream, 2 * 1024 * 1024)) {
            if (event === '[DONE]') {
              complete = true
              // Completion reaches clients only after the ledger transaction commits.
              await settle()
              await output.write('data: [DONE]\n\n')
            } else {
              if (event.usage) observed = event.usage
              await output.write(`data: ${JSON.stringify(event)}\n\n`)
            }
          }
        } catch {
          // An incomplete stream has no completion marker; clients must not treat it as success.
        } finally {
          upstream.destroy()
          await settle()
        }
      })
    } catch (error) {
      abort.abort()
      await settle()
      if (error instanceof HTTPException) throw error
      throw new HTTPException(502, { message: 'Upstream model unavailable' })
    }
  })
}
