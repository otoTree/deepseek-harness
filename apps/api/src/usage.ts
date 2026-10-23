/** Platform usage analytics over settled CNY price snapshots. */
import type { Hono } from 'hono'
import { and, asc, desc, eq, gt, gte, lt, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { z } from 'zod'
import * as s from './schema.ts'
import { requirePlatform } from './security.ts'
import type { ApiEnv, Services } from './application.ts'

const purpose = z.enum(['chat', 'subagent', 'compaction', 'title', 'plugin_review', 'plugin_model', 'media_generation'])
const filtersSchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  organizationId: z.uuid().optional(),
  modelId: z.uuid().optional(),
  accountId: z.string().min(1).max(128).optional(),
  purpose: purpose.optional(),
  protocol: z.enum(['openai-completions', 'openai-responses']).optional(),
  modality: z.enum(['text', 'image', 'video', 'audio', 'document']).optional(),
}).strict()

interface UsageFilters {
  readonly from: Date
  readonly to: Date
  readonly organizationId?: string
  readonly modelId?: string
  readonly accountId?: string
  readonly purpose?: z.infer<typeof purpose>
  readonly protocol?: 'openai-completions' | 'openai-responses'
  readonly modality?: 'text' | 'image' | 'video' | 'audio' | 'document'
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
  const settled = eq(s.modelUsage.status, 'settled')
  const predicates = [
    gte(s.modelUsage.settledAt, value.from),
    lt(s.modelUsage.settledAt, value.to),
  ]
  if (value.organizationId !== undefined) predicates.push(eq(s.modelUsage.organizationId, value.organizationId))
  if (value.modelId !== undefined) predicates.push(eq(s.modelUsage.modelId, value.modelId))
  if (value.accountId !== undefined) predicates.push(eq(s.modelUsage.accountId, value.accountId))
  if (value.purpose !== undefined) predicates.push(eq(s.modelUsage.purpose, value.purpose))
  if (value.protocol !== undefined) predicates.push(eq(s.modelUsage.protocol, value.protocol))
  if (value.modality !== undefined) predicates.push(sql`${s.modelUsage.inputModalities} @> ${JSON.stringify([value.modality])}::jsonb`)
  return and(settled, ...predicates) ?? settled
}

function recordsWhere(value: UsageFilters): SQL {
  const occurredAt = sql<Date>`coalesce(${s.modelUsage.settledAt}, ${s.modelUsage.requestStartedAt})`.mapWith(s.modelUsage.settledAt)
  const predicates = [
    sql`${occurredAt} >= ${value.from.toISOString()}::timestamptz`,
    sql`${occurredAt} < ${value.to.toISOString()}::timestamptz`,
  ]
  if (value.organizationId !== undefined) predicates.push(eq(s.modelUsage.organizationId, value.organizationId))
  if (value.modelId !== undefined) predicates.push(eq(s.modelUsage.modelId, value.modelId))
  if (value.accountId !== undefined) predicates.push(eq(s.modelUsage.accountId, value.accountId))
  if (value.purpose !== undefined) predicates.push(eq(s.modelUsage.purpose, value.purpose))
  if (value.protocol !== undefined) predicates.push(eq(s.modelUsage.protocol, value.protocol))
  if (value.modality !== undefined) predicates.push(sql`${s.modelUsage.inputModalities} @> ${JSON.stringify([value.modality])}::jsonb`)
  return and(...predicates) ?? sql`false`
}

const aggregate = {
  calls: sql<number>`count(*)::int`,
  pricedCalls: sql<number>`count(*) filter (where ${s.modelUsage.currency} = 'CNY')::int`,
  inputTokens: sum(s.modelUsage.inputTokens),
  cachedInputTokens: sum(s.modelUsage.cachedInputTokens),
  outputTokens: sum(s.modelUsage.outputTokens),
  reasoningTokens: sum(s.modelUsage.reasoningTokens),
  totalTokens: sum(sql`coalesce(${s.modelUsage.totalTokens}, coalesce(${s.modelUsage.inputTokens}, 0) + coalesce(${s.modelUsage.outputTokens}, 0))`),
  totalCostMicrosCny: sum(s.modelUsage.totalCostMicrosCny),
  fileUploadCount: sum(s.modelUsage.fileUploadCount),
  uploadedBytes: sum(s.modelUsage.uploadedBytes),
  fileUploadFailures: sum(s.modelUsage.fileUploadFailures),
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

  app.get('/v1/platform/overview', async (c) => {
    const to = new Date()
    const from = new Date(to.getTime() - 30 * 86_400_000)
    const settled = and(
      eq(s.modelUsage.status, 'settled'),
      gte(s.modelUsage.settledAt, from),
      lt(s.modelUsage.settledAt, to),
    )
    const result = await platform(c.get('actor'), async (tx) => {
      const [organizations, members, runtimes, usageSummary] = await Promise.all([
        tx.select({ count: sql<number>`count(*)::int` }).from(s.organizations),
        tx.select({ count: sql<number>`count(*)::int` }).from(s.memberships),
        tx.select({ count: sql<number>`count(*)::int` }).from(s.runtimes).where(and(sql`${s.runtimes.revokedAt} is null`, gt(s.runtimes.expiresAt, new Date()))),
        tx.select({
          calls: sql<number>`count(*)::int`,
          totalTokens: sql<number>`coalesce(sum(${s.modelUsage.totalTokens}), 0)::float8`,
          totalCostMicrosCny: sql<number>`coalesce(sum(${s.modelUsage.totalCostMicrosCny}), 0)::float8`,
        }).from(s.modelUsage).where(settled),
      ])
      const day = sql<string>`to_char(date_trunc('day', ${s.modelUsage.settledAt} at time zone 'Asia/Shanghai'), 'YYYY-MM-DD')`
      const trend = await tx.select({
        day,
        calls: sql<number>`count(*)::int`,
        totalTokens: sql<number>`coalesce(sum(${s.modelUsage.totalTokens}), 0)::float8`,
        totalCostMicrosCny: sql<number>`coalesce(sum(${s.modelUsage.totalCostMicrosCny}), 0)::float8`,
      }).from(s.modelUsage).where(settled).groupBy(day).orderBy(asc(day))
      const [syncPending, syncFailed, pluginReview, audit, services] = await Promise.all([
        tx.select({ count: sql<number>`count(*)::int` }).from(s.syncRuns).where(sql`${s.syncRuns.status} in ('queued', 'running')`),
        tx.select({ count: sql<number>`count(*)::int` }).from(s.syncRuns).where(eq(s.syncRuns.status, 'failed')),
        tx.select({ count: sql<number>`count(*)::int` }).from(s.plugins).where(sql`${s.plugins.status} in ('awaiting_ai', 'awaiting_human')`),
        tx.select({
          id: s.audit.id,
          action: s.audit.action,
          resourceId: s.audit.resourceId,
          organizationId: s.audit.organizationId,
          createdAt: s.audit.createdAt,
        }).from(s.audit).orderBy(desc(s.audit.createdAt)).limit(5),
        (async () => {
          const started = Date.now()
          await tx.execute(sql`select 1 as ok`)
          return { databaseLatencyMs: Date.now() - started }
        })(),
      ])
      return {
        range: { from: from.toISOString(), to: to.toISOString(), timezone: 'Asia/Shanghai' },
        metrics: {
          organizations: organizations[0]?.count ?? 0,
          members: members[0]?.count ?? 0,
          runtimes: runtimes[0]?.count ?? 0,
          calls: usageSummary[0]?.calls ?? 0,
          totalTokens: usageSummary[0]?.totalTokens ?? 0,
          totalCostMicrosCny: usageSummary[0]?.totalCostMicrosCny ?? 0,
        },
        trend,
        pending: [
          { id: 'directory-sync', kind: 'directory-sync', count: (syncPending[0]?.count ?? 0) + (syncFailed[0]?.count ?? 0), status: syncFailed[0]?.count ? 'failed' : 'ready' },
          { id: 'plugin-review', kind: 'plugin-review', count: pluginReview[0]?.count ?? 0, status: pluginReview[0]?.count ? 'warning' : 'ready' },
        ],
        health: [
          { id: 'api', label: 'API 网关', status: 'ready', availability: 99.99 },
          { id: 'database', label: '数据库', status: 'ready', availability: services.databaseLatencyMs < 500 ? 99.99 : 98.5 },
          { id: 'identity', label: '身份认证', status: 'unknown', availability: null },
          { id: 'directory', label: '目录同步', status: syncFailed[0]?.count ? 'warning' : 'ready', availability: null },
          { id: 'runtime', label: '设备 Runtime', status: 'unknown', availability: null },
        ],
        audit,
      }
    })
    return c.json(result)
  })

  app.get('/v1/platform/usage/summary', async (c) => {
    const selected = filters(c.req.query())
    const [result] = await platform(c.get('actor'), tx => tx.select(aggregate).from(s.modelUsage).where(where(selected)))
    return c.json({ ...result, from: selected.from, to: selected.to, currency: 'CNY' as const })
  })

  app.get('/v1/platform/usage/timeseries', async (c) => {
    const selected = filters(c.req.query())
    const day = sql<string>`to_char(date_trunc('day', ${s.modelUsage.settledAt} at time zone 'Asia/Shanghai'), 'YYYY-MM-DD')`
    const values = await platform(c.get('actor'), tx => tx.select({ day, ...aggregate })
      .from(s.modelUsage).where(where(selected)).groupBy(day).orderBy(asc(day)))
    return c.json({ values, timezone: 'Asia/Shanghai', currency: 'CNY' as const })
  })

  app.get('/v1/platform/usage/breakdown', async (c) => {
    const query = z.object({ groupBy: z.enum(['model', 'account', 'organization', 'purpose']) }).parse(c.req.query())
    const selected = filters(Object.fromEntries(Object.entries(c.req.query()).filter(([key]) => key !== 'groupBy')))
    const values = await platform(c.get('actor'), async (tx) => {
      if (query.groupBy === 'model') return tx.select({ id: s.modelUsage.modelId, label: s.models.name, ...aggregate })
        .from(s.modelUsage).innerJoin(s.models, eq(s.models.id, s.modelUsage.modelId)).where(where(selected))
        .groupBy(s.modelUsage.modelId, s.models.name).orderBy(desc(aggregate.totalCostMicrosCny)).limit(10)
      if (query.groupBy === 'account') return tx.select({ id: s.modelUsage.accountId, label: s.user.email, ...aggregate })
        .from(s.modelUsage).innerJoin(s.user, eq(s.user.id, s.modelUsage.accountId)).where(where(selected))
        .groupBy(s.modelUsage.accountId, s.user.email).orderBy(desc(aggregate.totalCostMicrosCny)).limit(10)
      if (query.groupBy === 'organization') return tx.select({ id: s.modelUsage.organizationId, label: s.organizations.name, ...aggregate })
        .from(s.modelUsage).innerJoin(s.organizations, eq(s.organizations.id, s.modelUsage.organizationId)).where(where(selected))
        .groupBy(s.modelUsage.organizationId, s.organizations.name).orderBy(desc(aggregate.totalCostMicrosCny)).limit(10)
      return tx.select({ id: s.modelUsage.purpose, label: s.modelUsage.purpose, ...aggregate })
        .from(s.modelUsage).where(where(selected)).groupBy(s.modelUsage.purpose).orderBy(desc(aggregate.totalCostMicrosCny)).limit(10)
    })
    return c.json({ groupBy: query.groupBy, values, currency: 'CNY' as const })
  })

  app.get('/v1/platform/usage/records', async (c) => {
    const query = z.object({ cursor: z.string().max(512).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse({ cursor: c.req.query('cursor'), limit: c.req.query('limit') })
    const selected = filters(Object.fromEntries(Object.entries(c.req.query())
      .filter(([key]) => !['cursor', 'limit'].includes(key))))
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor)
    const occurredAt = sql<Date>`coalesce(${s.modelUsage.settledAt}, ${s.modelUsage.requestStartedAt})`.mapWith(s.modelUsage.settledAt)
    const cursorWhere = cursor === undefined ? undefined : or(
      sql`${occurredAt} < ${cursor.settledAt.toISOString()}::timestamptz`,
      and(sql`${occurredAt} = ${cursor.settledAt.toISOString()}::timestamptz`, gt(s.modelUsage.id, cursor.id)),
    )
    const items = await platform(c.get('actor'), tx => tx.select({
      id: s.modelUsage.id,
      occurredAt,
      settledAt: s.modelUsage.settledAt,
      organizationId: s.modelUsage.organizationId,
      organizationName: s.organizations.name,
      accountId: s.modelUsage.accountId,
      accountEmail: s.user.email,
      runtimeId: s.modelUsage.runtimeId,
      modelId: s.modelUsage.modelId,
      modelName: s.models.name,
      purpose: s.modelUsage.purpose,
      status: s.modelUsage.status,
      protocol: s.modelUsage.protocol,
      inputModalities: s.modelUsage.inputModalities,
      fileUploadCount: s.modelUsage.fileUploadCount,
      uploadedBytes: s.modelUsage.uploadedBytes,
      fileUploadFailures: s.modelUsage.fileUploadFailures,
      reconciliationReason: s.modelUsage.reconciliationReason,
      failureReason: s.modelUsage.failureReason,
      inputTokens: sql<number>`coalesce(${s.modelUsage.inputTokens}, 0)::int`,
      cachedInputTokens: sql<number>`coalesce(${s.modelUsage.cachedInputTokens}, 0)::int`,
      uncachedInputTokens: sql<number>`coalesce(${s.modelUsage.uncachedInputTokens}, ${s.modelUsage.inputTokens}, 0)::int`,
      outputTokens: sql<number>`coalesce(${s.modelUsage.outputTokens}, 0)::int`,
      reasoningTokens: sql<number>`coalesce(${s.modelUsage.reasoningTokens}, 0)::int`,
      totalTokens: sql<number>`coalesce(${s.modelUsage.totalTokens}, coalesce(${s.modelUsage.inputTokens}, 0) + coalesce(${s.modelUsage.outputTokens}, 0))::int`,
      totalCostMicrosCny: s.modelUsage.totalCostMicrosCny,
      currency: s.modelUsage.currency,
      durationMs: s.modelUsage.durationMs,
      upstreamRequestId: s.modelUsage.upstreamRequestId,
      pricingVersion: s.modelUsage.pricingVersion,
      inputPriceMicrosCnyPerMillion: s.modelUsage.inputPriceMicrosCnyPerMillion,
      cachedInputPriceMicrosCnyPerMillion: s.modelUsage.cachedInputPriceMicrosCnyPerMillion,
      outputPriceMicrosCnyPerMillion: s.modelUsage.outputPriceMicrosCnyPerMillion,
      inputCostMicrosCny: s.modelUsage.inputCostMicrosCny,
      cachedInputCostMicrosCny: s.modelUsage.cachedInputCostMicrosCny,
      outputCostMicrosCny: s.modelUsage.outputCostMicrosCny,
    }).from(s.modelUsage)
      .innerJoin(s.organizations, eq(s.organizations.id, s.modelUsage.organizationId))
      .innerJoin(s.user, eq(s.user.id, s.modelUsage.accountId))
      .innerJoin(s.models, eq(s.models.id, s.modelUsage.modelId))
      .where(cursorWhere === undefined ? recordsWhere(selected) : and(recordsWhere(selected), cursorWhere))
      .orderBy(desc(occurredAt), asc(s.modelUsage.id)).limit(query.limit + 1))
    const hasMore = items.length > query.limit
    const page = hasMore ? items.slice(0, query.limit) : items
    const last = page.at(-1)
    return c.json({
      items: page,
      nextCursor: hasMore && last?.occurredAt ? encodeCursor(last.occurredAt, last.id) : null,
      currency: 'CNY' as const,
    })
  })
}
