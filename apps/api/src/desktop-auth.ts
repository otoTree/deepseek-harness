/** Browser-to-desktop authorization uses single-use codes and S256 PKCE. */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { eq } from 'drizzle-orm'
import type { ApiEnv, Services } from './application.ts'
import { desktopCodes, runtimes, user } from './schema.ts'
import { organizationId, accountId, desktopAuthorization, desktopTokenRequest } from './contracts.ts'
import { digest, enterTenant, forbidden, recordAudit } from './security.ts'

/** Validate an RFC 8252 loopback callback without arbitrary redirect targets. */
export function loopbackCallback(value: string): URL {
  const url = new URL(value)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/callback' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new HTTPException(400, { message: 'Invalid desktop callback' })
  }
  return url
}

/** Issue a one-use desktop code for an already authenticated account and organization. */
export async function issueDesktopCode(
  services: Pick<Services, 'db'>,
  actor: { id: ReturnType<typeof accountId.parse>; email: string },
  input: { organizationId: string; challenge: string; callback: string; state: string },
): Promise<string> {
  const callback = loopbackCallback(input.callback)
  const code = randomBytes(32).toString('base64url')
  await services.db.transaction(async (tx) => {
    const tenant = await enterTenant(tx, actor, organizationId.parse(input.organizationId))
    await tx.insert(desktopCodes).values({
      id: digest(code),
      accountId: actor.id,
      organizationId: input.organizationId,
      challenge: input.challenge,
      expiresAt: new Date(Date.now() + 60000),
      runtime: { name: 'macOS desktop', type: 'desktop', version: '0.1.0', capabilities: ['local-tools'] },
    })
    await recordAudit(tx, tenant, 'desktop.authorized')
  })
  callback.searchParams.set('code', code)
  callback.searchParams.set('state', input.state)
  return callback.toString()
}

/** Register code issuance with browser login and code exchange without a browser session. */
export function mountDesktopAuthorization(app: Hono<ApiEnv>, { db, config }: Services): void {
  app.post('/v1/desktop/authorize', async (c) => {
    const input = desktopAuthorization.parse(await c.req.json())
    return c.json({ callback: await issueDesktopCode({ db }, c.get('actor'), input) })
  })
  app.post('/desktop/token', async (c) => {
    // This endpoint accepts only the code and verifier, never a cookie-granted identity.
    const input = desktopTokenRequest.parse(await c.req.json())
    return c.json(
      await db.transaction(async (tx) => {
        const [code] = await tx
          .select()
          .from(desktopCodes)
          .where(eq(desktopCodes.id, digest(input.code)))
          .for('update')
        const challenge = createHash('sha256').update(input.verifier).digest('base64url')
        if (!code || code.consumedAt || code.expiresAt <= new Date() || code.challenge !== challenge) forbidden()
        const [account] = await tx.select().from(user).where(eq(user.id, code.accountId))
        if (!account || (config.requireEmailVerification && !account.emailVerified)) forbidden()
        const tenant = await enterTenant(
          tx,
          { id: accountId.parse(account.id), email: account.email },
          organizationId.parse(code.organizationId),
        )
        const now = new Date()
        const runtimeId = randomUUID()
        const token = randomBytes(32).toString('base64url')
        const expiresAt = new Date(now.getTime() + config.loginSessionSeconds * 1000)
        await tx.insert(runtimes).values({
          id: runtimeId,
          organizationId: tenant.organizationId,
          accountId: account.id,
          ...code.runtime,
          tokenHash: digest(token),
          expiresAt,
        })
        await tx.update(desktopCodes).set({ consumedAt: new Date() }).where(eq(desktopCodes.id, code.id))
        await recordAudit(tx, tenant, 'runtime.registered', runtimeId)
        return { runtimeId, accountId: account.id, token, expiresAt, organizationId: tenant.organizationId }
      }),
    )
  })
}
