/** Platform usage analytics over settled CNY price snapshots. */
import type { Hono } from 'hono'
import { and, asc, desc, eq, gt, gte, lt, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { z } from 'zod'
import * as s from './schema.ts'
import { requirePlatform } from './security.ts'
import type { ApiEnv, Services } from './application.ts'

const purpose = z.enum(['chat', 'subagent', 'compaction', 'title', 'plugin_review'])
const filtersSchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  organizationId: z.uuid().optional(),
  modelId: z.uuid().optional(),
  accountId: z.string().min(1).max(128).optional(),
  purpose: purpose.optional(),
}).strict()

interface UsageFilters {
  readonly from: Date
  readonly to: Date
  readonly organizationId?: string
  readonly modelId?: string
  readonly accountId?: string
  readonly purpose?: z.infer<typeof purpose>
}

const sum = (column: SQLWrapper): SQL<number> => sql<number>`coalesce(sum(${column}), 0)::float8`

function filters(query: Record<string, string>): UsageFilters {
  const parsed = filtersSchema.parse(query)
  const to = parsed.to === undefined ? new Date() : new Date(parsed.to)
  const from = parsed.from === undefined ? new Date(to.getTime() - 30 * 86_400_000) : new Date(parsed.from)
  if (from >= to) throw new z.ZodError([{ code: 'custom', path: ['from'], message: 'from must precede to' }])
  if (to.getTime() - from.getTime() > 366 * 86_400_000) {
    throw new z.ZodError([{ code: 'custom', path: ['to'], message: 'usage range cannot exceed 366 days' }])
  }
  return { ...parsed, from, to }
}

function where(value: UsageFilters): SQL {
  const settled = eq(s.usage.status, 'settled')
  const predicates = [
    gte(s.usage.settledAt, value.from),
    lt(s.usage.settledAt, value.to),
  ]
  if (value.organizationId !== undefined) predicates.push(eq(s.usage.organizationId, value.organizationId))
  if (value.modelId !== undefined) predicates.push(eq(s.usage.modelId, value.modelId))
  if (value.accountId !== undefined) predicates.push(eq(s.usage.accountId, value.accountId))
  if (value.purpose !== undefined) predicates.push(eq(s.usage.purpose, value.purpose))
  return and(settled, ...predicates) ?? settled
}

const aggregate = {
  calls: sql<number>`count(*)::int`,
  pricedCalls: sql<number>`count(*) filter (where ${s.usage.currency} = 'CNY')::int`,
  inputTokens: sum(s.usage.inputTokens),
  cachedInputTokens: sum(s.usage.cachedInputTokens),
  outputTokens: sum(s.usage.outputTokens),
  reasoningTokens: sum(s.usage.reasoningTokens),
  totalTokens: sum(sql`coalesce(${s.usage.totalTokens}, coalesce(${s.usage.inputTokens}, 0) + coalesce(${s.usage.outputTokens}, 0))`),
  totalCostMicrosCny: sum(s.usage.totalCostMicrosCny),
}

function encodeCursor(settledAt: Date, id: string): string {
  return Buffer.from(`${settledAt.toISOString()}|${id}`, 'utf8').toString('base64url')
}

function decodeCursor(value: string): { settledAt: Date; id: string } {
  const [date, id, ...rest] = Buffer.from(value, 'base64url').toString('utf8').split('|')
  const settledAt = new Date(date ?? '')
  if (rest.length > 0 || !id || Number.isNaN(settledAt.getTime())) {
    throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'invalid usage cursor' }])
  }
  return { settledAt, id }
}

/** Register platform-only CNY usage summary, trend, breakdown, and detail routes. */
export function mountUsageAnalytics(app: Hono<ApiEnv>, { db }: Services): void {
  const platform = async <T>(actor: ApiEnv['Variables']['actor'], run: Parameters<typeof db.transaction<T>>[0]): Promise<T> =>
    db.transaction(async (tx) => {
      await requirePlatform(tx, actor)
      await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
      return run(tx)
    })

  app.get('/v1/platform/usage/summary', async (c) => {
    const selected = filters(c.req.query())
    const [result] = await platform(c.get('actor'), tx => tx.select(aggregate).from(s.usage).where(where(selected)))
    return c.json({ ...result, from: selected.from, to: selected.to, currency: 'CNY' as const })
  })

  app.get('/v1/platform/usage/timeseries', async (c) => {
    const selected = filters(c.req.query())
    const day = sql<string>`to_char(date_trunc('day', ${s.usage.settledAt} at time zone 'Asia/Shanghai'), 'YYYY-MM-DD')`
    const values = await platform(c.get('actor'), tx => tx.select({ day, ...aggregate })
      .from(s.usage).where(where(selected)).groupBy(day).orderBy(asc(day)))
    return c.json({ values, timezone: 'Asia/Shanghai', currency: 'CNY' as const })
  })

  app.get('/v1/platform/usage/breakdown', async (c) => {
    const query = z.object({ groupBy: z.enum(['model', 'account', 'organization', 'purpose']) }).parse(c.req.query())
    const selected = filters(Object.fromEntries(Object.entries(c.req.query()).filter(([key]) => key !== 'groupBy')))
    const values = await platform(c.get('actor'), async (tx) => {
      if (query.groupBy === 'model') return tx.select({ id: s.usage.modelId, label: s.models.name, ...aggregate })
        .from(s.usage).innerJoin(s.models, eq(s.models.id, s.usage.modelId)).where(where(selected))
        .groupBy(s.usage.modelId, s.models.name).orderBy(desc(aggregate.totalCostMicrosCny)).limit(10)
      if (query.groupBy === 'account') return tx.select({ id: s.usage.accountId, label: s.user.email, ...aggregate })
        .from(s.usage).innerJoin(s.user, eq(s.user.id, s.usage.accountId)).where(where(selected))
        .groupBy(s.usage.accountId, s.user.email).orderBy(desc(aggregate.totalCostMicrosCny)).limit(10)
      if (query.groupBy === 'organization') return tx.select({ id: s.usage.organizationId, label: s.organizations.name, ...aggregate })
        .from(s.usage).innerJoin(s.organizations, eq(s.organizations.id, s.usage.organizationId)).where(where(selected))
        .groupBy(s.usage.organizationId, s.organizations.name).orderBy(desc(aggregate.totalCostMicrosCny)).limit(10)
      return tx.select({ id: s.usage.purpose, label: s.usage.purpose, ...aggregate })
        .from(s.usage).where(where(selected)).groupBy(s.usage.purpose).orderBy(desc(aggregate.totalCostMicrosCny)).limit(10)
    })
    return c.json({ groupBy: query.groupBy, values, currency: 'CNY' as const })
  })

  app.get('/v1/platform/usage/records', async (c) => {
    const query = z.object({ cursor: z.string().max(512).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse({ cursor: c.req.query('cursor'), limit: c.req.query('limit') })
    const selected = filters(Object.fromEntries(Object.entries(c.req.query())
      .filter(([key]) => !['cursor', 'limit'].includes(key))))
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor)
    const cursorWhere = cursor === undefined ? undefined : or(
      lt(s.usage.settledAt, cursor.settledAt),
      and(eq(s.usage.settledAt, cursor.settledAt), gt(s.usage.id, cursor.id)),
    )
    const items = await platform(c.get('actor'), tx => tx.select({
      id: s.usage.id,
      settledAt: s.usage.settledAt,
      organizationId: s.usage.organizationId,
      organizationName: s.organizations.name,
      accountId: s.usage.accountId,
      accountEmail: s.user.email,
      runtimeId: s.usage.runtimeId,
      modelId: s.usage.modelId,
      modelName: s.models.name,
      purpose: s.usage.purpose,
      inputTokens: sql<number>`coalesce(${s.usage.inputTokens}, 0)::int`,
      cachedInputTokens: sql<number>`coalesce(${s.usage.cachedInputTokens}, 0)::int`,
      uncachedInputTokens: sql<number>`coalesce(${s.usage.uncachedInputTokens}, ${s.usage.inputTokens}, 0)::int`,
      outputTokens: sql<number>`coalesce(${s.usage.outputTokens}, 0)::int`,
      reasoningTokens: sql<number>`coalesce(${s.usage.reasoningTokens}, 0)::int`,
      totalTokens: sql<number>`coalesce(${s.usage.totalTokens}, coalesce(${s.usage.inputTokens}, 0) + coalesce(${s.usage.outputTokens}, 0))::int`,
      totalCostMicrosCny: s.usage.totalCostMicrosCny,
      currency: s.usage.currency,
      durationMs: s.usage.durationMs,
      upstreamRequestId: s.usage.upstreamRequestId,
      pricingVersion: s.usage.pricingVersion,
      inputPriceMicrosCnyPerMillion: s.usage.inputPriceMicrosCnyPerMillion,
      cachedInputPriceMicrosCnyPerMillion: s.usage.cachedInputPriceMicrosCnyPerMillion,
      outputPriceMicrosCnyPerMillion: s.usage.outputPriceMicrosCnyPerMillion,
      inputCostMicrosCny: s.usage.inputCostMicrosCny,
      cachedInputCostMicrosCny: s.usage.cachedInputCostMicrosCny,
      outputCostMicrosCny: s.usage.outputCostMicrosCny,
    }).from(s.usage)
      .innerJoin(s.organizations, eq(s.organizations.id, s.usage.organizationId))
      .innerJoin(s.user, eq(s.user.id, s.usage.accountId))
      .innerJoin(s.models, eq(s.models.id, s.usage.modelId))
      .where(cursorWhere === undefined ? where(selected) : and(where(selected), cursorWhere))
      .orderBy(desc(s.usage.settledAt), asc(s.usage.id)).limit(query.limit + 1))
    const hasMore = items.length > query.limit
    const page = hasMore ? items.slice(0, query.limit) : items
    const last = page.at(-1)
    return c.json({
      items: page,
      nextCursor: hasMore && last?.settledAt ? encodeCursor(last.settledAt, last.id) : null,
      currency: 'CNY' as const,
    })
  })
}
