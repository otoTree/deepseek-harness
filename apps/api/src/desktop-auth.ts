/** Browser-to-desktop authorization uses single-use codes and S256 PKCE. */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { and, eq, isNull } from 'drizzle-orm'
import type { ApiEnv, Services } from './application.ts'
import { desktopCodes, runtimes, subscriptions, user } from './schema.ts'
import { organizationId, accountId, desktopAuthorization, desktopTokenRequest } from './contracts.ts'
import { digest, enterTenant, forbidden, lockOrganization, recordAudit } from './security.ts'

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

/** Register code issuance with browser login and code exchange without a browser session. */
export function mountDesktopAuthorization(app: Hono<ApiEnv>, { db, config }: Services): void {
  app.post('/v1/desktop/authorize', async (c) => {
    const input = desktopAuthorization.parse(await c.req.json())
    const callback = loopbackCallback(input.callback)
    const code = randomBytes(32).toString('base64url')
    await db.transaction(async (tx) => {
      const actor = c.get('actor')
      const tenant = await enterTenant(tx, actor, input.organizationId)
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
    return c.json({ callback: callback.toString() })
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
        await lockOrganization(tx, tenant.organizationId)
        const [plan] = await tx.select().from(subscriptions)
          .where(eq(subscriptions.organizationId, tenant.organizationId))
        const existing = await tx.select().from(runtimes)
          .where(and(eq(runtimes.organizationId, tenant.organizationId), isNull(runtimes.revokedAt)))
        if (!plan || existing.length >= plan.runtimes)
          throw new HTTPException(409, { message: 'Runtime limit reached' })
        const runtimeId = randomUUID()
        const token = randomBytes(32).toString('base64url')
        const leaseUntil = new Date(Date.now() + config.leaseSeconds * 1000)
        await tx.insert(runtimes).values({
          id: runtimeId,
          organizationId: tenant.organizationId,
          accountId: account.id,
          ...code.runtime,
          tokenHash: digest(token),
          leaseUntil,
        })
        await tx.update(desktopCodes).set({ consumedAt: new Date() }).where(eq(desktopCodes.id, code.id))
        await recordAudit(tx, tenant, 'runtime.registered', runtimeId)
        return { runtimeId, token, leaseUntil, organizationId: tenant.organizationId }
      }),
    )
  })
}
