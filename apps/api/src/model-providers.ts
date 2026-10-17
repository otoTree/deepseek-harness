/** Versioned provider credentials and platform administration; public catalogs omit transport settings. */
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import type { Hono, Context } from 'hono'
import { z } from 'zod'
import * as s from './schema.ts'
import { encrypt, requirePlatform } from './security.ts'
import { modelUrl } from './gateway.ts'
import type { Transaction } from './database.ts'
import type { ApiEnv, Services } from './application.ts'

const providerInput = z.object({
  name: z.string().trim().min(1).max(120), baseUrl: z.url(), apiKey: z.string().min(1).max(4096).optional(),
  timeoutMs: z.number().int().min(1000).max(1_800_000).default(300_000),
  retryableHttpStatuses: z.array(z.number().int().min(400).max(599)).default([429, 500, 502, 503, 504]),
  enabled: z.boolean().default(true),
}).strict()

/** Load the active provider revision. @param tx Transaction. @param id Provider ID. @returns Encrypted immutable connection settings. */
export async function resolveProvider(tx: Transaction, id: string) {
  const [provider] = await tx.select().from(s.modelProviders).where(eq(s.modelProviders.id, id))
  if (!provider?.enabled) throw new HTTPException(409, { message: 'Provider is unavailable' })
  const [revision] = await tx.select().from(s.modelProviderVersions).where(and(
    eq(s.modelProviderVersions.providerId, id), eq(s.modelProviderVersions.version, provider.version),
  ))
  if (!revision) throw new Error('Provider revision is unavailable')
  return revision
}

/**
 * Resolve text and file transport settings from the shared provider.
 * @param tx Database transaction.
 * @param model Platform model.
 * @returns Model with the active transport revision and credential binding.
 */
export async function resolveModelConnection(tx: Transaction, model: typeof s.models.$inferSelect) {
  if (!model.providerId) return { ...model, credentialBinding: model.id }
  const revision = await resolveProvider(tx, model.providerId)
  return { ...model, baseUrl: revision.baseUrl, secret: revision.secret,
    modelCallTimeoutMs: revision.timeoutMs, credentialBinding: revision.credentialBinding }
}

/** Mount credential-redacted provider administration. @param app HTTP app. @param services API dependencies. */
export function mountModelProviders(app: Hono<ApiEnv>, services: Services): void {
  const { db, config } = services
  app.get('/v1/platform/model-providers', async c => c.json(await db.transaction(async (tx) => {
    await requirePlatform(tx, c.get('actor'))
    const rows = await tx.select().from(s.modelProviders).innerJoin(s.modelProviderVersions, and(
      eq(s.modelProviders.id, s.modelProviderVersions.providerId), eq(s.modelProviders.version, s.modelProviderVersions.version),
    ))
    return rows.map(({ model_provider: provider, model_provider_version: { secret: _secret, credentialBinding: _binding,
      ...revision } }) => ({ ...revision, ...provider }))
  })))
  const save = async (c: Context<ApiEnv>) => {
    const input = providerInput.parse(await c.req.json())
    modelUrl(input.baseUrl)
    const id = c.req.param('id') ? z.uuid().parse(c.req.param('id')) : randomUUID()
    const version = await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const [current] = await tx.select().from(s.modelProviders).where(eq(s.modelProviders.id, id)).for('update')
      if (c.req.param('id') && !current) throw new HTTPException(404, { message: 'Provider not found' })
      const version = (current?.version ?? 0) + 1
      if (current) await tx.update(s.modelProviders).set({ name: input.name, enabled: input.enabled, version })
        .where(eq(s.modelProviders.id, id))
      else await tx.insert(s.modelProviders).values({ id, name: input.name, enabled: input.enabled, version })
      const previous = current ? await tx.select().from(s.modelProviderVersions).where(and(eq(s.modelProviderVersions.providerId, id),
        eq(s.modelProviderVersions.version, current.version))) : []
      const previousRevision = previous[0]
      let secret: string, credentialBinding: string
      if (input.apiKey) { credentialBinding = `${id}:${version}`; secret = encrypt(input.apiKey, config.encryptionKey, credentialBinding) }
      else {
        if (!previousRevision) throw new HTTPException(400, { message: 'Provider credential is required' })
        credentialBinding = previousRevision.credentialBinding; secret = previousRevision.secret
      }
      await tx.insert(s.modelProviderVersions).values({ providerId: id, version, baseUrl: input.baseUrl,
        secret, credentialBinding,
        timeoutMs: input.timeoutMs, retryableHttpStatuses: input.retryableHttpStatuses })
      return version
    })
    return c.json({ id, version }, 201)
  }
  app.post('/v1/platform/model-providers', save)
  app.put('/v1/platform/model-providers/:id', save)
}
