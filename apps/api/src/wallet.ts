/** Shared organization CNY wallet, immutable ledger, and one-time redemption codes. */
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, getTableColumns, gt, isNull, or, sql } from 'drizzle-orm'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { ApiEnv, Services, TenantOperation } from './application.ts'
import type { AccountId, OrganizationId } from './contracts.ts'
import type { Transaction } from './database.ts'
import * as s from './schema.ts'
import { hasRole, recordAudit, forbidden, requirePermission, requirePlatform, effectivePermissions } from './security.ts'

import { billingSummary, memberBudget } from './contracts.ts'
import { budgetMonth } from './team-governance.ts'

const amountCny = z.string().regex(/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/)
const codeInput = z.string().trim().min(16).max(128)

/** Convert a positive fixed-point CNY amount into integer micro-yuan. */
export function parseCnyMicros(value: string): number {
  const parsed = amountCny.parse(value)
  const [whole = '0', fraction = ''] = parsed.split('.')
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
  if (micros <= 0n || micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new z.ZodError([{ code: 'custom', path: ['amountCny'], message: 'amountCny is outside the supported range' }])
  }
  return Number(micros)
}

function codeHash(secret: string, code: string): string {
  return createHmac('sha256', secret).update('dsh-redemption-code\0').update(code.trim().toUpperCase()).digest('hex')
}

function newCode(): string {
  const encoded = randomBytes(24).toString('hex').toUpperCase()
  return `DSH-${encoded.slice(0, 8)}-${encoded.slice(8, 16)}-${encoded.slice(16, 24)}-${encoded.slice(24, 32)}-${encoded.slice(32)}`
}

/** Reject a new provider call unless the selected organization has a positive CNY balance. */
export async function assertWalletFunded(tx: Transaction, organizationId: OrganizationId): Promise<void> {
  const [wallet] = await tx.select({ balance: s.organizationWallets.balanceMicrosCny })
    .from(s.organizationWallets).where(eq(s.organizationWallets.organizationId, organizationId))
  if (!wallet || wallet.balance <= 0) {
    throw new HTTPException(402, { message: 'INSUFFICIENT_TEAM_BALANCE' })
  }
}

/** Lock the shared wallet in a tenant transaction.
 * @param tx Owning transaction.
 * @param organizationId Tenant identity.
 * @returns Existing wallet, locked until commit.
 */
export async function lockOrganizationWallet(tx: Transaction, organizationId: OrganizationId) {
  const [wallet] = await tx.select().from(s.organizationWallets).where(eq(s.organizationWallets.organizationId, organizationId)).for('update')
  if (!wallet) throw new Error('Organization wallet is unavailable')
  return wallet
}

/** Apply a balance under the caller's wallet lock.
 * @param tx Owning transaction.
 * @param wallet Locked row.
 * @param balance Safe integer micro-yuan.
 * @param now Transaction timestamp.
 */
export async function writeWalletBalance(
  tx: Transaction, wallet: typeof s.organizationWallets.$inferSelect, balance: number, now: Date,
): Promise<void> {
  if (!Number.isSafeInteger(balance)) throw new Error('Wallet balance exceeds the supported range')
  await tx.update(s.organizationWallets).set({ balanceMicrosCny: balance, updatedAt: now,
    version: sql`${s.organizationWallets.version} + 1` }).where(eq(s.organizationWallets.organizationId, wallet.organizationId))
}

interface UsageDebit {
  readonly organizationId: OrganizationId
  readonly usageId: string
  readonly accountId: AccountId
  readonly runtimeId?: string
  readonly amountMicrosCny: number
}

/** Append one idempotent usage debit and update the wallet in the caller's settlement transaction. */
export async function debitWalletForUsage(tx: Transaction, debit: UsageDebit): Promise<number> {
  if (!Number.isSafeInteger(debit.amountMicrosCny) || debit.amountMicrosCny < 0) {
    throw new Error('Wallet usage debit must be a nonnegative safe integer')
  }
  const [existing] = await tx.select({ balance: s.walletLedger.balanceAfterMicrosCny })
    .from(s.walletLedger).where(eq(s.walletLedger.usageId, debit.usageId))
  if (existing) return existing.balance
  const wallet = await lockOrganizationWallet(tx, debit.organizationId)
  const balance = wallet.balanceMicrosCny - debit.amountMicrosCny
  await tx.insert(s.walletLedger).values({
    id: randomUUID(),
    organizationId: debit.organizationId,
    amountMicrosCny: -debit.amountMicrosCny,
    kind: 'model_usage_debit',
    usageId: debit.usageId,
    accountId: debit.accountId,
    runtimeId: debit.runtimeId ?? null,
    balanceAfterMicrosCny: balance,
  })
  await writeWalletBalance(tx, wallet, balance, new Date())
  return balance
}

function decodeCursor(value: string): { createdAtMicros: string; id: string } {
  const [createdAtMicros, id, ...rest] = Buffer.from(value, 'base64url').toString('utf8').split('|')
  if (rest.length || !id || !createdAtMicros || !/^[0-9]+$/u.test(createdAtMicros)) {
    throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'invalid cursor' }])
  }
  return { createdAtMicros, id }
}

function encodeCursor(createdAtMicros: string, id: string): string {
  return Buffer.from(`${createdAtMicros}|${id}`, 'utf8').toString('base64url')
}

const createdAtMicros = (column: typeof s.walletLedger.createdAt | typeof s.redemptionCodes.createdAt) =>
  sql<string>`(extract(epoch from ${column}) * 1000000)::bigint::text`

const beforeCursor = (
  column: typeof s.walletLedger.createdAt | typeof s.redemptionCodes.createdAt,
  idColumn: typeof s.walletLedger.id | typeof s.redemptionCodes.id,
  cursor: ReturnType<typeof decodeCursor> | undefined,
) => cursor === undefined ? undefined : sql`(
  (extract(epoch from ${column}) * 1000000)::bigint < ${cursor.createdAtMicros}::bigint
  OR ((extract(epoch from ${column}) * 1000000)::bigint = ${cursor.createdAtMicros}::bigint AND ${idColumn} < ${cursor.id})
)`

/** Register organization wallet and platform redemption-code routes. */
export function mountWallet(app: Hono<ApiEnv>, services: Services, tenantOperation: TenantOperation): void {
  const { db, config } = services

  app.get('/v1/organizations/:organizationId/wallet', c => tenantOperation(c, async (tx, tenant) => {
    await requirePermission(tx, tenant, 'billing.read')
    const [wallet] = await tx.select().from(s.organizationWallets)
      .where(eq(s.organizationWallets.organizationId, tenant.organizationId))
    if (!wallet) throw new HTTPException(404, { message: 'Wallet not found' })
    return c.json(wallet)
  }))

  app.get('/v1/organizations/:organizationId/wallet/summary', c => tenantOperation(c, async (tx, tenant) => {
    const scope = z.enum(['own', 'organization']).default('own').parse(c.req.query('scope'))
    if (scope === 'organization') await requirePermission(tx, tenant, 'billing.read')
    const now = new Date(services.now?.() ?? Date.now())
    const [team] = await tx.select().from(s.organizations).where(eq(s.organizations.id, tenant.organizationId))
    const [member] = await tx.select().from(s.memberships).where(eq(s.memberships.id, tenant.membershipId))
    if (!team || !member) forbidden()
    const timeZone = team.nextBudgetTimeZone && team.nextBudgetTimeZoneAt && team.nextBudgetTimeZoneAt <= now
      ? team.nextBudgetTimeZone : team.resourcePolicy?.timeZone ?? 'Asia/Shanghai'
    const month = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/).parse(c.req.query('month') ?? budgetMonth(now, timeZone))
    const costs = await tx.execute(sql`
      WITH consumption AS (
        SELECT a.department_ids, u.total_cost_micros_cny AS cost, u.status = 'settled' AS settled,
          CASE WHEN u.status IN ('pending_reconciliation') THEN 1 ELSE 0 END AS pending,
          0::bigint AS estimate
        FROM enterprise.billing_attribution a JOIN enterprise.usage u ON u.id = a.id
        WHERE a.organization_id = ${tenant.organizationId} AND a.month = ${month}
          AND (${scope} = 'organization' OR a.account_id = ${tenant.actor.id})
        UNION ALL
        SELECT a.department_ids, t.final_micros_cny, t.settled_at IS NOT NULL,
          CASE WHEN t.settled_at IS NULL THEN 1 ELSE 0 END,
          CASE WHEN t.settled_at IS NULL THEN t.reserved_micros_cny ELSE 0 END
        FROM enterprise.billing_attribution a JOIN enterprise.model_task t ON t.id = a.id
        WHERE a.organization_id = ${tenant.organizationId} AND a.month = ${month}
          AND (${scope} = 'organization' OR a.account_id = ${tenant.actor.id})
      ) SELECT COALESCE(SUM(cost) FILTER (WHERE settled), 0) AS settled,
        COALESCE(SUM(pending), 0) AS pending, COALESCE(SUM(estimate), 0) AS estimate,
        COALESCE((SELECT jsonb_agg(d) FROM (
          SELECT ids.id, max(unit.name) AS name, SUM(c.cost) AS cost FROM consumption c
          CROSS JOIN LATERAL (SELECT DISTINCT value AS id FROM jsonb_array_elements_text(c.department_ids)) ids
          LEFT JOIN enterprise.org_unit unit ON unit.id = ids.id AND unit.organization_id = ${tenant.organizationId}
          WHERE c.settled GROUP BY ids.id ORDER BY ids.id
        ) d), '[]'::jsonb) AS departments FROM consumption
    `)
    const adjustments = await tx.execute(sql`
      WITH movements AS (
        SELECT kind, amount_micros_cny AS amount FROM enterprise.wallet_ledger
        WHERE organization_id = ${tenant.organizationId} AND to_char(created_at AT TIME ZONE ${timeZone}, 'YYYY-MM') = ${month}
          AND (${scope} = 'organization' OR account_id = ${tenant.actor.id})
        UNION ALL
        SELECT kind, amount_micros_cny FROM enterprise.model_task_ledger
        WHERE organization_id = ${tenant.organizationId} AND to_char(created_at AT TIME ZONE ${timeZone}, 'YYYY-MM') = ${month}
          AND (${scope} = 'organization' OR account_id = ${tenant.actor.id})
      ) SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'release'), 0) AS refund,
        COALESCE(SUM(amount) FILTER (WHERE kind IN ('manual_adjustment', 'adjustment')), 0) AS adjustment FROM movements
    `)
    const [wallet] = await tx.select().from(s.organizationWallets).where(eq(s.organizationWallets.organizationId, tenant.organizationId))
    const totals = costs[0], corrections = adjustments[0]
    if (!totals || !corrections) throw new Error('Billing totals are unavailable')
    const budget = member.budget.mode === 'inherit' ? team.resourcePolicy?.defaultBudget ?? member.budget : member.budget
    return c.json(billingSummary.parse({ scope, month, timeZone,
      balanceMicrosCny: scope === 'organization' ? wallet?.balanceMicrosCny ?? null : null,
      budget: memberBudget.parse(budget), ownerExempt: await hasRole(tx, tenant, ['owner']),
      settledMicrosCny: Number(totals.settled), pendingCount: Number(totals.pending),
      pendingEstimateMicrosCny: Number(totals.estimate), refundMicrosCny: Number(corrections.refund),
      adjustmentMicrosCny: Number(corrections.adjustment),
      departments: (totals.departments as { id: string; name: string | null; cost: string }[])
        .map(item => ({ id: item.id, name: item.name, settledMicrosCny: Number(item.cost) })), updatedAt: now.toISOString(),
    }))
  }))

  app.get('/v1/organizations/:organizationId/wallet/ledger', c => tenantOperation(c, async (tx, tenant) => {
    const query = z.object({
      scope: z.enum(['own', 'organization']).default('own'),
      cursor: z.string().max(512).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse({ scope: c.req.query('scope'), cursor: c.req.query('cursor'), limit: c.req.query('limit') })
    if (query.scope === 'organization') await requirePermission(tx, tenant, 'billing.read')
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor)
    const walletRows = await tx.select({
      ...getTableColumns(s.walletLedger),
      cursorCreatedAtMicros: createdAtMicros(s.walletLedger.createdAt),
    }).from(s.walletLedger).where(and(
      eq(s.walletLedger.organizationId, tenant.organizationId),
      query.scope === 'organization' ? undefined : eq(s.walletLedger.accountId, tenant.actor.id),
      beforeCursor(s.walletLedger.createdAt, s.walletLedger.id, cursor),
    )).orderBy(desc(s.walletLedger.createdAt), desc(s.walletLedger.id)).limit(query.limit + 1)
    const taskCreatedAtMicros = sql<string>`(extract(epoch from ${s.modelTaskLedger.createdAt}) * 1000000)::bigint::text`
    const taskBeforeCursor = cursor === undefined ? undefined : sql`(
      (extract(epoch from ${s.modelTaskLedger.createdAt}) * 1000000)::bigint < ${cursor.createdAtMicros}::bigint
      OR ((extract(epoch from ${s.modelTaskLedger.createdAt}) * 1000000)::bigint = ${cursor.createdAtMicros}::bigint AND ${s.modelTaskLedger.id} < ${cursor.id})
    )`
    const taskRows = await tx.select({
      id: s.modelTaskLedger.id,
      organizationId: s.modelTaskLedger.organizationId,
      amountMicrosCny: s.modelTaskLedger.amountMicrosCny,
      kind: sql<string>`'model_task_' || ${s.modelTaskLedger.kind}`,
      usageId: sql<string | null>`NULL`,
      redemptionCodeId: sql<string | null>`NULL`,
      accountId: s.modelTaskLedger.accountId,
      runtimeId: s.modelTaskLedger.runtimeId,
      balanceAfterMicrosCny: s.modelTaskLedger.balanceAfterMicrosCny,
      createdAt: s.modelTaskLedger.createdAt,
      taskId: s.modelTaskLedger.taskId,
      cursorCreatedAtMicros: taskCreatedAtMicros,
    }).from(s.modelTaskLedger).where(and(
      eq(s.modelTaskLedger.organizationId, tenant.organizationId),
      query.scope === 'organization' ? undefined : eq(s.modelTaskLedger.accountId, tenant.actor.id),
      taskBeforeCursor,
    )).orderBy(desc(s.modelTaskLedger.createdAt), desc(s.modelTaskLedger.id)).limit(query.limit + 1)
    const combined = [
      ...walletRows.map(row => ({ ...row, taskId: null as string | null })),
      ...taskRows,
    ].sort((left, right) => {
      const timeOrder = BigInt(right.cursorCreatedAtMicros) - BigInt(left.cursorCreatedAtMicros)
      return timeOrder === 0n ? right.id.localeCompare(left.id) : timeOrder > 0n ? 1 : -1
    })
    const hasMore = combined.length > query.limit
    const pageWithCursor = combined.slice(0, query.limit)
    const showBalance = (await effectivePermissions(tx, tenant)).includes('billing.read')
    const page = pageWithCursor.map(({ cursorCreatedAtMicros: _, ...item }) => ({ ...item,
      balanceAfterMicrosCny: showBalance ? item.balanceAfterMicrosCny : null }))
    const last = pageWithCursor.at(-1)
    return c.json({
      items: page,
      nextCursor: hasMore && last ? encodeCursor(last.cursorCreatedAtMicros, last.id) : null,
      currency: 'CNY' as const,
    })
  }))

  app.post('/v1/organizations/:organizationId/wallet/redeem', async (c) => {
    const input = z.object({ code: codeInput }).strict().parse(await c.req.json())
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await requirePermission(tx, tenant, 'billing.read')
      const hash = codeHash(config.authSecret, input.code)
      const [redemption] = await tx.select().from(s.redemptionCodes)
        .where(eq(s.redemptionCodes.codeHash, hash)).for('update')
      const now = new Date()
      if (!redemption) throw new HTTPException(400, { message: 'INVALID_REDEMPTION_CODE' })
      if (redemption.revokedAt) throw new HTTPException(409, { message: 'REDEMPTION_CODE_REVOKED' })
      if (redemption.redeemedAt) throw new HTTPException(409, { message: 'REDEMPTION_CODE_REDEEMED' })
      if (redemption.expiresAt && redemption.expiresAt <= now) {
        throw new HTTPException(409, { message: 'REDEMPTION_CODE_EXPIRED' })
      }
      const [wallet] = await tx.select().from(s.organizationWallets)
        .where(eq(s.organizationWallets.organizationId, tenant.organizationId)).for('update')
      if (!wallet) throw new Error('Organization wallet is unavailable')
      const balance = wallet.balanceMicrosCny + redemption.amountMicrosCny
      await tx.update(s.redemptionCodes).set({
        redeemedAt: now,
        redeemedBy: tenant.actor.id,
        redeemedOrganizationId: tenant.organizationId,
      }).where(eq(s.redemptionCodes.id, redemption.id))
      await tx.insert(s.walletLedger).values({
        id: randomUUID(),
        organizationId: tenant.organizationId,
        amountMicrosCny: redemption.amountMicrosCny,
        kind: 'redemption_credit',
        redemptionCodeId: redemption.id,
        accountId: tenant.actor.id,
        balanceAfterMicrosCny: balance,
      })
      await tx.update(s.organizationWallets).set({
        balanceMicrosCny: balance,
        updatedAt: now,
        version: sql`${s.organizationWallets.version} + 1`,
      }).where(eq(s.organizationWallets.organizationId, tenant.organizationId))
      await recordAudit(tx, tenant, 'wallet.redeemed', redemption.id, {
        amountMicrosCny: redemption.amountMicrosCny,
        balanceAfterMicrosCny: balance,
      })
      return { balanceMicrosCny: balance, creditedMicrosCny: redemption.amountMicrosCny, currency: 'CNY' as const }
    }), 200)
  })

  app.post('/v1/platform/redemption-code-batches', async (c) => {
    const input = z.object({
      amountCny,
      count: z.number().int().min(1).max(1000),
      expiresAt: z.iso.datetime().optional(),
      note: z.string().trim().min(1).max(500).optional(),
    }).strict().parse(await c.req.json())
    const amountMicrosCny = parseCnyMicros(input.amountCny)
    const expiresAt = input.expiresAt === undefined ? null : new Date(input.expiresAt)
    if (expiresAt !== null && expiresAt <= new Date()) {
      throw new HTTPException(400, { message: 'Expiration must be in the future' })
    }
    const batchId = randomUUID()
    const plaintext = Array.from({ length: input.count }, () => newCode())
    await db.transaction(async (tx) => {
      const actor = c.get('actor')
      await requirePlatform(tx, actor)
      await tx.insert(s.redemptionCodes).values(plaintext.map(code => ({
        id: randomUUID(),
        batchId,
        codeHash: codeHash(config.authSecret, code),
        codeHint: code.slice(-8),
        amountMicrosCny,
        note: input.note ?? null,
        createdBy: actor.id,
        expiresAt,
      })))
    })
    return c.json({ batchId, amountMicrosCny, codes: plaintext, expiresAt }, 201)
  })

  app.get('/v1/platform/redemption-codes', async (c) => {
    const query = z.object({
      batchId: z.uuid().optional(),
      status: z.enum(['available', 'redeemed', 'revoked', 'expired']).optional(),
      cursor: z.string().max(512).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }).parse({ batchId: c.req.query('batchId'), status: c.req.query('status'), cursor: c.req.query('cursor'), limit: c.req.query('limit') })
    const now = new Date()
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor)
    const before = beforeCursor(s.redemptionCodes.createdAt, s.redemptionCodes.id, cursor)
    const status = query.status === undefined ? undefined
      : query.status === 'available' ? and(isNull(s.redemptionCodes.redeemedAt), isNull(s.redemptionCodes.revokedAt), or(isNull(s.redemptionCodes.expiresAt), gt(s.redemptionCodes.expiresAt, now)))
        : query.status === 'redeemed' ? sql`${s.redemptionCodes.redeemedAt} IS NOT NULL`
          : query.status === 'revoked' ? sql`${s.redemptionCodes.revokedAt} IS NOT NULL`
            : and(sql`${s.redemptionCodes.expiresAt} <= ${now}`, isNull(s.redemptionCodes.redeemedAt), isNull(s.redemptionCodes.revokedAt))
    const rows = await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      return tx.select({
        id: s.redemptionCodes.id,
        batchId: s.redemptionCodes.batchId,
        codeHint: s.redemptionCodes.codeHint,
        amountMicrosCny: s.redemptionCodes.amountMicrosCny,
        note: s.redemptionCodes.note,
        createdBy: s.redemptionCodes.createdBy,
        expiresAt: s.redemptionCodes.expiresAt,
        revokedAt: s.redemptionCodes.revokedAt,
        redeemedAt: s.redemptionCodes.redeemedAt,
        redeemedBy: s.redemptionCodes.redeemedBy,
        redeemedOrganizationId: s.redemptionCodes.redeemedOrganizationId,
        createdAt: s.redemptionCodes.createdAt,
        cursorCreatedAtMicros: createdAtMicros(s.redemptionCodes.createdAt),
      }).from(s.redemptionCodes).where(and(
        query.batchId === undefined ? undefined : eq(s.redemptionCodes.batchId, query.batchId),
        status,
        before,
      )).orderBy(desc(s.redemptionCodes.createdAt), desc(s.redemptionCodes.id)).limit(query.limit + 1)
    })
    const hasMore = rows.length > query.limit
    const page = hasMore ? rows.slice(0, query.limit) : rows
    const items = page.map(({ cursorCreatedAtMicros: _, ...item }) => item)
    const last = items.at(-1)
    const lastCursor = page.at(-1)
    return c.json({
      items,
      nextCursor: hasMore && last && lastCursor ? encodeCursor(lastCursor.cursorCreatedAtMicros, last.id) : null,
      currency: 'CNY' as const,
    })
  })

  app.post('/v1/platform/redemption-codes/:id/revoke', async (c) => {
    const id = z.uuid().parse(c.req.param('id'))
    return c.json(await db.transaction(async (tx) => {
      await requirePlatform(tx, c.get('actor'))
      const rows = await tx.update(s.redemptionCodes).set({ revokedAt: new Date() }).where(and(
        eq(s.redemptionCodes.id, id),
        sql`${s.redemptionCodes.redeemedAt} IS NULL`,
        sql`${s.redemptionCodes.revokedAt} IS NULL`,
      )).returning({ id: s.redemptionCodes.id, revokedAt: s.redemptionCodes.revokedAt })
      if (!rows[0]) throw new HTTPException(409, { message: 'REDEMPTION_CODE_NOT_REVOCABLE' })
      return rows[0]
    }))
  })
}
