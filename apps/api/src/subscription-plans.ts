/** Platform subscription catalog and explicit application of versioned plan defaults. */
import { eq, sql } from 'drizzle-orm'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { ApiEnv, Services } from './application.ts'
import { selectOrganization, type Transaction } from './database.ts'
import { organizationId, subscriptionPlan, subscriptionPlanInput, subscriptionPlanWrite } from './contracts.ts'
import { requirePlatform, recordAudit } from './security.ts'
import * as s from './schema.ts'

/** Apply selected plan defaults without crediting funds or changing accounting history.
 * @param tx Authorized transaction holding the team lock.
 * @param teamId Selected customer team.
 * @param change Displayed catalog version, seat override and expiry.
 */
export async function applySubscriptionPlan(tx: Transaction, teamId: z.infer<typeof organizationId>, change: {
  plan: string
  seats: number
  planVersion?: number | undefined
  expiresAt?: string | null | undefined
}): Promise<void> {
  const [plan] = await tx.select().from(s.subscriptionPlans).where(eq(s.subscriptionPlans.code, change.plan)).for('share')
  if (!plan || !plan.enabled) throw new HTTPException(409, { message: 'PLAN_UNAVAILABLE' })
  if (change.planVersion !== undefined && change.planVersion !== plan.version) throw new HTTPException(409, { message: 'PLAN_VERSION_CONFLICT' })
  await tx.insert(s.subscriptions).values({ organizationId: teamId, plan: plan.code, seats: change.seats,
    expiresAt: change.expiresAt ? new Date(change.expiresAt) : null })
    .onConflictDoUpdate({ target: s.subscriptions.organizationId, set: { plan: plan.code, seats: change.seats,
      ...(change.expiresAt === undefined ? {} : { expiresAt: change.expiresAt ? new Date(change.expiresAt) : null }) } })
  if (plan.resourcePolicy) {
    const [team] = await tx.select().from(s.organizations).where(eq(s.organizations.id, teamId))
    // Timezone changes require the dedicated resource action and its next-cycle calculation.
    if (team?.resourcePolicy && team.resourcePolicy.timeZone !== plan.resourcePolicy.timeZone) {
      throw new HTTPException(409, { message: 'PLAN_TIME_ZONE_CONFLICT' })
    }
    await tx.update(s.organizations).set({ resourcePolicy: plan.resourcePolicy }).where(eq(s.organizations.id, teamId))
  }
}

/** Register audited catalog CRUD; referenced plans can be disabled but cannot be deleted.
 * @param app Authenticated control-plane application.
 * @param services Database used for catalog and team references.
 */
export function mountSubscriptionPlans(app: Hono<ApiEnv>, services: Services): void {
  const platform = async <T>(actor: ApiEnv['Variables']['actor'], work: (tx: Transaction) => Promise<T>): Promise<T> =>
    services.db.transaction(async (tx) => {
      await requirePlatform(tx, actor)
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      return work(tx)
    })
  const audit = async (tx: Transaction, actor: ApiEnv['Variables']['actor'], action: string, code: string, detail: Record<string, unknown>) => {
    const [deployment] = await tx.select().from(s.deployment).where(eq(s.deployment.id, 'primary'))
    if (!deployment?.rootOrganizationId) throw new HTTPException(409, { message: 'DEPLOYMENT_SETUP_REQUIRED' })
    const auditTeam = organizationId.parse(deployment.rootOrganizationId)
    await selectOrganization(tx, auditTeam)
    await recordAudit(tx, { actor, organizationId: auditTeam, membershipId: '' }, action, code, detail)
  }
  app.get('/v1/platform/plans', async c => c.json(await platform(c.get('actor'), async (tx) => {
    const plans = await tx.select().from(s.subscriptionPlans).orderBy(s.subscriptionPlans.code)
    const assignments = await tx.select({ plan: s.subscriptions.plan, count: sql<number>`count(*)::int` })
      .from(s.subscriptions).groupBy(s.subscriptions.plan)
    return plans.map(plan => subscriptionPlan.parse({
      ...plan, assignedTeams: assignments.find(row => row.plan === plan.code)?.count ?? 0,
    }))
  })))
  app.post('/v1/platform/plans', async (c) => {
    const input = z.object({ code: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/), reason: subscriptionPlanWrite.shape.reason,
      values: subscriptionPlanInput }).strict().parse(await c.req.json())
    return c.json(await platform(c.get('actor'), async (tx) => {
      const rows = await tx.insert(s.subscriptionPlans).values({ code: input.code, ...input.values }).onConflictDoNothing().returning()
      if (!rows[0]) throw new HTTPException(409, { message: 'PLAN_CODE_EXISTS' })
      await audit(tx, c.get('actor'), 'plan.created', input.code, input)
      return subscriptionPlan.parse({ ...rows[0], assignedTeams: 0 })
    }), 201)
  })
  for (const method of ['PATCH', 'DELETE'] as const) app.on(method, '/v1/platform/plans/:code', async (c) => {
    const code = z.string().min(1).max(60).parse(c.req.param('code'))
    const body: unknown = await c.req.json()
    const input = method === 'PATCH' ? subscriptionPlanWrite.parse(body)
      : subscriptionPlanWrite.omit({ values: true }).parse(body)
    return c.json(await platform(c.get('actor'), async (tx) => {
      const [current] = await tx.select().from(s.subscriptionPlans).where(eq(s.subscriptionPlans.code, code)).for('update')
      if (!current) throw new HTTPException(404, { message: 'PLAN_UNAVAILABLE' })
      if (current.version !== input.expectedVersion) throw new HTTPException(409, { message: 'PLAN_VERSION_CONFLICT' })
      if (method === 'DELETE') {
        const [assigned] = await tx.select().from(s.subscriptions).where(eq(s.subscriptions.plan, code)).limit(1)
        if (assigned || ['team', 'private', 'enterprise'].includes(code)) throw new HTTPException(409, { message: 'PLAN_IN_USE' })
        await tx.delete(s.subscriptionPlans).where(eq(s.subscriptionPlans.code, code))
      } else {
        const values = subscriptionPlanWrite.parse(body).values
        await tx.update(s.subscriptionPlans).set({ ...values, version: current.version + 1 }).where(eq(s.subscriptionPlans.code, code))
      }
      await audit(tx, c.get('actor'), method === 'DELETE' ? 'plan.deleted' : 'plan.updated', code, input)
      return { ok: true }
    }))
  })
}
