/** Platform-owned model directory. Upstream credentials never appear in tenant responses. */
import { randomUUID } from 'node:crypto'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as s from './schema.ts'
import { MAX_MODEL_TOKENS, modelInput, modelPriceCny, resourceId } from './contracts.ts'
import { encrypt, forbidden, requirePlatform } from './security.ts'
import type { ApiEnv, Services, TenantOperation } from './application.ts'
import { modelUrl, mountGateway } from './gateway.ts'
import type { GatewayMaintenance } from './gateway.ts'

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
export function mountModels(app: Hono<ApiEnv>, services: Services, tenantOperation: TenantOperation): GatewayMaintenance {
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
      const normalizedInputModalities = rest.inputModalities.includes('image') || rest.images
        ? [...new Set(['text', ...rest.inputModalities, 'image'])]
        : rest.inputModalities
      await tx.insert(s.models).values({
        id, ...rest, inputModalities: normalizedInputModalities,
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
        protocol: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']).optional(),
        inputModalities: z.array(z.enum(['text', 'image', 'video', 'audio', 'document'])).min(1).max(5).optional(),
        fileInputPolicy: z.enum(['unsupported', 'inline', 'provider-files']).optional(),
        maxFileBytes: z.number().int().min(1).max(512 * 1024 * 1024).optional(),
        maxRequestBytes: z.number().int().min(1).max(512 * 1024 * 1024).optional(),
        filesTtlSeconds: z.number().int().min(60).max(30 * 24 * 60 * 60).optional(),
        fileUploadTimeoutMs: z.number().int().min(1_000).max(10 * 60 * 1_000).optional(),
        fileUploadMaxRetries: z.number().int().min(0).max(10).optional(),
        fileRefreshMarginSeconds: z.number().int().min(0).max(30 * 24 * 60 * 60).optional(),
        fileQuotaCleanupBatch: z.number().int().min(0).max(10_000).optional(),
        enabled: z.boolean().optional(),
      })
      .strict()
      .parse(await c.req.json())
    if (input.baseUrl) modelUrl(input.baseUrl)
    await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      const [current] = await tx.select().from(s.models).where(eq(s.models.id, id))
      if (!current) forbidden()
      const { apiKey, inputPriceCnyPerMillion, cachedInputPriceCnyPerMillion,
        outputPriceCnyPerMillion, ...rest } = input
      const maxFileBytes = rest.maxFileBytes ?? current.maxFileBytes
      const maxRequestBytes = rest.maxRequestBytes ?? current.maxRequestBytes
      const filesTtlSeconds = rest.filesTtlSeconds ?? current.filesTtlSeconds
      const fileRefreshMarginSeconds = rest.fileRefreshMarginSeconds ?? current.fileRefreshMarginSeconds
      const inputModalities = rest.inputModalities ?? current.inputModalities
      const fileInputPolicy = rest.fileInputPolicy ?? current.fileInputPolicy
      if (maxRequestBytes < maxFileBytes) {
        throw new HTTPException(400, { message: 'Request limit must include one maximum-size file' })
      }
      if (fileRefreshMarginSeconds >= filesTtlSeconds) {
        throw new HTTPException(400, { message: 'Refresh margin must be shorter than provider file lifetime' })
      }
      if (inputModalities.some(modality => !['text', 'image'].includes(modality)) && fileInputPolicy === 'unsupported') {
        throw new HTTPException(400, { message: 'Native file modalities require a file input policy' })
      }
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
      const modalityValues = rest.inputModalities === undefined && rest.images !== true
        ? {}
        : { inputModalities: (rest.inputModalities ?? ['text']).includes('image') || rest.images
          ? [...new Set(['text', ...(rest.inputModalities ?? []), 'image'])]
          : rest.inputModalities }
      const values = apiKey === undefined
        ? { ...rest, ...modalityValues, ...prices }
        : { ...rest, ...modalityValues, ...prices, secret: encrypt(apiKey, config.encryptionKey, id) }
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
            protocol: s.models.protocol,
            inputModalities: s.models.inputModalities,
            fileInputPolicy: s.models.fileInputPolicy,
            maxFileBytes: s.models.maxFileBytes,
            maxRequestBytes: s.models.maxRequestBytes,
            filesTtlSeconds: s.models.filesTtlSeconds,
            fileUploadTimeoutMs: s.models.fileUploadTimeoutMs,
            fileUploadMaxRetries: s.models.fileUploadMaxRetries,
            fileRefreshMarginSeconds: s.models.fileRefreshMarginSeconds,
            fileQuotaCleanupBatch: s.models.fileQuotaCleanupBatch,
            contextTokens: s.models.contextTokens,
            maxOutputTokens: s.models.maxOutputTokens,
          })
          .from(s.models)
          .where(eq(s.models.enabled, true))
          .orderBy(asc(s.models.name))
      }),
    ),
  )
  return mountGateway(app, services, tenantOperation)
}
