/** Better Auth owns passwords and login sessions; Organization membership is a separate domain. */
import { betterAuth, APIError } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { genericOAuth, type GenericOAuthConfig } from 'better-auth/plugins/generic-oauth'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { createTransport } from 'nodemailer'
import { z } from 'zod'
import { browserOrigins, type Config } from './config.ts'
import type { Database } from './database.ts'
import { identify } from './database.ts'
import { accountId } from './contracts.ts'
import * as schema from './schema.ts'

const oauthConfig = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().min(1).optional(),
  discoveryUrl: z.url().optional(),
  authorizationUrl: z.url().optional(),
  tokenUrl: z.url().optional(),
  userInfoUrl: z.url().optional(),
  scopes: z.array(z.string().trim().min(1)).optional(),
  requireIdTokenVerification: z.boolean().optional(),
  pkce: z.boolean().optional(),
}).passthrough()

type ConfiguredIdentityProvider = typeof schema.identityProviders.$inferSelect

function providerConfig(provider: ConfiguredIdentityProvider, apiUrl: string): GenericOAuthConfig {
  const values = oauthConfig.parse(provider.config)
  const providerId = `dsh-${provider.id}`
  const discoveryUrl = values.discoveryUrl ?? (provider.protocol === 'oidc' && provider.issuer
    ? `${provider.issuer.replace(/\/$/u, '')}/.well-known/openid-configuration` : undefined)
  if (!discoveryUrl && (!values.authorizationUrl || !values.tokenUrl)) {
    throw new Error(`Identity provider ${provider.id} needs discoveryUrl or authorizationUrl/tokenUrl`)
  }
  return {
    providerId,
    name: provider.name,
    clientId: values.clientId,
    clientSecret: values.clientSecret,
    discoveryUrl,
    authorizationUrl: values.authorizationUrl,
    tokenUrl: values.tokenUrl,
    userInfoUrl: values.userInfoUrl,
    scopes: values.scopes ?? (provider.protocol === 'oidc' ? ['openid', 'profile', 'email'] : ['profile', 'email']),
    requireIdTokenVerification: provider.protocol === 'oidc' ? values.requireIdTokenVerification ?? true : false,
    pkce: values.pkce ?? true,
    redirectURI: `${apiUrl.replace(/\/$/u, '')}/auth/callback/${providerId}`,
    mapProfileToUser: (profile) => {
      const email = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : ''
      if (!email) throw new Error(`Identity provider ${provider.id} did not return an email`)
      const name = typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : email
      return { email, name, emailVerified: profile.emailVerified === true }
    },
  }
}

/** Load enabled OIDC/OAuth2 providers into Better Auth's generic OAuth registry. */
function dynamicOAuthPlugin(db: Database, config: Config) {
  const options: { config: GenericOAuthConfig[] } = { config: [] }
  const plugin = genericOAuth(options)
  return {
    ...plugin,
    init: async (context: Parameters<NonNullable<typeof plugin.init>>[0]) => {
      const providers = await db.select().from(schema.identityProviders)
      options.config.splice(0, options.config.length, ...providers
        .filter(provider => provider.enabled && (provider.protocol === 'oidc' || provider.protocol === 'oauth2'))
        .map(provider => providerConfig(provider, config.apiUrl)))
      return plugin.init(context)
    },
  }
}

export interface Mail {
  to: string
  subject: string
  text: string
}
export type SendMail = (mail: Mail) => Promise<void>

/** SMTP is explicit; an absent delivery configuration never pretends verification succeeded. */
export function smtpMailer(config: Config): SendMail {
  if (!config.smtpUrl || !config.mailFrom) return () => Promise.reject(new Error('SMTP delivery is not configured'))
  const transport = createTransport(config.smtpUrl)
  return async (mail) => {
    await transport.sendMail({ from: config.mailFrom, ...mail })
  }
}

/** Create cookie-based web authentication with configurable email verification and live registration policy. */
export function createAuth(db: Database, config: Config, mail: SendMail) {
  // Better Auth still keeps the callback configured when verification is off,
  // but it must never enqueue a delivery task in that mode.  A no-op callback
  // also makes local development independent of SMTP configuration.
  const sendVerification = config.requireEmailVerification
    ? async ({ user, url }: { user: { email: string }; url: string }) =>
      mail({ to: user.email, subject: 'Verify your email', text: url })
    : async () => {}
  return betterAuth({
    secret: config.authSecret,
    baseURL: config.apiUrl,
    basePath: '/auth',
    trustedOrigins: browserOrigins(config),
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: config.requireEmailVerification,
      minPasswordLength: 12,
      sendResetPassword: async ({ user, url }) => mail({ to: user.email, subject: 'Reset your password', text: url }),
    },
    plugins: [dynamicOAuthPlugin(db, config)],
    emailVerification: {
      sendOnSignUp: config.requireEmailVerification,
      sendVerificationEmail: sendVerification,
    },
    session: { cookieCache: { enabled: false }, expiresIn: 86400, updateAge: 3600 },
    rateLimit: { enabled: true, window: 60, max: 100 },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const [policy] = await db.select().from(schema.deployment).where(eq(schema.deployment.id, 'primary'))
            if (!policy || policy.registration === 'disabled')
              throw new APIError('FORBIDDEN', { message: 'Registration unavailable' })
            const email = user.email.toLowerCase()
            const domain = email.split('@')[1]
            if (policy.registration === 'domain_restricted' && (!domain || !policy.domains.includes(domain))) {
              throw new APIError('FORBIDDEN', { message: 'Registration unavailable' })
            }
            if (policy.mode === 'private' || policy.registration === 'invite_only') {
              const invitations = await db.transaction(async (tx) => {
                await identify(tx, accountId.parse('registration'), email)
                return tx
                  .select()
                  .from(schema.invitations)
                  .where(
                    and(
                      eq(schema.invitations.email, email),
                      gt(schema.invitations.expiresAt, new Date()),
                      isNull(schema.invitations.acceptedAt),
                    ),
                  )
              })
              if (invitations.length === 0) throw new APIError('FORBIDDEN', { message: 'Registration unavailable' })
            }
            return { data: { ...user, email } }
          },
        },
      },
    },
  })
}
export type Auth = ReturnType<typeof createAuth>
