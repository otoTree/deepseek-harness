import { textPriceDescriptor } from './model-money.ts'
import { taskConfigSchema, taskPriceUnits } from './model-task-rules.ts'
import { resolveProvider } from './model-providers.ts'
/** Platform-owned model directory. Upstream configuration appears only in platform-administrator responses. */
import { randomUUID } from 'node:crypto'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { asc, eq, sql, and, or, isNull } from 'drizzle-orm'
import { z } from 'zod'
import * as s from './schema.ts'
import { MAX_MODEL_TOKENS, modelInput, modelPriceCny, resourceId } from './contracts.ts'
import { encrypt, forbidden, requirePlatform } from './security.ts'
import type { ApiEnv, Services, TenantOperation } from './application.ts'
import { modelUrl } from './gateway.ts'

const CNY_MICROS = 1_000_000
const toMicrosCny = (yuan: number): number => Math.round(yuan * CNY_MICROS)
const fromMicrosCny = (micros: number): number => micros / CNY_MICROS

const platformAdminModel = ({ secret: _secret, inputMicrosPerMillion: _legacyInput,
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
        return models.map(platformAdminModel)
      }),
    ),
  )
  app.post('/v1/platform/models', async (c) => {
    const input = modelInput.parse(await c.req.json())
    if (input.baseUrl) modelUrl(input.baseUrl)
    const id = randomUUID()
    await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const { apiKey, providerId: requestedProviderId, baseUrl, inputPriceCnyPerMillion, cachedInputPriceCnyPerMillion,
        outputPriceCnyPerMillion, ...rest } = input
      const providerId = requestedProviderId ?? id
      if (!requestedProviderId) {
        await tx.insert(s.modelProviders).values({ id: providerId, name: input.name })
        await tx.insert(s.modelProviderVersions).values({
          providerId, version: 1, baseUrl: baseUrl as string, secret: encrypt(apiKey as string, config.encryptionKey, id),
          credentialBinding: id, timeoutMs: input.modelCallTimeoutMs, retryableHttpStatuses: [429, 500, 502, 503, 504],
        })
      }
      const provider = await resolveProvider(tx, providerId)
      const normalizedInputModalities = rest.inputModalities.includes('image') || rest.images
        ? [...new Set(['text', ...rest.inputModalities, 'image'])]
        : rest.inputModalities
      await tx.insert(s.models).values({
        id, ...rest, providerId, baseUrl: provider.baseUrl, inputModalities: normalizedInputModalities,
        secret: provider.secret,
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
        providerId: resourceId.optional(),
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
        videoAudioMode: z.enum(['visual-only', 'visual-and-audio']).optional(),
        fileInputPolicy: z.enum(['unsupported', 'inline', 'provider-files']).optional(),
        maxFileBytes: z.number().int().min(1).max(512 * 1024 * 1024).optional(),
        maxRequestBytes: z.number().int().min(1).max(512 * 1024 * 1024).optional(),
        filesTtlSeconds: z.number().int().min(60).max(30 * 24 * 60 * 60).optional(),
        fileUploadTimeoutMs: z.number().int().min(1_000).max(10 * 60 * 1_000).optional(),
        fileUploadMaxRetries: z.number().int().min(0).max(10).optional(),
        fileRefreshMarginSeconds: z.number().int().min(0).max(30 * 24 * 60 * 60).optional(),
        fileQuotaCleanupBatch: z.number().int().min(0).max(10_000).optional(),
        modelCallTimeoutMs: z.number().int().min(1_000).max(30 * 60 * 1_000).optional(),
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
      const videoAudioMode = rest.videoAudioMode ?? current.videoAudioMode
      const fileInputPolicy = rest.fileInputPolicy ?? current.fileInputPolicy
      if (maxRequestBytes < maxFileBytes) {
        throw new HTTPException(400, { message: 'Request limit must include one maximum-size file' })
      }
      if (fileRefreshMarginSeconds >= filesTtlSeconds) {
        throw new HTTPException(400, { message: 'Refresh margin must be shorter than provider file lifetime' })
      }
      if (current.operations.includes('text.generate') && inputModalities.some(modality => !['text', 'image'].includes(modality)) && fileInputPolicy === 'unsupported') {
        throw new HTTPException(400, { message: 'Native file modalities require a file input policy' })
      }
      if (videoAudioMode === 'visual-and-audio' && !inputModalities.includes('video')) {
        throw new HTTPException(400, { message: 'Video audio understanding requires video input' })
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
      if (rest.providerId) await resolveProvider(tx, rest.providerId)
      if (current.providerId && (apiKey !== undefined || rest.baseUrl !== undefined || rest.modelCallTimeoutMs !== undefined)) {
        await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
        await tx.select().from(s.modelProviders).where(eq(s.modelProviders.id, current.providerId)).for('update')
        const provider = await resolveProvider(tx, current.providerId)
        const version = provider.version + 1
        await tx.insert(s.modelProviderVersions).values({
          ...provider, version, baseUrl: rest.baseUrl ?? provider.baseUrl, timeoutMs: rest.modelCallTimeoutMs ?? provider.timeoutMs,
          secret: apiKey ? encrypt(apiKey, config.encryptionKey, id) : provider.secret,
          credentialBinding: apiKey ? id : provider.credentialBinding,
        })
        await tx.update(s.modelProviders).set({ version }).where(eq(s.modelProviders.id, current.providerId))
      }
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
      const rows = await tx.update(s.models).set({ enabled: false }).where(eq(s.models.id, id)).returning({ id: s.models.id })
      if (!rows.length) forbidden()
    })
    return c.json({ id })
  })
  app.get('/v1/organizations/:organizationId/models', async c =>
    c.json(
      await tenantOperation(c, async (tx) => {
        const catalog = await tx
          .select({
            id: s.models.id,
            inputPriceMicrosCnyPerMillion: s.models.inputPriceMicrosCnyPerMillion,
            cachedInputPriceMicrosCnyPerMillion: s.models.cachedInputPriceMicrosCnyPerMillion,
            outputPriceMicrosCnyPerMillion: s.models.outputPriceMicrosCnyPerMillion,
            name: s.models.name,
            operations: s.models.operations,
            outputModalities: s.models.outputModalities,
            images: s.models.images,
            protocol: s.models.protocol,
            inputModalities: s.models.inputModalities,
            videoAudioMode: s.models.videoAudioMode,
            fileInputPolicy: s.models.fileInputPolicy,
            maxFileBytes: s.models.maxFileBytes,
            maxRequestBytes: s.models.maxRequestBytes,
            filesTtlSeconds: s.models.filesTtlSeconds,
            fileUploadTimeoutMs: s.models.fileUploadTimeoutMs,
            fileUploadMaxRetries: s.models.fileUploadMaxRetries,
            fileRefreshMarginSeconds: s.models.fileRefreshMarginSeconds,
            fileQuotaCleanupBatch: s.models.fileQuotaCleanupBatch,
            modelCallTimeoutMs: s.models.modelCallTimeoutMs,
            contextTokens: s.models.contextTokens,
            maxOutputTokens: s.models.maxOutputTokens,
          })
          .from(s.models)
          .leftJoin(s.modelProviders, eq(s.models.providerId, s.modelProviders.id))
          .where(and(eq(s.models.enabled, true), or(isNull(s.models.providerId), eq(s.modelProviders.enabled, true))))
          .orderBy(asc(s.models.name))
        const adapters = await tx.select().from(s.modelAdapters).where(eq(s.modelAdapters.enabled, true))
        return catalog.map(model => ({ ...model, operationConfigurations: [...(model.operations.includes('text.generate')
          ? [{ operation: 'text.generate', version: 1, parameters: {}, ...textPriceDescriptor(model) }] : []),
        ...adapters.filter(adapter => adapter.modelId === model.id).map((adapter) => {
          const rules = taskConfigSchema.parse(adapter.configuration)
          return { operation: adapter.operation, version: adapter.version, parameters: rules.parameters,
            prices: adapter.prices, settlementUnits: taskPriceUnits(rules),
            reserve: rules.reserve, reserveMicrosCny: adapter.reserveMicrosCny, referenceKinds: Object.keys(rules.referenceMapping),
            videoReferencePrices: rules.videoReferencePrices }
        })] }))
      }),
    ),
  )
}
