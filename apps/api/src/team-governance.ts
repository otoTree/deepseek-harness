import { applySubscriptionPlan } from './subscription-plans.ts'
import { z } from 'zod'
/** Team resource policies, monthly admission facts, and shared platform/desktop management. */
import { randomUUID } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import type { Hono } from 'hono'
import type { ApiEnv, Services, TenantOperation } from './application.ts'
import type { Transaction } from './database.ts'
import { selectOrganization } from './database.ts'
import { accountId, governanceRequest, organizationId, teamResourcePolicy, platformTeamPage } from './contracts.ts'
import type { OrganizationId } from './contracts.ts'
import * as s from './schema.ts'
import { effectivePermissions, enterTenant, forbidden, hasRole, lockOrganization, protectFinalOwner,
  recordAudit, requirePermission, requirePlatform, type Tenant } from './security.ts'
import { assertWalletFunded, lockOrganizationWallet, writeWalletBalance } from './wallet.ts'
import { driveCapacity } from './drive-capacity.ts'

/**
 * Return the calendar month used for admission and later cost attribution.
 * @param now Admission timestamp.
 * @param timeZone Team reporting time zone.
 * @returns ISO year-month in the selected time zone.
 */
export function budgetMonth(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(now)
  const year = parts.find(part => part.type === 'year'), month = parts.find(part => part.type === 'month')
  if (!year || !month) throw new Error('Calendar month is unavailable')
  return `${year.value}-${month.value}`
}

/**
 * Check a model's published audience without exposing provider configuration.
 * @param model Model audience selected from the database.
 * @param teamId Current team.
 * @returns Whether the team is in the published audience.
 */
export function modelPublishedTo(model: Pick<typeof s.models.$inferSelect, 'audience'>, teamId: string): boolean {
  return model.audience.mode === 'all' || model.audience.organizationIds.includes(teamId)
}

function resolvedPolicy(team: typeof s.organizations.$inferSelect, now: Date) {
  if (!team.resourcePolicy) return null
  return { ...team.resourcePolicy, timeZone: team.nextBudgetTimeZone && team.nextBudgetTimeZoneAt
    && team.nextBudgetTimeZoneAt <= now ? team.nextBudgetTimeZone : team.resourcePolicy.timeZone }
}

function nextBudgetMonth(now: Date, timeZone: string): Date {
  const date = budgetMonth(now, timeZone)
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7))
  const wanted = Date.UTC(year, month, 1)
  let candidate = wanted
  const formatter = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = formatter.formatToParts(new Date(candidate))
    const value = (key: Intl.DateTimeFormatPartTypes) => {
      const part = parts.find(part => part.type === key)
      if (!part) throw new Error('Calendar part is unavailable: ' + key)
      return Number(part.value)
    }
    candidate += wanted - Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'))
  }
  return new Date(candidate)
}

async function memberSpending(tx: Transaction, teamId: string, actorId: string, month: string): Promise<number> {
  const rows = await tx.execute(sql`
    SELECT COALESCE(SUM(cost), 0) AS spent FROM (
      SELECT u.total_cost_micros_cny AS cost FROM enterprise.usage u
      JOIN enterprise.billing_attribution a ON a.id = u.id
      WHERE a.organization_id = ${teamId} AND a.account_id = ${actorId} AND a.month = ${month} AND u.status = 'settled'
      UNION ALL
      SELECT t.final_micros_cny AS cost FROM enterprise.model_task t
      JOIN enterprise.billing_attribution a ON a.id = t.id
      WHERE a.organization_id = ${teamId} AND a.account_id = ${actorId} AND a.month = ${month} AND t.settled_at IS NOT NULL
    ) consumption
  `)
  return Number(rows[0]?.spent ?? 0)
}

/**
 * Check live spending eligibility and capture immutable attribution before dispatch.
 * @param tx Transaction that creates the usage or task record.
 * @param teamId Current team.
 * @param actorId Actual initiator.
 * @param modelId Selected platform model.
 * @param requestId Usage or task ID, unique across retries.
 * @param now Admission timestamp.
 * @param chargeable Whether the captured price schedule can incur a charge.
 * @returns Completion after attribution is recorded; rejects exhausted settled budgets and balances.
 */
export async function admitPaidCall(tx: Transaction, teamId: OrganizationId, actorId: string,
  modelId: string, requestId: string, now: Date, chargeable: boolean): Promise<void> {
  await tx.execute(sql`SELECT id FROM enterprise.organization WHERE id = ${teamId} FOR SHARE`)
  const [user] = await tx.select().from(s.user).where(eq(s.user.id, actorId))
  if (!user) forbidden()
  const tenant = await enterTenant(tx, { id: accountId.parse(actorId), email: user.email }, teamId)
  await requirePermission(tx, tenant, 'model.use')
  const [team] = await tx.select().from(s.organizations).where(eq(s.organizations.id, teamId))
  const [member] = await tx.select().from(s.memberships).where(eq(s.memberships.id, tenant.membershipId)).for('share')
  const [model] = await tx.select().from(s.models).where(eq(s.models.id, modelId)).for('share')
  if (!team || !member || !model?.enabled || !modelPublishedTo(model, teamId)) {
    throw new HTTPException(403, { message: 'MODEL_UNAVAILABLE' })
  }
  const [subscription] = await tx.select().from(s.subscriptions).where(eq(s.subscriptions.organizationId, teamId))
  if (!subscription || (subscription.expiresAt && subscription.expiresAt <= now)) {
    throw new HTTPException(403, { message: 'SUBSCRIPTION_EXPIRED' })
  }
  if (!team.resourcePolicy) throw new HTTPException(409, { message: 'TEAM_SETUP_REQUIRED' })
  const policy = teamResourcePolicy.parse(resolvedPolicy(team, now))
  const month = budgetMonth(now, policy.timeZone)
  const budget = member.budget.mode === 'inherit' ? policy.defaultBudget : member.budget
  if (chargeable && !await hasRole(tx, tenant, ['owner']) && budget.mode === 'limited'
    && await memberSpending(tx, teamId, actorId, month) >= budget.amountMicrosCny) {
    throw new HTTPException(402, { message: 'MEMBER_BUDGET_EXHAUSTED' })
  }
  if (chargeable) await assertWalletFunded(tx, teamId)
  const departments = await tx.select({ id: s.assignments.unitId }).from(s.assignments)
    .where(eq(s.assignments.membershipId, member.id))
  await tx.insert(s.billingAttributions).values({ id: requestId, organizationId: teamId, accountId: actorId,
    membershipId: member.id, month, timeZone: policy.timeZone, departmentIds: departments.map(item => item.id), createdAt: now })
}

/**
 * Change one retained membership and stop its new work without discarding supplier tasks.
 * @param tx Team-selected transaction; caller authorizes the actor and records the audit reason.
 * @param teamId Exact owning team.
 * @param membershipId Target membership.
 * @param status Requested access state.
 * @param now Mutation timestamp.
 * @returns Retained membership with its original budget and asset relationships.
 */
export async function setMemberStatus(tx: Transaction, teamId: OrganizationId, membershipId: string,
  status: 'active' | 'suspended' | 'removed', now: Date) {
  await lockOrganization(tx, teamId)
  const [member] = await tx.select().from(s.memberships).where(and(eq(s.memberships.id, membershipId),
    eq(s.memberships.organizationId, teamId))).for('update')
  if (!member) forbidden()
  if (status !== 'active') await protectFinalOwner(tx, teamId, member.id)
  if (status === 'active' && member.status !== 'active') {
    const [subscription] = await tx.select({ seats: s.subscriptions.seats, expiresAt: s.subscriptions.expiresAt,
      status: s.organizations.status, occupied: sql<number>`(SELECT count(*) FROM enterprise.membership
        WHERE organization_id = ${teamId} AND status = 'active')`.mapWith(Number) })
      .from(s.subscriptions).innerJoin(s.organizations, eq(s.organizations.id, s.subscriptions.organizationId))
      .where(eq(s.subscriptions.organizationId, teamId))
    if (!subscription || subscription.status !== 'active') throw new HTTPException(409, { message: 'TEAM_INACTIVE' })
    if (subscription.expiresAt && subscription.expiresAt <= now) throw new HTTPException(409, { message: 'SUBSCRIPTION_EXPIRED' })
    if (subscription.occupied >= subscription.seats) throw new HTTPException(409, { message: 'SEAT_LIMIT_EXCEEDED' })
  }
  const [updated] = await tx.update(s.memberships).set({ status }).where(eq(s.memberships.id, member.id)).returning()
  if (status !== 'active') {
    await tx.update(s.modelTasks).set({ cancelRequestedAt: now }).where(and(eq(s.modelTasks.organizationId, teamId),
      eq(s.modelTasks.accountId, member.accountId), sql`${s.modelTasks.status} IN ('queued','submitting','processing','unknown')`))
    await tx.update(s.runtimes).set({ revokedAt: now }).where(and(eq(s.runtimes.organizationId, teamId),
      eq(s.runtimes.accountId, member.accountId)))
  }
  if (!updated) throw new Error('Membership update is unavailable')
  return updated
}

async function summary(tx: Transaction, tenant: Tenant, now: Date, services: Services) {
  const [team] = await tx.select().from(s.organizations).where(eq(s.organizations.id, tenant.organizationId))
  if (!team) forbidden()
  const permissions = tenant.membershipId ? await effectivePermissions(tx, tenant) : []
  const [wallet] = await tx.select().from(s.organizationWallets).where(eq(s.organizationWallets.organizationId, team.id))
  const memberRows = await tx.select({ member: s.memberships, name: s.user.name, email: s.user.email })
    .from(s.memberships).innerJoin(s.user, eq(s.user.id, s.memberships.accountId))
    .where(eq(s.memberships.organizationId, team.id))
  const policy = resolvedPolicy(team, now)
  const month = budgetMonth(now, policy?.timeZone ?? 'Asia/Shanghai')
  const canManage = !tenant.membershipId || ['member.manage', 'billing.read', 'budget.manage', 'storage.manage', 'role.manage'].some(permission => permissions.includes(permission))
  const members = await Promise.all(memberRows.filter(row => canManage || row.member.accountId === tenant.actor.id).map(async row => ({
    id: row.member.id, accountId: row.member.accountId, name: row.name, email: row.email, status: row.member.status,
    budget: row.member.budget, storageLimitBytes: row.member.storageLimitBytes,
    spentMicrosCny: (!tenant.membershipId || row.member.accountId === tenant.actor.id || permissions.includes('billing.read'))
      ? await memberSpending(tx, team.id, row.member.accountId, month) : null,
  })))
  const tasks = await tx.execute(sql`SELECT count(*) FILTER (WHERE status IN ('queued','submitting','processing','unknown')) AS unfinished,
    count(*) FILTER (WHERE settled_at IS NULL) AS unsettled FROM enterprise.model_task WHERE organization_id = ${team.id}`)
  const ownerRows = await tx.execute(sql`SELECT m.account_id FROM enterprise.membership m WHERE m.organization_id = ${team.id} AND m.status = 'active'`)
  let owner = false
  for (const row of ownerRows) owner ||= await hasRole(tx, { ...tenant, actor: { id: accountId.parse(row.account_id), email: '' } }, ['owner'])
  const models = await tx.select().from(s.models).where(eq(s.models.enabled, true))
  const releases = await tx.select({ id: s.desktopReleases.id }).from(s.desktopReleases).where(sql`${s.desktopReleases.publishedAt} IS NOT NULL`).limit(1)
  const identity = await tx.select().from(s.identityProviders).where(and(eq(s.identityProviders.organizationId, team.id),
    eq(s.identityProviders.enabled, true)))
  const [subscription] = await tx.select().from(s.subscriptions).where(eq(s.subscriptions.organizationId, team.id))
  const credentials = await tx.execute(sql`SELECT 1 FROM enterprise_auth.account a JOIN enterprise.membership m ON m.account_id = a.user_id
    WHERE m.organization_id = ${team.id} AND m.status = 'active' AND a.provider_id = 'credential' LIMIT 1`)
  const readiness = { owner, login: credentials.length > 0 || identity.length > 0,
    recovery: Boolean(services.config.smtpUrl && services.config.mailFrom) || identity.length > 0,
    models: models.some(model => modelPublishedTo(model, team.id)), funding: (wallet?.balanceMicrosCny ?? 0) > 0,
    budget: policy !== null, storage: Boolean(policy && policy.storageBytes > 0), desktop: releases.length > 0 }
  return { organizationId: team.id, name: team.name, status: team.status, version: team.policyRevision,
    subscription: subscription ? { plan: subscription.plan, seats: subscription.seats,
      expiresAt: subscription.expiresAt?.toISOString() ?? null } : null,
    policy, nextTimeZone: team.nextBudgetTimeZoneAt && team.nextBudgetTimeZoneAt > now
      ? { timeZone: team.nextBudgetTimeZone, effectiveAt: team.nextBudgetTimeZoneAt.toISOString() } : null, month, permissions, members,
    balanceMicrosCny: (!tenant.membershipId || permissions.includes('billing.read')) ? wallet?.balanceMicrosCny ?? null : null,
    unfinishedTasks: Number(tasks[0]?.unfinished ?? 0), unsettledTasks: Number(tasks[0]?.unsettled ?? 0),
    storage: await driveCapacity(tx, tenant.organizationId), readiness, updatedAt: now.toISOString() }
}

/**
 * Mount shared team administration through explicit platform and membership authorization.
 * @param app Authenticated application.
 * @param services Database and configured dependencies.
 * @param operation Tenant resolver for desktop callers.
 * @returns No value; registers read and mutation routes.
 */
export function mountTeamGovernance(app: Hono<ApiEnv>, services: Services, operation: TenantOperation): void {
  const now = () => new Date(services.now?.() ?? Date.now())
  app.get('/v1/platform/organizations', async c => c.json(await services.db.transaction(async (tx) => {
    await requirePlatform(tx, c.get('actor'))
    await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
    const query = z.object({ query: z.string().trim().max(120).optional(), status: z.enum(['active', 'suspended', 'closed']).optional(),
      cursor: organizationId.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(c.req.query())
    const rows = await tx.execute(sql`SELECT o.id, o.name, o.status, o.resource_policy, p.plan, p.seats,
      w.balance_micros_cny, (SELECT count(*) FROM enterprise.membership m WHERE m.organization_id = o.id AND m.status = 'active') AS members,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'email', u.email)) FROM enterprise.membership m
        JOIN enterprise_auth."user" u ON u.id = m.account_id WHERE m.organization_id = o.id AND m.status = 'active'
        AND EXISTS (SELECT 1 FROM enterprise.role_binding r WHERE r.organization_id = o.id AND r.membership_id = m.id AND r.role = 'owner' AND r.effect = 'allow' AND r.unit_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM enterprise.role_binding r WHERE r.organization_id = o.id AND r.membership_id = m.id AND r.role = 'owner' AND r.effect = 'deny' AND r.unit_id IS NULL)), '[]'::jsonb) AS owners
      FROM enterprise.organization o LEFT JOIN enterprise.subscription p ON p.organization_id = o.id
      LEFT JOIN enterprise.organization_wallet w ON w.organization_id = o.id
      WHERE (${query.query ?? ''} = '' OR o.name ILIKE ${'%' + (query.query ?? '') + '%'})
        AND (${query.status ?? ''} = '' OR o.status = ${query.status ?? ''})
        AND (${query.cursor ?? ''} = '' OR o.id > ${query.cursor ?? ''}) ORDER BY o.id LIMIT ${query.limit + 1}`)
    const page = rows.slice(0, query.limit)
    return platformTeamPage.parse({ items: page.map(row => ({ id: row.id, name: row.name, status: row.status, plan: row.plan,
      seats: Number(row.seats), members: Number(row.members),
      balanceMicrosCny: row.balance_micros_cny === null ? null : Number(row.balance_micros_cny),
      policy: row.resource_policy, owners: row.owners })), nextCursor: rows.length > query.limit ? page.at(-1)?.id ?? null : null })
  })))
  app.get('/v1/organizations/:organizationId/governance', async c => c.json(await operation(c, (tx, tenant) => summary(tx, tenant, now(), services))))
  app.get('/v1/platform/organizations/:organizationId/governance', async c => c.json(await services.db.transaction(async (tx) => {
    await requirePlatform(tx, c.get('actor'))
    const id = organizationId.parse(c.req.param('organizationId'))
    await selectOrganization(tx, id)
    return summary(tx, { actor: c.get('actor'), organizationId: id, membershipId: '' }, now(), services)
  })))
  for (const platform of [false, true]) {
    const prefix = platform ? '/v1/platform/organizations' : '/v1/organizations'
    app.post(`${prefix}/:organizationId/governance/actions`, async (c) => {
      const input = governanceRequest.parse(await c.req.json())
      const run = async (tx: Transaction, tenant: Tenant) => {
        await lockOrganization(tx, tenant.organizationId)
        const [team] = await tx.select().from(s.organizations).where(eq(s.organizations.id, tenant.organizationId))
        if (!team) forbidden()
        if (team.policyRevision !== input.expectedVersion) throw new HTTPException(409, { message: 'POLICY_VERSION_CONFLICT' })
        const change = input.change
        if (!platform) {
          if (change.action === 'credit' || change.action === 'subscription') forbidden()
          const permission = change.action === 'budget' ? 'budget.manage' : change.action === 'member-storage' || change.action === 'handover'
            ? 'storage.manage' : change.action === 'member-state' ? 'member.manage' : 'organization.manage'
          if (change.action !== 'resources' && change.action !== 'leave') await requirePermission(tx, tenant, permission)
          if (change.action === 'team-state' && change.status !== 'closed') forbidden()
          if (change.action === 'owner-transfer' && !await hasRole(tx, tenant, ['owner'])) forbidden()
        }
        if (change.action === 'credit') {
          const wallet = await lockOrganizationWallet(tx, tenant.organizationId)
          const balance = wallet.balanceMicrosCny + change.amountMicrosCny
          await writeWalletBalance(tx, wallet, balance, now())
          await tx.insert(s.walletLedger).values({ id: randomUUID(), organizationId: team.id, kind: 'manual_adjustment',
            amountMicrosCny: change.amountMicrosCny, balanceAfterMicrosCny: balance, accountId: tenant.actor.id })
        } else if (change.action === 'subscription') {
          await applySubscriptionPlan(tx, tenant.organizationId, change)
        } else if (change.action === 'leave') {
          if (platform) forbidden()
          await setMemberStatus(tx, tenant.organizationId, tenant.membershipId, 'removed', now())
        } else if (change.action === 'restore-request') {
          if (platform || team.status === 'active') throw new HTTPException(409, { message: 'TEAM_RESTORE_NOT_REQUIRED' })
        } else if (change.action === 'resources') {
          if (!platform && (!team.resourcePolicy || team.resourcePolicy.storageBytes !== change.policy.storageBytes)) forbidden()
          const current = resolvedPolicy(team, now())
          if (!platform && current) {
            if (JSON.stringify(current.defaultBudget) !== JSON.stringify(change.policy.defaultBudget) || current.timeZone !== change.policy.timeZone) await requirePermission(tx, tenant, 'budget.manage')
            if (current.personalStorageBytes !== change.policy.personalStorageBytes) await requirePermission(tx, tenant, 'storage.manage')
            if (!(await effectivePermissions(tx, tenant)).some(permission => permission === 'budget.manage' || permission === 'storage.manage')) forbidden()
          }
          const changingZone = current && current.timeZone !== change.policy.timeZone
          await tx.update(s.organizations).set({ resourcePolicy: { ...change.policy,
            timeZone: current?.timeZone ?? change.policy.timeZone },
          nextBudgetTimeZone: changingZone ? change.policy.timeZone : null,
          nextBudgetTimeZoneAt: changingZone ? nextBudgetMonth(now(), current.timeZone) : null,
          }).where(eq(s.organizations.id, team.id))
        } else if (change.action === 'team-state') {
          await tx.update(s.organizations).set({ status: change.status }).where(eq(s.organizations.id, team.id))
          if (change.status !== 'active') await tx.update(s.modelTasks).set({ cancelRequestedAt: now() }).where(and(
            eq(s.modelTasks.organizationId, team.id), sql`${s.modelTasks.status} IN ('queued','submitting','processing','unknown')`))
        } else {
          const [member] = await tx.select().from(s.memberships).where(and(eq(s.memberships.id, change.membershipId),
            eq(s.memberships.organizationId, team.id)))
          if (!member) forbidden()
          switch (change.action) {
            case 'budget': await tx.update(s.memberships).set({ budget: change.budget }).where(eq(s.memberships.id, member.id)); break
            case 'member-storage': await tx.update(s.memberships).set({ storageLimitBytes: change.bytes }).where(eq(s.memberships.id, member.id)); break
            case 'member-state': {
              const target = { ...tenant, actor: { id: accountId.parse(member.accountId), email: '' }, membershipId: member.id }
              if (!platform && await hasRole(tx, target, ['owner']) && !await hasRole(tx, tenant, ['owner'])) forbidden()
              await setMemberStatus(tx, tenant.organizationId, member.id, change.status, now())
              break
            }
            case 'owner-transfer': {
              if (member.status !== 'active') forbidden()
              const targetBindings = await tx.select().from(s.roles).where(and(eq(s.roles.organizationId, team.id),
                eq(s.roles.membershipId, member.id), eq(s.roles.role, 'owner'), isNull(s.roles.unitId)))
              if (targetBindings.some(binding => binding.effect === 'deny')) throw new HTTPException(409, { message: 'OWNER_EXPLICITLY_DENIED' })
              if (!targetBindings.length) await tx.insert(s.roles).values({ id: randomUUID(), organizationId: team.id, membershipId: member.id, role: 'owner' })
              if (!platform && tenant.membershipId !== member.id) await tx.delete(s.roles).where(and(eq(s.roles.membershipId,
                tenant.membershipId), eq(s.roles.role, 'owner'), isNull(s.roles.unitId), eq(s.roles.effect, 'allow')))
              break
            }
            case 'handover': {
              const [target] = await tx.select().from(s.memberships).where(and(eq(s.memberships.id, change.targetMembershipId),
                eq(s.memberships.organizationId, team.id), eq(s.memberships.status, 'active')))
              if (!target || target.id === member.id) forbidden()
              if (member.status === 'active') throw new HTTPException(409, { message: 'HANDOVER_REQUIRES_INACTIVE_MEMBER' })
              await tx.update(s.driveSpaces).set({ custodianAccountId: target.accountId }).where(and(eq(s.driveSpaces.organizationId,
                team.id), eq(s.driveSpaces.accountId, member.accountId), eq(s.driveSpaces.kind, 'personal')))
              await tx.insert(s.handovers).values({ id: randomUUID(), organizationId: team.id, membershipId: member.id,
                targetMembershipId: target.id, reason: input.reason, createdBy: tenant.actor.id })
              break
            }
          }
        }
        await tx.update(s.organizations).set({ policyRevision: team.policyRevision + 1 }).where(eq(s.organizations.id, team.id))
        await recordAudit(tx, tenant, 'governance.' + change.action, team.id, { reason: input.reason, change,
          previousVersion: input.expectedVersion })
        return summary(tx, tenant, now(), services)
      }
      return c.json(platform ? await services.db.transaction(async (tx) => {
        await requirePlatform(tx, c.get('actor'))
        const id = organizationId.parse(c.req.param('organizationId'))
        await selectOrganization(tx, id)
        return run(tx, { actor: c.get('actor'), organizationId: id, membershipId: '' })
      }) : await operation(c, run))
    })
  }
}
