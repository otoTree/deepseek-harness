import { cleanupDrive } from './drive-capacity.ts'
/** Hono enterprise service mounted only through a named dsh profile. */
import type { Context } from '@deepseek-ai/cordis'
import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { eq } from 'drizzle-orm'
import { configSchema, type Config as ApiConfig } from './config.ts'
import { connectDatabase } from './database.ts'
import { createApplication } from './application.ts'
import { smtpMailer } from './auth.ts'
import { deployment } from './schema.ts'
import { MinioPluginArtifactStore } from './plugin-artifacts.ts'
import { connectRedisRateLimiter } from './rate-limit.ts'
import { connectPluginDatabase } from './plugin-database.ts'
import { MinioDesktopArtifactStore } from './desktop-storage.ts'
import { MinioDriveObjectStore } from './drive-storage.ts'

export const Config = configSchema

/** Mount the listener and close connections before disposing the database pool. */
export async function apply(ctx: Context, config: ApiConfig): Promise<void> {
  const connection = connectDatabase(config.databaseUrl)
  ctx.effect(() => () => connection.close(), 'enterprise.database')
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
  const driveObjects = new MinioDriveObjectStore(
    config.objectStoreEndpoint,
    config.objectStoreAccessKey,
    config.objectStoreSecretKey,
    config.objectStoreBucket,
  )
  const pluginDatabase = config.pluginDatabaseUrl ? connectPluginDatabase(config.pluginDatabaseUrl) : undefined
  if (pluginDatabase) ctx.effect(() => () => pluginDatabase.close(), 'enterprise.plugin-database')
  const services = {
    db: connection.db,
    config,
    mail: smtpMailer(config),
    pluginArtifacts,
    driveObjects,
    desktopArtifacts: new MinioDesktopArtifactStore(
      config.objectStoreEndpoint, config.objectStoreAccessKey, config.objectStoreSecretKey, config.objectStoreBucket,
    ),
    rateLimiter: redis?.limiter,
    pluginCache: redis?.pluginCache,
    pluginDatabase,
  }
  const { app, gatewayMaintenance, modelTaskMaintenance } = createApplication(services)
  const cleanupAbort = new AbortController()
  let modelTaskScan = Promise.resolve()
  let taskScanRunning = false
  const modelTaskTimer = setInterval(() => {
    if (taskScanRunning) return
    taskScanRunning = true
    modelTaskScan = modelTaskMaintenance.scanDue(cleanupAbort.signal).then(() => {}).catch((error: unknown) => {
      if (!cleanupAbort.signal.aborted) ctx.logger.warn('Model task reconciliation scan failed: %s', error instanceof Error ? error.name : 'NonError')
    }).finally(() => { taskScanRunning = false })
  }, config.modelTaskScanIntervalMs)
  modelTaskTimer.unref()
  ctx.effect(() => async () => {
    clearInterval(modelTaskTimer)
    cleanupAbort.abort()
    await modelTaskScan
  }, 'enterprise.model-task-scan')
  let cleanup = Promise.resolve()
  const cleanupTimer = setInterval(() => {
    cleanup = cleanup.then(() => gatewayMaintenance.cleanupExpired(cleanupAbort.signal)).then(() => {}, (error: unknown) => {
      if (!cleanupAbort.signal.aborted) ctx.logger.warn('Provider file cleanup failed: %s', error instanceof Error ? error.name : 'NonError')
    })
  }, config.modelFileCleanupIntervalMs)
  cleanupTimer.unref()
  ctx.effect(() => async () => {
    clearInterval(cleanupTimer)
    cleanupAbort.abort()
    await cleanup
  }, 'enterprise.model-files-cleanup')
  let driveScan = Promise.resolve()
  let driveScanRunning = false
  const driveTimer = setInterval(() => {
    if (driveScanRunning) return
    driveScanRunning = true
    driveScan = cleanupDrive(services, cleanupAbort.signal).then(() => {}).catch((error: unknown) => {
      if (!cleanupAbort.signal.aborted) ctx.logger.warn('Drive cleanup failed: %s', error instanceof Error ? error.name : 'NonError')
    }).finally(() => { driveScanRunning = false })
  }, config.driveCleanupIntervalMs)
  driveTimer.unref()
  ctx.effect(() => async () => { clearInterval(driveTimer); cleanupAbort.abort(); await driveScan }, 'enterprise.drive-cleanup')
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
