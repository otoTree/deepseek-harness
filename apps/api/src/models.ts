/** Platform-owned model directory. Upstream credentials never appear in tenant responses. */
import { randomUUID } from 'node:crypto'
import type { Hono } from 'hono'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as s from './schema.ts'
import { MAX_MODEL_TOKENS, modelInput, resourceId } from './contracts.ts'
import { encrypt, forbidden, requirePlatform } from './security.ts'
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
  app.delete('/v1/platform/models/:id', async (c) => {
    const id = resourceId.parse(c.req.param('id'))
    await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      const rows = await tx.delete(s.models).where(eq(s.models.id, id)).returning({ id: s.models.id })
      if (!rows.length) forbidden()
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
          .where(eq(s.models.enabled, true))
          .orderBy(asc(s.models.name))
      }),
    ),
  )
  mountGateway(app, services, tenantOperation)
}
