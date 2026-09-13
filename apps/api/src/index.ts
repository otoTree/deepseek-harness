/** Hono enterprise service mounted only through a named dsh profile. */
import type { Context } from '@deepseek-ai/cordis'
import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { eq, sql } from 'drizzle-orm'
import { configSchema, type Config as ApiConfig } from './config.ts'
import { connectDatabase } from './database.ts'
import { createApplication } from './application.ts'
import { smtpMailer } from './auth.ts'
import { deployment } from './schema.ts'
import { MinioPluginArtifactStore } from './plugin-artifacts.ts'
import { connectRedisRateLimiter } from './rate-limit.ts'

export const Config = configSchema

/** Mount the listener and close connections before disposing the database pool. */
export async function apply(ctx: Context, config: ApiConfig): Promise<void> {
  const connection = connectDatabase(config.databaseUrl)
  ctx.effect(() => () => connection.close(), 'enterprise.database')
  const identity = await connection.db.execute(
    sql`select current_user as role, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
  )
  if (identity[0]?.role !== 'enterprise_app' || identity[0].rolsuper || identity[0].rolbypassrls) {
    throw new Error('Enterprise API requires the non-privileged enterprise_app database role')
  }
  const [policy] = await connection.db.select().from(deployment).where(eq(deployment.id, 'primary'))
  if (!policy || policy.mode !== config.mode)
    throw new Error('Enterprise deployment has not been provisioned for this mode')
  const redis = config.redisUrl
    ? await connectRedisRateLimiter(config.redisUrl, config.redisKeyPrefix, {
      requestsPerMinute: config.modelRequestsPerMinute,
      concurrentCalls: config.modelConcurrentCalls,
    })
    : undefined
  if (redis) ctx.effect(() => () => redis.close(), 'enterprise.redis')
  if (!config.objectStoreEndpoint || !config.objectStoreAccessKey || !config.objectStoreSecretKey) {
    throw new Error('Enterprise API requires MinIO object storage configuration')
  }
  const pluginArtifacts = new MinioPluginArtifactStore(
    config.objectStoreEndpoint,
    config.objectStoreAccessKey,
    config.objectStoreSecretKey,
    config.objectStoreBucket,
  )
  const { app } = createApplication({
    db: connection.db,
    config,
    mail: smtpMailer(config),
    pluginArtifacts,
    rateLimiter: redis?.limiter,
  })
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }) as Server
  ctx.effect(
    () => async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
        server.closeAllConnections()
      })
    },
    'enterprise.http',
  )
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Enterprise HTTP listener has no TCP address')
  ctx.logger.info('Enterprise API listening on %s:%d', config.host, address.port)
}
