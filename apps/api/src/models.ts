/** Platform-owned model directory. Upstream credentials never appear in tenant responses. */
import { randomUUID } from 'node:crypto'
import type { Hono } from 'hono'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as s from './schema.ts'
import { MAX_MODEL_TOKENS, modelInput, modelPriceCny, resourceId } from './contracts.ts'
import { encrypt, forbidden, requirePlatform } from './security.ts'
import type { ApiEnv, Services, TenantOperation } from './application.ts'
import { modelUrl, mountGateway } from './gateway.ts'

const CNY_MICROS = 1_000_000
const toMicrosCny = (yuan: number): number => Math.round(yuan * CNY_MICROS)
const fromMicrosCny = (micros: number): number => micros / CNY_MICROS

const publicModel = ({ secret: _secret, inputMicrosPerMillion: _legacyInput,
  outputMicrosPerMillion: _legacyOutput, inputPriceMicrosCnyPerMillion,
  cachedInputPriceMicrosCnyPerMillion, outputPriceMicrosCnyPerMillion, ...model }: typeof s.models.$inferSelect) => ({
  ...model,
  inputPriceCnyPerMillion: fromMicrosCny(inputPriceMicrosCnyPerMillion),
  cachedInputPriceCnyPerMillion: fromMicrosCny(cachedInputPriceMicrosCnyPerMillion),
  outputPriceCnyPerMillion: fromMicrosCny(outputPriceMicrosCnyPerMillion),
})

/** Register platform administration and tenant model selection. */
export function mountModels(app: Hono<ApiEnv>, services: Services, tenantOperation: TenantOperation): void {
  const { db, config } = services
  app.get('/v1/platform/models', async c =>
    c.json(
      await db.transaction(async (tx) => {
        await requirePlatform(tx, c.get('actor'))
        const models = await tx.select().from(s.models)
        return models.map(publicModel)
      }),
    ),
  )
  app.post('/v1/platform/models', async (c) => {
    const input = modelInput.parse(await c.req.json())
    modelUrl(input.baseUrl)
    const id = randomUUID()
    await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      const { apiKey, inputPriceCnyPerMillion, cachedInputPriceCnyPerMillion,
        outputPriceCnyPerMillion, ...rest } = input
      await tx.insert(s.models).values({
        id,
        ...rest,
        secret: encrypt(apiKey, config.encryptionKey, id),
        inputMicrosPerMillion: 0,
        outputMicrosPerMillion: 0,
        inputPriceMicrosCnyPerMillion: toMicrosCny(inputPriceCnyPerMillion),
        cachedInputPriceMicrosCnyPerMillion: toMicrosCny(cachedInputPriceCnyPerMillion),
        outputPriceMicrosCnyPerMillion: toMicrosCny(outputPriceCnyPerMillion),
      })
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
        inputPriceCnyPerMillion: modelPriceCny.optional(),
        cachedInputPriceCnyPerMillion: modelPriceCny.optional(),
        outputPriceCnyPerMillion: modelPriceCny.optional(),
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
      const { apiKey, inputPriceCnyPerMillion, cachedInputPriceCnyPerMillion,
        outputPriceCnyPerMillion, ...rest } = input
      const prices = {
        ...(inputPriceCnyPerMillion === undefined ? {} : {
          inputPriceMicrosCnyPerMillion: toMicrosCny(inputPriceCnyPerMillion),
        }),
        ...(cachedInputPriceCnyPerMillion === undefined ? {} : {
          cachedInputPriceMicrosCnyPerMillion: toMicrosCny(cachedInputPriceCnyPerMillion),
        }),
        ...(outputPriceCnyPerMillion === undefined ? {} : {
          outputPriceMicrosCnyPerMillion: toMicrosCny(outputPriceCnyPerMillion),
        }),
      }
      const values = apiKey === undefined
        ? { ...rest, ...prices }
        : { ...rest, ...prices, secret: encrypt(apiKey, config.encryptionKey, id) }
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
