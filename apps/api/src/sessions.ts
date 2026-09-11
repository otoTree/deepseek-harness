/** Tenant-scoped append-only event storage with a single renewable writer. */
import { randomUUID } from 'node:crypto'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { and, eq, gt, gte, lt, isNull, ilike, sql } from 'drizzle-orm'
import { z } from 'zod'
import { conversations, events, runtimes } from './schema.ts'
import { recordAudit, requireRole, forbidden } from './security.ts'
import { resourceId, sessionId, sessionCreate, sessionAppend } from './contracts.ts'
import type { Transaction } from './database.ts'
import type { Tenant } from './security.ts'
import type { ApiEnv, Services, TenantOperation } from './application.ts'

async function activeRuntime(tx: Transaction, tenant: Tenant): Promise<void> {
  if (!tenant.actor.runtimeId) return
  const [runtime] = await tx.select().from(runtimes).where(and(
    eq(runtimes.id, tenant.actor.runtimeId), eq(runtimes.organizationId, tenant.organizationId),
    eq(runtimes.accountId, tenant.actor.id),
  )).for('share')
  if (!runtime || runtime.revokedAt || runtime.leaseUntil <= new Date()) forbidden()
}

function metadata(session: typeof conversations.$inferSelect) {
  return { id: session.id, header: session.header, inheritedEventCount: session.inheritedEventCount, nextSeq: session.nextSeq }
}

/** Mount persistence endpoints; content reads by administrators emit an audit record. */
export function mountSessions(app: Hono<ApiEnv>, { config }: Services, tenantOperation: TenantOperation): void {
  app.post('/v1/organizations/:organizationId/sessions', async (c) => {
    const input = sessionCreate.parse(await c.req.json())
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await activeRuntime(tx, tenant)
        const inserted = await tx.insert(conversations).values({
          id: input.id,
          organizationId: tenant.organizationId,
          accountId: tenant.actor.id,
          header: input.header,
          inheritedEventCount: input.inheritedEventCount,
          writer: input.writer,
          writerRuntimeId: input.writer ? tenant.actor.runtimeId : undefined,
          leaseUntil: input.writer ? new Date(Date.now() + config.leaseSeconds * 1000) : undefined,
        }).onConflictDoNothing().returning()
        if (inserted.length === 0) throw new HTTPException(409, { message: 'Session already exists' })
        await recordAudit(tx, tenant, 'session.created', input.id)
        return { id: input.id }
      }),
      201,
    )
  })
  app.get('/v1/organizations/:organizationId/sessions', async c =>
    c.json(
      await tenantOperation(c, async (tx, tenant) => {
        const scope = z.enum(['own', 'organization']).default('own').parse(c.req.query('scope'))
        const after = sessionId.optional().parse(c.req.query('after'))
        const query = c.req.query('q')?.trim().toLowerCase() ?? ''
        if (scope === 'organization') {
          await requireRole(tx, tenant, ['owner', 'administrator'])
          await recordAudit(tx, tenant, 'session.organization_listed')
        }
        const rows = await tx
          .select({
            id: conversations.id,
            header: conversations.header,
            inheritedEventCount: conversations.inheritedEventCount,
            nextSeq: conversations.nextSeq,
          })
          .from(conversations)
          .where(and(
            scope === 'own' ? eq(conversations.accountId, tenant.actor.id) : undefined,
            after ? gt(conversations.id, after) : undefined,
          ))
          .orderBy(conversations.id)
          .limit(500)
        return rows
          .filter(
            row =>
              query.length === 0 ||
              row.id.toLowerCase().includes(query) ||
              JSON.stringify(row.header).toLowerCase().includes(query),
          )
          .slice(0, 100)
      }),
    ),
  )
  app.get('/v1/organizations/:organizationId/sessions/:id', async c => c.json(
    await tenantOperation(c, async (tx, tenant) => {
      const id = sessionId.parse(c.req.param('id'))
      const [session] = await tx.select().from(conversations).where(and(
        eq(conversations.id, id),
        eq(conversations.accountId, tenant.actor.id),
      ))
      if (!session) throw new HTTPException(404, { message: 'Session not found' })
      return metadata(session)
    }),
  ))
  app.get('/v1/organizations/:organizationId/sessions/:id/events', async (c) => {
    const id = sessionId.parse(c.req.param('id'))
    const offset = z.coerce.number().int().nonnegative().default(0).parse(c.req.query('offset'))
    const limit = z.coerce.number().int().min(1).max(500).default(500).parse(c.req.query('limit'))
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        const [session] = await tx.select().from(conversations).where(eq(conversations.id, id))
        if (!session) forbidden()
        if (session.accountId !== tenant.actor.id) {
          await requireRole(tx, tenant, ['owner', 'administrator'])
          await recordAudit(tx, tenant, 'session.content_read', id, { scope: 'organization', reason: c.req.query('reason') ?? 'session inspection' })
        }
        const rows = await tx
          .select()
          .from(events)
          .where(and(eq(events.sessionId, id), gte(events.seq, offset), lt(events.seq, session.nextSeq)))
          .orderBy(events.seq)
          .limit(limit)
        return { ...metadata(session), events: rows.map(row => row.event) }
      }),
    )
  })
  app.get('/v1/organizations/:organizationId/sessions/search', async c =>
    c.json(await tenantOperation(c, async (tx, tenant) => {
      const query = z.string().trim().min(1).max(200).parse(c.req.query('q'))
      const scope = z.enum(['own', 'organization']).default('own').parse(c.req.query('scope'))
      if (scope === 'organization') {
        await requireRole(tx, tenant, ['owner', 'administrator'])
        await recordAudit(tx, tenant, 'session.search', undefined, { scope: 'organization' })
      }
      const rows = await tx.select({ id: events.sessionId, seq: events.seq, event: events.event })
        .from(events)
        .innerJoin(conversations, eq(conversations.id, events.sessionId))
        .where(and(
          scope === 'own' ? eq(conversations.accountId, tenant.actor.id) : undefined,
          ilike(sql`(${events.event})::text`, `%${query}%`),
        ))
        .orderBy(events.sessionId, events.seq)
        .limit(200)
      return rows
    })),
  )
  app.get('/v1/organizations/:organizationId/sessions/:id/export', async (c) => {
    const id = sessionId.parse(c.req.param('id'))
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      const [session] = await tx.select().from(conversations).where(eq(conversations.id, id))
      if (!session) forbidden()
      if (session.accountId !== tenant.actor.id) {
        await requireRole(tx, tenant, ['owner', 'administrator'])
        await recordAudit(tx, tenant, 'session.exported', id, { scope: 'organization', reason: c.req.query('reason') ?? 'session export' })
      } else {
        await recordAudit(tx, tenant, 'session.exported', id, { scope: 'own' })
      }
      const rows = await tx.select().from(events).where(eq(events.sessionId, id)).orderBy(events.seq)
      return { ...metadata(session), events: rows.map(row => row.event) }
    }))
  })
  app.post('/v1/organizations/:organizationId/sessions/:id/fork', async (c) => {
    const sourceId = sessionId.parse(c.req.param('id'))
    const input = z.object({
      id: sessionId.optional(),
      eventCount: z.number().int().nonnegative().optional(),
    }).strict().parse(await c.req.json().catch(() => ({})))
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      const [source] = await tx.select().from(conversations).where(eq(conversations.id, sourceId))
      if (!source || source.accountId !== tenant.actor.id) forbidden()
      const eventCount = Math.min(input.eventCount ?? source.nextSeq, source.nextSeq)
      const id = input.id ?? sessionId.parse(randomUUID())
      const copied = await tx
        .select()
        .from(events)
        .where(and(eq(events.sessionId, sourceId), lt(events.seq, eventCount)))
        .orderBy(events.seq)
      const header = { ...source.header as Record<string, unknown>, id, isSeeded: true, parentSession: sourceId }
      await tx.insert(conversations).values({
        id,
        organizationId: tenant.organizationId,
        accountId: tenant.actor.id,
        header,
        inheritedEventCount: eventCount,
        nextSeq: copied.length,
      })
      if (copied.length)
        await tx.insert(events).values(copied.map(row => ({
          organizationId: tenant.organizationId, sessionId: id, seq: row.seq, event: row.event,
        })))
      await recordAudit(tx, tenant, 'session.forked', id, { parentSession: sourceId, eventCount })
      return metadata({ ...source, id, header, inheritedEventCount: eventCount, nextSeq: copied.length })
    }), 201)
  })
  app.post('/v1/organizations/:organizationId/sessions/:id/lease', async (c) => {
    const id = sessionId.parse(c.req.param('id'))
    const input = z
      .object({ writer: resourceId.optional() })
      .strict()
      .parse(await c.req.json())
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await activeRuntime(tx, tenant)
        const [session] = await tx.select().from(conversations).where(eq(conversations.id, id)).for('update')
        if (!session || session.accountId !== tenant.actor.id) forbidden()
        if (input.writer && (
          session.writer !== input.writer
          || !session.leaseUntil
          || session.leaseUntil <= new Date()
          || session.writerRuntimeId !== (tenant.actor.runtimeId ?? null)
        )) {
          throw new HTTPException(409, { message: 'Session write ownership lost' })
        }
        if (
          session.writer &&
          session.leaseUntil &&
          session.leaseUntil > new Date() &&
          session.writer !== input.writer
        ) {
          throw new HTTPException(409, { message: 'Session already has a writer' })
        }
        // An expired writer is never resurrected: a new token fences stale requests.
        const writer =
          session.leaseUntil && session.leaseUntil > new Date() && session.writer === input.writer
            ? session.writer
            : randomUUID()
        const leaseUntil = new Date(Date.now() + config.leaseSeconds * 1000)
        await tx.update(conversations)
          .set({ writer, leaseUntil, writerRuntimeId: tenant.actor.runtimeId ?? null })
          .where(eq(conversations.id, id))
        return { writer, leaseUntil, nextSeq: session.nextSeq }
      }),
    )
  })
  app.post('/v1/organizations/:organizationId/sessions/:id/events', async (c) => {
    const id = sessionId.parse(c.req.param('id'))
    const input = sessionAppend.parse(await c.req.json())
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await activeRuntime(tx, tenant)
        const [session] = await tx.select().from(conversations).where(eq(conversations.id, id)).for('update')
        if (!session || session.accountId !== tenant.actor.id) forbidden()
        if (
          session.writer !== input.writer
          || !session.leaseUntil
          || session.leaseUntil <= new Date()
          || session.writerRuntimeId !== (tenant.actor.runtimeId ?? null)
        ) {
          throw new HTTPException(409, { message: 'Session write ownership lost' })
        }
        const first = input.events[0]
        if (!first) throw new HTTPException(400, { message: 'Event batch is empty' })
        const start = first.seq
        if (input.events.some((item, index) => item.seq !== start + index))
          throw new HTTPException(409, { message: 'Noncontiguous event batch' })
        if (start < session.nextSeq) {
          const stored = await tx
            .select()
            .from(events)
            .where(and(eq(events.sessionId, id), gte(events.seq, start)))
            .orderBy(events.seq)
            .limit(input.events.length)
          const equal =
            stored.length === input.events.length &&
            stored.every(
              (row, index) => JSON.stringify(canonical(row.event)) === JSON.stringify(canonical(input.events[index])),
            )
          if (!equal) throw new HTTPException(409, { message: 'Conflicting event replay' })
          return { nextSeq: session.nextSeq }
        }
        if (start !== session.nextSeq) throw new HTTPException(409, { message: 'Session event gap' })
        await tx.insert(events).values(
          input.events.map(item => ({
            organizationId: tenant.organizationId,
            sessionId: id,
            seq: item.seq,
            event: item,
          })),
        )
        await tx
          .update(conversations)
          .set({ nextSeq: start + input.events.length })
          .where(eq(conversations.id, id))
        return { nextSeq: start + input.events.length }
      }),
    )
  })
  app.delete('/v1/organizations/:organizationId/sessions/:id/lease', async (c) => {
    const id = sessionId.parse(c.req.param('id'))
    const { writer } = z
      .object({ writer: resourceId })
      .strict()
      .parse(await c.req.json())
    await tenantOperation(c, async (tx, tenant) => {
      await tx
        .update(conversations)
        .set({ writer: null, leaseUntil: null, writerRuntimeId: null })
        .where(
          and(eq(conversations.id, id), eq(conversations.accountId, tenant.actor.id), eq(conversations.writer, writer),
            tenant.actor.runtimeId ? eq(conversations.writerRuntimeId, tenant.actor.runtimeId) : isNull(conversations.writerRuntimeId)),
        )
    })
    return c.json({ released: true })
  })
}

/** JSONB sorts object keys; equality ignores key order but preserves array order and values. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    )
  return value
}
