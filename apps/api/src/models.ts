/** Platform-owned model directory. Upstream credentials never appear in tenant responses. */
import { randomUUID } from 'node:crypto'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import * as s from './schema.ts'
import { MAX_MODEL_TOKENS, modelInput, resourceId, organizationId } from './contracts.ts'
import { selectOrganization } from './database.ts'
import { encrypt, forbidden, recordAudit, requirePlatform, requireRole } from './security.ts'
import type { ApiEnv, Services, TenantOperation } from './application.ts'
import { modelUrl, mountGateway } from './gateway.ts'

/** Register platform administration and tenant model selection. */
export function mountModels(app: Hono<ApiEnv>, services: Services, tenantOperation: TenantOperation): void {
  const { db, config } = services
  app.get('/v1/platform/models', async c =>
    c.json(
      await db.transaction(async (tx) => {
        await requirePlatform(tx, c.get('actor'))
        const models = await tx.select().from(s.models)
        return models.map(({ secret: _secret, ...model }) => model)
      }),
    ),
  )
  app.post('/v1/platform/models', async (c) => {
    const input = modelInput.parse(await c.req.json())
    modelUrl(input.baseUrl)
    const id = randomUUID()
    await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      const { apiKey, ...rest } = input
      await tx.insert(s.models).values({ id, ...rest, secret: encrypt(apiKey, config.encryptionKey, id) })
    })
    return c.json({ id }, 201)
  })
  app.patch('/v1/platform/models/:id', async (c) => {
    const id = resourceId.parse(c.req.param('id'))
    const input = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        baseUrl: z.url().optional(),
        upstreamModel: z.string().min(1).max(200).optional(),
        apiKey: z.string().min(1).max(4096).optional(),
        inputMicrosPerMillion: z.number().int().min(0).max(1_000_000_000).optional(),
        outputMicrosPerMillion: z.number().int().min(0).max(1_000_000_000).optional(),
        maxOutputTokens: z.number().int().min(1).max(MAX_MODEL_TOKENS).optional(),
        contextTokens: z.number().int().min(1024).max(MAX_MODEL_TOKENS).optional(),
        images: z.boolean().optional(),
        enabled: z.boolean().optional(),
      })
      .strict()
      .parse(await c.req.json())
    if (input.baseUrl) modelUrl(input.baseUrl)
    await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      const { apiKey, ...rest } = input
      const values = apiKey === undefined
        ? rest
        : { ...rest, secret: encrypt(apiKey, config.encryptionKey, id) }
      const rows = await tx.update(s.models).set(values).where(eq(s.models.id, id)).returning({ id: s.models.id })
      if (!rows.length) forbidden()
    })
    return c.json({ id })
  })
  app.delete('/v1/platform/models/:id', async c => {
    const id = resourceId.parse(c.req.param('id'))
    await db.transaction(async tx => {
      await requirePlatform(tx, c.get('actor'))
      const grants = await tx.select({ organizationId: s.modelGrants.organizationId }).from(s.modelGrants).where(eq(s.modelGrants.modelId, id))
      if (grants.length) throw new HTTPException(409, { message: 'Model is still assigned to an organization' })
      const rows = await tx.delete(s.models).where(eq(s.models.id, id)).returning({ id: s.models.id })
      if (!rows.length) forbidden()
    })
    return c.json({ id })
  })
  app.put('/v1/platform/organizations/:organizationId/models/:id', async (c) => {
    const id = resourceId.parse(c.req.param('id'))
    const orgId = organizationId.parse(c.req.param('organizationId'))
    const input = z
      .object({ enabled: z.boolean(), priority: z.number().int().positive().max(1_000_000).optional(), isDefault: z.boolean().optional() })
      .strict()
      .parse(await c.req.json())
    await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      await selectOrganization(tx, orgId)
      const [model] = await tx.select({ id: s.models.id, enabled: s.models.enabled }).from(s.models).where(eq(s.models.id, id))
      if (!model) forbidden()
      if (input.isDefault && input.enabled === false) throw new HTTPException(400, { message: 'Default model must be enabled' })
      if (input.isDefault && !model.enabled) throw new HTTPException(400, { message: 'Default model must be platform-enabled' })
      if (!input.enabled) {
        await tx.delete(s.modelGrants).where(and(eq(s.modelGrants.organizationId, orgId), eq(s.modelGrants.modelId, id)))
      } else {
        if (input.isDefault) await tx.update(s.modelGrants).set({ isDefault: false, updatedAt: new Date() }).where(eq(s.modelGrants.organizationId, orgId))
        await tx.insert(s.modelGrants).values({ organizationId: orgId, modelId: id, priority: input.priority ?? 100, isDefault: input.isDefault ?? false, updatedAt: new Date() })
          .onConflictDoUpdate({ target: [s.modelGrants.organizationId, s.modelGrants.modelId], set: { enabled: true, ...(input.priority === undefined ? {} : { priority: input.priority }), ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }), updatedAt: new Date() } })
      }
      await recordAudit(tx, { actor, organizationId: orgId, membershipId: '' }, 'model.grant', id, input)
    })
    return c.json({ id })
  })
  app.get('/v1/platform/organizations/:organizationId/models', async c => {
    const orgId = organizationId.parse(c.req.param('organizationId'))
    return c.json(await db.transaction(async tx => {
      await requirePlatform(tx, c.get('actor'))
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      await selectOrganization(tx, orgId)
      return tx.select({
        id: s.models.id, name: s.models.name, enabled: s.models.enabled, images: s.models.images,
        contextTokens: s.models.contextTokens, maxOutputTokens: s.models.maxOutputTokens,
        organizationId: s.modelGrants.organizationId, modelEnabled: s.modelGrants.enabled,
        priority: s.modelGrants.priority, isDefault: s.modelGrants.isDefault,
      }).from(s.models).leftJoin(s.modelGrants, and(
        eq(s.modelGrants.modelId, s.models.id),
        eq(s.modelGrants.organizationId, orgId),
      )).orderBy(asc(s.modelGrants.priority), asc(s.models.name))
    }))
  })
  app.patch('/v1/platform/organizations/:organizationId/models/:id', async c => {
    const orgId = organizationId.parse(c.req.param('organizationId'))
    const id = resourceId.parse(c.req.param('id'))
    const input = z.object({ enabled: z.boolean().optional(), priority: z.number().int().positive().max(1_000_000).optional(), isDefault: z.boolean().optional() }).strict().parse(await c.req.json())
    return c.json(await db.transaction(async tx => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      await selectOrganization(tx, orgId)
      if (input.isDefault) await tx.update(s.modelGrants).set({ isDefault: false, updatedAt: new Date() }).where(eq(s.modelGrants.organizationId, orgId))
      const values = { ...input, ...(input.enabled === false ? { isDefault: false } : {}), updatedAt: new Date() }
      const rows = await tx.update(s.modelGrants).set(values).where(and(eq(s.modelGrants.organizationId, orgId), eq(s.modelGrants.modelId, id))).returning()
      if (!rows.length) forbidden()
      await recordAudit(tx, { actor, organizationId: orgId, membershipId: '' }, 'model.grant.updated', id, input)
      return rows[0]
    }))
  })
  app.patch('/v1/organizations/:organizationId/models/:id', async (c) => {
    const id = resourceId.parse(c.req.param('id'))
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(await c.req.json())
    await tenantOperation(c, async (tx, tenant) => {
      await requireRole(tx, tenant, ['owner', 'administrator'])
      const updated = await tx.update(s.modelGrants).set({ enabled }).where(and(
        eq(s.modelGrants.organizationId, tenant.organizationId),
        eq(s.modelGrants.modelId, id),
      )).returning()
      if (!updated.length) forbidden()
      await recordAudit(tx, tenant, 'model.restricted', id, { enabled })
    })
    return c.json({ id })
  })
  app.get('/v1/organizations/:organizationId/models', async c =>
    c.json(
      await tenantOperation(c, async (tx) => {
        return tx
          .select({
            id: s.models.id,
            name: s.models.name,
            images: s.models.images,
            contextTokens: s.models.contextTokens,
            maxOutputTokens: s.models.maxOutputTokens,
            priority: s.modelGrants.priority,
            isDefault: s.modelGrants.isDefault,
          })
          .from(s.models)
          .innerJoin(s.modelGrants, eq(s.modelGrants.modelId, s.models.id))
          .where(and(eq(s.models.enabled, true), eq(s.modelGrants.enabled, true)))
          .orderBy(asc(s.modelGrants.priority), asc(s.models.name))
      }),
    ),
  )
  mountGateway(app, services, tenantOperation)
}
