/* oxlint-disable @stylistic/max-len -- Drive route schemas and SQL expressions mirror the wire/API contract. */
/** Enterprise cloud-drive HTTP routes, permissions, versioning and descriptions. */
import { assertDriveCapacity, driveCapacity } from './drive-capacity.ts'
import { randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import * as s from './schema.ts'
import * as wire from './contracts.ts'
import type { Transaction } from './database.ts'
import { effectivePermissions, forbidden, lockOrganization, requirePermission, type Tenant } from './security.ts'
import type { DriveObjectMetadata } from './drive-storage.ts'
import { driveObjectKey } from './drive-storage.ts'
import type { ApiEnv, Services, TenantOperation } from './application.ts'

const cursorSchema = z.object({
  spaceId: wire.resourceId, shared: z.boolean(),
  query: z.string().default(''), parentId: z.string().nullable(), sort: z.enum(['name', 'updatedAt']).default('name'),
  value: z.string(), id: z.string(),
}).strict()
const listInput = z.object({ spaceId: wire.resourceId, parentId: wire.resourceId.nullable().default(null), cursor: z.string().max(2048).optional(), sort: z.enum(['name', 'updatedAt']).default('name'), limit: z.coerce.number().int().min(1).max(100).default(50), shared: z.coerce.boolean().optional() }).strict()
const searchInput = z.object({ spaceId: wire.resourceId, query: z.string().trim().min(1).max(200), cursor: z.string().max(2048).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), shared: z.coerce.boolean().optional() }).strict()
const folderInput = z.object({ spaceId: wire.resourceId, parentId: wire.resourceId.nullable(), name: z.string().trim().min(1).max(255) }).strict()
const uploadInput = z.object({ spaceId: wire.resourceId, nodeId: wire.resourceId.optional(), parentId: wire.resourceId.nullable().default(null), name: z.string().trim().min(1).max(255), size: z.number().int().nonnegative(), contentType: z.string().min(1).max(255), checksum: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict()
const commitInput = z.object({ uploadId: wire.resourceId, baseVersionId: wire.resourceId.optional() }).strict()
const versionInput = z.object({ nodeId: wire.resourceId, baseVersionId: wire.resourceId.nullable(), size: z.number().int().nonnegative(), contentType: z.string().min(1).max(255), checksum: z.string().regex(/^[a-f0-9]{64}$/), uploadId: wire.resourceId }).strict()
const nodeInput = z.object({ confirmSharing: z.boolean().optional(), spaceId: wire.resourceId, nodeId: wire.resourceId, name: z.string().trim().min(1).max(255).optional(), parentId: wire.resourceId.nullable().optional(), baseVersionId: wire.resourceId.nullable().optional() }).strict()
const descriptionInput = z.object({ nodeId: wire.resourceId, versionId: wire.resourceId.nullable(), type: z.string().trim().min(1).max(80), content: z.string().max(100_000), fields: z.record(z.string(), z.json()).optional(), source: z.enum(['user', 'agent', 'import']), reference: z.record(z.string(), z.json()).optional(), baseUpdatedAt: z.iso.datetime().optional() }).strict()
const editSessionInput = z.object({ baseVersionId: wire.resourceId }).strict()
const changeCursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.string() }).strict()
const changeInput = z.object({
  spaceId: wire.resourceId,
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict()

function encodeCursor(value: z.input<typeof cursorSchema>): string { return Buffer.from(JSON.stringify(value)).toString('base64url') }
function decodeCursor(value: string): z.infer<typeof cursorSchema> { return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))) }
function encodeChangeCursor(value: z.input<typeof changeCursorSchema>): string { return Buffer.from(JSON.stringify(value)).toString('base64url') }
function decodeChangeCursor(value: string): z.infer<typeof changeCursorSchema> { return changeCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))) }
function readable(role: string): boolean { return ['owner', 'admin', 'administrator', 'member', 'viewer'].includes(role) }
function writable(role: string): boolean { return ['owner', 'admin', 'administrator', 'member'].includes(role) }

async function assertNameAvailable(tx: Transaction, spaceId: string, parentId: string | null, name: string, exceptId?: string): Promise<void> {
  const rows = await tx.select({ id: s.driveNodes.id }).from(s.driveNodes).where(and(eq(s.driveNodes.spaceId, spaceId), parentId === null ? isNull(s.driveNodes.parentId) : eq(s.driveNodes.parentId, parentId), eq(s.driveNodes.name, name), exceptId === undefined ? undefined : sql`${s.driveNodes.id} <> ${exceptId}`)).limit(1)
  if (rows.length > 0) throw new HTTPException(409, { message: 'A file or folder with this name already exists' })
}

function fileNameParts(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? { stem: name.slice(0, dot), extension: name.slice(dot) } : { stem: name, extension: '' }
}

/** Build one bounded duplicate name while preserving the final extension. */
export function duplicateUploadName(name: string, index: number): string {
  const { stem, extension } = fileNameParts(name)
  const suffix = index === 0 ? '' : ` (${index})`
  const maxStemLength = Math.max(1, 255 - suffix.length - extension.length)
  return `${stem.slice(0, maxStemLength)}${suffix}${extension}`
}

/** Pick the first server-owned duplicate name without changing an existing file version. */
async function availableUploadName(tx: Transaction, spaceId: string, parentId: string | null, name: string): Promise<string> {
  for (let index = 0; index <= 10_000; index += 1) {
    const candidate = duplicateUploadName(name, index)
    const nodeRows = await tx.select({ id: s.driveNodes.id }).from(s.driveNodes).where(and(eq(s.driveNodes.spaceId, spaceId), parentId === null ? isNull(s.driveNodes.parentId) : eq(s.driveNodes.parentId, parentId), eq(s.driveNodes.name, candidate))).limit(1)
    if (nodeRows.length > 0) continue
    const uploadRows = await tx.select({ id: s.driveUploads.id }).from(s.driveUploads).where(and(eq(s.driveUploads.spaceId, spaceId), parentId === null ? isNull(s.driveUploads.parentId) : eq(s.driveUploads.parentId, parentId), eq(s.driveUploads.expectedName, candidate), eq(s.driveUploads.status, 'created'), gt(s.driveUploads.expiresAt, new Date()))).limit(1)
    if (uploadRows.length === 0) return candidate
  }
  throw new HTTPException(409, { message: 'No available name for this file' })
}


function nodeAccess(tenant: Tenant, id = sql`${s.driveNodes.id}`) {
  return sql<number>`COALESCE(enterprise.drive_node_access(${id}, ${tenant.actor.id}, ${tenant.organizationId}), 0)`
}

function privatePolicy(tenant: Tenant): wire.DriveSharingPolicy {
  return { organizationId: tenant.organizationId, scope: 'private', permission: 'viewer', memberIds: [], departments: [] }
}

async function resolveSpace(tx: Transaction, tenant: Tenant, spaceId: string): Promise<{ space: typeof s.driveSpaces.$inferSelect; role: 'owner' | 'admin' | 'member' | 'viewer' }> {
  const [space] = await tx.select().from(s.driveSpaces).where(eq(s.driveSpaces.id, spaceId))
  if (!space || space.organizationId !== tenant.organizationId) forbidden()
  if (space.kind === 'personal') {
    if (space.accountId === tenant.actor.id) return { space, role: 'owner' }
    const [shared] = await tx.select({ id: s.driveNodes.id }).from(s.driveNodes).where(and(eq(s.driveNodes.spaceId, spaceId), gt(nodeAccess(tenant), 0))).limit(1)
    if (!shared) forbidden()
    return { space, role: 'viewer' }
  }
  if (space.organizationId !== tenant.organizationId) forbidden()
  const permissions = await effectivePermissions(tx, tenant)
  const role = permissions.includes('storage.write') ? 'member' : 'viewer'
  return { space, role }
}

async function resolveNode(tx: Transaction, tenant: Tenant, nodeId: string, allowDeleted = false, allowCustodian = false): Promise<{ node: typeof s.driveNodes.$inferSelect; role: 'owner' | 'member' | 'viewer' }> {
  const [resolved] = await tx.select({ node: s.driveNodes, access: nodeAccess(tenant) }).from(s.driveNodes).where(eq(s.driveNodes.id, nodeId))
  if (resolved && allowCustodian && !resolved.node.purgeRequestedAt) {
    const [space] = await tx.select().from(s.driveSpaces).where(and(eq(s.driveSpaces.id, resolved.node.spaceId),
      eq(s.driveSpaces.organizationId, tenant.organizationId), eq(s.driveSpaces.custodianAccountId, tenant.actor.id)))
    if (space && (allowDeleted || !resolved.node.deletedAt)) return { node: resolved.node, role: 'owner' }
  }
  if (!resolved || resolved.node.purgeRequestedAt || resolved.access === 0 || (!allowDeleted && resolved.node.deletedAt !== null)) forbidden()
  return { node: resolved.node, role: resolved.access === 3 ? 'owner' : resolved.access === 2 ? 'member' : 'viewer' }
}

async function destination(tx: Transaction, tenant: Tenant, spaceId: string, parentId: string | null): Promise<void> {
  if (parentId === null) {
    const { space, role } = await resolveSpace(tx, tenant, spaceId)
    if (!writable(role) || (space.kind === 'personal' && space.accountId !== tenant.actor.id)) forbidden()
    return
  }
  const parent = await resolveNode(tx, tenant, parentId)
  if (!writable(parent.role) || parent.node.spaceId !== spaceId || parent.node.kind !== 'folder' || parent.node.deletedAt) forbidden()
}

async function sharingState(tx: Transaction, tenant: Tenant, nodeId: string) {
  const resolved = await resolveNode(tx, tenant, nodeId)
  const rows = await tx.execute<{ id: string; sharing: unknown }>(sql`
    WITH RECURSIVE lineage AS (
      SELECT id, parent_id, sharing, ARRAY[id] AS visited, 0 AS distance FROM enterprise.drive_node WHERE id = ${nodeId}
      UNION ALL
      SELECT p.id, p.parent_id, p.sharing, c.visited || p.id, c.distance + 1
      FROM enterprise.drive_node p JOIN lineage c ON p.id = c.parent_id WHERE NOT p.id = ANY(c.visited)
    ) SELECT id, sharing FROM lineage WHERE sharing IS NOT NULL ORDER BY distance LIMIT 1
  `)
  const effective = rows[0]
  return {
    policy: effective === undefined ? privatePolicy(tenant) : wire.driveSharingPolicy.parse(effective.sharing),
    inheritedFrom: effective !== undefined && effective.id !== nodeId ? effective.id : null,
    audienceCount: (await tx.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM enterprise.membership m
      WHERE m.organization_id = ${tenant.organizationId} AND m.status = 'active'
      AND enterprise.drive_node_access(${nodeId}, m.account_id, ${tenant.organizationId}) > 0`))[0]?.count ?? 0,
    canManage: resolved.role === 'owner', role: resolved.role,
  }
}

function publicNode(node: typeof s.driveNodes.$inferSelect) {
  return { id: node.id, spaceId: node.spaceId, sharing: node.sharing, parentId: node.parentId, name: node.name, kind: node.kind, size: node.size, contentType: node.contentType, versionId: node.versionId, updatedAt: node.updatedAt.toISOString(), deletedAt: node.deletedAt?.toISOString() ?? null }
}

async function audit(
  tx: Transaction,
  tenant: Tenant,
  action: string,
  detail: Record<string, unknown>,
  resource: { spaceId?: string; nodeId?: string; versionId?: string; descriptionId?: string } = {},
): Promise<void> {
  await tx.insert(s.driveAudit).values({
    id: randomUUID(), organizationId: tenant.organizationId, actorId: tenant.actor.id, action, detail,
    ...resource,
  })
}

/** Mount all cloud-drive routes under the tenant organization path. */
export function mountDrive(app: Hono<ApiEnv>, services: Services, tenantOperation: TenantOperation): void {
  const now = () => new Date(services.now?.() ?? Date.now())
  const objects = services.driveObjects
  const config = services.config
  const operation = (c: Context<ApiEnv>, run: (tx: Transaction, tenant: Tenant) => Promise<unknown>) => tenantOperation(c, run)
  app.get('/v1/organizations/:organizationId/drive/spaces', async c => c.json(await operation(c, async (tx, tenant) => {
    await lockOrganization(tx, tenant.organizationId)
    const personalRows = await tx.select().from(s.driveSpaces).where(and(eq(s.driveSpaces.accountId, tenant.actor.id), eq(s.driveSpaces.kind, 'personal'), eq(s.driveSpaces.organizationId, tenant.organizationId)))
    const organizationRows = await tx.select().from(s.driveSpaces).where(and(eq(s.driveSpaces.organizationId, tenant.organizationId), eq(s.driveSpaces.kind, 'organization')))
    const spaces = [...personalRows, ...organizationRows]
    if (spaces.length === 0 || personalRows.length === 0) {
      const [created] = await tx.insert(s.driveSpaces).values({ id: randomUUID(), organizationId: tenant.organizationId, accountId: tenant.actor.id, kind: 'personal', name: 'Personal space' }).returning()
      if (created) spaces.unshift(created)
    }
    if (organizationRows.length === 0) {
      const [created] = await tx.insert(s.driveSpaces).values({ id: randomUUID(), organizationId: tenant.organizationId, kind: 'organization', name: 'Organization space' }).returning()
      if (created) spaces.push(created)
    }
    const fallback = spaces[0]
    if (fallback === undefined) throw new HTTPException(500, { message: 'Drive space initialization failed' })
    const role = await resolveSpace(tx, tenant, spaces.find(item => item.kind === 'organization')?.id ?? fallback.id)
    return spaces.map(item => ({ id: item.id, kind: item.kind, name: item.name, role: item.kind === 'personal' ? 'owner' : role.role }))
  })))
  app.get('/v1/organizations/:organizationId/drive/capacity', async c => c.json(await operation(c, async (tx, tenant) => {
    const [team] = await tx.select().from(s.organizations).where(eq(s.organizations.id, tenant.organizationId))
    const [member] = await tx.select().from(s.memberships).where(eq(s.memberships.id, tenant.membershipId))
    return { team: { ...await driveCapacity(tx, tenant.organizationId), limitBytes: team?.resourcePolicy?.storageBytes
      ?? null }, personal: { ...await driveCapacity(tx, tenant.organizationId, tenant.actor.id),
      limitBytes: member?.storageLimitBytes ?? team?.resourcePolicy?.personalStorageBytes ?? null },
    updatedAt: now().toISOString() }
  })))
  app.delete('/v1/organizations/:organizationId/drive/uploads/:id', async c => c.json(await operation(c, async (tx, tenant) => {
    await lockOrganization(tx, tenant.organizationId)
    const [upload] = await tx.select().from(s.driveUploads).where(and(eq(s.driveUploads.id, wire.resourceId.parse(c.req.param('id'))),
      eq(s.driveUploads.organizationId, tenant.organizationId), eq(s.driveUploads.createdBy, tenant.actor.id)))
    if (!upload || upload.status !== 'created') forbidden()
    await tx.update(s.driveUploads).set({ status: 'cancel_pending' }).where(eq(s.driveUploads.id, upload.id))
    return { id: upload.id, status: 'cancel_pending', releasesAfter: upload.expiresAt.toISOString() }
  })))
  app.delete('/v1/organizations/:organizationId/drive/files/:id/permanent', async c => c.json(await operation(c, async (tx, tenant) => {
    await lockOrganization(tx, tenant.organizationId)
    const resolved = await resolveNode(tx, tenant, wire.resourceId.parse(c.req.param('id')), true, true)
    if (resolved.role !== 'owner' || !resolved.node.deletedAt) forbidden()
    const nodes = await tx.execute(sql`WITH RECURSIVE children AS (
      SELECT id FROM enterprise.drive_node WHERE id = ${resolved.node.id}
      UNION ALL SELECT n.id FROM enterprise.drive_node n JOIN children c ON n.parent_id = c.id
    ) SELECT id FROM children`)
    for (const node of nodes) {
      const nodeId = String(node.id)
      await tx.update(s.driveNodes).set({ purgeRequestedAt: now() }).where(eq(s.driveNodes.id, nodeId))
      await tx.update(s.driveUploads).set({ status: 'cancel_pending' }).where(and(
        or(eq(s.driveUploads.nodeId, nodeId), eq(s.driveUploads.parentId, nodeId)), eq(s.driveUploads.status, 'created')))
      const versions = await tx.select().from(s.driveVersions).where(eq(s.driveVersions.nodeId, nodeId))
      for (const version of versions) await tx.insert(s.driveCleanup).values({ id: randomUUID(), organizationId: tenant.organizationId,
        objectKey: version.objectKey, versionId: version.id, nodeId }).onConflictDoNothing()
    }
    await audit(tx, tenant, 'drive.file.purge_requested', { spaceId: resolved.node.spaceId, nodeId: resolved.node.id })
    return { id: resolved.node.id, status: 'purging' }
  })))
  app.get('/v1/organizations/:organizationId/drive/custody', async c => c.json(await operation(c, async (tx, tenant) => {
    const input = z.object({ cursor: wire.resourceId.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse({ cursor: c.req.query('cursor'), limit: c.req.query('limit') })
    const rows = await tx.select({ id: s.driveNodes.id, name: s.driveNodes.name, kind: s.driveNodes.kind,
      spaceId: s.driveNodes.spaceId, ownerAccountId: s.driveSpaces.accountId, deletedAt: s.driveNodes.deletedAt,
      purging: sql<boolean>`${s.driveNodes.purgeRequestedAt} IS NOT NULL`, size: s.driveNodes.size,
    }).from(s.driveNodes).innerJoin(s.driveSpaces, eq(s.driveSpaces.id, s.driveNodes.spaceId)).where(and(
      eq(s.driveSpaces.organizationId, tenant.organizationId), eq(s.driveSpaces.custodianAccountId, tenant.actor.id),
      input.cursor ? gt(s.driveNodes.id, input.cursor) : undefined,
    )).orderBy(asc(s.driveNodes.id)).limit(input.limit + 1)
    return { items: rows.slice(0, input.limit), nextCursor: rows.length > input.limit ? rows.at(input.limit - 1)?.id ?? null : null }
  })))
  app.get('/v1/organizations/:organizationId/drive/cleanup', async c => c.json(await operation(c, async (tx, tenant) => {
    await requirePermission(tx, tenant, 'storage.manage')
    const jobs = await tx.select({ id: s.driveCleanup.id, nodeId: s.driveCleanup.nodeId, error: s.driveCleanup.error,
      createdAt: s.driveCleanup.createdAt }).from(s.driveCleanup).where(eq(s.driveCleanup.organizationId, tenant.organizationId)).orderBy(s.driveCleanup.createdAt).limit(100)
    return { items: jobs, retryIntervalMs: config.driveCleanupIntervalMs }
  })))
  app.get('/v1/organizations/:organizationId/drive/directory', async c => c.json(await operation(c, async (tx, tenant) => {
    const [organization] = await tx.select().from(s.organizations).where(eq(s.organizations.id, tenant.organizationId))
    if (!organization) forbidden()
    const members = await tx.select({ id: s.memberships.accountId, name: s.user.name }).from(s.memberships)
      .innerJoin(s.user, eq(s.user.id, s.memberships.accountId))
      .where(and(eq(s.memberships.organizationId, tenant.organizationId), eq(s.memberships.status, 'active'))).orderBy(asc(s.user.name))
    const departments = await tx.select({ id: s.units.id, parentId: s.units.parentId, name: s.units.name }).from(s.units)
      .where(and(eq(s.units.organizationId, tenant.organizationId), sql`${s.units.unitType} <> 'root'`)).orderBy(asc(s.units.name))
    const assignments = await tx.select({ id: s.assignments.unitId }).from(s.assignments).where(eq(s.assignments.membershipId, tenant.membershipId))
    return { organizationId: tenant.organizationId, organizationName: organization.name, members, departments, myDepartmentIds: assignments.map(item => item.id) }
  })))
  app.get('/v1/organizations/:organizationId/drive/files/:id/sharing', async c => c.json(await operation(c, (tx, tenant) => sharingState(tx, tenant, wire.resourceId.parse(c.req.param('id'))))))
  app.put('/v1/organizations/:organizationId/drive/files/:id/sharing', async c => c.json(await operation(c, async (tx, tenant) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    const { policy } = z.object({ policy: wire.driveSharingPolicy.nullable() }).strict().parse(await c.req.json())
    await tx.execute(sql`SELECT id FROM enterprise.drive_node WHERE id = ${id} FOR UPDATE`)
    const current = await resolveNode(tx, tenant, id)
    if (current.role !== 'owner' || current.node.deletedAt) forbidden()
    if (policy !== null) {
      if (policy.organizationId !== tenant.organizationId) forbidden()
      const members = await tx.select().from(s.memberships).where(and(eq(s.memberships.organizationId, tenant.organizationId), eq(s.memberships.status, 'active')))
      const units = await tx.select().from(s.units).where(and(eq(s.units.organizationId, tenant.organizationId), sql`${s.units.unitType} <> 'root'`))
      if (policy.memberIds.some(id => !members.some(member => member.accountId === id)) || policy.departments.some(item => !units.some(unit => unit.id === item.id))) throw new HTTPException(400, { message: 'Sharing recipient is not in this organization' })
    } else if (current.node.parentId === null) throw new HTTPException(400, { message: 'Root files cannot inherit folder sharing' })
    await tx.update(s.driveNodes).set({ sharing: policy, updatedAt: now() }).where(eq(s.driveNodes.id, id))
    await audit(tx, tenant, 'drive.sharing.updated', { policy }, { spaceId: current.node.spaceId, nodeId: id })
    return sharingState(tx, tenant, id)
  })))
  app.get('/v1/organizations/:organizationId/drive/changes', async c => c.json(await operation(c, async (tx, tenant) => {
    const input = changeInput.parse({
      spaceId: c.req.query('spaceId'), cursor: c.req.query('cursor'), limit: c.req.query('limit'),
    })
    await resolveSpace(tx, tenant, input.spaceId)
    const actions = ['drive.version.committed', 'drive.file.deleted', 'drive.file.restored']
    if (input.cursor === undefined) {
      const [head] = await tx.select({ id: s.driveAudit.id, createdAt: s.driveAudit.createdAt })
        .from(s.driveAudit)
        .where(and(
          eq(s.driveAudit.organizationId, tenant.organizationId),
          eq(s.driveAudit.spaceId, input.spaceId),
          inArray(s.driveAudit.action, actions),
          gt(nodeAccess(tenant, sql`${s.driveAudit.nodeId}`), 0),
        ))
        .orderBy(desc(s.driveAudit.createdAt), desc(s.driveAudit.id))
        .limit(1)
      return {
        cursor: encodeChangeCursor(head === undefined
          ? { createdAt: now().toISOString(), id: '' }
          : { createdAt: head.createdAt.toISOString(), id: head.id }),
        skipped: true,
        items: [],
      }
    }
    const cursor = decodeChangeCursor(input.cursor)
    const rows = await tx.select().from(s.driveAudit).where(and(
      eq(s.driveAudit.organizationId, tenant.organizationId),
      eq(s.driveAudit.spaceId, input.spaceId),
      inArray(s.driveAudit.action, actions),
      gt(nodeAccess(tenant, sql`${s.driveAudit.nodeId}`), 0),
      or(
        gt(s.driveAudit.createdAt, new Date(cursor.createdAt)),
        and(eq(s.driveAudit.createdAt, new Date(cursor.createdAt)), gt(s.driveAudit.id, cursor.id)),
      ),
    )).orderBy(asc(s.driveAudit.createdAt), asc(s.driveAudit.id)).limit(input.limit)
    const last = rows.at(-1)
    return {
      cursor: last === undefined ? input.cursor : encodeChangeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }),
      skipped: false,
      items: rows.flatMap((row) => {
        if (row.spaceId === null || row.nodeId === null || row.versionId === null) return []
        const detail = row.detail as { name?: unknown }
        if (typeof detail.name !== 'string' || detail.name === '') return []
        return [{
          id: row.id,
          spaceId: row.spaceId,
          nodeId: row.nodeId,
          versionId: row.versionId,
          name: detail.name,
          operation: row.action === 'drive.file.deleted' ? 'deleted' : 'updated',
          occurredAt: row.createdAt.toISOString(),
        }]
      }),
    }
  })))
  app.get('/v1/organizations/:organizationId/drive/files', async c => c.json(await operation(c, async (tx, tenant) => {
    const input = listInput.parse({ spaceId: c.req.query('spaceId'), parentId: c.req.query('parentId') ?? null, cursor: c.req.query('cursor'), sort: c.req.query('sort'), limit: c.req.query('limit'), shared: c.req.query('shared') === 'true' })
    const { role } = await resolveSpace(tx, tenant, input.spaceId)
    if (!readable(role)) forbidden()
    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor)
    if (cursor && (cursor.spaceId !== input.spaceId || cursor.shared !== (input.shared === true) || cursor.parentId !== input.parentId || cursor.sort !== input.sort || cursor.query !== '')) throw new HTTPException(400, { message: 'Cursor does not match query' })
    if (input.parentId !== null) {
      const parent = await resolveNode(tx, tenant, input.parentId)
      if (parent.node.spaceId !== input.spaceId || parent.node.kind !== 'folder') forbidden()
    }
    const predicate = input.shared ? sql`(${s.driveNodes.parentId} IS NULL OR enterprise.drive_node_access(${s.driveNodes.parentId}, ${tenant.actor.id}, ${tenant.organizationId}) = 0)` : input.parentId === null ? isNull(s.driveNodes.parentId) : eq(s.driveNodes.parentId, input.parentId)
    const rows = await tx.select().from(s.driveNodes).where(and(input.shared ? lt(nodeAccess(tenant), 3) : eq(s.driveNodes.spaceId, input.spaceId), gt(nodeAccess(tenant), 0), predicate, isNull(s.driveNodes.deletedAt), cursor === undefined ? undefined : input.sort === 'name' ? or(gt(s.driveNodes.name, cursor.value), and(eq(s.driveNodes.name, cursor.value), gt(s.driveNodes.id, cursor.id))) : or(lt(s.driveNodes.updatedAt, new Date(cursor.value)), and(eq(s.driveNodes.updatedAt, new Date(cursor.value)), gt(s.driveNodes.id, cursor.id))))).orderBy(input.sort === 'name' ? asc(s.driveNodes.name) : desc(s.driveNodes.updatedAt), asc(s.driveNodes.id)).limit(input.limit + 1)
    const items = rows.slice(0, input.limit)
    const last = items.at(-1)
    const nextCursor = rows.length > input.limit && last !== undefined ? encodeCursor({ spaceId: input.spaceId, shared: input.shared === true, query: '', parentId: input.parentId, sort: input.sort, value: input.sort === 'name' ? last.name : last.updatedAt.toISOString(), id: last.id }) : null
    return { items: items.map(publicNode), nextCursor, summary: { spaceId: input.spaceId, parentId: input.parentId, totalKnown: null } }
  })))
  app.get('/v1/organizations/:organizationId/drive/trash', async c => c.json(await operation(c, async (tx, tenant) => {
    const input = z.object({ spaceId: wire.resourceId, cursor: z.string().max(2048).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().parse({ spaceId: c.req.query('spaceId'), cursor: c.req.query('cursor'), limit: c.req.query('limit') })
    const { role } = await resolveSpace(tx, tenant, input.spaceId)
    if (!readable(role)) forbidden()
    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor)
    if (cursor && (cursor.spaceId !== input.spaceId || cursor.shared || cursor.query !== '__trash__' || cursor.parentId !== null || cursor.sort !== 'updatedAt')) throw new HTTPException(400, { message: 'Cursor does not match query' })
    const rows = await tx.select().from(s.driveNodes).where(and(eq(s.driveNodes.spaceId, input.spaceId), gt(nodeAccess(tenant), 0), sql`${s.driveNodes.deletedAt} IS NOT NULL`, cursor === undefined ? undefined : or(lt(s.driveNodes.updatedAt, new Date(cursor.value)), and(eq(s.driveNodes.updatedAt, new Date(cursor.value)), gt(s.driveNodes.id, cursor.id))))).orderBy(desc(s.driveNodes.updatedAt), asc(s.driveNodes.id)).limit(input.limit + 1)
    const items = rows.slice(0, input.limit)
    const last = items.at(-1)
    const nextCursor = rows.length > input.limit && last !== undefined ? encodeCursor({ spaceId: input.spaceId, shared: false, query: '__trash__', parentId: null, sort: 'updatedAt', value: last.updatedAt.toISOString(), id: last.id }) : null
    return { items: items.map(publicNode), nextCursor, summary: { spaceId: input.spaceId, parentId: null, totalKnown: null } }
  })))
  app.get('/v1/organizations/:organizationId/drive/search', async c => c.json(await operation(c, async (tx, tenant) => {
    const input = searchInput.parse({ spaceId: c.req.query('spaceId'), query: c.req.query('query'), cursor: c.req.query('cursor'), limit: c.req.query('limit'), shared: c.req.query('shared') === 'true' })
    const { role } = await resolveSpace(tx, tenant, input.spaceId)
    if (!readable(role)) forbidden()
    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor)
    if (cursor && (cursor.spaceId !== input.spaceId || cursor.shared !== (input.shared === true) || cursor.query !== input.query || cursor.parentId !== null || cursor.sort !== 'updatedAt')) throw new HTTPException(400, { message: 'Cursor does not match query' })
    const needle = `%${input.query}%`
    const rows = await tx.select().from(s.driveNodes).where(and(input.shared ? lt(nodeAccess(tenant), 3) : eq(s.driveNodes.spaceId, input.spaceId), gt(nodeAccess(tenant), 0), isNull(s.driveNodes.deletedAt), or(ilike(s.driveNodes.name, needle), ilike(s.driveNodes.contentType, needle), sql`EXISTS (SELECT 1 FROM enterprise.drive_description d WHERE d.node_id = ${s.driveNodes.id} AND d.status = 'active' AND (d.content ILIKE ${needle} OR d.type ILIKE ${needle} OR d.fields::text ILIKE ${needle} OR to_tsvector('simple', d.content) @@ plainto_tsquery('simple', ${input.query})))`), cursor === undefined ? undefined : or(lt(s.driveNodes.updatedAt, new Date(cursor.value)), and(eq(s.driveNodes.updatedAt, new Date(cursor.value)), gt(s.driveNodes.id, cursor.id))))).orderBy(desc(s.driveNodes.updatedAt), asc(s.driveNodes.id)).limit(input.limit + 1)
    const items = rows.slice(0, input.limit).map(row => publicNode(row))
    const last = items.at(-1)
    const nextCursor = rows.length > input.limit && last !== undefined ? encodeCursor({ spaceId: input.spaceId, shared: input.shared === true, query: input.query, parentId: null, sort: 'updatedAt', value: last.updatedAt, id: last.id }) : null
    return { items, nextCursor, summary: { spaceId: input.spaceId, parentId: null, totalKnown: null } }
  })))
  app.post('/v1/organizations/:organizationId/drive/folders', async c => c.json(await operation(c, async (tx, tenant) => {
    const input = folderInput.parse(await c.req.json())
    await destination(tx, tenant, input.spaceId, input.parentId)
    await assertNameAvailable(tx, input.spaceId, input.parentId, input.name)
    const [folder] = await tx.insert(s.driveNodes).values({ id: randomUUID(), spaceId: input.spaceId, parentId: input.parentId, name: input.name, kind: 'folder', contentType: 'inode/directory', createdBy: tenant.actor.id, sharing: input.parentId === null ? privatePolicy(tenant) : null }).returning()
    if (!folder) throw new HTTPException(500, { message: 'Folder creation failed' })
    await audit(tx, tenant, 'drive.folder.created', { spaceId: input.spaceId, nodeId: folder.id })
    return publicNode(folder)
  })))
  app.post('/v1/organizations/:organizationId/drive/uploads', async c => c.json(await operation(c, async (tx, tenant) => {
    await requirePermission(tx, tenant, 'storage.write')
    if (objects === undefined) throw new HTTPException(503, { message: 'Drive object storage is not configured' })
    const input = uploadInput.parse(await c.req.json())
    const resolvedSpace = await resolveSpace(tx, tenant, input.spaceId)
    if (input.size > config.driveMaxFileBytes) throw new HTTPException(413, { message: 'File exceeds configured maximum size' })
    await assertDriveCapacity(tx, resolvedSpace.space, input.size)
    let uploadName = input.name
    let baseVersionId: string | null = null
    let uploadParent: string | null = input.parentId
    if (input.nodeId === undefined) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.spaceId}:${input.parentId ?? 'root'}`}, 0))`)
    if (input.nodeId !== undefined) {
      const existing = await resolveNode(tx, tenant, input.nodeId)
      if (!writable(existing.role) || existing.node.spaceId !== input.spaceId || existing.node.kind !== 'file' || existing.node.deletedAt) forbidden()
      baseVersionId = existing.node.versionId
      uploadName = existing.node.name
      uploadParent = existing.node.parentId
    } else {
      uploadName = await availableUploadName(tx, input.spaceId, input.parentId, input.name)
    }
    if (input.nodeId === undefined) await destination(tx, tenant, input.spaceId, uploadParent)
    const nodeId = input.nodeId ?? randomUUID()
    const versionId = randomUUID()
    const objectKey = `drive-staging/${randomUUID()}`
    const [upload] = await tx.insert(s.driveUploads).values({ id: randomUUID(), organizationId: tenant.organizationId, spaceId: input.spaceId, baseVersionId, stagingCleanupAt: new Date(now().getTime() + Math.max(config.driveUploadTtlSeconds, config.driveSignedUrlSeconds) * 1000), nodeId: input.nodeId, reservedNodeId: input.nodeId === undefined ? nodeId : null, parentId: uploadParent, expectedName: uploadName, versionId, objectKey, expectedSize: input.size, expectedContentType: input.contentType, expectedChecksum: input.checksum, expiresAt: new Date(now().getTime() + Math.max(config.driveUploadTtlSeconds, config.driveSignedUrlSeconds) * 1000), createdBy: tenant.actor.id }).returning()
    if (!upload) throw new HTTPException(500, { message: 'Upload session creation failed' })
    const uploadUrl = await objects.createUploadUrl(objectKey, config.driveSignedUrlSeconds)
    return { uploadId: upload.id, nodeId, versionId, name: uploadName, uploadUrl, expiresAt: upload.expiresAt.toISOString() }
  })))
  const commitUpload = async (tx: Transaction, tenant: Tenant, input: z.infer<typeof commitInput>) => {
    if (objects === undefined) throw new HTTPException(503, { message: 'Drive object storage is not configured' })
    await requirePermission(tx, tenant, 'storage.write')
    await lockOrganization(tx, tenant.organizationId)
    const [upload] = await tx.select().from(s.driveUploads).where(and(eq(s.driveUploads.id, input.uploadId), eq(s.driveUploads.organizationId, tenant.organizationId)))
    if (upload?.createdBy === tenant.actor.id && upload.status === 'committed' && upload.nodeId) {
      await resolveNode(tx, tenant, upload.nodeId)
      const [version] = await tx.select().from(s.driveVersions).where(eq(s.driveVersions.id, upload.versionId))
      if (!version) forbidden()
      return { nodeId: upload.nodeId, versionId: version.id, size: version.size, contentType: version.contentType, checksum: version.checksum }
    }
    if (!upload || upload.createdBy !== tenant.actor.id || upload.status !== 'created') throw new HTTPException(404, { message: 'Upload session unavailable' })
    if (upload.expiresAt <= now()) throw new HTTPException(410, { message: 'Upload session expired' })
    let metadata: DriveObjectMetadata
    try {
      metadata = await objects.inspect(upload.objectKey)
    } catch {
      throw new HTTPException(422, { message: 'Uploaded object is unavailable' })
    }
    if (metadata.size !== upload.expectedSize || metadata.contentType !== upload.expectedContentType || (upload.expectedChecksum !== null && metadata.checksum !== upload.expectedChecksum)) throw new HTTPException(422, { message: 'Uploaded object metadata does not match' })
    const resolved = upload.nodeId === null ? undefined : await resolveNode(tx, tenant, upload.nodeId)
    if (resolved && !writable(resolved.role)) forbidden()
    if (!resolved) await destination(tx, tenant, upload.spaceId, upload.parentId)
    if (resolved && (upload.baseVersionId !== null && resolved.node.versionId !== upload.baseVersionId || input.baseVersionId !== undefined && resolved.node.versionId !== input.baseVersionId)) throw new HTTPException(409, { message: 'File version conflict' })
    const nodeId = upload.nodeId ?? upload.reservedNodeId ?? randomUUID()
    if (resolved === undefined) await tx.insert(s.driveNodes).values({ id: nodeId, spaceId: upload.spaceId, parentId: upload.parentId, name: upload.expectedName, kind: 'file', size: upload.expectedSize, contentType: upload.expectedContentType, versionId: null, createdBy: tenant.actor.id, sharing: upload.parentId === null ? privatePolicy(tenant) : null })
    const finalKey = driveObjectKey(upload.spaceId, nodeId, upload.versionId)
    if (upload.objectKey !== finalKey) {
      await objects.copy(upload.objectKey, finalKey)
      const retained = await objects.inspect(finalKey)
      if (retained.size !== metadata.size || retained.contentType !== metadata.contentType || retained.checksum !== metadata.checksum) throw new HTTPException(409, { message: 'UPLOAD_CHANGED_DURING_COMMIT' })
    }
    const [version] = await tx.insert(s.driveVersions).values({ id: upload.versionId, nodeId, size: metadata.size, contentType: metadata.contentType, checksum: metadata.checksum, objectKey: finalKey, createdBy: tenant.actor.id }).returning()
    await tx.update(s.driveNodes).set({ size: metadata.size, contentType: metadata.contentType, versionId: upload.versionId, updatedAt: now() }).where(eq(s.driveNodes.id, nodeId))
    await tx.update(s.driveUploads).set({ status: 'committed', nodeId }).where(eq(s.driveUploads.id, upload.id))
    await audit(tx, tenant, 'drive.version.committed', {
      name: resolved?.node.name ?? upload.expectedName,
    }, { spaceId: upload.spaceId, nodeId, versionId: upload.versionId })
    return { nodeId, versionId: version?.id ?? upload.versionId, size: metadata.size, contentType: metadata.contentType, checksum: metadata.checksum }
  }
  app.post('/v1/organizations/:organizationId/drive/uploads/commit', async (c) => {
    const input = commitInput.parse(await c.req.json())
    return c.json(await operation(c, (tx, tenant) => commitUpload(tx, tenant, input)))
  })
  app.post('/v1/organizations/:organizationId/drive/imports', async (c) => {
    if (!objects) throw new HTTPException(503, { message: 'Drive object storage is not configured' })
    const input = wire.driveImportInput.parse(await c.req.json())
    const staged = await tenantOperation(c, async (tx, tenant) => {
      await lockOrganization(tx, tenant.organizationId)
      await requirePermission(tx, tenant, 'storage.write')
      await destination(tx, tenant, input.spaceId, input.parentId)
      const target = await resolveSpace(tx, tenant, input.spaceId)
      const [existing] = await tx.select().from(s.driveUploads).where(eq(s.driveUploads.id, input.requestId))
      if (existing) {
        if (existing.createdBy !== tenant.actor.id || JSON.stringify(wire.driveImportInput.parse(existing.importRequest)) !== JSON.stringify(input)) throw new HTTPException(409, { message: 'IMPORT_REQUEST_CONFLICT' })
        if (existing.status !== 'created' && existing.status !== 'committed') throw new HTTPException(410, { message: 'IMPORT_EXPIRED' })
        if (existing.status === 'committed') return { upload: existing, source: null }
      }
      let source: { objectKey: string; size: number; contentType: string; checksum: string }
      if (input.source.kind === 'file') {
        const resolved = await resolveNode(tx, tenant, input.source.nodeId)
        if (resolved.node.kind !== 'file' || !resolved.node.versionId) forbidden()
        const [version] = await tx.select().from(s.driveVersions).where(eq(s.driveVersions.id, resolved.node.versionId))
        if (!version) forbidden()
        source = version
      } else {
        const [asset] = await tx.select().from(s.modelAssets).where(and(eq(s.modelAssets.id, input.source.assetId),
          eq(s.modelAssets.organizationId, tenant.organizationId), eq(s.modelAssets.accountId, tenant.actor.id)))
        if (!asset) forbidden()
        if (asset.expiresAt && asset.expiresAt <= new Date(services.now?.() ?? now().getTime())) throw new HTTPException(410, { message: 'RESULT_RECOVERY_EXPIRED' })
        source = { objectKey: asset.objectKey, size: asset.byteLength, contentType: asset.mimeType, checksum: asset.checksum }
      }
      if (existing) return { upload: existing, source }
      await assertNameAvailable(tx, input.spaceId, input.parentId, input.name)
      await assertDriveCapacity(tx, target.space, source.size)
      const nodeId = randomUUID(), versionId = randomUUID()
      const [upload] = await tx.insert(s.driveUploads).values({ id: input.requestId, organizationId: tenant.organizationId,
        spaceId: input.spaceId, importRequest: input, reservedNodeId: nodeId, parentId: input.parentId, expectedName: input.name, versionId,
        objectKey: `drive-staging/${randomUUID()}`, stagingCleanupAt: new Date(now().getTime() + config.driveUploadTtlSeconds * 1000), expectedSize: source.size, expectedContentType: source.contentType,
        expectedChecksum: source.checksum, createdBy: tenant.actor.id, expiresAt: new Date(now().getTime() + config.driveUploadTtlSeconds * 1000) }).returning()
      if (!upload) throw new Error('Import reservation is missing')
      return { upload, source }
    })
    if (staged.upload.status === 'committed') return c.json({ nodeId: staged.upload.nodeId, versionId: staged.upload.versionId })
    return c.json(await tenantOperation(c, async (tx, tenant) => {
      await lockOrganization(tx, tenant.organizationId)
      const [upload] = await tx.select().from(s.driveUploads).where(eq(s.driveUploads.id, staged.upload.id))
      if (upload?.status === 'committed') return commitUpload(tx, tenant, { uploadId: input.requestId })
      if (!upload || upload.status !== 'created' || upload.expiresAt <= now()) throw new HTTPException(410, { message: 'IMPORT_EXPIRED' })
      if (!staged.source) throw new Error('Import source is unavailable')
      try { await objects.copy(staged.source.objectKey, staged.upload.objectKey) }
      catch { throw new HTTPException(409, { message: 'IMPORT_SAVE_RETRY_REQUIRED' }) }
      return commitUpload(tx, tenant, { uploadId: wire.resourceId.parse(staged.upload.id) })
    }))
  })
  app.post('/v1/organizations/:organizationId/drive/files/:id/versions', async c => c.json(await operation(c, async (tx, tenant) => {
    const nodeId = wire.resourceId.parse(c.req.param('id'))
    const input = versionInput.parse({ ...(await c.req.json()), nodeId })
    const [upload] = await tx.select().from(s.driveUploads).where(and(eq(s.driveUploads.id, input.uploadId), eq(s.driveUploads.nodeId, nodeId)))
    if (!upload || input.size !== upload.expectedSize || input.contentType !== upload.expectedContentType) throw new HTTPException(422, { message: 'Uploaded object metadata does not match' })
    const result = await commitUpload(tx, tenant, { uploadId: input.uploadId, baseVersionId: input.baseVersionId ?? undefined })
    if (result.checksum !== input.checksum) throw new HTTPException(422, { message: 'Uploaded object metadata does not match' })
    return result
  })))
  app.get('/v1/organizations/:organizationId/drive/files/:id', async c => c.json(await operation(c, async (tx, tenant) => {
    const resolved = await resolveNode(tx, tenant, wire.resourceId.parse(c.req.param('id')))
    return publicNode(resolved.node)
  })))
  app.get('/v1/organizations/:organizationId/drive/files/:id/download', async c => c.json(await operation(c, async (tx, tenant) => {
    if (objects === undefined) throw new HTTPException(503, { message: 'Drive object storage is not configured' })
    const resolved = await resolveNode(tx, tenant, wire.resourceId.parse(c.req.param('id')))
    if (!resolved.node.versionId) throw new HTTPException(404, { message: 'File has no version' })
    const [version] = await tx.select().from(s.driveVersions).where(eq(s.driveVersions.id, resolved.node.versionId))
    if (!version) throw new HTTPException(404, { message: 'File version unavailable' })
    return { url: await objects.createDownloadUrl(version.objectKey, config.driveSignedUrlSeconds), versionId: version.id, checksum: version.checksum }
  })))
  app.patch('/v1/organizations/:organizationId/drive/files/:id', async c => c.json(await operation(c, async (tx, tenant) => {
    const input = nodeInput.parse({ ...(await c.req.json()), nodeId: c.req.param('id') })
    await lockOrganization(tx, tenant.organizationId)
    const resolved = await resolveNode(tx, tenant, input.nodeId)
    const crossSpace = input.spaceId !== resolved.node.spaceId
    const target = await resolveSpace(tx, tenant, input.spaceId)
    const source = await resolveSpace(tx, tenant, resolved.node.spaceId)
    if (crossSpace && input.confirmSharing !== true) throw new HTTPException(409, { message: 'MOVE_SHARING_CONFIRMATION_REQUIRED' })
    if (!writable(resolved.role)) forbidden()
    if (input.baseVersionId !== undefined && input.baseVersionId !== resolved.node.versionId) throw new HTTPException(409, { message: 'File version conflict' })
    const nextParent = input.parentId === undefined ? crossSpace ? null : resolved.node.parentId : input.parentId
    const moving = crossSpace || nextParent !== resolved.node.parentId
    let sharing = resolved.node.sharing
    if (moving) {
      if (resolved.role !== 'owner') forbidden()
      await destination(tx, tenant, input.spaceId, nextParent)
      const descendants = await tx.execute(sql`WITH RECURSIVE children AS (
        SELECT id FROM enterprise.drive_node WHERE id = ${resolved.node.id}
        UNION SELECT n.id FROM enterprise.drive_node n JOIN children c ON n.parent_id = c.id
      ) SELECT id FROM children WHERE id = ${nextParent}`)
      if (descendants.length) throw new HTTPException(409, { message: 'Invalid destination folder' })
      sharing = (await sharingState(tx, tenant, resolved.node.id)).policy
      if (crossSpace) {
        const children = await tx.execute(sql`WITH RECURSIVE children AS (
          SELECT id FROM enterprise.drive_node WHERE id = ${resolved.node.id}
          UNION ALL SELECT n.id FROM enterprise.drive_node n JOIN children c ON n.parent_id = c.id
        ) SELECT c.id, enterprise.drive_node_access(c.id, ${tenant.actor.id}, ${tenant.organizationId}) AS access,
          (SELECT COALESCE(sum(v.size),0) FROM enterprise.drive_version v WHERE v.node_id = c.id) AS bytes,
          EXISTS (SELECT 1 FROM enterprise.drive_upload u WHERE (u.node_id = c.id OR u.parent_id = c.id)
            AND u.status IN ('created','cancel_pending')) AS uploading FROM children c`)
        if (children.some(child => Number(child.access) !== 3 || child.uploading)) throw new HTTPException(409, { message: 'MOVE_REQUIRES_OWNERSHIP_AND_IDLE_UPLOADS' })
        const bytes = children.reduce((sum, child) => sum + Number(child.bytes), 0)
        await assertDriveCapacity(tx, target.space, source.space.kind === 'personal' && target.space.kind === 'personal'
          && source.space.accountId === target.space.accountId ? 0 : bytes, 0)
        await tx.update(s.driveNodes).set({ spaceId: input.spaceId }).where(inArray(s.driveNodes.id, children.map(child => String(child.id))))
      }
    }
    await assertNameAvailable(tx, input.spaceId, nextParent, input.name ?? resolved.node.name, resolved.node.id)
    const [updated] = await tx.update(s.driveNodes).set({ ...(moving ? { sharing } : {}), ...(input.name === undefined ? {} : { name: input.name }), ...(moving ? { parentId: nextParent } : {}), updatedAt: now() }).where(eq(s.driveNodes.id, input.nodeId)).returning()
    await audit(tx, tenant, 'drive.file.updated', { nodeId: input.nodeId })
    return publicNode(updated ?? resolved.node)
  })))
  app.delete('/v1/organizations/:organizationId/drive/files/:id', async c => c.json(await operation(c, async (tx, tenant) => {
    const resolved = await resolveNode(tx, tenant, wire.resourceId.parse(c.req.param('id')), false, true)
    if (!writable(resolved.role)) forbidden()
    await tx.update(s.driveNodes).set({ deletedAt: now(), updatedAt: now() }).where(eq(s.driveNodes.id, resolved.node.id))
    await audit(tx, tenant, 'drive.file.deleted', { name: resolved.node.name }, {
      spaceId: resolved.node.spaceId, nodeId: resolved.node.id,
      ...(resolved.node.versionId === null ? {} : { versionId: resolved.node.versionId }),
    })
    return { id: resolved.node.id, deleted: true }
  })))
  app.post('/v1/organizations/:organizationId/drive/files/:id/restore', async c => c.json(await operation(c, async (tx, tenant) => {
    const resolved = await resolveNode(tx, tenant, wire.resourceId.parse(c.req.param('id')), true)
    if (!writable(resolved.role)) forbidden()
    const restoredSpace = await resolveSpace(tx, tenant, resolved.node.spaceId)
    await assertDriveCapacity(tx, restoredSpace.space, 0)
    await tx.update(s.driveNodes).set({ deletedAt: null, updatedAt: now() }).where(eq(s.driveNodes.id, resolved.node.id))
    await audit(tx, tenant, 'drive.file.restored', { name: resolved.node.name }, {
      spaceId: resolved.node.spaceId, nodeId: resolved.node.id,
      ...(resolved.node.versionId === null ? {} : { versionId: resolved.node.versionId }),
    })
    return publicNode({ ...resolved.node, deletedAt: null, updatedAt: now() })
  })))
  app.get('/v1/organizations/:organizationId/drive/files/:id/versions', async c => c.json(await operation(c, async (tx, tenant) => {
    const resolved = await resolveNode(tx, tenant, wire.resourceId.parse(c.req.param('id')))
    const versions = await tx.select().from(s.driveVersions).where(eq(s.driveVersions.nodeId, resolved.node.id)).orderBy(desc(s.driveVersions.createdAt))
    return versions.map(version => ({ id: version.id, nodeId: version.nodeId, size: version.size, contentType: version.contentType, checksum: version.checksum, createdBy: version.createdBy, createdAt: version.createdAt.toISOString() }))
  })))
  app.get('/v1/organizations/:organizationId/drive/files/:id/descriptions', async c => c.json(await operation(c, async (tx, tenant) => {
    const resolved = await resolveNode(tx, tenant, wire.resourceId.parse(c.req.param('id')))
    const condition = c.req.query('includeHistory') === 'true'
      ? eq(s.driveDescriptions.nodeId, resolved.node.id)
      : and(eq(s.driveDescriptions.nodeId, resolved.node.id), eq(s.driveDescriptions.status, 'active'))
    return tx.select().from(s.driveDescriptions).where(condition).orderBy(desc(s.driveDescriptions.updatedAt))
  })))
  app.post('/v1/organizations/:organizationId/drive/files/:id/edit-sessions', async c => c.json(await operation(c, async (tx, tenant) => {
    const resolved = await resolveNode(tx, tenant, wire.resourceId.parse(c.req.param('id')))
    if (!writable(resolved.role)) forbidden()
    const input = editSessionInput.parse(await c.req.json())
    if (resolved.node.kind !== 'file' || resolved.node.versionId !== input.baseVersionId) throw new HTTPException(409, { message: 'File version conflict' })
    const [session] = await tx.insert(s.driveEditSessions).values({ id: randomUUID(), organizationId: tenant.organizationId, nodeId: resolved.node.id, baseVersionId: input.baseVersionId, accountId: tenant.actor.id, expiresAt: new Date(now().getTime() + Math.max(config.driveUploadTtlSeconds, config.driveSignedUrlSeconds) * 1000) }).returning()
    if (!session) throw new HTTPException(500, { message: 'Edit session creation failed' })
    return { id: session.id, nodeId: session.nodeId, baseVersionId: session.baseVersionId, status: session.status, conflict: session.conflict, expiresAt: session.expiresAt.toISOString() }
  })))
  app.get('/v1/organizations/:organizationId/drive/edit-sessions/:id', async c => c.json(await operation(c, async (tx, tenant) => {
    const [session] = await tx.select().from(s.driveEditSessions).where(and(eq(s.driveEditSessions.id, wire.resourceId.parse(c.req.param('id'))), eq(s.driveEditSessions.accountId, tenant.actor.id), eq(s.driveEditSessions.organizationId, tenant.organizationId)))
    if (!session) throw new HTTPException(404, { message: 'Edit session unavailable' })
    if (session.expiresAt <= now() && session.status === 'active') await tx.update(s.driveEditSessions).set({ status: 'expired', closedAt: now() }).where(eq(s.driveEditSessions.id, session.id))
    return { id: session.id, nodeId: session.nodeId, baseVersionId: session.baseVersionId, status: session.expiresAt <= now() ? 'expired' : session.status, conflict: session.conflict, expiresAt: session.expiresAt.toISOString() }
  })))
  app.post('/v1/organizations/:organizationId/drive/edit-sessions/:id/close', async c => c.json(await operation(c, async (tx, tenant) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    const [session] = await tx.update(s.driveEditSessions).set({ status: 'closed', closedAt: now() }).where(and(eq(s.driveEditSessions.id, id), eq(s.driveEditSessions.accountId, tenant.actor.id), eq(s.driveEditSessions.organizationId, tenant.organizationId))).returning()
    if (!session) throw new HTTPException(404, { message: 'Edit session unavailable' })
    return { id: session.id, status: session.status }
  })))
  app.post('/v1/organizations/:organizationId/drive/descriptions', async c => c.json(await operation(c, async (tx, tenant) => {
    const input = descriptionInput.parse(await c.req.json())
    const resolved = await resolveNode(tx, tenant, input.nodeId)
    if (!writable(resolved.role)) forbidden()
    if (input.versionId !== null && input.versionId !== resolved.node.versionId) throw new HTTPException(409, { message: 'Description version conflict' })
    const [description] = await tx.insert(s.driveDescriptions).values({ id: randomUUID(), nodeId: input.nodeId, versionId: input.versionId, type: input.type, content: input.content, fields: input.fields ?? {}, source: input.source, reference: input.reference ?? {}, createdBy: tenant.actor.id }).returning()
    await audit(tx, tenant, 'drive.description.created', { nodeId: input.nodeId, descriptionId: description?.id })
    return description
  })))
  app.patch('/v1/organizations/:organizationId/drive/descriptions/:id', async c => c.json(await operation(c, async (tx, tenant) => {
    const input = descriptionInput.parse(await c.req.json())
    const [current] = await tx.select().from(s.driveDescriptions).where(eq(s.driveDescriptions.id, wire.resourceId.parse(c.req.param('id'))))
    if (!current) forbidden()
    const resolved = await resolveNode(tx, tenant, current.nodeId)
    if (!writable(resolved.role) || (input.baseUpdatedAt !== undefined && current.updatedAt.toISOString() !== input.baseUpdatedAt)) throw new HTTPException(409, { message: 'Description conflict' })
    const [updated] = await tx.update(s.driveDescriptions).set({ content: input.content, fields: input.fields ?? current.fields, type: input.type, reference: input.reference ?? current.reference, updatedAt: now() }).where(eq(s.driveDescriptions.id, current.id)).returning()
    return updated
  })))
  app.post('/v1/organizations/:organizationId/drive/descriptions/:id/supersede', async c => c.json(await operation(c, async (tx, tenant) => {
    const [current] = await tx.select().from(s.driveDescriptions).where(eq(s.driveDescriptions.id, wire.resourceId.parse(c.req.param('id'))))
    if (!current) forbidden()
    const resolved = await resolveNode(tx, tenant, current.nodeId)
    if (!writable(resolved.role)) forbidden()
    await tx.update(s.driveDescriptions).set({ status: 'superseded', updatedAt: now() }).where(eq(s.driveDescriptions.id, current.id))
    return { id: current.id, status: 'superseded' }
  })))
}
