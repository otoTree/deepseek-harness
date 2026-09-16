/** HTTP composition for enterprise identity, organization and runtime administration. */
import { randomBytes, randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { and, asc, desc, eq, gt, ilike, isNull, sql } from 'drizzle-orm'
import * as s from './schema.ts'
import * as wire from './contracts.ts'
import { browserOrigins, type Config } from './config.ts'
import { type Database, type Transaction, identify, selectOrganization } from './database.ts'
import { createAuth, type SendMail } from './auth.ts'
import {
  digest,
  enterTenant,
  forbidden,
  lockOrganization,
  recordAudit,
  requireRole,
  requirePlatform,
  type Actor,
  type Tenant,
} from './security.ts'
import { mountModels } from './models.ts'
import { mountSessions } from './sessions.ts'
import { mountDesktopAuthorization } from './desktop-auth.ts'
import { mountPlugins } from './plugins.ts'
import { mountUsageAnalytics } from './usage.ts'
import { calculateUsageCosts, type ModelTransport } from './gateway.ts'
import type { PluginArtifactStore } from './plugin-artifacts.ts'
import type { RateLimiter } from './rate-limit.ts'

export type ApiEnv = { Variables: { actor: Actor } }
export interface Services {
  db: Database
  config: Config
  mail: SendMail
  modelTransport?: ModelTransport
  pluginArtifacts?: PluginArtifactStore
  rateLimiter?: RateLimiter
}
export type TenantOperation = <T>(
  c: Context<ApiEnv>,
  run: (tx: Transaction, tenant: Tenant) => Promise<T>,
) => Promise<T>

/** Assemble routes without binding a port; the Cordis plugin owns listener lifetime. */
export function createApplication(services: Services) {
  const { db, config, mail } = services
  const auth = createAuth(db, config, mail)
  const app = new Hono<ApiEnv>()
  const tenantOperation: TenantOperation = (c, run) =>
    db.transaction(async (tx) => {
      const tenant = await enterTenant(tx, c.get('actor'), wire.organizationId.parse(c.req.param('organizationId')))
      return run(tx, tenant)
    })
  const orgAdmin = ['owner', 'administrator'] as const
  const allowedBrowserOrigins = browserOrigins(config)
  app.use('*', bodyLimit({ maxSize: 1024 * 1024 }))
  app.use(
    '*',
    cors({
      origin: allowedBrowserOrigins,
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    }),
  )
  app.use('/v1/*', async (c, next) => {
    const token = c.req.header('Authorization')?.replace(/^Bearer /, '')
    const path = c.req.path.match(new RegExp([
      '^/v1/organizations/([0-9a-f-]+)/',
      '(overview|models|model-call|usage|',
      'plugins(?:/catalog|/[^/]+(?:/(?:artifact|revoke|ai-review|approve))?|/revocations)?|',
      'sessions(?:/[^/]+(?:/(?:events|lease|export|fork))?)?|',
      'runtimes(?:/[^/]+(?:/heartbeat)?)?)$',
    ].join('')))
    if (token && path && !c.req.header('Cookie')) {
      const org = wire.organizationId.parse(path[1])
      const actor = await db.transaction(async (tx) => {
        await selectOrganization(tx, org)
        const [runtime] = await tx
          .select()
          .from(s.runtimes)
          .where(and(eq(s.runtimes.tokenHash, digest(token)), isNull(s.runtimes.revokedAt)))
        if (!runtime || (!path[2]?.endsWith('/heartbeat') && runtime.leaseUntil <= new Date())) forbidden()
        const [user] = await tx.select().from(s.user).where(eq(s.user.id, runtime.accountId))
        if (!user || (config.requireEmailVerification && !user.emailVerified)) forbidden()
        const actor = { id: wire.accountId.parse(user.id), email: user.email, runtimeId: runtime.id }
        // Model relay calls are authenticated by the runtime credential and do
        // not require an organization model grant. Other tenant APIs retain
        // membership checks and transaction-local tenant context.
        if (path[2] !== 'model-call') await enterTenant(tx, actor, org)
        return actor
      })
      c.set('actor', actor)
      await next()
      return
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !allowedBrowserOrigins.includes(c.req.header('Origin') ?? '')) forbidden()
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session || (config.requireEmailVerification && !session.user.emailVerified))
      throw new HTTPException(401, { message: config.requireEmailVerification ? 'A verified login is required' : 'Login required' })
    c.set('actor', { id: wire.accountId.parse(session.user.id), email: session.user.email.toLowerCase() })
    await next()
  })
  app.on(['GET', 'POST'], '/auth/*', c => auth.handler(c.req.raw))
  app.get('/health', c => c.json({ service: 'enterprise-api', status: 'ok' }))
  app.get('/v1/me', async (c) => {
    const actor = c.get('actor')
    const platformAdmin = await db.transaction(async (tx) => {
      const rows = await tx.select({ accountId: s.platformAdmins.accountId })
        .from(s.platformAdmins).where(eq(s.platformAdmins.accountId, actor.id))
      return rows.length > 0
    })
    return c.json({ ...actor, platformAdmin })
  })
  app.get('/v1/organizations', async c =>
    c.json(
      await db.transaction(async (tx) => {
        const actor = c.get('actor')
        await identify(tx, actor.id, actor.email)
        // Platform administrators operate the control plane and therefore need
        // a complete organization directory, even when they are not members
        // of every customer organization.
        const platformAdmin = await tx
          .select({ accountId: s.platformAdmins.accountId })
          .from(s.platformAdmins)
          .where(eq(s.platformAdmins.accountId, actor.id))
        if (platformAdmin.length > 0) {
          await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
          return tx.select().from(s.organizations).orderBy(s.organizations.createdAt)
        }
        const memberships = await tx
          .select()
          .from(s.memberships)
          .where(and(eq(s.memberships.accountId, actor.id), eq(s.memberships.status, 'active')))
        const result = []
        for (const member of memberships) {
          await selectOrganization(tx, wire.organizationId.parse(member.organizationId))
          const [organization] = await tx
            .select()
            .from(s.organizations)
            .where(eq(s.organizations.id, member.organizationId))
          if (organization) result.push(organization)
        }
        return result
      }),
    ),
  )
  app.post('/v1/organizations', async (c) => {
    const input = wire.createOrganization.parse(await c.req.json())
    const result = await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await identify(tx, actor.id, actor.email)
      const [deployment] = await tx.select().from(s.deployment).where(eq(s.deployment.id, 'primary')).for('update')
      if (deployment?.mode !== 'open') forbidden()
      const id = wire.organizationId.parse(randomUUID())
      const parentId = deployment.rootOrganizationId
      await selectOrganization(tx, id)
      const membershipId = randomUUID()
      const rootId = randomUUID()
      await tx.insert(s.organizations).values({ id, parentId, rootId: parentId ?? id, name: input.name })
      await tx.insert(s.units).values({ id: rootId, organizationId: id, unitType: 'root', name: input.name })
      await tx.insert(s.memberships).values({ id: membershipId, organizationId: id, accountId: actor.id })
      await tx.insert(s.assignments).values({ organizationId: id, membershipId, unitId: rootId })
      await tx.insert(s.roles).values({ id: randomUUID(), organizationId: id, membershipId, role: 'owner' })
      await tx.insert(s.subscriptions).values({ organizationId: id })
      await recordAudit(tx, { actor, organizationId: id, membershipId }, 'organization.created', id)
      return { id, rootId }
    })
    return c.json(result, 201)
  })
  app.get('/v1/organizations/:organizationId/overview', async c =>
    c.json(
      await tenantOperation(c, async (tx, tenant) => {
        const [organization] = await tx.select().from(s.organizations)
        const [subscription] = await tx.select().from(s.subscriptions)
        const roles = await tx.select().from(s.roles).where(eq(s.roles.membershipId, tenant.membershipId))
        return { organization, subscription, roles }
      }),
    ),
  )
  app.get('/v1/organizations/:organizationId/units', async c =>
    c.json(await tenantOperation(c, tx => tx.select().from(s.units))),
  )
  app.post('/v1/organizations/:organizationId/units', async (c) => {
    const input = wire.createUnit.parse(await c.req.json())
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await requireRole(tx, tenant, orgAdmin)
        await lockOrganization(tx, tenant.organizationId)
        const [parent] = await tx.select().from(s.units).where(eq(s.units.id, input.parentId))
        if (!parent) forbidden()
        const id = randomUUID()
        await tx.insert(s.units).values({ id, organizationId: tenant.organizationId, ...input })
        await recordAudit(tx, tenant, 'unit.created', id)
        return { id }
      }),
      201,
    )
  })
  app.patch('/v1/organizations/:organizationId/units/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    const input = z
      .object({ name: z.string().min(1).max(120), parentId: wire.resourceId })
      .strict()
      .parse(await c.req.json())
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await requireRole(tx, tenant, orgAdmin)
        await lockOrganization(tx, tenant.organizationId)
        const [unit] = await tx.select().from(s.units).where(eq(s.units.id, id))
        if (!unit || unit.parentId === null) forbidden()
        const ancestors = await tx.execute(sql`with recursive ancestors as (
        select id, parent_id from enterprise.org_unit where id = ${input.parentId}
        union all select u.id, u.parent_id from enterprise.org_unit u join ancestors a on u.id = a.parent_id
      ) select id from ancestors`)
        if (ancestors.length === 0 || ancestors.some(row => row.id === id))
          throw new HTTPException(409, { message: 'Organization tree cycle or missing parent' })
        await tx.update(s.units).set(input).where(eq(s.units.id, id))
        await recordAudit(tx, tenant, 'unit.updated', id)
        return { id }
      }),
    )
  })
  app.delete('/v1/organizations/:organizationId/units/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await requireRole(tx, tenant, orgAdmin)
        await lockOrganization(tx, tenant.organizationId)
        const [unit] = await tx.select().from(s.units).where(eq(s.units.id, id))
        if (!unit || unit.parentId === null) forbidden()
        await tx.delete(s.units).where(eq(s.units.id, id))
        await recordAudit(tx, tenant, 'unit.deleted', id)
        return { id }
      }),
    )
  })
  app.get('/v1/organizations/:organizationId/members', async c =>
    c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await requireRole(tx, tenant, orgAdmin)
        const members = await tx
          .select({
            id: s.memberships.id,
            accountId: s.memberships.accountId,
            status: s.memberships.status,
            name: s.user.name,
            email: s.user.email,
          })
          .from(s.memberships)
          .innerJoin(s.user, eq(s.user.id, s.memberships.accountId))
        return { members, roles: await tx.select().from(s.roles), assignments: await tx.select().from(s.assignments) }
      }),
    ),
  )
  app.patch('/v1/organizations/:organizationId/members/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    const input = z
      .object({ status: z.enum(['active', 'suspended', 'removed']) })
      .strict()
      .parse(await c.req.json())
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await requireRole(tx, tenant, orgAdmin)
        await lockOrganization(tx, tenant.organizationId)
        const [member] = await tx.select().from(s.memberships).where(eq(s.memberships.id, id))
        if (!member) forbidden()
        const targetRoles = await tx
          .select()
          .from(s.roles)
          .where(and(eq(s.roles.membershipId, id), isNull(s.roles.unitId)))
        if (targetRoles.some(binding => binding.role === 'owner')) {
          await requireRole(tx, tenant, ['owner'])
          const owners = await tx
            .select()
            .from(s.roles)
            .innerJoin(s.memberships, eq(s.memberships.id, s.roles.membershipId))
            .where(and(eq(s.roles.role, 'owner'), isNull(s.roles.unitId), eq(s.memberships.status, 'active')))
          if (!owners.some(owner => owner.membership.id !== id) && input.status !== 'active')
            throw new HTTPException(409, { message: 'The final Owner cannot be removed' })
        }
        if (input.status === 'active' && member.status !== 'active') await checkSeat(tx)
        await tx.update(s.memberships).set(input).where(eq(s.memberships.id, id))
        if (input.status !== 'active')
          await tx.update(s.runtimes).set({ revokedAt: new Date() }).where(eq(s.runtimes.accountId, member.accountId))
        await recordAudit(tx, tenant, 'membership.updated', id, input)
        return { id }
      }),
    )
  })
  app.post('/v1/organizations/:organizationId/roles', async (c) => {
    const input = z
      .object({ membershipId: wire.resourceId, unitId: wire.resourceId.nullable(), role: wire.role })
      .strict()
      .parse(await c.req.json())
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await requireRole(tx, tenant, input.role === 'owner' || input.role === 'administrator' ? ['owner'] : orgAdmin)
        if (input.role === 'owner' && input.unitId !== null)
          throw new HTTPException(400, { message: 'Owner must be organization-scoped' })
        await lockOrganization(tx, tenant.organizationId)
        const [existing] = await tx
          .select()
          .from(s.roles)
          .where(
            and(
              eq(s.roles.membershipId, input.membershipId),
              eq(s.roles.role, input.role),
              input.unitId === null ? isNull(s.roles.unitId) : eq(s.roles.unitId, input.unitId),
            ),
          )
        if (existing) throw new HTTPException(409, { message: 'Role is already granted' })
        const id = randomUUID()
        await tx.insert(s.roles).values({ id, organizationId: tenant.organizationId, ...input })
        await recordAudit(tx, tenant, 'role.granted', id)
        return { id }
      }),
      201,
    )
  })
  app.delete('/v1/organizations/:organizationId/roles/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    await tenantOperation(c, async (tx, tenant) => {
      await lockOrganization(tx, tenant.organizationId)
      const [binding] = await tx.select().from(s.roles).where(eq(s.roles.id, id))
      if (!binding) forbidden()
      await requireRole(tx, tenant, ['owner', 'administrator'].includes(binding.role) ? ['owner'] : orgAdmin)
      if (binding.role === 'owner') {
        const owners = await tx
          .select()
          .from(s.roles)
          .innerJoin(s.memberships, eq(s.memberships.id, s.roles.membershipId))
          .where(and(eq(s.roles.role, 'owner'), isNull(s.roles.unitId), eq(s.memberships.status, 'active')))
        if (!owners.some(owner => owner.membership.id !== binding.membershipId)) {
          throw new HTTPException(409, { message: 'The final Owner cannot be removed' })
        }
      }
      await tx.delete(s.roles).where(eq(s.roles.id, id))
      await recordAudit(tx, tenant, 'role.revoked', id)
    })
    return c.json({ id })
  })
  app.put('/v1/organizations/:organizationId/members/:id/units', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    const input = z
      .object({ unitIds: z.array(wire.resourceId).min(1).max(100) })
      .strict()
      .parse(await c.req.json())
    await tenantOperation(c, async (tx, tenant) => {
      await lockOrganization(tx, tenant.organizationId)
      await requireRole(tx, tenant, orgAdmin)
      const [member] = await tx.select().from(s.memberships).where(eq(s.memberships.id, id))
      if (!member || member.status !== 'active') forbidden()
      await tx.delete(s.assignments).where(eq(s.assignments.membershipId, id))
      await tx.insert(s.assignments).values(
        [...new Set(input.unitIds)].map(unitId => ({
          organizationId: tenant.organizationId,
          membershipId: id,
          unitId,
        })),
      )
      await recordAudit(tx, tenant, 'membership.units_changed', id, input)
    })
    return c.json({ id })
  })
  app.get('/v1/organizations/:organizationId/invitations', async c =>
    c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await requireRole(tx, tenant, orgAdmin)
        const invitations = await tx
          .select()
          .from(s.invitations)
          .orderBy(sql`${s.invitations.createdAt} desc`)
          .limit(200)
        return invitations.map(({ tokenHash: _token, ...invitation }) => invitation)
      }),
    ),
  )
  app.delete('/v1/organizations/:organizationId/invitations/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    await tenantOperation(c, async (tx, tenant) => {
      await lockOrganization(tx, tenant.organizationId)
      await requireRole(tx, tenant, orgAdmin)
      const [invitation] = await tx.select().from(s.invitations).where(eq(s.invitations.id, id)).for('update')
      if (!invitation) forbidden()
      if (invitation.acceptedAt) throw new HTTPException(409, { message: 'Accepted invitations cannot be revoked' })
      await tx
        .update(s.invitations)
        .set({ expiresAt: new Date(0) })
        .where(eq(s.invitations.id, id))
      await recordAudit(tx, tenant, 'invitation.revoked', id)
    })
    return c.json({ id })
  })
  app.post('/v1/organizations/:organizationId/invitations', async (c) => {
    const input = wire.inviteMember.parse(await c.req.json())
    const token = randomBytes(32).toString('base64url')
    const result = await tenantOperation(c, async (tx, tenant) => {
      await requireRole(tx, tenant, input.role === 'administrator' ? ['owner'] : orgAdmin)
      const id = randomUUID()
      await tx.insert(s.invitations).values({
        id,
        organizationId: tenant.organizationId,
        ...input,
        tokenHash: digest(token),
        inviterId: tenant.actor.id,
        expiresAt: new Date(Date.now() + config.invitationSeconds * 1000),
      })
      await recordAudit(tx, tenant, 'invitation.created', id)
      return { id }
    })
    await mail({
      to: input.email,
      subject: 'Organization invitation',
      text: `${config.portalOrigin}/?invitation=${token}`,
    })
    return c.json(result, 201)
  })
  app.post('/v1/invitations/accept', async (c) => {
    const { token } = z
      .object({ token: z.string().min(32).max(200) })
      .strict()
      .parse(await c.req.json())
    return c.json(
      await db.transaction(async (tx) => {
        const actor = c.get('actor')
        await identify(tx, actor.id, actor.email)
        const [invitation] = await tx
          .select()
          .from(s.invitations)
          .where(and(eq(s.invitations.tokenHash, digest(token)), eq(s.invitations.email, actor.email)))
        if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) forbidden()
        const organizationId = wire.organizationId.parse(invitation.organizationId)
        await selectOrganization(tx, organizationId)
        await lockOrganization(tx, organizationId)
        const [organization] = await tx.select().from(s.organizations)
        if (!organization || organization.status !== 'active') forbidden()
        const [fresh] = await tx.select().from(s.invitations).where(eq(s.invitations.id, invitation.id)).for('update')
        if (!fresh || fresh.acceptedAt || fresh.expiresAt <= new Date()) forbidden()
        const existing = await tx.select().from(s.memberships).where(and(
          eq(s.memberships.organizationId, organizationId),
          eq(s.memberships.accountId, actor.id),
        ))
        if (existing.length)
          throw new HTTPException(409, { message: 'Membership already exists; ask the administrator to restore it' })
        await checkSeat(tx)
        const membershipId = randomUUID()
        await tx.insert(s.memberships).values({ id: membershipId, organizationId, accountId: actor.id })
        const [root] = await tx.select().from(s.units).where(isNull(s.units.parentId))
        if (!root) throw new Error('Organization root is missing')
        await tx.insert(s.assignments).values({ organizationId, membershipId, unitId: fresh.unitId ?? root.id })
        await tx
          .insert(s.roles)
          .values({ id: randomUUID(), organizationId, membershipId, role: fresh.role, unitId: fresh.unitId })
        await tx.update(s.invitations).set({ acceptedAt: new Date() }).where(eq(s.invitations.id, fresh.id))
        await recordAudit(tx, { actor, organizationId, membershipId }, 'invitation.accepted', fresh.id)
        return { organizationId, membershipId }
      }),
    )
  })
  app.get('/v1/organizations/:organizationId/runtimes', async c =>
    c.json(
      await tenantOperation(c, async (tx, tenant) => {
        const rows = await tx
          .select({
            id: s.runtimes.id,
            accountId: s.runtimes.accountId,
            name: s.runtimes.name,
            type: s.runtimes.type,
            version: s.runtimes.version,
            leaseUntil: s.runtimes.leaseUntil,
            revokedAt: s.runtimes.revokedAt,
          })
          .from(s.runtimes)
        const ownOnly = rows.filter(row => row.accountId === tenant.actor.id)
        try {
          await requireRole(tx, tenant, orgAdmin)
          return rows
        } catch (error) {
          if (error instanceof HTTPException && error.status === 403) return ownOnly
          throw error
        }
      }),
    ),
  )
  app.post('/v1/organizations/:organizationId/runtimes', async (c) => {
    const input = wire.runtimeInput.parse(await c.req.json())
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await lockOrganization(tx, tenant.organizationId)
        const [plan] = await tx.select().from(s.subscriptions)
        const now = new Date()
        const live = await tx.select().from(s.runtimes).where(and(
          isNull(s.runtimes.revokedAt),
          gt(s.runtimes.leaseUntil, now),
        ))
        if (!plan || live.length >= plan.runtimes) throw new HTTPException(409, { message: 'Runtime limit reached' })
        const id = randomUUID()
        const token = randomBytes(32).toString('base64url')
        const leaseUntil = new Date(now.getTime() + config.leaseSeconds * 1000)
        await tx.insert(s.runtimes).values({
          id,
          organizationId: tenant.organizationId,
          accountId: tenant.actor.id,
          ...input,
          tokenHash: digest(token),
          leaseUntil,
        })
        await recordAudit(tx, tenant, 'runtime.registered', id)
        return { id, token, leaseUntil }
      }),
      201,
    )
  })
  app.post('/v1/organizations/:organizationId/runtimes/:id/heartbeat', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    const token = z
      .string()
      .min(32)
      .parse(c.req.header('Authorization')?.replace(/^Bearer /, ''))
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        const leaseUntil = new Date(Date.now() + config.leaseSeconds * 1000)
        const [runtime] = await tx
          .update(s.runtimes)
          .set({ leaseUntil })
          .where(
            and(
              eq(s.runtimes.id, id),
              eq(s.runtimes.accountId, tenant.actor.id),
              eq(s.runtimes.tokenHash, digest(token)),
              isNull(s.runtimes.revokedAt),
            ),
          )
          .returning({ id: s.runtimes.id })
        if (!runtime) forbidden()
        const [organization] = await tx.select().from(s.organizations)
        if (!organization) forbidden()
        return { leaseUntil, policyRevision: organization.policyRevision }
      }),
    )
  })
  app.delete('/v1/organizations/:organizationId/runtimes/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        const [runtime] = await tx.select().from(s.runtimes).where(eq(s.runtimes.id, id))
        if (!runtime) forbidden()
        if (runtime.accountId !== tenant.actor.id) await requireRole(tx, tenant, orgAdmin)
        await tx.update(s.runtimes).set({ revokedAt: new Date() }).where(eq(s.runtimes.id, id))
        await recordAudit(tx, tenant, 'runtime.revoked', id)
        return { id }
      }),
    )
  })
  app.get('/v1/organizations/:organizationId/audit', async c =>
    c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await requireRole(tx, tenant, ['owner', 'administrator', 'finance_auditor', 'security_reviewer'])
        return tx
          .select()
          .from(s.audit)
          .orderBy(sql`${s.audit.createdAt} desc`)
          .limit(200)
      }),
    ),
  )
  app.get('/v1/organizations/:organizationId/usage', async c =>
    c.json(
      await tenantOperation(c, async (tx, tenant) => {
        const scope = z.enum(['own', 'organization']).default('own').parse(c.req.query('scope'))
        if (scope === 'organization') await requireRole(tx, tenant, ['owner', 'administrator', 'finance_auditor'])
        return tx
          .select()
          .from(s.usage)
          .where(scope === 'own' ? eq(s.usage.accountId, tenant.actor.id) : undefined)
          .orderBy(sql`${s.usage.createdAt} desc`)
          .limit(200)
      }),
    ),
  )
  app.get('/v1/platform/policy', async c =>
    c.json(
      await db.transaction(async (tx) => {
        await requirePlatform(tx, c.get('actor'))
        const [policy] = await tx.select().from(s.deployment).where(eq(s.deployment.id, 'primary'))
        return policy
      }),
    ),
  )
  app.put('/v1/platform/policy', async (c) => {
    const input = z
      .object({ registration: wire.registrationPolicy, domains: z.array(z.string().min(1).max(253)).max(100) })
      .strict()
      .parse(await c.req.json())
    return c.json(
      await db.transaction(async (tx) => {
        await requirePlatform(tx, c.get('actor'))
        if (config.mode === 'private' && ['open', 'domain_restricted'].includes(input.registration)) forbidden()
        return tx.update(s.deployment).set(input).where(eq(s.deployment.id, 'primary')).returning()
      }),
    )
  })
  app.get('/v1/platform/organizations/tree', async c =>
    c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const parentId = c.req.query('parentId')
      const query = c.req.query('query')?.trim()
      const all = c.req.query('all') === 'true'
      const organizations = await tx.select({
        id: s.organizations.id,
        parentId: s.organizations.parentId,
        rootId: s.organizations.rootId,
        name: s.organizations.name,
        kind: s.organizations.kind,
        status: s.organizations.status,
        createdAt: s.organizations.createdAt,
      }).from(s.organizations).where(and(
        all || parentId === undefined
          ? undefined
          : parentId === 'null' ? isNull(s.organizations.parentId) : eq(s.organizations.parentId, parentId),
        query ? ilike(s.organizations.name, `%${query}%`) : undefined,
      )).orderBy(asc(s.organizations.createdAt))
      return Promise.all(organizations.map(async (organization) => {
        const [children] = await tx.select({ count: sql<number>`count(*)::int` })
          .from(s.organizations).where(eq(s.organizations.parentId, organization.id))
        const [members] = await tx.select({ count: sql<number>`count(*)::int` })
          .from(s.memberships).where(eq(s.memberships.organizationId, organization.id))
        return {
          ...organization,
          childCount: children?.count ?? 0,
          memberCount: members?.count ?? 0,
          hasChildren: (children?.count ?? 0) > 0,
        }
      }))
    })),
  )
  app.post('/v1/platform/organizations', async (c) => {
    const input = z.object({
      name: z.string().trim().min(1).max(120),
      kind: z.string().trim().min(1).max(40).default('team'),
      parentId: wire.organizationId.nullable().default(null),
    }).strict().parse(await c.req.json())
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      let rootId: string
      if (input.parentId) {
        const [parent] = await tx.select({ id: s.organizations.id, rootId: s.organizations.rootId })
          .from(s.organizations).where(eq(s.organizations.id, input.parentId))
        if (!parent) forbidden()
        rootId = parent.rootId ?? parent.id
      } else rootId = randomUUID()
      const id = wire.organizationId.parse(randomUUID())
      await tx.insert(s.organizations).values({ id, parentId: input.parentId, rootId, name: input.name, kind: input.kind })
      const unitId = input.parentId ? randomUUID() : rootId
      await tx.insert(s.units).values({ id: unitId, organizationId: id, unitType: 'root', name: input.name })
      await tx.insert(s.subscriptions).values({ organizationId: id })
      await recordAudit(tx, { actor, organizationId: id, membershipId: '' }, 'organization.created', id, input)
      return { id, parentId: input.parentId, rootId }
    }), 201)
  })
  app.get('/v1/platform/accounts', async c =>
    c.json(await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      const query = c.req.query('query')?.trim()
      const status = c.req.query('status')
      const organizationId = c.req.query('organizationId')
      const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100), 1), 200)
      const offset = Math.max(Number(c.req.query('offset') ?? 0), 0)
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const result = await tx.select({
        id: s.user.id,
        name: s.user.name,
        email: s.user.email,
        emailVerified: s.user.emailVerified,
        createdAt: s.user.createdAt,
      }).from(s.user)
        .where(and(
          query ? ilike(s.user.email, `%${query}%`) : undefined,
          organizationId
            ? sql`EXISTS (SELECT 1 FROM enterprise.membership mm WHERE mm.account_id = ${s.user.id} AND mm.organization_id = ${organizationId})`
            : undefined,
          status
            ? sql`EXISTS (SELECT 1 FROM enterprise.membership ms WHERE ms.account_id = ${s.user.id} AND ms.status = ${status})`
            : undefined,
        )).orderBy(asc(s.user.createdAt)).limit(limit).offset(offset)
      return result
    })),
  )
  app.get('/v1/platform/accounts/:accountId/organizations', async (c) => {
    const accountId = wire.accountId.parse(c.req.param('accountId'))
    return c.json(await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const [account] = await tx.select({ id: s.user.id, name: s.user.name, email: s.user.email })
        .from(s.user).where(eq(s.user.id, accountId))
      if (!account) throw new HTTPException(404, { message: 'Account not found' })
      const memberships = await tx.select({
        id: s.memberships.id, organizationId: s.memberships.organizationId, status: s.memberships.status,
        createdAt: s.memberships.createdAt,
        organizationName: s.organizations.name,
      }).from(s.memberships)
        .innerJoin(s.organizations, eq(s.organizations.id, s.memberships.organizationId))
        .where(eq(s.memberships.accountId, accountId))
      const membershipIds = new Set(memberships.map(membership => membership.id))
      const roles = (await tx.select({
        membershipId: s.roles.membershipId,
        organizationId: s.roles.organizationId,
        role: s.roles.role,
        unitId: s.roles.unitId,
      }).from(s.roles)).filter(role => membershipIds.has(role.membershipId))
      return { account, memberships, roles }
    }))
  })
  app.get('/v1/platform/accounts/:accountId/runtimes', async (c) => {
    const accountId = wire.accountId.parse(c.req.param('accountId'))
    return c.json(await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      return tx.select({
        id: s.runtimes.id,
        organizationId: s.runtimes.organizationId,
        name: s.runtimes.name,
        type: s.runtimes.type,
        version: s.runtimes.version,
        leaseUntil: s.runtimes.leaseUntil,
        revokedAt: s.runtimes.revokedAt,
        createdAt: s.runtimes.createdAt,
      }).from(s.runtimes).where(eq(s.runtimes.accountId, accountId))
        .orderBy(desc(s.runtimes.createdAt)).limit(200)
    }))
  })
  app.get('/v1/platform/accounts/:accountId/sessions', async (c) => {
    const accountId = wire.accountId.parse(c.req.param('accountId'))
    return c.json(await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      return tx.select({
        id: s.conversations.id,
        organizationId: s.conversations.organizationId,
        header: s.conversations.header,
        nextSeq: s.conversations.nextSeq,
        createdAt: s.conversations.createdAt,
      }).from(s.conversations).where(eq(s.conversations.accountId, accountId))
        .orderBy(desc(s.conversations.createdAt)).limit(200)
    }))
  })
  app.get('/v1/platform/accounts/:accountId/usage', async (c) => {
    const accountId = wire.accountId.parse(c.req.param('accountId'))
    return c.json(await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      return tx.select({
        id: s.usage.id,
        organizationId: s.usage.organizationId,
        modelId: s.usage.modelId,
        purpose: s.usage.purpose,
        status: s.usage.status,
        reservedMicros: s.usage.reservedMicros,
        actualMicros: s.usage.actualMicros,
        billedMicros: s.usage.billedMicros,
        inputTokens: s.usage.inputTokens,
        outputTokens: s.usage.outputTokens,
        createdAt: s.usage.createdAt,
        settledAt: s.usage.settledAt,
      }).from(s.usage).where(eq(s.usage.accountId, accountId))
        .orderBy(desc(s.usage.createdAt)).limit(200)
    }))
  })
  app.get('/v1/platform/accounts/:accountId/history', async (c) => {
    const accountId = wire.accountId.parse(c.req.param('accountId'))
    return c.json(await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      const [account] = await tx.select({ id: s.user.id, email: s.user.email }).from(s.user).where(eq(s.user.id, accountId))
      if (!account) throw new HTTPException(404, { message: 'Account not found' })
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const memberships = await tx.select().from(s.memberships).where(eq(s.memberships.accountId, accountId))
      const membershipIds = new Set(memberships.map(member => member.id))
      const events = (await tx.select().from(s.audit).orderBy(sql`${s.audit.createdAt} desc`)).filter(event =>
        event.actorId === accountId || (event.resourceId !== null && membershipIds.has(event.resourceId)),
      )
      return { account, memberships, events }
    }))
  })
  app.get('/v1/platform/audit', async (c) => {
    const organizationId = c.req.query('organizationId')
    const accountId = c.req.query('accountId')
    const action = c.req.query('action')
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100), 1), 500)
    return c.json(await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      return tx.select().from(s.audit).where(and(
        organizationId ? eq(s.audit.organizationId, organizationId) : undefined,
        accountId ? eq(s.audit.actorId, accountId) : undefined,
        action ? eq(s.audit.action, action) : undefined,
      )).orderBy(desc(s.audit.createdAt)).limit(limit)
    }))
  })
  app.get('/v1/platform/organizations/:organizationId/members', async (c) => {
    const id = wire.organizationId.parse(c.req.param('organizationId'))
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await selectOrganization(tx, id)
      const [organization] = await tx.select().from(s.organizations).where(eq(s.organizations.id, id))
      if (!organization) forbidden()
      const members = await tx.select({
        id: s.memberships.id,
        accountId: s.memberships.accountId,
        status: s.memberships.status,
        createdAt: s.memberships.createdAt,
        email: s.user.email,
        name: s.user.name,
      }).from(s.memberships).innerJoin(s.user, eq(s.user.id, s.memberships.accountId))
      const bindings = await tx.select().from(s.roles)
      const assignments = await tx.select().from(s.assignments)
      return { organization, members, roles: bindings, assignments }
    }))
  })
  app.post('/v1/platform/organizations/:organizationId/members', async (c) => {
    const organizationId = wire.organizationId.parse(c.req.param('organizationId'))
    const input = z.object({
      accountId: wire.accountId,
      role: wire.role.default('member'),
      unitId: wire.resourceId.nullable().optional(),
    }).strict().parse(await c.req.json())
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const [organization] = await tx.select().from(s.organizations).where(eq(s.organizations.id, organizationId))
      if (!organization || organization.status !== 'active') forbidden()
      const [account] = await tx.select({ id: s.user.id }).from(s.user).where(eq(s.user.id, input.accountId))
      if (!account) throw new HTTPException(404, { message: 'Account not found' })
      const [existing] = await tx.select().from(s.memberships).where(and(
        eq(s.memberships.organizationId, organizationId),
        eq(s.memberships.accountId, input.accountId),
      ))
      if (existing) throw new HTTPException(409, { message: 'Account already belongs to this organization' })
      if (input.role === 'owner' && input.unitId != null) throw new HTTPException(400, { message: 'Owner must be organization-scoped' })
      const membershipId = randomUUID()
      await tx.insert(s.memberships).values({ id: membershipId, organizationId, accountId: input.accountId, status: 'active' })
      const [binding] = await tx.insert(s.roles).values({
        id: randomUUID(), organizationId, membershipId, role: input.role, unitId: input.unitId ?? null,
      }).returning()
      await recordAudit(tx, { actor, organizationId, membershipId }, 'membership.added', membershipId, input)
      return { membershipId, role: binding }
    }), 201)
  })
  app.patch('/v1/platform/organizations/:organizationId/members/:memberId', async (c) => {
    const organizationId = wire.organizationId.parse(c.req.param('organizationId'))
    const memberId = wire.resourceId.parse(c.req.param('memberId'))
    const input = z.object({ status: z.enum(['active', 'suspended']) }).strict().parse(await c.req.json())
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await selectOrganization(tx, organizationId)
      const [member] = await tx.select().from(s.memberships).where(and(
        eq(s.memberships.id, memberId), eq(s.memberships.organizationId, organizationId),
      ))
      if (!member) forbidden()
      const rows = await tx.update(s.memberships).set({ status: input.status }).where(eq(s.memberships.id, memberId)).returning()
      await recordAudit(tx, { actor, organizationId, membershipId: '' }, 'membership.status_updated', memberId, input)
      return rows[0]
    }))
  })
  app.delete('/v1/platform/organizations/:organizationId/members/:memberId', async (c) => {
    const organizationId = wire.organizationId.parse(c.req.param('organizationId'))
    const memberId = wire.resourceId.parse(c.req.param('memberId'))
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await selectOrganization(tx, organizationId)
      const [member] = await tx.select().from(s.memberships).where(and(
        eq(s.memberships.id, memberId), eq(s.memberships.organizationId, organizationId),
      ))
      if (!member) forbidden()
      const rows = await tx.update(s.memberships).set({ status: 'removed' }).where(eq(s.memberships.id, memberId)).returning()
      await recordAudit(tx, { actor, organizationId, membershipId: '' }, 'membership.removed', memberId)
      return rows[0]
    }))
  })
  app.post('/v1/platform/organizations/:organizationId/members/:memberId/roles', async (c) => {
    const organizationId = wire.organizationId.parse(c.req.param('organizationId'))
    const memberId = wire.resourceId.parse(c.req.param('memberId'))
    const input = z.object({ role: wire.role, unitId: wire.resourceId.nullable() }).strict().parse(await c.req.json())
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const [member] = await tx.select().from(s.memberships).where(and(
        eq(s.memberships.id, memberId), eq(s.memberships.organizationId, organizationId),
      ))
      if (!member) forbidden()
      if (input.role === 'owner' && input.unitId !== null) throw new HTTPException(400, { message: 'Owner must be organization-scoped' })
      const [existing] = await tx.select().from(s.roles).where(and(
        eq(s.roles.membershipId, memberId),
        eq(s.roles.organizationId, organizationId),
        eq(s.roles.role, input.role),
        input.unitId === null ? isNull(s.roles.unitId) : eq(s.roles.unitId, input.unitId),
      ))
      if (existing) throw new HTTPException(409, { message: 'Role is already granted' })
      const [binding] = await tx.insert(s.roles).values({ id: randomUUID(), organizationId, membershipId: memberId, ...input }).returning()
      if (!binding) throw new Error('Role insert returned no row')
      await recordAudit(tx, { actor, organizationId, membershipId: memberId }, 'role.granted', binding.id, input)
      return binding
    }), 201)
  })
  app.post('/v1/platform/organizations/:organizationId/members/:memberId/transfer', async (c) => {
    const sourceOrganizationId = wire.organizationId.parse(c.req.param('organizationId'))
    const memberId = wire.resourceId.parse(c.req.param('memberId'))
    const input = z.object({ organizationId: wire.organizationId }).strict().parse(await c.req.json())
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await selectOrganization(tx, sourceOrganizationId)
      const [source] = await tx.select().from(s.memberships).where(and(
        eq(s.memberships.id, memberId), eq(s.memberships.organizationId, sourceOrganizationId),
      ))
      if (!source) forbidden()
      const sourceRoles = await tx.select().from(s.roles).where(and(
        eq(s.roles.membershipId, memberId), isNull(s.roles.unitId),
      ))
      if (input.organizationId === sourceOrganizationId) throw new HTTPException(409, { message: 'Member is already in this organization' })
      await selectOrganization(tx, input.organizationId)
      const [targetOrg] = await tx.select().from(s.organizations).where(eq(s.organizations.id, input.organizationId))
      if (!targetOrg || targetOrg.status !== 'active') forbidden()
      const [existing] = await tx.select().from(s.memberships).where(and(
        eq(s.memberships.organizationId, input.organizationId), eq(s.memberships.accountId, source.accountId),
      ))
      if (existing) throw new HTTPException(409, { message: 'Account already belongs to the target organization' })
      const targetId = randomUUID()
      await tx.insert(s.memberships).values({
        id: targetId,
        organizationId: input.organizationId,
        accountId: source.accountId,
        status: source.status,
      })
      if (sourceRoles.length) {
        await tx.insert(s.roles).values(sourceRoles.map(role => ({
          id: randomUUID(), organizationId: input.organizationId, membershipId: targetId,
          unitId: null, role: role.role,
        })))
      }
      await tx.update(s.memberships).set({ status: 'suspended' }).where(eq(s.memberships.id, memberId))
      await selectOrganization(tx, sourceOrganizationId)
      await recordAudit(tx, { actor, organizationId: sourceOrganizationId, membershipId: '' }, 'membership.transferred', memberId, {
        targetOrganizationId: input.organizationId, targetMembershipId: targetId,
      })
      return { sourceMembershipId: memberId, targetMembershipId: targetId, organizationId: input.organizationId }
    }), 201)
  })
  app.patch('/v1/platform/organizations/:organizationId', async (c) => {
    const id = wire.organizationId.parse(c.req.param('organizationId'))
    const input = z.object({
      status: z.enum(['active', 'suspended']).optional(),
      name: z.string().trim().min(1).max(120).optional(),
      parentId: wire.organizationId.nullable().optional(),
    }).strict().parse(await c.req.json())
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      await selectOrganization(tx, id)
      const [current] = await tx.select().from(s.organizations).where(eq(s.organizations.id, id))
      if (!current) forbidden()
      const changes: { status?: 'active' | 'suspended'; name?: string; parentId?: string | null; rootId?: string } = {}
      if (input.status !== undefined) changes.status = input.status
      if (input.name !== undefined) changes.name = input.name
      if (input.parentId !== undefined) {
        if (input.parentId === id) throw new HTTPException(409, { message: 'An organization cannot parent itself' })
        if (input.parentId !== null) {
          const [parent] = await tx.select().from(s.organizations).where(eq(s.organizations.id, input.parentId))
          if (!parent) forbidden()
          const descendants = await tx.execute(sql`
            WITH RECURSIVE descendants AS (
              SELECT id FROM enterprise.organization WHERE id = ${id}
              UNION ALL
              SELECT child.id FROM enterprise.organization child JOIN descendants d ON child.parent_id = d.id
            ) SELECT id FROM descendants WHERE id = ${input.parentId}
          `)
          if (descendants.length) throw new HTTPException(409, { message: 'An organization cannot move below its descendant' })
          changes.parentId = input.parentId
          changes.rootId = parent.rootId ?? parent.id
        } else {
          changes.parentId = null
          changes.rootId = id
        }
      }
      const rows = Object.keys(changes).length
        ? await tx.update(s.organizations).set(changes).where(eq(s.organizations.id, id)).returning()
        : [current]
      if (input.parentId !== undefined) {
        await tx.execute(sql`
          WITH RECURSIVE descendants AS (
            SELECT id FROM enterprise.organization WHERE id = ${id}
            UNION ALL
            SELECT child.id FROM enterprise.organization child JOIN descendants d ON child.parent_id = d.id
          ) UPDATE enterprise.organization SET root_id = ${changes.rootId} WHERE id IN (SELECT id FROM descendants)
        `)
      }
      await recordAudit(tx, { actor, organizationId: id, membershipId: '' }, 'organization.updated', id, input)
      return rows[0]
    }))
  })
  app.put('/v1/platform/organizations/:organizationId/subscription', async (c) => {
    const id = wire.organizationId.parse(c.req.param('organizationId'))
    const input = z
      .object({
        plan: z.string().min(1).max(60),
        seats: z.number().int().positive().max(100000),
        runtimes: z.number().int().positive().max(100000),
        budgetMicros: z.number().int().nonnegative().max(1_000_000_000_000),
      })
      .strict()
      .parse(await c.req.json())
    return c.json(
      await db.transaction(async (tx) => {
        const actor = c.get('actor')
        await requirePlatform(tx, actor)
        await selectOrganization(tx, id)
        const rows = await tx
          .update(s.subscriptions)
          .set(input)
          .where(eq(s.subscriptions.organizationId, id))
          .returning()
        if (!rows.length) forbidden()
        await recordAudit(tx, { actor, organizationId: id, membershipId: '' }, 'subscription.updated', id, input)
        return rows[0]
      }),
    )
  })
  app.post('/v1/platform/organizations/:organizationId/usage/:id/reconcile', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    const organizationId = wire.organizationId.parse(c.req.param('organizationId'))
    const input = z.object({
      outcome: z.enum(['settled', 'failed']),
      inputTokens: z.number().int().nonnegative().optional(),
      cachedInputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      reasoningTokens: z.number().int().nonnegative().optional(),
      billedMicros: z.number().int().nonnegative().optional(),
      durationMs: z.number().int().nonnegative().optional(),
      upstreamRequestId: z.string().min(1).max(512).optional(),
    }).strict().parse(await c.req.json())
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await selectOrganization(tx, organizationId)
      const [entry] = await tx.select().from(s.usage).where(eq(s.usage.id, id)).for('update')
      if (!entry) throw new HTTPException(404, { message: 'Usage entry not found' })
      if (entry.status !== 'pending_reconciliation') {
        throw new HTTPException(409, { message: 'Usage entry is not pending reconciliation' })
      }
      if (entry.organizationId !== organizationId) forbidden()
      const cnyClaim = entry.pricingVersion === 1
        && entry.inputPriceMicrosCnyPerMillion !== null
        && entry.cachedInputPriceMicrosCnyPerMillion !== null
        && entry.outputPriceMicrosCnyPerMillion !== null
        && entry.requestStartedAt !== null
      if (input.outcome === 'failed') {
        await tx.update(s.usage).set({ status: 'failed', actualMicros: 0, billedMicros: 0, settledAt: new Date() })
          .where(eq(s.usage.id, id))
        if (!cnyClaim) await tx.update(s.subscriptions).set({
          reservedMicros: sql`${s.subscriptions.reservedMicros} - ${entry.reservedMicros}`,
        }).where(eq(s.subscriptions.organizationId, entry.organizationId))
        await recordAudit(tx, { actor, organizationId, membershipId: '' }, 'usage.reconciled', id, { outcome: 'failed' })
        return { id, status: 'failed' as const }
      }
      if (cnyClaim) {
        const inputPrice = entry.inputPriceMicrosCnyPerMillion
        const cachedInputPrice = entry.cachedInputPriceMicrosCnyPerMillion
        const outputPrice = entry.outputPriceMicrosCnyPerMillion
        const requestStartedAt = entry.requestStartedAt
        if (inputPrice === null || cachedInputPrice === null || outputPrice === null || requestStartedAt === null) {
          throw new Error('CNY usage claim lost its price or request-time snapshot')
        }
        if (input.inputTokens === undefined || input.outputTokens === undefined) {
          throw new HTTPException(400, { message: 'CNY settlement requires inputTokens and outputTokens' })
        }
        const cachedInputTokens = input.cachedInputTokens ?? 0
        const reasoningTokens = input.reasoningTokens ?? 0
        if (cachedInputTokens > input.inputTokens || reasoningTokens > input.outputTokens) {
          throw new HTTPException(400, { message: 'Usage subdivisions exceed their token totals' })
        }
        const costs = calculateUsageCosts({
          promptTokens: input.inputTokens,
          cachedPromptTokens: cachedInputTokens,
          completionTokens: input.outputTokens,
          reasoningTokens,
        }, {
          inputPriceMicrosCnyPerMillion: inputPrice,
          cachedInputPriceMicrosCnyPerMillion: cachedInputPrice,
          outputPriceMicrosCnyPerMillion: outputPrice,
        })
        await tx.update(s.usage).set({
          status: 'settled',
          inputTokens: input.inputTokens,
          cachedInputTokens,
          uncachedInputTokens: costs.uncachedInputTokens,
          outputTokens: input.outputTokens,
          reasoningTokens,
          totalTokens: input.inputTokens + input.outputTokens,
          currency: 'CNY',
          inputCostMicrosCny: costs.inputCostMicrosCny,
          cachedInputCostMicrosCny: costs.cachedInputCostMicrosCny,
          outputCostMicrosCny: costs.outputCostMicrosCny,
          totalCostMicrosCny: costs.totalCostMicrosCny,
          durationMs: input.durationMs ?? Math.max(0, Date.now() - requestStartedAt.getTime()),
          upstreamRequestId: input.upstreamRequestId ?? entry.upstreamRequestId,
          settledAt: new Date(),
        }).where(eq(s.usage.id, id))
        await recordAudit(tx, { actor, organizationId, membershipId: '' }, 'usage.reconciled', id, {
          outcome: 'settled', currency: 'CNY', totalCostMicrosCny: costs.totalCostMicrosCny,
        })
        return { id, status: 'settled' as const, currency: 'CNY' as const, totalCostMicrosCny: costs.totalCostMicrosCny }
      }
      if (input.billedMicros === undefined) {
        throw new HTTPException(400, { message: 'A compatibility settlement requires billedMicros' })
      }
      await tx.update(s.usage).set({
        status: 'settled', inputTokens: input.inputTokens ?? null, outputTokens: input.outputTokens ?? null,
        actualMicros: input.billedMicros, billedMicros: input.billedMicros, settledAt: new Date(),
      }).where(eq(s.usage.id, id))
      await tx.update(s.subscriptions).set({
        reservedMicros: sql`${s.subscriptions.reservedMicros} - ${entry.reservedMicros}`,
        spentMicros: sql`${s.subscriptions.spentMicros} + ${input.billedMicros}`,
      }).where(eq(s.subscriptions.organizationId, entry.organizationId))
      await recordAudit(tx, { actor, organizationId, membershipId: '' }, 'usage.reconciled', id, {
        outcome: 'settled', billedMicros: input.billedMicros,
      })
      return { id, status: 'settled' as const, billedMicros: input.billedMicros }
    }))
  })
  mountModels(app, services, tenantOperation)
  mountSessions(app, services, tenantOperation)
  mountDesktopAuthorization(app, services)
  mountPlugins(app, services, tenantOperation)
  mountUsageAnalytics(app, services)
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json(
        { error: 'INVALID_INPUT', issues: error.issues.map(i => ({ path: i.path, message: i.message })) },
        400,
      )
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
    const cause = error.cause ?? error
    if (
      typeof cause === 'object' &&
      'code' in cause &&
      ['23503', '23505', '23514', '40001'].includes(String(cause.code))
    ) {
      return c.json({ error: 'CONFLICT' }, 409)
    }
    return c.json({ error: 'INTERNAL_ERROR' }, 500)
  })
  return { app, auth }
}

async function checkSeat(tx: Transaction): Promise<void> {
  const [plan] = await tx.select().from(s.subscriptions).for('update')
  const active = await tx.select().from(s.memberships).where(eq(s.memberships.status, 'active'))
  if (!plan || active.length >= plan.seats) throw new HTTPException(409, { message: 'Seat limit reached' })
}
