/** Platform-owned model directory. Upstream credentials never appear in tenant responses. */
import { randomUUID } from 'node:crypto'
import type { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as s from './schema.ts'
import { modelInput, resourceId, organizationId } from './contracts.ts'
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
    modelUrl(input.baseUrl, config.allowedModelOrigins)
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
      .object({ enabled: z.boolean() })
      .strict()
      .parse(await c.req.json())
    await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      const rows = await tx.update(s.models).set(input).where(eq(s.models.id, id)).returning({ id: s.models.id })
      if (!rows.length) forbidden()
    })
    return c.json({ id })
  })
  app.put('/v1/platform/organizations/:organizationId/models/:id', async (c) => {
    const id = resourceId.parse(c.req.param('id'))
    const orgId = organizationId.parse(c.req.param('organizationId'))
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(await c.req.json())
    await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await selectOrganization(tx, orgId)
      if (enabled) await tx.insert(s.modelGrants).values({ organizationId: orgId, modelId: id }).onConflictDoNothing()
      else await tx.delete(s.modelGrants).where(and(eq(s.modelGrants.organizationId, orgId), eq(s.modelGrants.modelId, id)))
      await recordAudit(tx, { actor, organizationId: orgId, membershipId: '' }, 'model.grant', id, { enabled })
    })
    return c.json({ id })
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
          })
          .from(s.models)
          .innerJoin(s.modelGrants, eq(s.modelGrants.modelId, s.models.id))
          .where(and(eq(s.models.enabled, true), eq(s.modelGrants.enabled, true)))
      }),
    ),
  )
  mountGateway(app, services, tenantOperation)
}
