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

/**
 * Return browser origins accepted by the enterprise API.
 *
 * Local development commonly alternates between `localhost` and
 * `127.0.0.1`; both names resolve to the same loopback service but browsers
 * treat them as different origins. Only loopback-configured origins receive
 * this alias, so deployed origins remain an explicit allowlist.
 * @param config - browser origin settings from the parsed API configuration.
 * @returns distinct configured and loopback-alias origins.
 */
export function browserOrigins(config: Pick<Config, 'adminOrigin' | 'portalOrigin'>): string[] {
  const result = new Set<string>()
  for (const configured of [config.adminOrigin, config.portalOrigin]) {
    const origin = new URL(configured)
    result.add(origin.origin)
    const hostname = origin.hostname.toLowerCase()
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') continue
    origin.hostname = hostname === 'localhost' ? '127.0.0.1' : 'localhost'
    result.add(origin.origin)
  }
  return [...result]
}
