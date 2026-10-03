/** Administration workflows that require durable approval and history records. */
import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { ApiEnv, Services, TenantOperation } from './application.ts'
import type { Transaction } from './database.ts'
import * as s from './schema.ts'
import { forbidden, recordAudit, requirePermission, requirePlatform, requireRole } from './security.ts'
import * as wire from './contracts.ts'

const decisionInput = z.object({ decision: z.enum(['approved', 'rejected']), version: z.number().int().positive() }).strict()
const bulkDecisionInput = z.object({ runId: wire.resourceId, decision: z.enum(['approved', 'rejected']), limit: z.number().int().min(1).max(1_000).default(1_000) }).strict()
const mappingInput = z.object({
  sourceField: z.string().trim().min(1).max(160),
  targetField: z.string().trim().min(1).max(160),
  transform: z.enum(['direct', 'lowercase', 'uppercase', 'split', 'join']).default('direct'),
  required: z.boolean().default(false),
  version: z.number().int().positive().optional(),
}).strict()

function inverseChange(changeType: string): 'create' | 'update' | 'disable' | 'delete' {
  if (changeType === 'create') return 'delete'
  if (changeType === 'delete') return 'create'
  return changeType === 'disable' ? 'update' : 'update'
}

function directoryRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Apply the directory entity types backed by the current tenant schema. */
async function applyDirectoryDiff(tx: Transaction, diff: typeof s.syncDiffs.$inferSelect, tenant: { organizationId: string; actor: { id: string } }): Promise<void> {
  const after = directoryRecord(diff.after)
  if (diff.entityType === 'organization') {
    const name = typeof after.name === 'string' ? after.name.trim() : ''
    if (diff.changeType === 'create') {
      if (!name) throw new HTTPException(422, { message: 'Organization diff is missing a name' })
      await tx.insert(s.organizations).values({ id: diff.externalId, name, kind: typeof after.kind === 'string' ? after.kind : 'team', parentId: typeof after.parentExternalId === 'string' ? after.parentExternalId : typeof after.parentId === 'string' ? after.parentId : tenant.organizationId, rootId: tenant.organizationId })
      return
    }
    if (diff.changeType === 'delete') {
      await tx.update(s.organizations).set({ status: 'suspended' }).where(and(eq(s.organizations.id, diff.externalId), eq(s.organizations.rootId, tenant.organizationId)))
      return
    }
    if (!name) throw new HTTPException(422, { message: 'Organization diff is missing a name' })
    const updated = await tx.update(s.organizations).set({ name, status: after.status === 'suspended' ? 'suspended' : 'active' }).where(eq(s.organizations.id, diff.externalId)).returning({ id: s.organizations.id })
    if (!updated.length) await tx.insert(s.organizations).values({ id: diff.externalId, name, kind: typeof after.kind === 'string' ? after.kind : 'team', parentId: typeof after.parentExternalId === 'string' ? after.parentExternalId : tenant.organizationId, rootId: tenant.organizationId })
    return
  }
  if (diff.entityType === 'user') {
    const email = typeof after.email === 'string' ? after.email.trim().toLowerCase() : ''
    const name = typeof after.name === 'string' ? after.name.trim() : ''
    if (!email || !name) throw new HTTPException(422, { message: 'User diff is missing email or name' })
    const [existing] = await tx.select({ id: s.user.id }).from(s.user).where(eq(s.user.id, diff.externalId))
    if (diff.changeType === 'create' && !existing) {
      await tx.insert(s.user).values({ id: diff.externalId, email, name, emailVerified: true })
      return
    }
    if (!existing && diff.changeType !== 'create') throw new HTTPException(422, { message: `User ${diff.externalId} does not exist` })
    const updated = await tx.update(s.user).set({ email, name, updatedAt: new Date() }).where(eq(s.user.id, diff.externalId)).returning({ id: s.user.id })
    if (!updated.length) await tx.insert(s.user).values({ id: diff.externalId, email, name, emailVerified: true })
    if (diff.changeType === 'delete' || diff.changeType === 'disable' || after.active === false) {
      await tx.update(s.memberships).set({ status: 'suspended' }).where(and(eq(s.memberships.organizationId, tenant.organizationId), eq(s.memberships.accountId, diff.externalId)))
    }
    return
  }
  if (diff.entityType === 'membership') {
    const accountId = typeof after.userExternalId === 'string' ? after.userExternalId : typeof after.accountId === 'string' ? after.accountId : ''
    const organizationId = typeof after.organizationExternalId === 'string' ? after.organizationExternalId : tenant.organizationId
    if (!accountId) throw new HTTPException(422, { message: 'Membership diff is missing userExternalId' })
    if (diff.changeType === 'delete' || diff.changeType === 'disable') {
      await tx.update(s.memberships).set({ status: 'suspended' }).where(and(eq(s.memberships.id, diff.externalId), eq(s.memberships.organizationId, organizationId)))
      return
    }
    const [existing] = await tx.select({ id: s.memberships.id }).from(s.memberships).where(eq(s.memberships.id, diff.externalId))
    if (!existing) await tx.insert(s.memberships).values({ id: diff.externalId, organizationId, accountId, status: 'active' })
    else await tx.update(s.memberships).set({ status: 'active', accountId, organizationId }).where(eq(s.memberships.id, diff.externalId))
    return
  }
  throw new HTTPException(422, { message: `Unsupported directory entity type: ${diff.entityType}` })
}

function maskSubject(value: string): string {
  const normalized = value.trim().toLowerCase()
  const [local, domain] = normalized.split('@')
  if (!local || !domain) return normalized.length <= 4 ? '***' : `${normalized.slice(0, 2)}***`
  return `${local.slice(0, 1)}***@${domain}`
}

/** Mount durable approval, mapping, rollback, runtime-detail and health routes. */
export function mountAdminGovernance(app: Hono<ApiEnv>, services: Services, tenantOperation: TenantOperation): void {
  const { db } = services

  app.get('/v1/organizations/:organizationId/sync-diffs', async c => c.json(await tenantOperation(c, async (tx, tenant) => {
    await requirePermission(tx, tenant, 'directory.sync')
    const status = c.req.query('status')
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100), 1), 250)
    return tx.select().from(s.syncDiffs).where(and(
      eq(s.syncDiffs.organizationId, tenant.organizationId),
      status ? eq(s.syncDiffs.status, status) : undefined,
    )).orderBy(desc(s.syncDiffs.createdAt)).limit(limit)
  })))

  app.post('/v1/organizations/:organizationId/sync-diffs/bulk', async (c) => {
    const input = bulkDecisionInput.parse(await c.req.json())
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'directory.sync')
      const pending = await tx.select().from(s.syncDiffs).where(and(
        eq(s.syncDiffs.organizationId, tenant.organizationId), eq(s.syncDiffs.runId, input.runId), eq(s.syncDiffs.status, 'pending'),
      )).orderBy(s.syncDiffs.createdAt).limit(input.limit).for('update')
      for (const diff of pending) {
        if (input.decision === 'approved') await applyDirectoryDiff(tx, diff, tenant)
        await tx.update(s.syncDiffs).set({ status: input.decision, version: diff.version + 1, decidedBy: tenant.actor.id, decidedAt: new Date() }).where(and(eq(s.syncDiffs.id, diff.id), eq(s.syncDiffs.version, diff.version)))
      }
      await recordAudit(tx, tenant, `sync_diff.bulk_${input.decision}`, input.runId, { count: pending.length })
      return { runId: input.runId, decision: input.decision, processed: pending.length, remaining: pending.length === input.limit }
    }))
  })

  app.patch('/v1/organizations/:organizationId/sync-diffs/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    const input = decisionInput.parse(await c.req.json())
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'directory.sync')
      const [current] = await tx.select().from(s.syncDiffs).where(and(
        eq(s.syncDiffs.id, id), eq(s.syncDiffs.organizationId, tenant.organizationId),
      )).for('update')
      if (!current) forbidden()
      if (current.status !== 'pending' || current.version !== input.version) {
        throw new HTTPException(409, { message: 'Sync diff changed before the decision was saved' })
      }
      if (input.decision === 'approved') await applyDirectoryDiff(tx, current, tenant)
      const [updated] = await tx.update(s.syncDiffs).set({
        status: input.decision,
        version: current.version + 1,
        decidedBy: tenant.actor.id,
        decidedAt: new Date(),
      }).where(and(eq(s.syncDiffs.id, id), eq(s.syncDiffs.version, input.version))).returning()
      if (!updated) throw new HTTPException(409, { message: 'Sync diff changed before the decision was saved' })
      await recordAudit(tx, tenant, `sync_diff.${input.decision}`, id, { runId: current.runId, version: updated.version })
      return updated
    }))
  })

  app.get('/v1/organizations/:organizationId/sync-rollbacks', async c => c.json(await tenantOperation(c, async (tx, tenant) => {
    await requirePermission(tx, tenant, 'directory.sync')
    return tx.select().from(s.syncRollbacks).where(eq(s.syncRollbacks.organizationId, tenant.organizationId))
      .orderBy(desc(s.syncRollbacks.createdAt)).limit(100)
  })))

  app.post('/v1/organizations/:organizationId/sync-runs/:id/rollback', async (c) => {
    const sourceRunId = wire.resourceId.parse(c.req.param('id'))
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'directory.sync')
      const [source] = await tx.select().from(s.syncRuns).where(and(
        eq(s.syncRuns.id, sourceRunId), eq(s.syncRuns.organizationId, tenant.organizationId),
      )).for('update')
      if (!source) forbidden()
      if (source.status === 'failed') throw new HTTPException(409, { message: 'A failed run has no applied state to roll back' })
      const sourceDiffs = await tx.select().from(s.syncDiffs).where(and(eq(s.syncDiffs.runId, sourceRunId), eq(s.syncDiffs.organizationId, tenant.organizationId)))
      if (!sourceDiffs.length) throw new HTTPException(409, { message: 'The selected run has no recorded diffs to roll back' })
      const rollbackId = randomUUID()
      const compensatingRunId = randomUUID()
      await tx.insert(s.syncRuns).values({
        id: compensatingRunId,
        organizationId: tenant.organizationId,
        scriptId: source.scriptId,
        trigger: 'rollback',
        status: 'preview',
        preview: { rollbackOf: sourceRunId, sourcePreview: source.preview, diffCount: sourceDiffs.length },
        startedAt: new Date(),
        finishedAt: new Date(),
      })
      await tx.insert(s.syncRollbacks).values({
        id: rollbackId,
        organizationId: tenant.organizationId,
        sourceRunId,
        compensatingRunId,
        status: 'queued',
        requestedBy: tenant.actor.id,
      })
      await tx.insert(s.syncDiffs).values(sourceDiffs.map(diff => ({
        id: randomUUID(), organizationId: tenant.organizationId, runId: compensatingRunId,
        entityType: diff.entityType, externalId: diff.externalId, changeType: inverseChange(diff.changeType),
        before: diff.after, after: diff.before,
      })))
      await recordAudit(tx, tenant, 'sync.rollback_created', rollbackId, { sourceRunId, compensatingRunId })
      return { id: rollbackId, sourceRunId, compensatingRunId, status: 'queued' as const, diffCount: sourceDiffs.length }
    }), 201)
  })

  app.get('/v1/organizations/:organizationId/identity-providers/:providerId/mappings', async (c) => {
    const providerId = wire.resourceId.parse(c.req.param('providerId'))
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'identity.manage')
      return tx.select().from(s.identityFieldMappings).where(and(
        eq(s.identityFieldMappings.organizationId, tenant.organizationId),
        eq(s.identityFieldMappings.providerId, providerId),
      )).orderBy(s.identityFieldMappings.sourceField)
    }))
  })

  app.put('/v1/organizations/:organizationId/identity-providers/:providerId/mappings', async (c) => {
    const providerId = wire.resourceId.parse(c.req.param('providerId'))
    const input = z.array(mappingInput).max(100).parse(await c.req.json())
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'identity.manage')
      const [provider] = await tx.select({ id: s.identityProviders.id }).from(s.identityProviders).where(and(
        eq(s.identityProviders.id, providerId), eq(s.identityProviders.organizationId, tenant.organizationId),
      ))
      if (!provider) forbidden()
      const current = await tx.select().from(s.identityFieldMappings).where(and(
        eq(s.identityFieldMappings.organizationId, tenant.organizationId),
        eq(s.identityFieldMappings.providerId, providerId),
      )).for('update')
      const currentBySource = new Map(current.map(item => [item.sourceField, item]))
      for (const item of input) {
        const existing = currentBySource.get(item.sourceField)
        if (existing && item.version !== existing.version) {
          throw new HTTPException(409, { message: `Mapping ${item.sourceField} changed before save` })
        }
      }
      await tx.delete(s.identityFieldMappings).where(and(
        eq(s.identityFieldMappings.organizationId, tenant.organizationId),
        eq(s.identityFieldMappings.providerId, providerId),
      ))
      if (input.length) await tx.insert(s.identityFieldMappings).values(input.map(item => ({
        id: randomUUID(), organizationId: tenant.organizationId, providerId,
        sourceField: item.sourceField, targetField: item.targetField, transform: item.transform,
        required: item.required, version: (currentBySource.get(item.sourceField)?.version ?? 0) + 1,
      })))
      await recordAudit(tx, tenant, 'identity_mapping.updated', providerId, { fields: input.map(item => item.sourceField) })
      return tx.select().from(s.identityFieldMappings).where(eq(s.identityFieldMappings.providerId, providerId))
    }))
  })

  app.get('/v1/organizations/:organizationId/identity-login-failures', async c => c.json(await tenantOperation(c, async (tx, tenant) => {
    await requirePermission(tx, tenant, 'identity.manage')
    return tx.select({
      id: s.identityLoginFailures.id,
      providerId: s.identityLoginFailures.providerId,
      subjectHint: s.identityLoginFailures.subjectHint,
      reasonCode: s.identityLoginFailures.reasonCode,
      occurredAt: s.identityLoginFailures.occurredAt,
      detail: s.identityLoginFailures.detail,
    }).from(s.identityLoginFailures).where(eq(s.identityLoginFailures.organizationId, tenant.organizationId))
      .orderBy(desc(s.identityLoginFailures.occurredAt)).limit(200)
  })))

  app.post('/v1/organizations/:organizationId/identity-login-failures', async (c) => {
    const input = z.object({
      providerId: wire.resourceId.nullable().default(null),
      subject: z.string().min(1).max(320),
      reasonCode: z.string().min(1).max(120),
      ipAddress: z.string().max(160).optional(),
      detail: z.record(z.string(), z.unknown()).default({}),
    }).strict().parse(await c.req.json())
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'identity.manage')
      const id = randomUUID()
      await tx.insert(s.identityLoginFailures).values({
        id, organizationId: tenant.organizationId, providerId: input.providerId,
        subjectHint: maskSubject(input.subject), reasonCode: input.reasonCode,
        ipHash: input.ipAddress ? createHash('sha256').update(input.ipAddress).digest('hex') : null,
        detail: input.detail,
      })
      await recordAudit(tx, tenant, 'identity_login_failure.recorded', id, { providerId: input.providerId, reasonCode: input.reasonCode })
      return { id }
    }), 201)
  })

  app.get('/v1/organizations/:organizationId/session-approvals', async c => c.json(await tenantOperation(c, async (tx, tenant) => {
    await requirePermission(tx, tenant, 'session.read')
    const status = c.req.query('status')
    return tx.select().from(s.sessionApprovals).where(and(
      eq(s.sessionApprovals.organizationId, tenant.organizationId),
      status ? eq(s.sessionApprovals.status, status) : undefined,
    )).orderBy(desc(s.sessionApprovals.createdAt)).limit(200)
  })))

  app.post('/v1/organizations/:organizationId/session-approvals', async (c) => {
    const input = z.object({ sessionId: wire.resourceId, action: z.enum(['read', 'export', 'share']), reason: z.string().max(1000).default('') }).strict().parse(await c.req.json())
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'session.read')
      const [session] = await tx.select({ id: s.conversations.id }).from(s.conversations).where(and(
        eq(s.conversations.id, input.sessionId), eq(s.conversations.organizationId, tenant.organizationId),
      ))
      if (!session) forbidden()
      const id = randomUUID()
      await tx.insert(s.sessionApprovals).values({ id, organizationId: tenant.organizationId, requesterId: tenant.actor.id, ...input })
      await recordAudit(tx, tenant, 'session_approval.requested', id, { sessionId: input.sessionId, action: input.action })
      return { id, status: 'pending' as const, version: 1 }
    }), 201)
  })

  app.patch('/v1/organizations/:organizationId/session-approvals/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    const input = decisionInput.parse(await c.req.json())
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requireRole(tx, tenant, ['owner', 'administrator', 'security_reviewer'])
      const [current] = await tx.select().from(s.sessionApprovals).where(and(
        eq(s.sessionApprovals.id, id), eq(s.sessionApprovals.organizationId, tenant.organizationId),
      )).for('update')
      if (!current) forbidden()
      if (current.status !== 'pending' || current.version !== input.version) {
        throw new HTTPException(409, { message: 'Session approval changed before the decision was saved' })
      }
      const [updated] = await tx.update(s.sessionApprovals).set({
        status: input.decision, version: current.version + 1, decidedBy: tenant.actor.id, decidedAt: new Date(),
      }).where(and(eq(s.sessionApprovals.id, id), eq(s.sessionApprovals.version, input.version))).returning()
      if (!updated) throw new HTTPException(409, { message: 'Session approval changed before the decision was saved' })
      await recordAudit(tx, tenant, `session_approval.${input.decision}`, id, { sessionId: current.sessionId })
      return updated
    }))
  })

  app.get('/v1/organizations/:organizationId/role-bindings', async c => c.json(await tenantOperation(c, async (tx, tenant) => {
    await requirePermission(tx, tenant, 'role.manage')
    return tx.select().from(s.roles).where(eq(s.roles.organizationId, tenant.organizationId)).limit(500)
  })))

  app.get('/v1/platform/runtimes/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    return c.json(await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const [runtime] = await tx.select().from(s.runtimes).where(eq(s.runtimes.id, id))
      if (!runtime) throw new HTTPException(404, { message: 'Runtime not found' })
      const [account] = await tx.select({ id: s.user.id, name: s.user.name, email: s.user.email }).from(s.user).where(eq(s.user.id, runtime.accountId))
      const audit = await tx.select().from(s.audit).where(eq(s.audit.resourceId, id)).orderBy(desc(s.audit.createdAt)).limit(50)
      return { runtime: { ...runtime, tokenHash: undefined }, account, audit }
    }))
  })

  app.get('/v1/platform/runtimes', async c => c.json(await db.transaction(async (tx) => {
    await requirePlatform(tx, c.get('actor'))
    await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
    return tx.select({
      id: s.runtimes.id,
      organizationId: s.runtimes.organizationId,
      accountId: s.runtimes.accountId,
      name: s.runtimes.name,
      type: s.runtimes.type,
      version: s.runtimes.version,
      leaseUntil: s.runtimes.leaseUntil,
      revokedAt: s.runtimes.revokedAt,
      createdAt: s.runtimes.createdAt,
    }).from(s.runtimes).orderBy(desc(s.runtimes.createdAt)).limit(500)
  })))

  app.get('/v1/platform/health', async c => c.json(await db.transaction(async (tx) => {
    await requirePlatform(tx, c.get('actor'))
    const started = Date.now()
    await tx.execute(sql`select 1 as ok`)
    const databaseLatencyMs = Date.now() - started
    return {
      checkedAt: new Date().toISOString(),
      services: [
        { id: 'api', label: 'Enterprise API', status: 'ready', latencyMs: 0, availability: null },
        { id: 'database', label: 'PostgreSQL', status: 'ready', latencyMs: databaseLatencyMs, availability: null },
        { id: 'identity', label: 'Identity providers', status: 'unknown', latencyMs: null, availability: null },
        { id: 'directory', label: 'Directory workers', status: 'unknown', latencyMs: null, availability: null },
        { id: 'runtime', label: 'Runtime fleet', status: 'unknown', latencyMs: null, availability: null },
      ],
    }
  })))
}
