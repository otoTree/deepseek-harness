/** Enterprise API settings are parsed at startup, never inferred from a personal Harness home. */
import { z } from 'zod'

const environmentBoolean = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return value
}, z.boolean())

export const configSchema = z
  .object({
    databaseUrl: z.url(),
    authSecret: z.string().min(32),
    encryptionKey: z.string().regex(/^[0-9a-f]{64}$/),
    apiUrl: z.url(),
    adminOrigin: z.url(),
    portalOrigin: z.url(),
    redisUrl: z.url().optional(),
    redisKeyPrefix: z.string().min(1).max(120).default('dsh:enterprise'),
    modelRequestsPerMinute: z.number().int().positive().max(1_000_000).default(120),
    modelConcurrentCalls: z.number().int().positive().max(100_000).default(8),
    host: z.literal('127.0.0.1').default('127.0.0.1'),
    port: z.number().int().min(0).max(65535).default(8787),
    mode: z.enum(['open', 'private']).default('open'),
    registration: z.enum(['open', 'domain_restricted', 'invite_only', 'disabled']).default('open'),
    requireEmailVerification: environmentBoolean.default(false),
    allowedModelOrigins: z.array(z.url()).default([]),
    leaseSeconds: z.number().int().min(30).max(600).default(90),
    invitationSeconds: z.number().int().positive().default(604800),
    smtpUrl: z.url().optional(),
    mailFrom: z.email().optional(),
    reviewModelId: z.uuid().optional(),
    pluginSigningKey: z.string().min(1).optional(),
    objectStoreEndpoint: z.url().optional(),
    objectStoreAccessKey: z.string().min(1).optional(),
    objectStoreSecretKey: z.string().min(1).optional(),
    objectStoreBucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/).default('dsh-enterprise'),
  })
  .strict()
  .superRefine((value, ctx) => {
    const configured = [value.objectStoreEndpoint, value.objectStoreAccessKey, value.objectStoreSecretKey]
      .filter(item => item !== undefined).length
    if (configured !== 0 && configured !== 3) {
      ctx.addIssue({
        code: 'custom',
        message: 'Object storage endpoint, access key, and secret key must be configured together',
        path: ['objectStoreEndpoint'],
      })
    }
  })
export type Config = z.infer<typeof configSchema>
