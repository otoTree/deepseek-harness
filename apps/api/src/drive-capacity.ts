/** Team and personal-workspace byte accounting with durable object cleanup. */
import { randomUUID } from 'node:crypto'
import { and, eq, lte, sql } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import type { Services } from './application.ts'
import type { Transaction } from './database.ts'
import { selectOrganization } from './database.ts'
import { organizationId } from './contracts.ts'
import { lockOrganization } from './security.ts'
import * as s from './schema.ts'
import { driveObjectKey } from './drive-storage.ts'

/**
 * Read all retained versions and uncommitted uploads charged to a team or personal workspace.
 * @param tx Team-selected transaction.
 * @param teamId Owning team.
 * @param accountId Optional personal-workspace owner; omitted includes every team space.
 * @returns Byte totals, including deleted files and uploads awaiting cleanup.
 */
export async function driveCapacity(tx: Transaction, teamId: string, accountId?: string) {
  const spaceWhere = sql`s.organization_id = ${teamId} ${accountId === undefined ? sql``
    : sql`AND s.account_id = ${accountId} AND s.kind = 'personal'`}`
  const rows = await tx.execute(sql`
    WITH RECURSIVE trashed AS (
      SELECT n.id FROM enterprise.drive_node n JOIN enterprise.drive_space s ON s.id = n.space_id
      WHERE ${spaceWhere} AND n.deleted_at IS NOT NULL
      UNION
      SELECT n.id FROM enterprise.drive_node n JOIN trashed p ON n.parent_id = p.id
    ) SELECT COALESCE(SUM(v.size), 0) AS used,
      COALESCE(SUM(v.size) FILTER (WHERE n.id IN (SELECT id FROM trashed)), 0) AS trash,
      COALESCE(SUM(v.size) FILTER (WHERE v.id IS DISTINCT FROM n.version_id), 0) AS versions
    FROM enterprise.drive_version v JOIN enterprise.drive_node n ON n.id = v.node_id
    JOIN enterprise.drive_space s ON s.id = n.space_id WHERE ${spaceWhere}
  `)
  const pending = await tx.execute(sql`SELECT COALESCE(SUM(u.expected_size), 0) AS reserved
    FROM enterprise.drive_upload u JOIN enterprise.drive_space s ON s.id = u.space_id
    WHERE ${spaceWhere} AND u.status IN ('created','cancel_pending')`)
  return { usedBytes: Number(rows[0]?.used ?? 0), trashBytes: Number(rows[0]?.trash ?? 0),
    versionBytes: Number(rows[0]?.versions ?? 0), uploadBytes: Number(pending[0]?.reserved ?? 0) }
}

/**
 * Serialize capacity admission against team policy, existing versions, and pending uploads.
 * @param tx Transaction that inserts or transfers storage records.
 * @param space Destination workspace.
 * @param incomingBytes Additional retained bytes.
 * @param teamIncomingBytes Additional team bytes; transfers within one team pass zero.
 * @returns Completion if team and member space limits both permit the operation.
 */
export async function assertDriveCapacity(tx: Transaction, space: typeof s.driveSpaces.$inferSelect,
  incomingBytes: number, teamIncomingBytes = incomingBytes): Promise<void> {
  if (!space.organizationId) throw new HTTPException(409, { message: 'DRIVE_TEAM_REQUIRED' })
  const teamId = organizationId.parse(space.organizationId)
  await lockOrganization(tx, teamId)
  const [team] = await tx.select().from(s.organizations).where(eq(s.organizations.id, teamId))
  if (!team) throw new HTTPException(404, { message: 'TEAM_UNAVAILABLE' })
  const total = await driveCapacity(tx, teamId)
  if (!team.resourcePolicy) {
    if (incomingBytes > 0 || teamIncomingBytes > 0) throw new HTTPException(409, { message: 'TEAM_SETUP_REQUIRED' })
    return
  }
  const limit = team.resourcePolicy.storageBytes
  if (teamIncomingBytes > 0 && total.usedBytes + total.uploadBytes + teamIncomingBytes > limit) throw new HTTPException(413, { message: 'TEAM_STORAGE_EXHAUSTED' })
  if (space.kind === 'personal' && space.accountId) {
    const [member] = await tx.select().from(s.memberships).where(and(eq(s.memberships.organizationId, teamId),
      eq(s.memberships.accountId, space.accountId)))
    const memberLimit = member?.storageLimitBytes ?? team.resourcePolicy.personalStorageBytes
    const personal = await driveCapacity(tx, teamId, space.accountId)
    if (incomingBytes > 0 && personal.usedBytes + personal.uploadBytes + incomingBytes > memberLimit) {
      throw new HTTPException(413, { message: 'MEMBER_STORAGE_EXHAUSTED' })
    }
  }
}

/**
 * Delete expired uploads and explicitly purged objects, retaining capacity until storage confirms deletion.
 * @param services Database, storage, clock, and configured batch limit.
 * @param signal Application disposal signal.
 * @returns Number of completed cleanup entries.
 */
export async function cleanupDrive(services: Services, signal: AbortSignal): Promise<number> {
  if (!services.driveObjects) return 0
  const objects = services.driveObjects
  const now = new Date(services.now?.() ?? Date.now())
  const expired = await services.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
    return tx.select().from(s.driveUploads).where(sql`(${s.driveUploads.status} IN ('created','cancel_pending') AND ${s.driveUploads.expiresAt} <= ${now.toISOString()}::timestamptz)
      OR (${s.driveUploads.stagingCleanupAt} <= ${now.toISOString()}::timestamptz AND ${s.driveUploads.status} IN ('committed','expired'))`)
      .orderBy(s.driveUploads.stagingCleanupAt).limit(services.config.driveCleanupBatch)
  })
  for (const candidate of expired) {
    await services.db.transaction(async (tx) => {
      const teamId = organizationId.parse(candidate.organizationId)
      await selectOrganization(tx, teamId)
      await lockOrganization(tx, teamId)
      const [upload] = await tx.select().from(s.driveUploads).where(and(eq(s.driveUploads.id, candidate.id),
        lte(s.driveUploads.expiresAt, now)))
      if (!upload) return
      await tx.insert(s.driveCleanup).values({ id: randomUUID(), organizationId: upload.organizationId, objectKey: upload.objectKey,
        uploadId: upload.id }).onConflictDoNothing()
      if (upload.status !== 'committed') {
        await tx.update(s.driveUploads).set({ status: 'cancel_pending' }).where(eq(s.driveUploads.id, upload.id))
        const nodeId = upload.nodeId ?? upload.reservedNodeId
        if (nodeId && upload.objectKey.startsWith('drive-staging/')) await tx.insert(s.driveCleanup).values({ id: randomUUID(),
          organizationId: upload.organizationId, objectKey: driveObjectKey(upload.spaceId, nodeId,
            upload.versionId) }).onConflictDoNothing()
      }
    })
  }
  await services.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
    const assets = await tx.select().from(s.modelAssets).where(lte(s.modelAssets.expiresAt, now)).limit(services.config.driveCleanupBatch)
    for (const asset of assets) await tx.insert(s.driveCleanup).values({ id: randomUUID(), organizationId: asset.organizationId,
      objectKey: asset.objectKey, assetId: asset.id }).onConflictDoNothing()
  })
  const jobs = await services.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
    return tx.select().from(s.driveCleanup).orderBy(sql`COALESCE(${s.driveCleanup.lastAttemptAt}, ${s.driveCleanup.createdAt})`, s.driveCleanup.id).limit(services.config.driveCleanupBatch)
  })
  let completed = 0
  for (const job of jobs) {
    signal.throwIfAborted()
    try {
      await services.db.transaction(async (tx) => {
        await selectOrganization(tx, organizationId.parse(job.organizationId))
        await lockOrganization(tx, organizationId.parse(job.organizationId))
        const [current] = await tx.select().from(s.driveCleanup).where(eq(s.driveCleanup.id, job.id))
        if (!current) return
        await objects.delete(job.objectKey)
        if (job.versionId) {
          await tx.delete(s.driveDescriptions).where(eq(s.driveDescriptions.versionId, job.versionId))
          await tx.update(s.driveNodes).set({ versionId: null }).where(and(eq(s.driveNodes.versionId, job.versionId),
            sql`${s.driveNodes.purgeRequestedAt} IS NOT NULL`))
          await tx.delete(s.driveVersions).where(eq(s.driveVersions.id, job.versionId))
        }
        if (job.assetId) await tx.delete(s.modelAssets).where(eq(s.modelAssets.id, job.assetId))
        if (job.uploadId) {
          const [upload] = await tx.select().from(s.driveUploads).where(eq(s.driveUploads.id, job.uploadId))
          if (upload) await tx.update(s.driveUploads).set({ status: upload.status === 'committed' ? 'committed' : 'expired',
            stagingCleanupAt: upload.objectKey.startsWith('drive-staging/') ? new Date(now.getTime() + services.config.driveStagingSweepSeconds * 1000) : null,
          }).where(eq(s.driveUploads.id, upload.id))
        }
        await tx.delete(s.driveCleanup).where(eq(s.driveCleanup.id, job.id))
      })
      completed++
    } catch (error) {
      await services.db.transaction(async (tx) => {
        await selectOrganization(tx, organizationId.parse(job.organizationId))
        await tx.update(s.driveCleanup).set({ error: error instanceof Error ? error.name : 'StorageError', lastAttemptAt: now }).where(eq(s.driveCleanup.id, job.id))
      })
    }
  }
  const teams = await services.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('enterprise.platform_admin', 'true', true)`)
    return tx.execute(sql`SELECT DISTINCT s.organization_id FROM enterprise.drive_node n
      JOIN enterprise.drive_space s ON s.id = n.space_id WHERE n.purge_requested_at IS NOT NULL`)
  })
  for (const team of teams) {
    await services.db.transaction(async (tx) => {
      const teamId = organizationId.parse(team.organization_id)
      await selectOrganization(tx, teamId)
      await lockOrganization(tx, teamId)
      // Delete leaves only: a folder's cascade must never release retained child objects.
      for (;;) {
        const deleted = await tx.execute(sql`DELETE FROM enterprise.drive_node n
          USING enterprise.drive_space s WHERE n.space_id = s.id AND s.organization_id = ${teamId}
          AND n.purge_requested_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM enterprise.drive_node child WHERE child.parent_id = n.id)
          AND NOT EXISTS (SELECT 1 FROM enterprise.drive_version v WHERE v.node_id = n.id)
          AND NOT EXISTS (SELECT 1 FROM enterprise.drive_upload u WHERE (u.node_id = n.id OR u.parent_id = n.id)
            AND u.status IN ('created','cancel_pending')) RETURNING n.id`)
        if (!deleted.length) break
      }
    })
  }
  return completed
}
