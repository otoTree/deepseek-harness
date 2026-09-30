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
import { recordAudit, requirePlatform } from './security.ts'

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
  const [wallet] = await tx.select().from(s.organizationWallets)
    .where(eq(s.organizationWallets.organizationId, debit.organizationId)).for('update')
  if (!wallet) throw new Error('Organization wallet is unavailable')
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
  await tx.update(s.organizationWallets).set({
    balanceMicrosCny: balance,
    updatedAt: new Date(),
    version: sql`${s.organizationWallets.version} + 1`,
  }).where(eq(s.organizationWallets.organizationId, debit.organizationId))
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
    const [wallet] = await tx.select().from(s.organizationWallets)
      .where(eq(s.organizationWallets.organizationId, tenant.organizationId))
    if (!wallet) throw new HTTPException(404, { message: 'Wallet not found' })
    return c.json(wallet)
  }))

  app.get('/v1/organizations/:organizationId/wallet/ledger', c => tenantOperation(c, async (tx, tenant) => {
  const query = z.object({
      cursor: z.string().max(512).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
  }).parse({ cursor: c.req.query('cursor'), limit: c.req.query('limit') })
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor)
    const walletRows = await tx.select({
      ...getTableColumns(s.walletLedger),
      cursorCreatedAtMicros: createdAtMicros(s.walletLedger.createdAt),
    }).from(s.walletLedger).where(and(
      eq(s.walletLedger.organizationId, tenant.organizationId),
      eq(s.walletLedger.accountId, tenant.actor.id),
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
      eq(s.modelTaskLedger.accountId, tenant.actor.id),
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
    const page = pageWithCursor.map(({ cursorCreatedAtMicros: _, ...item }) => item)
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
