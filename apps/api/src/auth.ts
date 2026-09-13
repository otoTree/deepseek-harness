/** Better Auth owns passwords and login sessions; Organization membership is a separate domain. */
import { betterAuth, APIError } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { createTransport } from 'nodemailer'
import type { Config } from './config.ts'
import type { Database } from './database.ts'
import { identify } from './database.ts'
import { accountId } from './contracts.ts'
import * as schema from './schema.ts'

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
    trustedOrigins: [config.adminOrigin, config.portalOrigin],
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: config.requireEmailVerification,
      minPasswordLength: 12,
      sendResetPassword: async ({ user, url }) => mail({ to: user.email, subject: 'Reset your password', text: url }),
    },
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
