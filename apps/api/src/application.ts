/** HTTP composition for enterprise identity, organization and runtime administration. */
import { mountSubscriptionPlans, applySubscriptionPlan } from './subscription-plans.ts'
import { randomBytes, randomUUID } from 'node:crypto'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { hashPassword } from 'better-auth/crypto'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { and, asc, desc, eq, getTableColumns, gt, gte, ilike, inArray, isNull, ne, sql } from 'drizzle-orm'
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
  requirePermission,
  requirePlatform,
  effectivePermissions,
  protectFinalOwner,
  type Actor,
  type Tenant,
} from './security.ts'
import { mountTeamGovernance, setMemberStatus } from './team-governance.ts'
import { mountModels } from './models.ts'
import { refreshLoginSession } from './login-session.ts'
import { mountSessions } from './sessions.ts'
import { issueDesktopCode, loopbackCallback, mountDesktopAuthorization } from './desktop-auth.ts'
import { mountDesktopReleases } from './desktop-releases.ts'
import type { DesktopArtifactStore } from './desktop-storage.ts'
import { mountPlugins } from './plugins.ts'
import { mountUsageAnalytics } from './usage.ts'
import { calculateUsageCosts, mountGateway, type ModelTransport } from './gateway.ts'
import { debitWalletForUsage, mountWallet } from './wallet.ts'
import { createInternalRelayAuthority } from './internal-relay.ts'
import type { PluginArtifactStore } from './plugin-artifacts.ts'
import type { PluginCacheStore, RateLimiter } from './rate-limit.ts'
import type { PluginDatabaseService } from './plugin-database.ts'
import type { DriveObjectStore } from './drive-storage.ts'
import { mountDrive } from './drive.ts'
import { mountModelProviders } from './model-providers.ts'
import { mountModelTasks } from './model-tasks.ts'
import { runSyncScript, type SyncScriptPage } from './sync-runner.ts'
import { mountAdminGovernance } from './admin-governance.ts'

export type ApiEnv = { Variables: { actor: Actor } }
export interface Services {
  db: Database
  config: Config
  mail: SendMail
  /** Testable wall clock for runtime-only provider file expiry. */
  now?: () => number
  assetDownload?: typeof import('./model-task-assets.ts').downloadTaskAsset
  modelTransport?: ModelTransport
  desktopArtifacts?: DesktopArtifactStore
  pluginArtifacts?: PluginArtifactStore
  rateLimiter?: RateLimiter
  pluginCache?: PluginCacheStore
  pluginDatabase?: PluginDatabaseService
  driveObjects?: DriveObjectStore
  /** Optional Host-side credential adapter; secret values never enter Client responses. */
  pluginCredentials?: PluginCredentialStore
  /** Optional Host-side authorization adapter. */
  pluginAuthorization?: PluginAuthorizationBroker
  /** Optional Host-side MCP adapter. */
  pluginMcp?: PluginMcpBroker
  pluginSkills?: PluginSkillStore
  pluginConfig?: PluginConfigStore
}

export interface PluginCredentialStore {
  get(installationId: string, name: string): Promise<string | undefined>
  set(installationId: string, name: string, value: string): Promise<void>
  delete(installationId: string, name: string): Promise<void>
  list(installationId: string): Promise<readonly { name: string; label?: string; kind: 'secret' | 'oauth' | 'api-key' }[]>
}

export interface PluginAuthorizationBroker {
  begin(installationId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>
  complete(installationId: string, authorizationId: string, input: Record<string, string>): Promise<Record<string, unknown>>
}

export interface PluginMcpBroker {
  connect(installationId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>
  disconnect(installationId: string, id: string): Promise<void>
  listTools(installationId: string, id: string): Promise<readonly Record<string, unknown>[]>
  call(installationId: string, input: Record<string, unknown>): Promise<unknown>
}

export interface PluginSkillStore {
  register(installationId: string, skill: Record<string, unknown>): Promise<void>
  unregister(installationId: string, id: string): Promise<void>
  list(installationId: string): Promise<readonly Record<string, unknown>[]>
}

export interface PluginConfigStore {
  get(installationId: string, key: string): Promise<unknown>
  set(installationId: string, key: string, value: unknown): Promise<void>
  delete(installationId: string, key: string): Promise<void>
}
export type TenantOperation = <T>(
  c: Context<ApiEnv>,
  run: (tx: Transaction, tenant: Tenant) => Promise<T>,
) => Promise<T>

const tenantUsageQueryBase = z.object({
  scope: z.enum(['own', 'organization']).default('own'),
  accountId: wire.accountId.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
const tenantUsageRangeQuery = tenantUsageQueryBase.pick({ from: true, to: true }).superRefine((value, context) => {
  if ((value.from === undefined) !== (value.to === undefined)) {
    context.addIssue({ code: 'custom', path: ['from'], message: 'from and to must be provided together' })
  } else if (value.from !== undefined && value.to !== undefined && value.from >= value.to) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'to must be later than from' })
  }
})
const tenantUsageQuery = tenantUsageQueryBase.superRefine((value, context) => {
  if ((value.from === undefined) !== (value.to === undefined)) {
    context.addIssue({ code: 'custom', path: ['from'], message: 'from and to must be provided together' })
  } else if (value.from !== undefined && value.to !== undefined && value.from >= value.to) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'to must be later than from' })
  }
})

type ZonedDateParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function zonedDateParts(value: Date, timeZone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  const number = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find(part => part.type === type)?.value)
  return { year: number('year'), month: number('month'), day: number('day'), hour: number('hour'), minute: number('minute'), second: number('second') }
}

function zonedMidnight(year: number, month: number, timeZone: string): Date {
  const wanted = Date.UTC(year, month - 1, 1)
  let candidate = wanted
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedDateParts(new Date(candidate), timeZone)
    const observed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    candidate += wanted - observed
  }
  return new Date(candidate)
}

function currentReportingMonth(now: Date, timeZone: string): { from: Date; to: Date } {
  const local = zonedDateParts(now, timeZone)
  const nextYear = local.month === 12 ? local.year + 1 : local.year
  const nextMonth = local.month === 12 ? 1 : local.month + 1
  return {
    from: zonedMidnight(local.year, local.month, timeZone),
    to: zonedMidnight(nextYear, nextMonth, timeZone),
  }
}

function decodeUsageCursor(value: string): { occurredAtMicros: string; id: string } {
  const [occurredAtMicros, id, ...rest] = Buffer.from(value, 'base64url').toString('utf8').split('|')
  if (!id || !occurredAtMicros || rest.length > 0 || !/^[0-9]+$/u.test(occurredAtMicros)) {
    throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'invalid usage cursor' }])
  }
  return { occurredAtMicros, id }
}

function encodeUsageCursor(occurredAtMicros: string, id: string): string {
  return Buffer.from(`${occurredAtMicros}|${id}`, 'utf8').toString('base64url')
}

/** Assemble routes without binding a port; the Cordis plugin owns listener lifetime. */
export function createApplication(services: Services) {
  const { db, config, mail } = services
  const auth = createAuth(db, config, mail)
  const internalRelay = createInternalRelayAuthority()
  const app = new Hono<ApiEnv>()
  const tenantOperation: TenantOperation = (c, run) =>
    db.transaction(async (tx) => {
      const tenant = await enterTenant(tx, c.get('actor'), wire.organizationId.parse(c.req.param('organizationId')),
        c.req.method === 'GET' || c.req.path.includes('/governance') || /\/model-tasks\/[^/]+\/(?:cancel|retry-save)$/.test(c.req.path) || (c.req.method === 'DELETE' && c.req.path.includes('/drive/')))
      return run(tx, tenant)
    })
  const allowedBrowserOrigins = browserOrigins(config)
  const ordinaryBodyLimit: MiddlewareHandler<ApiEnv> = bodyLimit({ maxSize: 1024 * 1024 })
  const pluginPackageBodyLimit: MiddlewareHandler<ApiEnv> = bodyLimit({ maxSize: config.pluginPackageMaxBytes })
  const modelBodyLimit: MiddlewareHandler<ApiEnv> = bodyLimit({ maxSize: config.modelRequestBodyBytes })
  const controlPath = new RegExp(
    '^(?:/auth(?:/|$)|/health$|/desktop(?:/|$)|'
    + '/v1/(?:me$|desktop(?:/|$)|invitations(?:/|$)|organizations(?:/|$)|platform(?:/|$)))',
    'u',
  )
  const isControlPath = (path: string): boolean => controlPath.test(path)
  const isModelRelayPath = (path: string): boolean => /^\/model\//u.test(path)
  const requestBodyLimit: MiddlewareHandler<ApiEnv> = (c, next) => {
    // Installer uploads enforce signed size while streaming after platform authorization.
    if (c.req.method === 'PUT' && /^\/v1\/platform\/desktop-releases\/[^/]+\/installer$/u.test(c.req.path)) return next()
    const limiter = isModelRelayPath(c.req.path)
      ? modelBodyLimit
      : c.req.path.endsWith('/plugins/packages') ? pluginPackageBodyLimit : ordinaryBodyLimit
    return limiter(c, next)
  }
  app.use('*', requestBodyLimit)
  app.use(
    '*',
    cors({
      origin: allowedBrowserOrigins,
      credentials: true,
      allowHeaders: [
        'Content-Type', 'Authorization', 'Idempotency-Key',
        'X-DSH-Model', 'X-DSH-Purpose', 'X-DSH-Policy-Revision',
      ],
    }),
  )
  app.use('/v1/*', async (c, next) => {
    if (!isControlPath(c.req.path)) {
      await next()
      return
    }
    const token = c.req.header('Authorization')?.replace(/^Bearer /, '')
    const path = c.req.path.match(new RegExp([
      '^/v1/organizations/([0-9a-f-]+)/',
      '(capabilities|governance(?:/actions)?|roles(?:/custom(?:/[0-9a-f-]+(?:/bindings)?)?|/[0-9a-f-]+)?|identity-providers(?:/[^/]+)?|audit(?:-page)?|role-bindings|permissions|overview|models|model-tasks(?:/page|/models|/preview|/[0-9a-f-]+(?:/(?:cancel|retry-save))?)?|model-assets(?:/[0-9a-f-]+/access)?|usage|wallet(?:/ledger|/summary|/redeem)?|members(?:/usage-summary|/[0-9a-f-]+/(?:units|effective-permissions))?|units(?:/[0-9a-f-]+)?|invitations(?:/[0-9a-f-]+(?:/resend)?)?|',
      'plugins(?:/catalog|/packages|/device-targets|/installations(?:/[^/]+)?(?:/(?:operations|uninstall/complete|devices/[^/]+(?:/(?:heartbeat|activate))?|activate|deactivate|upgrade|force-remove|reauthorize|export|data-delete))?|/[^/]+(?:/(?:artifact|package|install|revoke|ai-review|approve|uninstall/complete|devices/[^/]+(?:/(?:heartbeat|activate))?|activate|deactivate|upgrade|reauthorize|export|data-delete))?|/revocations)?|',
      'sessions(?:/[^/]+(?:/(?:events|lease|export|fork|archive))?)?|drive(?:/.*)?|',
      'runtimes(?:/[^/]+(?:/authorization)?)?)$',
    ].join('')))
    if (token && path && !c.req.header('Cookie')) {
      const org = wire.organizationId.parse(path[1])
      const actor = await db.transaction(async (tx) => {
        await selectOrganization(tx, org)
        const [runtime] = await tx
          .select()
          .from(s.runtimes)
          .where(and(eq(s.runtimes.organizationId, org), eq(s.runtimes.tokenHash, digest(token)), isNull(s.runtimes.revokedAt)))
        if (!runtime || runtime.expiresAt <= new Date()) forbidden()
        const [user] = await tx.select().from(s.user).where(eq(s.user.id, runtime.accountId))
        if (!user || (config.requireEmailVerification && !user.emailVerified)) forbidden()
        const actor = { id: wire.accountId.parse(user.id), email: user.email, runtimeId: runtime.id }
        await enterTenant(tx, actor, org, true)
        await refreshLoginSession(tx, runtime, config.loginSessionSeconds)
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
  app.get('/auth/deployment', async (c) => {
    const [policy] = await db.select({ mode: s.deployment.mode, registration: s.deployment.registration })
      .from(s.deployment).where(eq(s.deployment.id, 'primary'))
    if (!policy) throw new HTTPException(503, { message: 'Deployment policy is not initialized' })
    return c.json(wire.accountDeployment.parse(policy), 200, { 'Cache-Control': 'no-store' })
  })
  app.get('/auth/account-entry', c => c.json({ url: new URL('/account', config.adminOrigin).href }, 200, {
    'Cache-Control': 'no-store',
  }))
  app.get('/auth/sso/providers', async (c) => {
    const providers = await db.select({
      id: s.identityProviders.id, name: s.identityProviders.name, protocol: s.identityProviders.protocol,
    })
      .from(s.identityProviders)
      .where(and(eq(s.identityProviders.enabled, true), inArray(s.identityProviders.protocol, ['oidc', 'oauth2'])))
    return c.json(providers.map(provider => ({ id: `dsh-${provider.id}`, name: provider.name, protocol: provider.protocol })))
  })
  app.get('/auth/sso/desktop', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) throw new HTTPException(401, { message: 'Login required' })
    const query = z.object({
      challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
      callback: z.string(),
      state: z.string().min(32).max(128),
      organizationId: wire.organizationId.optional(),
    }).strict().parse({
      challenge: c.req.query('challenge'), callback: c.req.query('callback'),
      state: c.req.query('state'), organizationId: c.req.query('organizationId'),
    })
    const actor = { id: wire.accountId.parse(session.user.id), email: session.user.email.toLowerCase() }
    if (query.organizationId === undefined) {
      const organizations = await db.transaction(async (tx) => {
        await identify(tx, actor.id, actor.email)
        const rows = await tx.execute(sql`
          SELECT id, name
          FROM enterprise.list_active_organizations_for_account(${actor.id})
        `)
        return rows.filter((row): row is { id: string; name: string } =>
          typeof row.id === 'string' && typeof row.name === 'string')
      })
      const base = new URL(c.req.url)
      const links = organizations.map((organization) => {
        const href = new URL(base)
        href.searchParams.set('organizationId', organization.id)
        const label = organization.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        return `<li><a href="${href.toString()}">${label}</a></li>`
      }).join('')
      return c.html(`<!doctype html><meta charset="utf-8"><title>Choose organization</title><h1>Choose an organization</h1><ul>${links || '<li>No organizations available</li>'}</ul>`, 200, {
        'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline';",
      })
    }
    const callback = loopbackCallback(query.callback)
    const redirect = await issueDesktopCode({ db }, actor, {
      organizationId: query.organizationId, challenge: query.challenge, callback: callback.toString(), state: query.state,
    })
    return c.redirect(redirect, 302)
  })
  app.on(['GET', 'POST'], '/auth/*', c => auth.handler(c.req.raw))
  app.get('/health', c => c.json({ service: 'enterprise-api', status: 'ok' }))
  app.get('/v1/me', async (c) => {
    const actor = c.get('actor')
    const profile = await db.transaction(async (tx) => {
      const [account] = await tx.select({
        id: s.user.id,
        name: s.user.name,
        email: s.user.email,
        avatarUrl: s.user.image,
      }).from(s.user).where(eq(s.user.id, actor.id))
      const rows = await tx.select({ accountId: s.platformAdmins.accountId })
        .from(s.platformAdmins).where(eq(s.platformAdmins.accountId, actor.id))
      return { account, platformAdmin: rows.length > 0 }
    })
    if (!profile.account) forbidden()
    return c.json({
      id: profile.account.id,
      userId: profile.account.id,
      name: profile.account.name,
      email: profile.account.email,
      avatarUrl: profile.account.avatarUrl,
      platformAdmin: profile.platformAdmin,
    })
  })
  app.get('/v1/organizations', async c =>
    c.json(
      await db.transaction(async (tx) => {
        const actor = c.get('actor')
        await identify(tx, actor.id, actor.email)
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
  /** Return organizations where the signed-in account has an active membership.
   * Desktop account selection must not expose the platform administrator's
   * control-plane directory because non-member organizations cannot be entered.
   */
  app.get('/v1/desktop/organizations', async c =>
    c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await identify(tx, actor.id, actor.email)
      const rows = await tx.execute(sql`
        SELECT id, name
        FROM enterprise.list_active_organizations_for_account(${actor.id})
      `)
      return rows.filter((row): row is { id: string; name: string } =>
        typeof row.id === 'string' && typeof row.name === 'string')
    })),
  )
  app.post('/v1/organizations', async (c) => {
    const input = wire.createOrganization.parse(await c.req.json())
    const result = await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await identify(tx, actor.id, actor.email)
      const [deployment] = await tx.select().from(s.deployment).where(eq(s.deployment.id, 'primary')).for('update')
      if (deployment?.mode !== 'open') forbidden()
      const id = wire.organizationId.parse(randomUUID())
      await selectOrganization(tx, id)
      const membershipId = randomUUID()
      const rootId = randomUUID()
      await tx.insert(s.organizations).values({ id, rootId: id, path: id, name: input.name, resourcePolicy: {
        defaultBudget: input.defaultBudget, timeZone: 'Asia/Shanghai', storageBytes: config.driveOrganizationQuotaBytes,
        personalStorageBytes: config.drivePersonalQuotaBytes,
      } })
      await tx.insert(s.units).values({ id: rootId, organizationId: id, unitType: 'root', name: input.name })
      await tx.insert(s.memberships).values({ id: membershipId, organizationId: id, accountId: actor.id })
      await tx.insert(s.assignments).values({ organizationId: id, membershipId, unitId: rootId })
      await tx.insert(s.roles).values({ id: randomUUID(), organizationId: id, membershipId, role: 'owner' })
      await tx.insert(s.subscriptions).values({ organizationId: id })
      await tx.insert(s.organizationWallets).values({ organizationId: id })
      await recordAudit(tx, { actor, organizationId: id, membershipId }, 'organization.created', id)
      return { id, rootId }
    })
    return c.json(result, 201)
  })
  app.get('/v1/organizations/:organizationId/capabilities', c => tenantOperation(c, async (tx, tenant) =>
    c.json({ permissions: await effectivePermissions(tx, tenant) })))
  app.get('/v1/organizations/:organizationId/overview', async c =>
    c.json(
      await tenantOperation(c, async (tx, tenant) => {
        const [organization] = await tx.select().from(s.organizations).where(eq(s.organizations.id, tenant.organizationId))
        const [subscription] = await tx.select().from(s.subscriptions).where(eq(s.subscriptions.organizationId, tenant.organizationId))
        const roles = await tx.select().from(s.roles).where(eq(s.roles.membershipId, tenant.membershipId))
        const permissions = await effectivePermissions(tx, tenant)
        const manageOrganizationPlugins = permissions.includes('plugin.manage'), publishPlugins = permissions.includes('plugin.publish')
        return { organization, subscription, roles, permissions, capabilities: { manageOrganizationPlugins, publishPlugins } }
      }),
    ),
  )
  app.get('/v1/organizations/:organizationId/permissions', async c =>
    c.json(await tenantOperation(c, tx => tx.select().from(s.permissions).orderBy(s.permissions.resource, s.permissions.action))),
  )
  app.get('/v1/organizations/:organizationId/workspaces', async c =>
    c.json(await tenantOperation(c, async (tx, tenant) => tx.select().from(s.workspaces).where(eq(s.workspaces.organizationId,
      tenant.organizationId)).orderBy(desc(s.workspaces.updatedAt))),
    ))
  app.post('/v1/organizations/:organizationId/workspaces', async (c) => {
    const input = wire.workspaceInput.parse(await c.req.json())
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'sandbox.manage')
      const id = randomUUID()
      await tx.insert(s.workspaces).values({ id, organizationId: tenant.organizationId, accountId: tenant.actor.id, ...input })
      await recordAudit(tx, tenant, 'workspace.created', id, { image: input.image })
      const [workspace] = await tx.select().from(s.workspaces).where(eq(s.workspaces.id, id))
      return workspace
    }), 201)
  })
  app.post('/v1/organizations/:organizationId/workspaces/:id/start', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'sandbox.manage')
      const [workspace] = await tx.select().from(s.workspaces).where(and(eq(s.workspaces.id, id), eq(s.workspaces.organizationId,
        tenant.organizationId)))
      if (!workspace) forbidden()
      await tx.update(s.workspaces).set({ status: 'running', updatedAt: new Date() }).where(eq(s.workspaces.id, id))
      await recordAudit(tx, tenant, 'workspace.started', id)
      return { ...workspace, status: 'running' }
    }))
  })
  app.post('/v1/organizations/:organizationId/workspaces/:id/stop', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'sandbox.manage')
      const [workspace] = await tx.select().from(s.workspaces).where(and(eq(s.workspaces.id, id), eq(s.workspaces.organizationId,
        tenant.organizationId)))
      if (!workspace) forbidden()
      await tx.update(s.workspaces).set({ status: 'stopped', leaseId: null, leaseUntil: null, updatedAt: new Date() }).where(eq(s.workspaces.id, id))
      await recordAudit(tx, tenant, 'workspace.stopped', id)
      return { ...workspace, status: 'stopped', leaseId: null, leaseUntil: null }
    }))
  })
  app.post('/v1/organizations/:organizationId/workspaces/:id/lease', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'sandbox.manage')
      const [workspace] = await tx.select().from(s.workspaces).where(and(eq(s.workspaces.id, id), eq(s.workspaces.organizationId,
        tenant.organizationId)))
      if (!workspace) forbidden()
      const leaseId = randomUUID()
      const leaseUntil = new Date(Date.now() + 10 * 60_000)
      await tx.update(s.workspaces).set({ status: 'running', leaseId, leaseUntil, updatedAt: new Date() }).where(eq(s.workspaces.id, id))
      return { leaseId, leaseUntil: leaseUntil.toISOString() }
    }))
  })
  app.delete('/v1/organizations/:organizationId/workspaces/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'sandbox.manage')
      const [workspace] = await tx.select().from(s.workspaces).where(and(eq(s.workspaces.id, id), eq(s.workspaces.organizationId,
        tenant.organizationId)))
      if (!workspace) forbidden()
      await tx.delete(s.workspaces).where(eq(s.workspaces.id, id))
      await recordAudit(tx, tenant, 'workspace.deleted', id)
      return { id, deleted: true }
    }))
  })
  app.get('/v1/organizations/:organizationId/identity-providers', async c =>
    c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'identity.manage')
      return tx.select().from(s.identityProviders).where(eq(s.identityProviders.organizationId, tenant.organizationId))
    })),
  )
  app.post('/v1/organizations/:organizationId/identity-providers', async (c) => {
    const input = wire.identityProviderInput.parse(await c.req.json())
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'identity.manage')
      const id = randomUUID()
      await tx.insert(s.identityProviders).values({ id, organizationId: tenant.organizationId, ...input })
      await recordAudit(tx, tenant, 'identity_provider.created', id, { protocol: input.protocol })
      return { id }
    }), 201)
  })
  app.patch('/v1/organizations/:organizationId/identity-providers/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    const input = wire.identityProviderInput.partial().extend({ enabled: z.boolean().optional(),
      expectedVersion: z.number().int().positive() }).strict().parse(await c.req.json())
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'identity.manage')
      const [provider] = await tx.select().from(s.identityProviders).where(and(eq(s.identityProviders.id, id),
        eq(s.identityProviders.organizationId, tenant.organizationId)))
      if (!provider) forbidden()
      if (provider.version !== input.expectedVersion) throw new HTTPException(409, { message: 'CONFIG_VERSION_CONFLICT' })
      const { expectedVersion: _, ...changes } = input
      const updated = await tx.update(s.identityProviders).set({ ...changes, version: provider.version + 1,
        updatedAt: new Date() }).where(and(eq(s.identityProviders.id, id), eq(s.identityProviders.version,
        input.expectedVersion))).returning()
      if (!updated.length) throw new HTTPException(409, { message: 'CONFIG_VERSION_CONFLICT' })
      await recordAudit(tx, tenant, 'identity_provider.updated', id)
      return { id }
    }))
  })
  app.get('/v1/organizations/:organizationId/sync-scripts', async c =>
    c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'directory.sync')
      return tx.select({ id: s.syncScripts.id, name: s.syncScripts.name, version: s.syncScripts.version, source: s.syncScripts.source, status: s.syncScripts.status, approvedBy: s.syncScripts.approvedBy, createdAt: s.syncScripts.createdAt, updatedAt: s.syncScripts.updatedAt }).from(s.syncScripts).where(and(eq(s.syncScripts.organizationId, tenant.organizationId), ne(s.syncScripts.status, 'archived')))
    })),
  )
  app.post('/v1/organizations/:organizationId/sync-scripts', async (c) => {
    const input = wire.syncScriptInput.parse(await c.req.json())
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'directory.sync')
      const id = randomUUID()
      await tx.insert(s.syncScripts).values({ id, organizationId: tenant.organizationId, name: input.name, source: input.source })
      await recordAudit(tx, tenant, 'sync_script.created', id)
      return { id, status: 'draft' }
    }), 201)
  })
  app.patch('/v1/organizations/:organizationId/sync-scripts/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    const input = wire.syncScriptInput.parse(await c.req.json())
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'directory.sync')
      const [script] = await tx.select().from(s.syncScripts).where(and(eq(s.syncScripts.id, id), eq(s.syncScripts.organizationId,
        tenant.organizationId)))
      if (!script) forbidden()
      const [updated] = await tx.update(s.syncScripts).set({ name: input.name, source: input.source, version: script.version + 1, status: 'draft', approvedBy: null, updatedAt: new Date() }).where(eq(s.syncScripts.id, id)).returning()
      if (!updated) throw new HTTPException(409, { message: 'Sync script changed before it was saved' })
      await recordAudit(tx, tenant, 'sync_script.updated', id, { version: updated.version })
      return { id, name: updated.name, version: updated.version, status: updated.status, updatedAt: updated.updatedAt }
    }))
  })
  app.delete('/v1/organizations/:organizationId/sync-scripts/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'directory.sync')
      const [script] = await tx.select().from(s.syncScripts).where(and(eq(s.syncScripts.id, id), eq(s.syncScripts.organizationId, tenant.organizationId), ne(s.syncScripts.status, 'archived')))
      if (!script) forbidden()
      await tx.update(s.syncScripts).set({ status: 'archived', updatedAt: new Date() }).where(eq(s.syncScripts.id, id))
      await recordAudit(tx, tenant, 'sync_script.archived', id)
      return { id, deleted: true }
    }))
  })
  app.post('/v1/organizations/:organizationId/sync-scripts/:id/test', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    const rawInput: unknown = await c.req.json().catch(() => ({}))
    const input = z.record(z.string(), z.unknown()).parse(rawInput)
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'directory.sync')
      const [script] = await tx.select().from(s.syncScripts).where(and(eq(s.syncScripts.id, id), eq(s.syncScripts.organizationId,
        tenant.organizationId)))
      if (!script) forbidden()
      const runId = randomUUID()
      try {
        const result = await runSyncScript({ source: script.source, input })
        const pageEntries = Object.entries(result).flatMap(([entityType, value]) => {
          if (Array.isArray(value)) return [{ entityType, items: value, nextCursor: null, total: value.length }]
          if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as SyncScriptPage).items)) {
            const page = value as SyncScriptPage
            return [{ entityType, items: page.items, nextCursor: page.nextCursor ?? null, total: page.total ?? page.items.length }]
          }
          return []
        })
        if (pageEntries.some(page => page.items.length > 1_000)) throw new Error('A sync page cannot contain more than 1000 records')
        const sampleLimit = 20
        const preview = {
          accepted: true,
          protocol: 'directory-v1',
          counts: Object.fromEntries(pageEntries.map(page => [page.entityType, page.total])),
          pages: Object.fromEntries(pageEntries.map(page => [page.entityType, { returned: page.items.length, total: page.total,
            nextCursor: page.nextCursor }])),
          sample: Object.fromEntries(pageEntries.map(page => [page.entityType, page.items.slice(0, sampleLimit)])),
        }
        const changes = pageEntries.flatMap(({ entityType, items }) => items.slice(0, 1_000).map((entry, index) => {
          const record: Record<string, unknown> = entry && typeof entry === 'object' ? entry as Record<string, unknown> : { value: entry }
          const externalIdValue = record.externalId ?? record.id ?? record.email ?? record.employeeId ?? record.employee_no
          if ((typeof externalIdValue !== 'string' && typeof externalIdValue !== 'number') || String(externalIdValue).trim() === '') throw new Error(`Record ${entityType}[${index}] is missing a stable externalId`)
          const externalId = String(externalIdValue)
          const requestedChange = record.changeType ?? record._change
          const changeType = requestedChange === 'create' || requestedChange === 'disable' || requestedChange === 'delete' ? requestedChange : 'update'
          const canonicalType = entityType === 'organizations' ? 'organization' : entityType === 'users' ? 'user' : entityType === 'memberships' ? 'membership' : entityType === 'departments' ? 'department' : entityType
          return { id: randomUUID(), organizationId: tenant.organizationId, runId, entityType: canonicalType, externalId, changeType,
            before: null, after: record }
        }))
        await tx.insert(s.syncRuns).values({ id: runId, organizationId: tenant.organizationId, scriptId: id, trigger: 'manual', status: 'preview', preview })
        if (changes.length) await tx.insert(s.syncDiffs).values(changes)
        await recordAudit(tx, tenant, 'sync.preview_completed', runId, { scriptId: id, counts: preview.counts })
        return { id: runId, status: 'preview', ...preview }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Script failed'
        await tx.insert(s.syncRuns).values({ id: runId, organizationId: tenant.organizationId, scriptId: id, trigger: 'manual', status: 'failed', error: message, preview: { accepted: false } })
        await recordAudit(tx, tenant, 'sync.preview_failed', runId, { scriptId: id, error: message })
        return { id: runId, status: 'failed', accepted: false, error: message }
      }
    }))
  })
  app.post('/v1/organizations/:organizationId/sync-scripts/:id/approve', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'directory.sync')
      const [script] = await tx.select().from(s.syncScripts).where(and(eq(s.syncScripts.id, id), eq(s.syncScripts.organizationId,
        tenant.organizationId)))
      if (!script) forbidden()
      await tx.update(s.syncScripts).set({ status: 'approved', approvedBy: tenant.actor.id, updatedAt: new Date() }).where(eq(s.syncScripts.id, id))
      await recordAudit(tx, tenant, 'sync_script.approved', id)
      return { id, status: 'approved' }
    }))
  })
  app.post('/v1/organizations/:organizationId/sync-scripts/:id/publish', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'directory.sync')
      const [script] = await tx.select().from(s.syncScripts).where(and(eq(s.syncScripts.id, id), eq(s.syncScripts.organizationId,
        tenant.organizationId)))
      if (!script || script.status !== 'approved') throw new HTTPException(409, { message: 'Script approval is required before publish' })
      await tx.update(s.syncScripts).set({ status: 'published', updatedAt: new Date() }).where(eq(s.syncScripts.id, id))
      await recordAudit(tx, tenant, 'sync_script.published', id)
      return { id, status: 'published' }
    }))
  })
  app.get('/v1/organizations/:organizationId/sync-runs', async c =>
    c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'directory.sync')
      const runRows = await tx.select().from(s.syncRuns).where(eq(s.syncRuns.organizationId, tenant.organizationId))
        .orderBy(desc(s.syncRuns.createdAt)).limit(100)
      const scriptRows = await tx.select({ id: s.syncScripts.id, name: s.syncScripts.name,
        version: s.syncScripts.version }).from(s.syncScripts).where(eq(s.syncScripts.organizationId, tenant.organizationId))
      const scriptsById = new Map(scriptRows.map(script => [script.id, script]))
      return runRows.map(run => ({ ...run, scriptName: scriptsById.get(run.scriptId)?.name ?? '', scriptVersion: scriptsById.get(run.scriptId)?.version ?? null }))
    })),
  )
  app.get('/v1/organizations/:organizationId/roles/custom', async c =>
    c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'role.manage')
      const roles = await tx.select().from(s.customRoles).where(eq(s.customRoles.organizationId, tenant.organizationId))
      const bindings = await tx.select().from(s.customRolePermissions)
      return roles.map(role => ({ ...role,
        permissionIds: bindings.filter(binding => binding.roleId === role.id).map(binding => binding.permissionId) }))
    })),
  )
  app.post('/v1/organizations/:organizationId/roles/custom', async (c) => {
    const input = wire.customRoleInput.parse(await c.req.json())
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'role.manage')
      const available = await tx.select({ id: s.permissions.id }).from(s.permissions)
      const ids = new Set(available.map(item => item.id))
      if (input.permissionIds.some(id => !ids.has(id))) throw new HTTPException(400, { message: 'Unknown permission' })
      const id = randomUUID()
      await tx.insert(s.customRoles).values({ id, organizationId: tenant.organizationId, name: input.name, description: input.description })
      if (input.permissionIds.length) await tx.insert(s.customRolePermissions).values(input.permissionIds.map(permissionId => ({ roleId: id,
        permissionId })))
      await recordAudit(tx, tenant, 'custom_role.created', id, { permissionIds: input.permissionIds })
      return { id }
    }), 201)
  })
  app.patch('/v1/organizations/:organizationId/roles/custom/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    const input = wire.customRoleInput.extend({ expectedVersion: z.number().int().positive() }).parse(await c.req.json())
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'role.manage')
      const [role] = await tx.select().from(s.customRoles).where(and(eq(s.customRoles.id, id), eq(s.customRoles.organizationId,
        tenant.organizationId))).for('update')
      if (!role || role.system) forbidden()
      const expectedVersion = input.expectedVersion
      if (role.version !== expectedVersion) throw new HTTPException(409, { message: 'CONFIG_VERSION_CONFLICT' })
      const available = await tx.select({ id: s.permissions.id }).from(s.permissions)
      const ids = new Set(available.map(item => item.id))
      if (input.permissionIds.some(permissionId => !ids.has(permissionId))) throw new HTTPException(400, { message: 'Unknown permission' })
      await tx.update(s.customRoles).set({ name: input.name, description: input.description, version: role.version + 1 })
        .where(eq(s.customRoles.id, id))
      await tx.delete(s.customRolePermissions).where(eq(s.customRolePermissions.roleId, id))
      if (input.permissionIds.length) await tx.insert(s.customRolePermissions).values(input.permissionIds.map(permissionId => ({ roleId: id,
        permissionId })))
      await recordAudit(tx, tenant, 'custom_role.updated', id, { permissionIds: input.permissionIds, version: role.version + 1 })
      return { id, version: role.version + 1 }
    }))
  })
  app.delete('/v1/organizations/:organizationId/roles/custom/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'role.manage')
      const [role] = await tx.select().from(s.customRoles).where(and(eq(s.customRoles.id, id), eq(s.customRoles.organizationId,
        tenant.organizationId))).for('update')
      if (!role || role.system) forbidden()
      const expectedVersion = z.coerce.number().int().positive().parse(c.req.query('expectedVersion'))
      if (role.version !== expectedVersion) throw new HTTPException(409, { message: 'CONFIG_VERSION_CONFLICT' })
      await tx.update(s.customRoles).set({ enabled: false, version: role.version + 1 }).where(eq(s.customRoles.id, id))
      await recordAudit(tx, tenant, 'custom_role.disabled', id)
      return { id }
    }))
  })
  app.post('/v1/organizations/:organizationId/roles/custom/:id/bindings', async (c) => {
    const roleId = wire.resourceId.parse(c.req.param('id'))
    const input = wire.customRoleBindingInput.omit({ roleId: true }).parse(await c.req.json())
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'role.manage')
      const [role] = await tx.select().from(s.customRoles).where(and(eq(s.customRoles.id, roleId), eq(s.customRoles.organizationId,
        tenant.organizationId), eq(s.customRoles.enabled, true)))
      if (!role) forbidden()
      const [membership] = await tx.select().from(s.memberships).where(and(eq(s.memberships.id, input.membershipId),
        eq(s.memberships.organizationId, tenant.organizationId)))
      if (!membership) forbidden()
      await requireRoleTarget(tx, tenant.organizationId, input.membershipId, input.unitId)
      const id = randomUUID()
      await tx.insert(s.roles).values({ id, organizationId: tenant.organizationId, membershipId: input.membershipId, unitId: input.unitId, role: `custom:${roleId}`, effect: input.effect })
      await recordAudit(tx, tenant, 'custom_role.bound', id, { roleId, membershipId: input.membershipId, unitId: input.unitId, source: input.source })
      return { id }
    }), 201)
  })
  app.get('/v1/organizations/:organizationId/members/:membershipId/effective-permissions', async (c) => {
    const membershipId = wire.resourceId.parse(c.req.param('membershipId'))
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'role.manage')
      const [member] = await tx.select().from(s.memberships).where(and(eq(s.memberships.id, membershipId),
        eq(s.memberships.organizationId, tenant.organizationId)))
      if (!member) forbidden()
      const [user] = await tx.select().from(s.user).where(eq(s.user.id, member.accountId))
      if (!user) forbidden()
      return { membershipId, permissions: await effectivePermissions(tx, { ...tenant, membershipId,
        actor: { id: wire.accountId.parse(user.id), email: user.email } }) }
    }))
  })
  app.get('/v1/organizations/:organizationId/units', async c =>
    c.json(await tenantOperation(c, (tx, tenant) => tx.select().from(s.units).where(eq(s.units.organizationId, tenant.organizationId)))),
  )
  app.post('/v1/organizations/:organizationId/units', async (c) => {
    const input = wire.createUnit.parse(await c.req.json())
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await requirePermission(tx, tenant, 'member.manage')
        await lockOrganization(tx, tenant.organizationId)
        const [parent] = await tx.select().from(s.units).where(and(
          eq(s.units.id, input.parentId), eq(s.units.organizationId, tenant.organizationId),
        ))
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
    const input = wire.createUnit.omit({ unitType: true }).parse(await c.req.json())
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await requirePermission(tx, tenant, 'member.manage')
        await lockOrganization(tx, tenant.organizationId)
        const [unit] = await tx.select().from(s.units).where(and(eq(s.units.id, id), eq(s.units.organizationId, tenant.organizationId)))
        if (!unit || unit.parentId === null) forbidden()
        const ancestors = await tx.execute(sql`with recursive ancestors as (
        select id, parent_id from enterprise.org_unit where id = ${input.parentId} and organization_id = ${tenant.organizationId}
        union all select u.id, u.parent_id from enterprise.org_unit u join ancestors a on u.id = a.parent_id where u.organization_id = ${tenant.organizationId}
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
        await requirePermission(tx, tenant, 'member.manage')
        await lockOrganization(tx, tenant.organizationId)
        const [unit] = await tx.select().from(s.units).where(and(eq(s.units.id, id), eq(s.units.organizationId, tenant.organizationId)))
        if (!unit || unit.parentId === null) forbidden()
        const [child] = await tx.select({ id: s.units.id }).from(s.units).where(and(
          eq(s.units.organizationId, tenant.organizationId), eq(s.units.parentId, id),
        )).limit(1)
        const [assignment] = await tx.select().from(s.assignments).where(and(
          eq(s.assignments.organizationId, tenant.organizationId), eq(s.assignments.unitId, id),
        )).limit(1)
        const [role] = await tx.select({ id: s.roles.id }).from(s.roles).where(and(
          eq(s.roles.organizationId, tenant.organizationId), eq(s.roles.unitId, id),
        )).limit(1)
        if (child || assignment || role) throw new HTTPException(409, { message: 'Department still has children, members, or roles' })
        await tx.delete(s.units).where(eq(s.units.id, id))
        await recordAudit(tx, tenant, 'unit.deleted', id)
        return { id }
      }),
    )
  })
  app.get('/v1/organizations/:organizationId/members', async c =>
    c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await requirePermission(tx, tenant, 'member.manage')
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
          .where(eq(s.memberships.organizationId, tenant.organizationId))
        return {
          members,
          roles: await tx.select().from(s.roles).where(eq(s.roles.organizationId, tenant.organizationId)),
          assignments: await tx.select().from(s.assignments).where(eq(s.assignments.organizationId, tenant.organizationId)),
        }
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
        await requirePermission(tx, tenant, 'member.manage')
        await lockOrganization(tx, tenant.organizationId)
        const [member] = await tx.select().from(s.memberships).where(and(
          eq(s.memberships.id, id), eq(s.memberships.organizationId, tenant.organizationId),
        ))
        if (!member) forbidden()
        const targetRoles = await tx
          .select()
          .from(s.roles)
          .where(and(eq(s.roles.membershipId, id), isNull(s.roles.unitId)))
        if (targetRoles.some(binding => binding.role === 'owner')) {
          await requireRole(tx, tenant, ['owner'])
        }
        await setMemberStatus(tx, tenant.organizationId, id, input.status, new Date(services.now?.() ?? Date.now()))
        await recordAudit(tx, tenant, 'membership.updated', id, input)
        return { id }
      }),
    )
  })
  app.post('/v1/organizations/:organizationId/roles', async (c) => {
    const input = z
      .object({ membershipId: wire.resourceId, unitId: wire.resourceId.nullable(), role: wire.role, effect: z.enum(['allow', 'deny']).default('allow') })
      .strict()
      .parse(await c.req.json())
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await requirePermission(tx, tenant, 'role.manage')
        if (input.role === 'owner' || input.role === 'administrator') await requireRole(tx, tenant, ['owner'])
        if (input.role === 'owner' && input.unitId !== null)
          throw new HTTPException(400, { message: 'Owner must be organization-scoped' })
        await lockOrganization(tx, tenant.organizationId)
        await requireRoleTarget(tx, tenant.organizationId, input.membershipId, input.unitId)
        if (input.role === 'owner' && input.effect === 'deny') await protectFinalOwner(tx, tenant.organizationId, input.membershipId)
        const [existing] = await tx
          .select()
          .from(s.roles)
          .where(
            and(
              eq(s.roles.membershipId, input.membershipId),
              eq(s.roles.role, input.role),
              eq(s.roles.effect, input.effect),
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
      const [binding] = await tx.select().from(s.roles).where(and(eq(s.roles.id, id), eq(s.roles.organizationId, tenant.organizationId)))
      if (!binding) forbidden()
      await requirePermission(tx, tenant, 'role.manage')
      if (['owner', 'administrator'].includes(binding.role)) await requireRole(tx, tenant, ['owner'])
      if (binding.role === 'owner') {
        await protectFinalOwner(tx, tenant.organizationId, binding.membershipId)
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
      await requirePermission(tx, tenant, 'member.manage')
      const [member] = await tx.select().from(s.memberships).where(and(
        eq(s.memberships.id, id), eq(s.memberships.organizationId, tenant.organizationId),
      ))
      if (!member || member.status !== 'active') forbidden()
      const unitIds = [...new Set(input.unitIds)]
      const units = await tx.select({ id: s.units.id }).from(s.units).where(and(
        eq(s.units.organizationId, tenant.organizationId), inArray(s.units.id, unitIds),
      ))
      if (units.length !== unitIds.length) forbidden()
      await tx.delete(s.assignments).where(eq(s.assignments.membershipId, id))
      await tx.insert(s.assignments).values(
        unitIds.map(unitId => ({
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
        await requirePermission(tx, tenant, 'member.manage')
        const invitations = await tx
          .select()
          .from(s.invitations)
          .where(eq(s.invitations.organizationId, tenant.organizationId))
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
      await requirePermission(tx, tenant, 'member.manage')
      const [invitation] = await tx.select().from(s.invitations).where(and(eq(s.invitations.id, id), eq(s.invitations.organizationId, tenant.organizationId))).for('update')
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
  const deliverInvitation = async (id: string, organizationId: wire.OrganizationId, email: string, token: string) => {
    let deliveryStatus: 'sent' | 'failed' = 'sent'
    try {
      const url = new URL('/account', config.adminOrigin)
      url.searchParams.set('invitation', token)
      await mail({ to: email, subject: 'Team invitation', text: url.href })
    } catch { deliveryStatus = 'failed' /* The committed invitation remains available for authorized resend. */ }
    await db.transaction(async (tx) => {
      await selectOrganization(tx, organizationId)
      await tx.update(s.invitations).set({ deliveryStatus }).where(and(eq(s.invitations.id, id),
        eq(s.invitations.tokenHash, digest(token))))
    })
    return { id, deliveryStatus }
  }
  app.post('/v1/organizations/:organizationId/invitations', async (c) => {
    const input = wire.inviteMember.parse(await c.req.json())
    const token = randomBytes(32).toString('base64url')
    const result = await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'member.manage')
      if (input.role !== 'member') await requirePermission(tx, tenant, 'role.manage')
      if (input.role === 'administrator') await requireRole(tx, tenant, ['owner'])
      if (input.unitId) {
        const [unit] = await tx.select().from(s.units).where(and(eq(s.units.id, input.unitId),
          eq(s.units.organizationId, tenant.organizationId)))
        if (!unit) forbidden()
      }
      const id = randomUUID()
      await tx.insert(s.invitations).values({ id, organizationId: tenant.organizationId, ...input,
        tokenHash: digest(token), inviterId: tenant.actor.id,
        expiresAt: new Date(Date.now() + config.invitationSeconds * 1000) })
      await recordAudit(tx, tenant, 'invitation.created', id)
      return { id, organizationId: tenant.organizationId }
    })
    return c.json(await deliverInvitation(result.id, result.organizationId, input.email, token), 201)
  })
  app.post('/v1/organizations/:organizationId/invitations/:id/resend', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id')), token = randomBytes(32).toString('base64url')
    const result = await tenantOperation(c, async (tx, tenant) => {
      await lockOrganization(tx, tenant.organizationId)
      await requirePermission(tx, tenant, 'member.manage')
      const [invitation] = await tx.select().from(s.invitations).where(and(eq(s.invitations.id, id),
        eq(s.invitations.organizationId, tenant.organizationId))).for('update')
      if (!invitation) forbidden()
      if (invitation.acceptedAt) throw new HTTPException(409, { message: 'INVITATION_ALREADY_ACCEPTED' })
      await tx.update(s.invitations).set({ tokenHash: digest(token), deliveryStatus: 'pending',
        expiresAt: new Date(Date.now() + config.invitationSeconds * 1000) }).where(eq(s.invitations.id, id))
      await recordAudit(tx, tenant, 'invitation.resent', id)
      return { organizationId: tenant.organizationId, email: invitation.email }
    })
    return c.json(await deliverInvitation(id, result.organizationId, result.email, token))
  })
  app.get('/v1/invitations/:token', async c => c.json(await db.transaction(async (tx) => {
    const actor = c.get('actor')
    await identify(tx, actor.id, actor.email)
    const token = z.string().min(32).max(200).parse(c.req.param('token'))
    const [invitation] = await tx.select().from(s.invitations).where(and(eq(s.invitations.tokenHash, digest(token)),
      eq(s.invitations.email, actor.email)))
    if (!invitation) throw new HTTPException(403, { message: 'INVITATION_EMAIL_MISMATCH_OR_INVALID' })
    return { email: invitation.email, organizationId: invitation.organizationId, role: invitation.role,
      expiresAt: invitation.expiresAt, accepted: invitation.acceptedAt !== null }
  })))
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
        if (!invitation) throw new HTTPException(403, { message: 'INVITATION_EMAIL_MISMATCH_OR_INVALID' })
        const organizationId = wire.organizationId.parse(invitation.organizationId)
        await selectOrganization(tx, organizationId)
        await lockOrganization(tx, organizationId)
        const [organization] = await tx.select().from(s.organizations).where(eq(s.organizations.id, organizationId))
        if (!organization || organization.status !== 'active') forbidden()
        const [fresh] = await tx.select().from(s.invitations).where(eq(s.invitations.id, invitation.id)).for('update')
        if (!fresh) forbidden()
        if (!fresh.acceptedAt && fresh.expiresAt <= new Date()) throw new HTTPException(410, { message: 'INVITATION_EXPIRED' })
        const existing = await tx.select().from(s.memberships).where(and(
          eq(s.memberships.organizationId, organizationId),
          eq(s.memberships.accountId, actor.id),
        ))
        if (existing[0]) {
          if (existing[0].status !== 'active') throw new HTTPException(409, { message: 'MEMBERSHIP_RESTORE_REQUIRED' })
          await tx.update(s.invitations).set({ acceptedAt: fresh.acceptedAt ?? new Date() }).where(eq(s.invitations.id, fresh.id))
          return { organizationId, membershipId: existing[0].id }
        }
        if (fresh.acceptedAt) throw new HTTPException(409, { message: 'INVITATION_ALREADY_ACCEPTED' })
        await checkSeat(tx, organizationId)
        const membershipId = randomUUID()
        await tx.insert(s.memberships).values({ id: membershipId, organizationId, accountId: actor.id })
        const [root] = await tx.select().from(s.units).where(and(eq(s.units.organizationId, organizationId), isNull(s.units.parentId)))
        if (!root) throw new Error('Organization root is missing')
        await tx.insert(s.assignments).values({ organizationId, membershipId, unitId: fresh.unitId ?? root.id })
        await tx
          .insert(s.roles)
          .values({ id: randomUUID(), organizationId, membershipId, role: fresh.role, unitId: null })
        await tx.insert(s.driveSpaces).values({ id: randomUUID(), organizationId, accountId: actor.id, kind: 'personal', name: 'Personal space' })
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
            expiresAt: s.runtimes.expiresAt,
            revokedAt: s.runtimes.revokedAt,
          })
          .from(s.runtimes)
          .where(eq(s.runtimes.organizationId, tenant.organizationId))
        const ownOnly = rows.filter(row => row.accountId === tenant.actor.id)
        try {
          await requirePermission(tx, tenant, 'member.manage')
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
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      const id = randomUUID()
      const token = randomBytes(32).toString('base64url')
      const expiresAt = new Date(Date.now() + config.loginSessionSeconds * 1000)
      await tx.insert(s.runtimes).values({
        id, organizationId: tenant.organizationId, accountId: tenant.actor.id,
        ...input, tokenHash: digest(token), expiresAt,
      })
      await recordAudit(tx, tenant, 'runtime.registered', id)
      return { id, accountId: tenant.actor.id, token, expiresAt }
    }), 201)
  })
  app.get('/v1/organizations/:organizationId/runtimes/:id/authorization', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      if (tenant.actor.runtimeId !== id) forbidden()
      const [runtime] = await tx.select().from(s.runtimes).where(and(
        eq(s.runtimes.id, id), eq(s.runtimes.organizationId, tenant.organizationId),
        eq(s.runtimes.accountId, tenant.actor.id), isNull(s.runtimes.revokedAt),
        gt(s.runtimes.expiresAt, new Date()),
      ))
      if (!runtime) forbidden()
      const [organization] = await tx.select().from(s.organizations).where(eq(s.organizations.id, tenant.organizationId))
      if (!organization) forbidden()
      return { expiresAt: runtime.expiresAt, policyRevision: organization.policyRevision }
    }))
  })
  app.delete('/v1/organizations/:organizationId/runtimes/:id', async (c) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    return c.json(
      await tenantOperation(c, async (tx, tenant) => {
        const [runtime] = await tx.select().from(s.runtimes).where(and(
          eq(s.runtimes.id, id), eq(s.runtimes.organizationId, tenant.organizationId),
        ))
        if (!runtime) forbidden()
        if (runtime.accountId !== tenant.actor.id) await requirePermission(tx, tenant, 'member.manage')
        await tx.update(s.runtimes).set({ revokedAt: new Date() }).where(and(
          eq(s.runtimes.id, id), eq(s.runtimes.organizationId, tenant.organizationId),
        ))
        await recordAudit(tx, tenant, 'runtime.revoked', id)
        return { id }
      }),
    )
  })
  app.get('/v1/organizations/:organizationId/audit-page', async c => c.json(await tenantOperation(c, async (tx, tenant) => {
    await requirePermission(tx, tenant, 'audit.read')
    const query = z.object({ cursor: z.string().max(512).optional(), action: z.string().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(c.req.query())
    const cursor = query.cursor ? decodeUsageCursor(query.cursor) : undefined
    const rows = await tx.select({ ...getTableColumns(s.audit), cursorMicros: sql<string>`(extract(epoch from ${s.audit.createdAt}) * 1000000)::bigint::text` })
      .from(s.audit).where(and(eq(s.audit.organizationId, tenant.organizationId),
        query.action ? eq(s.audit.action, query.action) : undefined,
        cursor ? sql`((extract(epoch from ${s.audit.createdAt}) * 1000000)::bigint, ${s.audit.id}) < (${cursor.occurredAtMicros}::bigint, ${cursor.id})` : undefined))
      .orderBy(desc(s.audit.createdAt), desc(s.audit.id)).limit(query.limit + 1)
    const page = rows.slice(0, query.limit), last = page.at(-1)
    return { items: page.map(({ cursorMicros: _, ...row }) => row),
      nextCursor: rows.length > query.limit && last ? encodeUsageCursor(last.cursorMicros, last.id) : null }
  })))
  app.get('/v1/organizations/:organizationId/audit', async c =>
    c.json(
      await tenantOperation(c, async (tx, tenant) => {
        await requirePermission(tx, tenant, 'audit.read')
        return tx
          .select()
          .from(s.audit)
          .orderBy(sql`${s.audit.createdAt} desc`)
          .limit(200)
      }),
    ),
  )
  app.get('/v1/organizations/:organizationId/usage', async (c) => {
    const query = tenantUsageQuery.parse({
      scope: c.req.query('scope'),
      accountId: c.req.query('accountId'),
      from: c.req.query('from'),
      to: c.req.query('to'),
      cursor: c.req.query('cursor'),
      limit: c.req.query('limit'),
    })
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      if (query.scope === 'organization' || (query.accountId !== undefined && query.accountId !== tenant.actor.id)) {
        await requirePermission(tx, tenant, 'billing.read')
      }
      const range = query.from === undefined || query.to === undefined
        ? currentReportingMonth(new Date(), config.reportingTimeZone)
        : { from: new Date(query.from), to: new Date(query.to) }
      const cursor = query.cursor === undefined ? undefined : decodeUsageCursor(query.cursor)
      const occurredAtSql = sql`coalesce(${s.modelUsage.requestStartedAt}, ${s.modelUsage.createdAt})`
      const occurredAt = sql<Date>`${occurredAtSql}`.mapWith(s.modelUsage.createdAt)
      const cursorOccurredAtMicros = sql<string>`(extract(epoch from ${occurredAtSql}) * 1000000)::bigint::text`
      const selectedAccount = query.accountId ?? (query.scope === 'own' ? tenant.actor.id : undefined)
      const before = cursor === undefined ? undefined : sql`(
        (extract(epoch from ${occurredAtSql}) * 1000000)::bigint < ${cursor.occurredAtMicros}::bigint
        OR ((extract(epoch from ${occurredAtSql}) * 1000000)::bigint = ${cursor.occurredAtMicros}::bigint AND ${s.modelUsage.id} < ${cursor.id})
      )`
      const items = await tx.select({
        id: s.modelUsage.id,
        accountId: s.modelUsage.accountId,
        runtimeId: s.modelUsage.runtimeId,
        modelId: s.modelUsage.modelId,
        purpose: s.modelUsage.purpose,
        status: s.modelUsage.status,
        protocol: s.modelUsage.protocol,
        inputModalities: s.modelUsage.inputModalities,
        inputTokens: s.modelUsage.inputTokens,
        cachedInputTokens: s.modelUsage.cachedInputTokens,
        outputTokens: s.modelUsage.outputTokens,
        reasoningTokens: s.modelUsage.reasoningTokens,
        totalTokens: s.modelUsage.totalTokens,
        totalCostMicrosCny: s.modelUsage.totalCostMicrosCny,
        currency: s.modelUsage.currency,
        fileUploadCount: s.modelUsage.fileUploadCount,
        uploadedBytes: s.modelUsage.uploadedBytes,
        fileUploadFailures: s.modelUsage.fileUploadFailures,
        reconciliationReason: s.modelUsage.reconciliationReason,
        failureReason: s.modelUsage.failureReason,
        occurredAt,
        cursorOccurredAtMicros,
      }).from(s.modelUsage).where(and(
        selectedAccount === undefined ? undefined : eq(s.modelUsage.accountId, selectedAccount),
        sql`${occurredAtSql} >= ${range.from.toISOString()}::timestamptz`,
        sql`${occurredAtSql} < ${range.to.toISOString()}::timestamptz`,
        before,
      )).orderBy(desc(occurredAt), desc(s.modelUsage.id)).limit(query.limit + 1)
      const hasMore = items.length > query.limit
      const selected = hasMore ? items.slice(0, query.limit) : items
      const page = selected.map(({ cursorOccurredAtMicros: _, ...item }) => item)
      const last = page.at(-1)
      const lastCursor = selected.at(-1)
      return {
        items: page,
        nextCursor: hasMore && last && lastCursor ? encodeUsageCursor(lastCursor.cursorOccurredAtMicros, last.id) : null,
        range: { from: range.from.toISOString(), to: range.to.toISOString(), timeZone: config.reportingTimeZone },
      }
    }))
  })

  app.get('/v1/organizations/:organizationId/members/usage-summary', async (c) => {
    const query = tenantUsageRangeQuery.parse({
      from: c.req.query('from'),
      to: c.req.query('to'),
    })
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'member.manage')
      const canReadBilling = (await effectivePermissions(tx, tenant)).includes('billing.read')
      const range = query.from === undefined || query.to === undefined
        ? currentReportingMonth(new Date(), config.reportingTimeZone)
        : { from: new Date(query.from), to: new Date(query.to) }
      const occurredAtSql = sql`coalesce(${s.modelUsage.requestStartedAt}, ${s.modelUsage.createdAt})`
      const members = await tx.select({
        membershipId: s.memberships.id,
        accountId: s.memberships.accountId,
        name: s.user.name,
        email: s.user.email,
        status: s.memberships.status,
      }).from(s.memberships).innerJoin(s.user, eq(s.user.id, s.memberships.accountId))
        .where(eq(s.memberships.organizationId, tenant.organizationId))
        .orderBy(asc(s.user.email))
      const roleRows = await tx.select({ membershipId: s.roles.membershipId, role: s.roles.role }).from(s.roles)
        .where(eq(s.roles.organizationId, tenant.organizationId))
      const totals = canReadBilling ? await tx.select({
        accountId: s.modelUsage.accountId,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${s.modelUsage.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${s.modelUsage.outputTokens}), 0)::int`,
        totalTokens: sql<number>`coalesce(sum(${s.modelUsage.totalTokens}), 0)::int`,
        settledCostMicrosCny: sql<number>`coalesce(sum(${s.modelUsage.totalCostMicrosCny}) filter (where ${s.modelUsage.status} = 'settled' and ${s.modelUsage.currency} = 'CNY'), 0)::bigint`.mapWith(Number),
        lastActivityAt: sql<Date | null>`max(${occurredAtSql})`.mapWith(s.modelUsage.createdAt),
      }).from(s.modelUsage).where(and(
        eq(s.modelUsage.organizationId, tenant.organizationId),
        sql`${occurredAtSql} >= ${range.from.toISOString()}::timestamptz`,
        sql`${occurredAtSql} < ${range.to.toISOString()}::timestamptz`,
      ))
        .groupBy(s.modelUsage.accountId) : []
      const totalsByAccount = new Map(totals.map(item => [item.accountId, item]))
      const rolesByMembership = new Map<string, string[]>()
      for (const row of roleRows) {
        const values = rolesByMembership.get(row.membershipId) ?? []
        values.push(row.role)
        rolesByMembership.set(row.membershipId, values)
      }
      return {
        items: members.map((member) => {
          const usage = totalsByAccount.get(member.accountId)
          return {
            ...member,
            roles: rolesByMembership.get(member.membershipId) ?? [],
            calls: usage?.calls ?? 0,
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            totalTokens: usage?.totalTokens ?? 0,
            settledCostMicrosCny: canReadBilling ? usage?.settledCostMicrosCny ?? 0 : null,
            lastActivityAt: usage?.lastActivityAt ?? null,
          }
        }),
        range: { from: range.from.toISOString(), to: range.to.toISOString(), timeZone: config.reportingTimeZone },
      }
    }))
  })
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
        const [deployment] = await tx.select().from(s.deployment).where(eq(s.deployment.id, 'primary'))
        if (deployment?.mode === 'private' && ['open', 'domain_restricted'].includes(input.registration)) forbidden()
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
        depth: s.organizations.depth,
        path: s.organizations.path,
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
      const allOrganizations = await tx.select({
        id: s.organizations.id,
        name: s.organizations.name,
        depth: s.organizations.depth,
        path: s.organizations.path,
      }).from(s.organizations)
      const organizationById = new Map(allOrganizations.map(organization => [organization.id, organization]))
      const organizationDisplayPath = (path: string): string => path.split('/').filter(Boolean)
        .map(id => organizationById.get(id)?.name ?? id).join(' / ')
      const units = await tx.select().from(s.units)
      const unitById = new Map(units.map(unit => [unit.id, unit]))
      const unitMemberCounts = await tx.select({
        unitId: s.assignments.unitId,
        count: sql<number>`count(*)::int`,
      }).from(s.assignments)
        .innerJoin(s.memberships, and(
          eq(s.memberships.id, s.assignments.membershipId),
          eq(s.memberships.status, 'active'),
        ))
        .groupBy(s.assignments.unitId)
      const unitMemberCountById = new Map(unitMemberCounts.map(item => [item.unitId, item.count]))
      const organizationNodes = await Promise.all(organizations.map(async (organization) => {
        const [children] = await tx.select({ count: sql<number>`count(*)::int` })
          .from(s.organizations).where(eq(s.organizations.parentId, organization.id))
        const [members] = await tx.select({ count: sql<number>`count(*)::int` })
          .from(s.memberships).where(eq(s.memberships.organizationId, organization.id))
        return {
          ...organization,
          childCount: children?.count ?? 0,
          memberCount: members?.count ?? 0,
          hasChildren: (children?.count ?? 0) > 0 || units.some(unit => unit.organizationId === organization.id && unit.unitType !== 'root' && (!unit.parentId || unitById.get(unit.parentId)?.unitType === 'root')),
          nodeType: 'organization' as const,
          displayPath: organizationDisplayPath(organization.path),
        }
      }))
      const unitPosition = (unit: typeof units[number]): { depth: number; ids: string[]; names: string[] } => {
        const names = [unit.name]
        const ids = [unit.id]
        let depth = 1
        let parentId = unit.parentId
        while (parentId) {
          const parent = unitById.get(parentId)
          if (!parent) break
          if (parent.unitType !== 'root') {
            names.unshift(parent.name)
            ids.unshift(parent.id)
            depth += 1
          }
          parentId = parent.parentId
        }
        return { depth, ids, names }
      }
      const visibleUnits = units.filter(unit => unit.unitType !== 'root')
      const unitParentId = (unit: typeof units[number]): string => {
        const parent = unit.parentId ? unitById.get(unit.parentId) : undefined
        return parent && parent.unitType !== 'root' ? parent.id : unit.organizationId
      }
      const unitNodes = visibleUnits.filter((unit) => {
        if (all || parentId === undefined) return true
        if (parentId === 'null') return false
        return unitParentId(unit) === parentId
      }).map(unit => ({
        id: unit.id,
        parentId: unitParentId(unit),
        rootId: unit.organizationId,
        name: unit.name,
        kind: unit.unitType === 'team' ? 'team' : 'department',
        status: 'active',
        createdAt: new Date(0),
        childCount: units.filter(child => child.parentId === unit.id).length,
        memberCount: unitMemberCountById.get(unit.id) ?? 0,
        hasChildren: visibleUnits.some(child => unitParentId(child) === unit.id),
        nodeType: 'unit' as const,
        depth: (organizationById.get(unit.organizationId)?.depth ?? 0) + unitPosition(unit).depth,
        path: `${organizationById.get(unit.organizationId)?.path ?? ''}/${unitPosition(unit).ids.join('/')}`,
        displayPath: [organizationDisplayPath(organizationById.get(unit.organizationId)?.path ?? ''), unitPosition(unit).names.join(' / ')].filter(Boolean).join(' / '),
      }))
      return [...organizationNodes, ...unitNodes]
    })),
  )
  app.get('/v1/platform/organizations/overview', async c =>
    c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const [organizationCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(s.organizations)
      const [memberCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(s.memberships).where(eq(s.memberships.status, 'active'))
      const [administratorCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(s.roles).where(sql`${s.roles.role} in ('owner', 'administrator')`)
      const [runtimeCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(s.runtimes).where(and(isNull(s.runtimes.revokedAt), gt(s.runtimes.expiresAt, new Date())))
      const usageFrom = new Date(Date.now() - 30 * 86_400_000)
      const [monthlyUsage] = await tx.select({
        totalCostMicrosCny: sql<number>`coalesce(sum(${s.modelUsage.totalCostMicrosCny}) filter (where ${s.modelUsage.status} = 'settled' and ${s.modelUsage.currency} = 'CNY'), 0)::bigint`.mapWith(Number),
      }).from(s.modelUsage).where(gte(s.modelUsage.settledAt, usageFrom))
      return { organizationCount: organizationCount?.count ?? 0, memberCount: memberCount?.count ?? 0,
        administratorCount: administratorCount?.count ?? 0, runtimeCount: runtimeCount?.count ?? 0,
        monthlyCostMicrosCny: monthlyUsage?.totalCostMicrosCny ?? 0 }
    })),
  )
  app.post('/v1/platform/organizations', async (c) => {
    const input = z.object({
      name: z.string().trim().min(1).max(120),
      kind: z.string().trim().min(1).max(40).default('team'),
      parentId: wire.organizationId.nullable().default(null),
      ownerAccountId: wire.accountId, resourcePolicy: wire.teamResourcePolicy,
    }).strict().parse(await c.req.json())
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      const [deployment] = await tx.select().from(s.deployment).where(eq(s.deployment.id, 'primary'))
      if (deployment?.mode === 'private') throw new HTTPException(409, { message: 'PRIVATE_COMPANY_USES_DEPARTMENTS' })
      if (input.parentId !== null) throw new HTTPException(409, { message: 'TEAMS_USE_DEPARTMENTS' })
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const id = wire.organizationId.parse(randomUUID())
      const rootId = id, depth = 0, path = `/${id}`
      await selectOrganization(tx, id)
      await tx.insert(s.organizations).values({ id, parentId: input.parentId, rootId, depth, path, name: input.name, kind: 'team', resourcePolicy: input.resourcePolicy })
      const unitId = rootId
      await tx.insert(s.units).values({ id: unitId, organizationId: id, unitType: 'root', name: input.name })
      await tx.insert(s.subscriptions).values({ organizationId: id })
      await tx.insert(s.organizationWallets).values({ organizationId: id })
      const membershipId = randomUUID()
      await tx.insert(s.memberships).values({ id: membershipId, organizationId: id, accountId: input.ownerAccountId })
      await tx.insert(s.roles).values({ id: randomUUID(), organizationId: id, membershipId, role: 'owner' })
      await tx.insert(s.assignments).values({ organizationId: id, membershipId, unitId })
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
        updatedAt: s.user.updatedAt,
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
  app.post('/v1/platform/accounts', async c => c.json(await db.transaction(async (tx) => {
    const actor = c.get('actor')
    await requirePlatform(tx, actor)
    await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
    const input = z.object({ email: z.email().max(320), name: z.string().trim().min(1).max(120), password: z.string().min(12).max(200), emailVerified: z.boolean().default(true), organizationNodeId: z.string().min(1), role: z.enum(['member', 'administrator']).default('member') }).strict().parse(await c.req.json())
    const email = input.email.toLowerCase()
    const [existing] = await tx.select({ id: s.user.id }).from(s.user).where(eq(s.user.email, email))
    if (existing) throw new HTTPException(409, { message: 'Account email already exists' })
    const id = randomUUID()
    await tx.insert(s.user).values({ id, email, name: input.name, emailVerified: input.emailVerified })
    await tx.insert(s.account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(input.password) })
    const [unit] = await tx.select().from(s.units).where(eq(s.units.id, input.organizationNodeId))
    const organizationId = unit?.organizationId ?? input.organizationNodeId
    const [organization] = await tx.select({ id: s.organizations.id, name: s.organizations.name,
      path: s.organizations.path }).from(s.organizations).where(eq(s.organizations.id, organizationId))
    if (!organization) throw new HTTPException(404, { message: 'Organization not found' })
    const teamId = wire.organizationId.parse(organizationId)
    await selectOrganization(tx, teamId)
    const membershipId = randomUUID()
    await tx.insert(s.memberships).values({ id: membershipId, organizationId, accountId: id, status: 'suspended' })
    await setMemberStatus(tx, teamId, membershipId, 'active', new Date(services.now?.() ?? Date.now()))
    await tx.insert(s.roles).values({ id: randomUUID(), organizationId, membershipId, unitId: null, role: input.role })
    if (unit) {
      await tx.insert(s.assignments).values({ organizationId, membershipId, unitId: unit.id })
    }
    await recordAudit(tx, { actor, organizationId: teamId, membershipId: '' }, 'account.provisioned', id, { role: input.role })
    return { id, email, name: input.name, emailVerified: input.emailVerified, organizationNodeId: input.organizationNodeId }
  }), 201))
  app.patch('/v1/platform/accounts/:accountId', async c => c.json(await db.transaction(async (tx) => {
    const actor = c.get('actor')
    await requirePlatform(tx, actor)
    const id = wire.accountId.parse(c.req.param('accountId'))
    const input = wire.accountRecovery.extend({ name: z.string().trim().min(1).max(120).optional(), email: z.email().max(320).optional(),
      emailVerified: z.boolean().optional() }).strict().parse(await c.req.json())
    const [current] = await tx.select().from(s.user).where(eq(s.user.id, id)).for('update')
    if (!current) throw new HTTPException(404, { message: 'Account not found' })
    if (current.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new HTTPException(409, { message: 'VERSION_CONFLICT' })
    await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
    const changedIdentity = input.email !== undefined && input.email.toLowerCase() !== current.email
    const changes = { ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.email === undefined ? {} : { email: input.email.toLowerCase() }),
      ...(input.emailVerified === undefined ? (changedIdentity ? { emailVerified: false } : {}) : { emailVerified: input.emailVerified }),
      updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)) }
    const [updated] = await tx.update(s.user).set(changes).where(eq(s.user.id, id)).returning({ id: s.user.id, name: s.user.name,
      email: s.user.email, emailVerified: s.user.emailVerified, updatedAt: s.user.updatedAt })
    if (changedIdentity || input.emailVerified !== undefined) {
      await tx.delete(s.session).where(eq(s.session.userId, id))
      await tx.delete(s.desktopCodes).where(eq(s.desktopCodes.accountId, id))
      await tx.execute(sql`select set_config('enterprise.account_recovery_id', ${id}, true)`)
      await tx.update(s.runtimes).set({ revokedAt: changes.updatedAt }).where(eq(s.runtimes.accountId, id))
    }
    const [deployment] = await tx.select().from(s.deployment).where(eq(s.deployment.id, 'primary'))
    if (!deployment) forbidden()
    await selectOrganization(tx, wire.organizationId.parse(deployment.rootOrganizationId))
    await recordAudit(tx, { actor, organizationId: wire.organizationId.parse(deployment.rootOrganizationId), membershipId: '' },
      'account.identity_recovered', id, { reason: input.reason, fields: Object.keys(changes).filter(key => key !== 'updatedAt') })
    return updated
  })))
  app.post('/v1/platform/accounts/:accountId/password', async c => c.json(await db.transaction(async (tx) => {
    const actor = c.get('actor')
    await requirePlatform(tx, actor)
    const id = wire.accountId.parse(c.req.param('accountId'))
    const input = wire.accountRecovery.extend({ password: z.string().min(12).max(200) }).strict().parse(await c.req.json())
    const [user] = await tx.select().from(s.user).where(eq(s.user.id, id)).for('update')
    if (!user) throw new HTTPException(404, { message: 'Account not found' })
    if (user.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new HTTPException(409, { message: 'VERSION_CONFLICT' })
    await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
    const [account] = await tx.select({ id: s.account.id }).from(s.account).where(and(eq(s.account.userId, id), eq(s.account.providerId, 'credential')))
    if (!account) throw new HTTPException(404, { message: 'Credential account not found' })
    await tx.update(s.account).set({ password: await hashPassword(input.password), updatedAt: new Date() }).where(eq(s.account.id,
      account.id))
    await tx.delete(s.session).where(eq(s.session.userId, id))
    await tx.delete(s.desktopCodes).where(eq(s.desktopCodes.accountId, id))
    await tx.execute(sql`select set_config('enterprise.account_recovery_id', ${id}, true)`)
    const updatedAt = new Date(Math.max(Date.now(), user.updatedAt.getTime() + 1))
    await tx.update(s.user).set({ updatedAt }).where(eq(s.user.id, id))
    await tx.update(s.runtimes).set({ revokedAt: updatedAt }).where(eq(s.runtimes.accountId, id))
    const [deployment] = await tx.select().from(s.deployment).where(eq(s.deployment.id, 'primary'))
    if (!deployment) forbidden()
    await selectOrganization(tx, wire.organizationId.parse(deployment.rootOrganizationId))
    await recordAudit(tx, { actor, organizationId: wire.organizationId.parse(deployment.rootOrganizationId), membershipId: '' },
      'account.password_recovered', id, { reason: input.reason })
    return { id }
  })))
  app.get('/v1/platform/accounts/:accountId/organizations', async (c) => {
    const accountId = wire.accountId.parse(c.req.param('accountId'))
    return c.json(await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const [account] = await tx.select({ id: s.user.id, name: s.user.name, email: s.user.email,
        emailVerified: s.user.emailVerified, updatedAt: s.user.updatedAt })
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
        expiresAt: s.runtimes.expiresAt,
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
        id: s.modelUsage.id,
        organizationId: s.modelUsage.organizationId,
        modelId: s.modelUsage.modelId,
        purpose: s.modelUsage.purpose,
        status: s.modelUsage.status,
        reservedMicros: s.modelUsage.reservedMicros,
        actualMicros: s.modelUsage.actualMicros,
        billedMicros: s.modelUsage.billedMicros,
        totalCostMicrosCny: s.modelUsage.totalCostMicrosCny,
        currency: s.modelUsage.currency,
        inputTokens: s.modelUsage.inputTokens,
        outputTokens: s.modelUsage.outputTokens,
        createdAt: s.modelUsage.createdAt,
        settledAt: s.modelUsage.settledAt,
      }).from(s.modelUsage).where(eq(s.modelUsage.accountId, accountId))
        .orderBy(desc(s.modelUsage.createdAt)).limit(200)
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
  app.get('/v1/platform/organization-nodes/:nodeId/members', async (c) => {
    const nodeId = wire.resourceId.parse(c.req.param('nodeId'))
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      const [organization] = await tx.select().from(s.organizations).where(eq(s.organizations.id, nodeId))
      const [unit] = await tx.select().from(s.units).where(eq(s.units.id, nodeId))
      const organizationId = organization?.id ?? unit?.organizationId
      if (organizationId === undefined) throw new HTTPException(404, { message: 'Organization node not found' })
      const [rootOrganization] = await tx.select().from(s.organizations).where(eq(s.organizations.id, organizationId))
      if (!rootOrganization) throw new HTTPException(404, { message: 'Organization not found' })
      const members = unit
        ? await tx.select({
          id: s.memberships.id,
          accountId: s.memberships.accountId,
          status: s.memberships.status,
          createdAt: s.memberships.createdAt,
          email: s.user.email,
          name: s.user.name,
        }).from(s.memberships)
          .innerJoin(s.user, eq(s.user.id, s.memberships.accountId))
          .innerJoin(s.assignments, and(
            eq(s.assignments.organizationId, organizationId),
            eq(s.assignments.membershipId, s.memberships.id),
            eq(s.assignments.unitId, unit.id),
          ))
          .where(eq(s.memberships.organizationId, organizationId))
        : await tx.select({
          id: s.memberships.id,
          accountId: s.memberships.accountId,
          status: s.memberships.status,
          createdAt: s.memberships.createdAt,
          email: s.user.email,
          name: s.user.name,
        }).from(s.memberships)
          .innerJoin(s.user, eq(s.user.id, s.memberships.accountId))
          .where(eq(s.memberships.organizationId, organizationId))
      const bindings = await tx.select().from(s.roles).where(eq(s.roles.organizationId, organizationId))
      const assignments = await tx.select().from(s.assignments).where(eq(s.assignments.organizationId, organizationId))
      const [runtimes] = await tx.select({ count: sql<number>`count(*)::int` }).from(s.runtimes).where(and(
        eq(s.runtimes.organizationId, organizationId),
        isNull(s.runtimes.revokedAt), gt(s.runtimes.expiresAt, new Date()),
      ))
      return {
        node: unit
          ? { id: unit.id, nodeType: 'unit' as const, organizationId, name: unit.name, kind: unit.unitType }
          : { id: rootOrganization.id, nodeType: 'organization' as const, organizationId, name: rootOrganization.name, kind: rootOrganization.kind },
        organization: rootOrganization,
        members,
        roles: bindings,
        assignments,
        runtimeCount: runtimes?.count ?? 0,
      }
    }))
  })
  app.post('/v1/platform/organizations/:organizationId/members', async (c) => {
    const organizationId = wire.organizationId.parse(c.req.param('organizationId'))
    const input = z.object({
      accountId: wire.accountId,
      role: wire.role.default('member'),
      unitId: wire.resourceId.nullable().optional(),
      reason: wire.governanceRequest.shape.reason, expectedVersion: wire.governanceRequest.shape.expectedVersion,
    }).strict().parse(await c.req.json())
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      await selectOrganization(tx, organizationId)
      await bumpPlatformPolicy(tx, organizationId, input.expectedVersion)
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
      if (input.unitId) {
        const [unit] = await tx.select().from(s.units).where(and(eq(s.units.id, input.unitId), eq(s.units.organizationId, organizationId)))
        if (!unit) forbidden()
      }
      await checkSeat(tx, organizationId)
      const membershipId = randomUUID()
      await tx.insert(s.memberships).values({ id: membershipId, organizationId, accountId: input.accountId, status: 'active' })
      const [binding] = await tx.insert(s.roles).values({
        id: randomUUID(), organizationId, membershipId, role: input.role, unitId: input.unitId ?? null,
      }).returning()
      const [root] = await tx.select().from(s.units).where(and(eq(s.units.organizationId, organizationId), isNull(s.units.parentId)))
      if (!root) throw new Error('Organization root is missing')
      await tx.insert(s.assignments).values({ organizationId, membershipId, unitId: input.unitId ?? root.id })
      await recordAudit(tx, { actor, organizationId, membershipId: '' }, 'membership.added', membershipId, input)
      return { membershipId, role: binding }
    }), 201)
  })
  app.patch('/v1/platform/organizations/:organizationId/members/:memberId', async (c) => {
    const organizationId = wire.organizationId.parse(c.req.param('organizationId'))
    const memberId = wire.resourceId.parse(c.req.param('memberId'))
    const input = z.object({ status: z.enum(['active', 'suspended']), reason: wire.governanceRequest.shape.reason, expectedVersion: wire.governanceRequest.shape.expectedVersion }).strict().parse(await c.req.json())
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await selectOrganization(tx, organizationId)
      const [member] = await tx.select().from(s.memberships).where(and(
        eq(s.memberships.id, memberId), eq(s.memberships.organizationId, organizationId),
      ))
      if (!member) forbidden()
      await bumpPlatformPolicy(tx, organizationId, input.expectedVersion)
      const updated = await setMemberStatus(tx, organizationId, memberId, input.status, new Date(services.now?.() ?? Date.now()))
      await recordAudit(tx, { actor, organizationId, membershipId: '' }, 'membership.status_updated', memberId, input)
      return updated
    }))
  })
  app.delete('/v1/platform/organizations/:organizationId/members/:memberId', async (c) => {
    const organizationId = wire.organizationId.parse(c.req.param('organizationId'))
    const memberId = wire.resourceId.parse(c.req.param('memberId'))
    const input = wire.governanceRequest.omit({ change: true }).parse(await c.req.json())
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await selectOrganization(tx, organizationId)
      const [member] = await tx.select().from(s.memberships).where(and(
        eq(s.memberships.id, memberId), eq(s.memberships.organizationId, organizationId),
      ))
      if (!member) forbidden()
      await bumpPlatformPolicy(tx, organizationId, input.expectedVersion)
      const updated = await setMemberStatus(tx, organizationId, memberId, 'removed', new Date(services.now?.() ?? Date.now()))
      await recordAudit(tx, { actor, organizationId, membershipId: '' }, 'membership.removed', memberId, input)
      return updated
    }))
  })
  app.post('/v1/platform/organizations/:organizationId/members/:memberId/roles', async (c) => {
    const organizationId = wire.organizationId.parse(c.req.param('organizationId'))
    const memberId = wire.resourceId.parse(c.req.param('memberId'))
    const input = z.object({ role: wire.role, unitId: wire.resourceId.nullable(),
      reason: wire.governanceRequest.shape.reason,
      expectedVersion: wire.governanceRequest.shape.expectedVersion }).strict().parse(await c.req.json())
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      await selectOrganization(tx, organizationId)
      await bumpPlatformPolicy(tx, organizationId, input.expectedVersion)
      const [member] = await tx.select().from(s.memberships).where(and(
        eq(s.memberships.id, memberId), eq(s.memberships.organizationId, organizationId),
      ))
      if (!member) forbidden()
      await requireRoleTarget(tx, organizationId, memberId, input.unitId)
      if (input.role === 'owner' && input.unitId !== null) throw new HTTPException(400, { message: 'Owner must be organization-scoped' })
      const [existing] = await tx.select().from(s.roles).where(and(
        eq(s.roles.membershipId, memberId),
        eq(s.roles.organizationId, organizationId),
        eq(s.roles.role, input.role),
        input.unitId === null ? isNull(s.roles.unitId) : eq(s.roles.unitId, input.unitId),
      ))
      if (existing) throw new HTTPException(409, { message: 'Role is already granted' })
      const [binding] = await tx.insert(s.roles).values({ id: randomUUID(), organizationId, membershipId: memberId,
        role: input.role, unitId: input.unitId }).returning()
      if (!binding) throw new Error('Role insert returned no row')
      await recordAudit(tx, { actor, organizationId, membershipId: memberId }, 'role.granted', binding.id, input)
      return binding
    }), 201)
  })
  app.post('/v1/platform/organizations/:organizationId/members/:memberId/transfer', async (c) => {
    await db.transaction(tx => requirePlatform(tx, c.get('actor')))
    throw new HTTPException(409, { message: 'USE_TEAM_INVITATION_AND_EXPLICIT_OFFBOARDING' })
  })
  app.patch('/v1/platform/organizations/:organizationId', async (c) => {
    const id = wire.organizationId.parse(c.req.param('organizationId'))
    const input = z.object({ status: z.enum(['active', 'suspended']).optional(),
      name: z.string().trim().min(1).max(120).optional(), parentId: z.null().optional(),
      reason: z.string().trim().min(1).max(1000), expectedVersion: z.number().int().positive(),
    }).strict().parse(await c.req.json())
    return c.json(await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await selectOrganization(tx, id)
      await lockOrganization(tx, id)
      const [current] = await tx.select().from(s.organizations).where(eq(s.organizations.id, id))
      if (!current) forbidden()
      if (input.expectedVersion !== current.policyRevision) throw new HTTPException(409, { message: 'POLICY_VERSION_CONFLICT' })
      const [updated] = await tx.update(s.organizations).set({ status: input.status, name: input.name,
        policyRevision: current.policyRevision + 1 }).where(eq(s.organizations.id, id)).returning()
      if (input.status === 'suspended') await tx.update(s.modelTasks).set({ cancelRequestedAt: new Date(services.now?.() ?? Date.now()) })
        .where(and(eq(s.modelTasks.organizationId, id), sql`${s.modelTasks.status} IN ('queued','submitting','processing','unknown')`))
      await recordAudit(tx, { actor, organizationId: id, membershipId: '' }, 'organization.updated', id, input)
      return updated
    }))
  })
  app.put('/v1/platform/organizations/:organizationId/subscription', async (c) => {
    const id = wire.organizationId.parse(c.req.param('organizationId'))
    const input = z
      .object({
        plan: z.string().min(1).max(60),
        planVersion: z.number().int().positive().optional(),
        seats: z.number().int().positive().max(100000),
        reason: wire.governanceRequest.shape.reason, expectedVersion: wire.governanceRequest.shape.expectedVersion,
      })
      .strict()
      .parse(await c.req.json())
    return c.json(
      await db.transaction(async (tx) => {
        const actor = c.get('actor')
        await requirePlatform(tx, actor)
        await selectOrganization(tx, id)
        await bumpPlatformPolicy(tx, id, input.expectedVersion)
        await applySubscriptionPlan(tx, id, input)
        const rows = await tx.select().from(s.subscriptions).where(eq(s.subscriptions.organizationId, id))
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
      evidence: z.string().trim().min(1).max(2000),
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
        await recordAudit(tx, { actor, organizationId, membershipId: '' }, 'usage.reconciled', id, { outcome: 'failed', evidence: input.evidence })
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
        await debitWalletForUsage(tx, {
          organizationId,
          usageId: id,
          accountId: wire.accountId.parse(entry.accountId),
          ...(entry.runtimeId === null ? {} : { runtimeId: entry.runtimeId }),
          amountMicrosCny: costs.totalCostMicrosCny,
        })
        await recordAudit(tx, { actor, organizationId, membershipId: '' }, 'usage.reconciled', id, {
          outcome: 'settled', evidence: input.evidence, currency: 'CNY', totalCostMicrosCny: costs.totalCostMicrosCny,
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
        outcome: 'settled', evidence: input.evidence, billedMicros: input.billedMicros,
      })
      return { id, status: 'settled' as const, billedMicros: input.billedMicros }
    }))
  })
  mountModels(app, services, tenantOperation)
  mountSubscriptionPlans(app, services)
  mountTeamGovernance(app, services, tenantOperation)
  mountModelProviders(app, services)
  const modelTaskMaintenance = mountModelTasks(app, services, tenantOperation)
  mountSessions(app, services, tenantOperation)
  mountDesktopAuthorization(app, services)
  mountDesktopReleases(app, services)
  mountPlugins(app, services, tenantOperation, internalRelay, modelTaskMaintenance)
  mountUsageAnalytics(app, services)
  mountWallet(app, services, tenantOperation)
  mountDrive(app, services, tenantOperation)
  mountAdminGovernance(app, services, tenantOperation)
  const gatewayMaintenance = mountGateway(app, services, internalRelay)
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json(
        { error: 'INVALID_INPUT', issues: error.issues.map(i => ({ path: i.path, message: i.message })) },
        400,
      )
    if (error instanceof HTTPException) return c.json({ error: error.message, details: error.cause ?? {} }, error.status)
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
  return { app, auth, gatewayMaintenance, modelTaskMaintenance }
}

async function bumpPlatformPolicy(tx: Transaction, teamId: wire.OrganizationId, expectedVersion: number): Promise<void> {
  await lockOrganization(tx, teamId)
  const [team] = await tx.select().from(s.organizations).where(eq(s.organizations.id, teamId))
  if (!team || team.policyRevision !== expectedVersion) throw new HTTPException(409, { message: 'POLICY_VERSION_CONFLICT' })
  await tx.update(s.organizations).set({ policyRevision: expectedVersion + 1 }).where(eq(s.organizations.id, teamId))
}

async function requireRoleTarget(tx: Transaction, teamId: wire.OrganizationId, membershipId: string, unitId: string | null): Promise<void> {
  const [member] = await tx.select().from(s.memberships).where(and(eq(s.memberships.id, membershipId),
    eq(s.memberships.organizationId, teamId)))
  if (!member) forbidden()
  if (unitId !== null) {
    const [unit] = await tx.select().from(s.units).where(and(eq(s.units.id, unitId), eq(s.units.organizationId, teamId)))
    if (!unit) forbidden()
  }
}

async function checkSeat(tx: Transaction, organizationId: wire.OrganizationId): Promise<void> {
  const [plan] = await tx.select().from(s.subscriptions).where(eq(s.subscriptions.organizationId, organizationId)).for('update')
  const active = await tx.select().from(s.memberships).where(and(
    eq(s.memberships.organizationId, organizationId), eq(s.memberships.status, 'active'),
  ))
  if (!plan || active.length >= plan.seats) throw new HTTPException(409, { message: 'Seat limit reached' })
}
