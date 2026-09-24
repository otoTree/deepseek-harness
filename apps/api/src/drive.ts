/* oxlint-disable @stylistic/max-len -- Drive route schemas and SQL expressions mirror the wire/API contract. */
/** Enterprise cloud-drive HTTP routes, permissions, versioning and descriptions. */
import { randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import * as s from './schema.ts'
import * as wire from './contracts.ts'
import type { Config } from './config.ts'
import type { Transaction } from './database.ts'
import { forbidden, type Tenant } from './security.ts'
import type { DriveObjectMetadata } from './drive-storage.ts'
import { driveObjectKey } from './drive-storage.ts'
import type { ApiEnv, Services, TenantOperation } from './application.ts'

const cursorSchema = z.object({
  query: z.string().default(''), parentId: z.string().nullable(), sort: z.enum(['name', 'updatedAt']).default('name'),
  value: z.string(), id: z.string(),
}).strict()
const listInput = z.object({ spaceId: wire.resourceId, parentId: wire.resourceId.nullable().default(null), cursor: z.string().max(2048).optional(), sort: z.enum(['name', 'updatedAt']).default('name'), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict()
const searchInput = z.object({ spaceId: wire.resourceId, query: z.string().trim().min(1).max(200), cursor: z.string().max(2048).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict()
const folderInput = z.object({ spaceId: wire.resourceId, parentId: wire.resourceId.nullable(), name: z.string().trim().min(1).max(255) }).strict()
const uploadInput = z.object({ spaceId: wire.resourceId, nodeId: wire.resourceId.optional(), parentId: wire.resourceId.nullable().default(null), name: z.string().trim().min(1).max(255), size: z.number().int().nonnegative(), contentType: z.string().min(1).max(255), checksum: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict()
const commitInput = z.object({ uploadId: wire.resourceId, baseVersionId: wire.resourceId.optional() }).strict()
const versionInput = z.object({ nodeId: wire.resourceId, baseVersionId: wire.resourceId.nullable(), size: z.number().int().nonnegative(), contentType: z.string().min(1).max(255), checksum: z.string().regex(/^[a-f0-9]{64}$/), uploadId: wire.resourceId }).strict()
const nodeInput = z.object({ spaceId: wire.resourceId, nodeId: wire.resourceId, name: z.string().trim().min(1).max(255).optional(), parentId: wire.resourceId.nullable().optional(), baseVersionId: wire.resourceId.nullable().optional() }).strict()
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
function permissionRole(role: string): 'owner' | 'admin' | 'member' | 'viewer' { return role === 'administrator' ? 'admin' : role === 'owner' ? 'owner' : role === 'viewer' ? 'viewer' : 'member' }
function readable(role: string): boolean { return ['owner', 'administrator', 'member', 'viewer'].includes(role) }
function writable(role: string): boolean { return ['owner', 'administrator', 'member'].includes(role) }

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

async function assertQuota(tx: Transaction, space: typeof s.driveSpaces.$inferSelect, incomingBytes: number, config: Config, replacingNodeId?: string): Promise<void> {
  const rows = await tx.execute<{ total: number | string }>(sql`SELECT COALESCE(SUM(size), 0) AS total FROM enterprise.drive_node WHERE space_id = ${space.id} AND kind = 'file' AND deleted_at IS NULL AND (${replacingNodeId === undefined ? sql`TRUE` : sql`id <> ${replacingNodeId}`})`)
  const used = Number(rows[0]?.total ?? 0)
  const quota = space.kind === 'personal' ? config.drivePersonalQuotaBytes : config.driveOrganizationQuotaBytes
  if (used + incomingBytes > quota) throw new HTTPException(413, { message: 'Drive quota exceeded' })
}

async function resolveSpace(tx: Transaction, tenant: Tenant, spaceId: string): Promise<{ space: typeof s.driveSpaces.$inferSelect; role: 'owner' | 'admin' | 'member' | 'viewer' }> {
  const [space] = await tx.select().from(s.driveSpaces).where(and(eq(s.driveSpaces.id, spaceId), or(eq(s.driveSpaces.accountId, tenant.actor.id), eq(s.driveSpaces.organizationId, tenant.organizationId))))
  if (!space) forbidden()
  if (space.kind === 'personal') return { space, role: 'owner' }
  const bindings = await tx.execute(sql`SELECT r.role FROM enterprise.role_binding r JOIN enterprise.membership m ON m.id = r.membership_id WHERE m.organization_id = ${tenant.organizationId} AND m.account_id = ${tenant.actor.id} AND m.status = 'active' AND r.unit_id IS NULL`)
  const available = new Set(bindings.map(binding => String(binding.role)))
  const role = available.has('owner') ? 'owner' : available.has('administrator') ? 'administrator' : available.has('member') ? 'member' : 'viewer'
  if (!readable(role)) forbidden()
  return { space, role: permissionRole(role) }
}

async function resolveNode(tx: Transaction, tenant: Tenant, nodeId: string): Promise<{ node: typeof s.driveNodes.$inferSelect; role: 'owner' | 'admin' | 'member' | 'viewer' }> {
  const [node] = await tx.select().from(s.driveNodes).where(eq(s.driveNodes.id, nodeId))
  if (!node) forbidden()
  const resolved = await resolveSpace(tx, tenant, node.spaceId)
  return { node, role: resolved.role }
}

function publicNode(node: typeof s.driveNodes.$inferSelect) {
  return { id: node.id, parentId: node.parentId, name: node.name, kind: node.kind, size: node.size, contentType: node.contentType, versionId: node.versionId, updatedAt: node.updatedAt.toISOString(), deletedAt: node.deletedAt?.toISOString() ?? null }
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
  const objects = services.driveObjects
  const config = services.config
  const operation = (c: Context<ApiEnv>, run: (tx: Transaction, tenant: Tenant) => Promise<unknown>) => tenantOperation(c, run)
  app.get('/v1/organizations/:organizationId/drive/spaces', async c => c.json(await operation(c, async (tx, tenant) => {
    const personalRows = await tx.select().from(s.driveSpaces).where(and(eq(s.driveSpaces.accountId, tenant.actor.id), eq(s.driveSpaces.kind, 'personal')))
    const organizationRows = await tx.select().from(s.driveSpaces).where(and(eq(s.driveSpaces.organizationId, tenant.organizationId), eq(s.driveSpaces.kind, 'organization')))
    const spaces = [...personalRows, ...organizationRows]
    if (spaces.length === 0 || personalRows.length === 0) {
      const [created] = await tx.insert(s.driveSpaces).values({ id: randomUUID(), accountId: tenant.actor.id, kind: 'personal', name: 'Personal space' }).returning()
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
        ))
        .orderBy(desc(s.driveAudit.createdAt), desc(s.driveAudit.id))
        .limit(1)
      return {
        cursor: encodeChangeCursor(head === undefined
          ? { createdAt: new Date().toISOString(), id: '' }
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
    const input = listInput.parse({ spaceId: c.req.query('spaceId'), parentId: c.req.query('parentId') ?? null, cursor: c.req.query('cursor'), sort: c.req.query('sort'), limit: c.req.query('limit') })
    const { role } = await resolveSpace(tx, tenant, input.spaceId)
    if (!readable(role)) forbidden()
    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor)
    if (cursor && (cursor.parentId !== input.parentId || cursor.sort !== input.sort || cursor.query !== '')) throw new HTTPException(400, { message: 'Cursor does not match query' })
    const predicate = input.parentId === null ? isNull(s.driveNodes.parentId) : eq(s.driveNodes.parentId, input.parentId)
    const rows = await tx.select().from(s.driveNodes).where(and(eq(s.driveNodes.spaceId, input.spaceId), predicate, isNull(s.driveNodes.deletedAt), cursor === undefined ? undefined : input.sort === 'name' ? or(gt(s.driveNodes.name, cursor.value), and(eq(s.driveNodes.name, cursor.value), gt(s.driveNodes.id, cursor.id))) : or(lt(s.driveNodes.updatedAt, new Date(cursor.value)), and(eq(s.driveNodes.updatedAt, new Date(cursor.value)), gt(s.driveNodes.id, cursor.id))))).orderBy(input.sort === 'name' ? asc(s.driveNodes.name) : desc(s.driveNodes.updatedAt), asc(s.driveNodes.id)).limit(input.limit + 1)
    const items = rows.slice(0, input.limit)
    const last = items.at(-1)
    const nextCursor = rows.length > input.limit && last !== undefined ? encodeCursor({ query: '', parentId: input.parentId, sort: input.sort, value: input.sort === 'name' ? last.name : last.updatedAt.toISOString(), id: last.id }) : null
    return { items: items.map(publicNode), nextCursor, summary: { spaceId: input.spaceId, parentId: input.parentId, totalKnown: null } }
  })))
  app.get('/v1/organizations/:organizationId/drive/trash', async c => c.json(await operation(c, async (tx, tenant) => {
    const input = z.object({ spaceId: wire.resourceId, cursor: z.string().max(2048).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().parse({ spaceId: c.req.query('spaceId'), cursor: c.req.query('cursor'), limit: c.req.query('limit') })
    const { role } = await resolveSpace(tx, tenant, input.spaceId)
    if (!readable(role)) forbidden()
    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor)
    if (cursor && (cursor.query !== '__trash__' || cursor.parentId !== null || cursor.sort !== 'updatedAt')) throw new HTTPException(400, { message: 'Cursor does not match query' })
    const rows = await tx.select().from(s.driveNodes).where(and(eq(s.driveNodes.spaceId, input.spaceId), sql`${s.driveNodes.deletedAt} IS NOT NULL`, cursor === undefined ? undefined : or(lt(s.driveNodes.updatedAt, new Date(cursor.value)), and(eq(s.driveNodes.updatedAt, new Date(cursor.value)), gt(s.driveNodes.id, cursor.id))))).orderBy(desc(s.driveNodes.updatedAt), asc(s.driveNodes.id)).limit(input.limit + 1)
    const items = rows.slice(0, input.limit)
    const last = items.at(-1)
    const nextCursor = rows.length > input.limit && last !== undefined ? encodeCursor({ query: '__trash__', parentId: null, sort: 'updatedAt', value: last.updatedAt.toISOString(), id: last.id }) : null
    return { items: items.map(publicNode), nextCursor, summary: { spaceId: input.spaceId, parentId: null, totalKnown: null } }
  })))
  app.get('/v1/organizations/:organizationId/drive/search', async c => c.json(await operation(c, async (tx, tenant) => {
    const input = searchInput.parse({ spaceId: c.req.query('spaceId'), query: c.req.query('query'), cursor: c.req.query('cursor'), limit: c.req.query('limit') })
    const { role } = await resolveSpace(tx, tenant, input.spaceId)
    if (!readable(role)) forbidden()
    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor)
    if (cursor && (cursor.query !== input.query || cursor.parentId !== null || cursor.sort !== 'updatedAt')) throw new HTTPException(400, { message: 'Cursor does not match query' })
    const needle = `%${input.query}%`
    const rows = await tx.select().from(s.driveNodes).where(and(eq(s.driveNodes.spaceId, input.spaceId), isNull(s.driveNodes.deletedAt), or(ilike(s.driveNodes.name, needle), ilike(s.driveNodes.contentType, needle), sql`EXISTS (SELECT 1 FROM enterprise.drive_description d WHERE d.node_id = ${s.driveNodes.id} AND d.status = 'active' AND (d.content ILIKE ${needle} OR d.type ILIKE ${needle} OR d.fields::text ILIKE ${needle} OR to_tsvector('simple', d.content) @@ plainto_tsquery('simple', ${input.query})))`), cursor === undefined ? undefined : or(lt(s.driveNodes.updatedAt, new Date(cursor.value)), and(eq(s.driveNodes.updatedAt, new Date(cursor.value)), gt(s.driveNodes.id, cursor.id))))).orderBy(desc(s.driveNodes.updatedAt), asc(s.driveNodes.id)).limit(input.limit + 1)
    const items = rows.slice(0, input.limit).map(row => publicNode(row))
    const last = items.at(-1)
    const nextCursor = rows.length > input.limit && last !== undefined ? encodeCursor({ query: input.query, parentId: null, sort: 'updatedAt', value: last.updatedAt, id: last.id }) : null
    return { items, nextCursor, summary: { spaceId: input.spaceId, parentId: null, totalKnown: null } }
  })))
  app.post('/v1/organizations/:organizationId/drive/folders', async c => c.json(await operation(c, async (tx, tenant) => {
    const input = folderInput.parse(await c.req.json())
    const { role } = await resolveSpace(tx, tenant, input.spaceId)
    if (!writable(role)) forbidden()
    if (input.parentId !== null) {
      const parent = await resolveNode(tx, tenant, input.parentId)
      if (parent.node.spaceId !== input.spaceId || parent.node.kind !== 'folder' || parent.node.deletedAt) forbidden()
    }
    await assertNameAvailable(tx, input.spaceId, input.parentId, input.name)
    const [folder] = await tx.insert(s.driveNodes).values({ id: randomUUID(), spaceId: input.spaceId, parentId: input.parentId, name: input.name, kind: 'folder', contentType: 'inode/directory' }).returning()
    if (!folder) throw new HTTPException(500, { message: 'Folder creation failed' })
    await audit(tx, tenant, 'drive.folder.created', { spaceId: input.spaceId, nodeId: folder.id })
    return publicNode(folder)
  })))
  app.post('/v1/organizations/:organizationId/drive/uploads', async c => c.json(await operation(c, async (tx, tenant) => {
    if (objects === undefined) throw new HTTPException(503, { message: 'Drive object storage is not configured' })
    const input = uploadInput.parse(await c.req.json())
    const resolvedSpace = await resolveSpace(tx, tenant, input.spaceId)
    const { role } = resolvedSpace
    if (!writable(role)) forbidden()
    if (input.size > config.driveMaxFileBytes) throw new HTTPException(413, { message: 'File exceeds configured maximum size' })
    await assertQuota(tx, resolvedSpace.space, input.size, config, input.nodeId)
    let uploadName = input.name
    let uploadParent: string | null = input.parentId
    if (input.nodeId === undefined) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.spaceId}:${input.parentId ?? 'root'}`}, 0))`)
    if (input.nodeId !== undefined) {
      const existing = await resolveNode(tx, tenant, input.nodeId)
      if (existing.node.spaceId !== input.spaceId || existing.node.kind !== 'file' || existing.node.deletedAt) forbidden()
      uploadName = existing.node.name
      uploadParent = existing.node.parentId
    } else {
      uploadName = await availableUploadName(tx, input.spaceId, input.parentId, input.name)
    }
    if (uploadParent !== null) {
      const parent = await resolveNode(tx, tenant, uploadParent)
      if (parent.node.spaceId !== input.spaceId || parent.node.kind !== 'folder' || parent.node.deletedAt) forbidden()
    }
    const nodeId = input.nodeId ?? randomUUID()
    const versionId = randomUUID()
    const objectKey = driveObjectKey(input.spaceId, nodeId, versionId)
    const [upload] = await tx.insert(s.driveUploads).values({ id: randomUUID(), organizationId: tenant.organizationId, spaceId: input.spaceId, nodeId: input.nodeId, reservedNodeId: input.nodeId === undefined ? nodeId : null, parentId: uploadParent, expectedName: uploadName, versionId, objectKey, expectedSize: input.size, expectedContentType: input.contentType, expectedChecksum: input.checksum, expiresAt: new Date(Date.now() + config.driveUploadTtlSeconds * 1000), createdBy: tenant.actor.id }).returning()
    if (!upload) throw new HTTPException(500, { message: 'Upload session creation failed' })
    const uploadUrl = await objects.createUploadUrl(objectKey, config.driveSignedUrlSeconds)
    return { uploadId: upload.id, nodeId, versionId, name: uploadName, uploadUrl, expiresAt: upload.expiresAt.toISOString() }
  })))
  app.post('/v1/organizations/:organizationId/drive/uploads/commit', async c => c.json(await operation(c, async (tx, tenant) => {
    if (objects === undefined) throw new HTTPException(503, { message: 'Drive object storage is not configured' })
    const input = commitInput.parse(await c.req.json())
    const [upload] = await tx.select().from(s.driveUploads).where(and(eq(s.driveUploads.id, input.uploadId), eq(s.driveUploads.organizationId, tenant.organizationId)))
    if (!upload || upload.status !== 'created') throw new HTTPException(404, { message: 'Upload session unavailable' })
    if (upload.expiresAt <= new Date()) throw new HTTPException(410, { message: 'Upload session expired' })
    let metadata: DriveObjectMetadata
    try {
      metadata = await objects.inspect(upload.objectKey)
    } catch {
      throw new HTTPException(422, { message: 'Uploaded object is unavailable' })
    }
    if (metadata.size !== upload.expectedSize || metadata.contentType !== upload.expectedContentType || (upload.expectedChecksum !== null && metadata.checksum !== upload.expectedChecksum)) throw new HTTPException(422, { message: 'Uploaded object metadata does not match' })
    const resolved = upload.nodeId === null ? undefined : await resolveNode(tx, tenant, upload.nodeId)
    if (resolved && input.baseVersionId !== undefined && resolved.node.versionId !== input.baseVersionId) throw new HTTPException(409, { message: 'File version conflict' })
    const nodeId = upload.nodeId ?? upload.reservedNodeId ?? randomUUID()
    if (resolved === undefined) await tx.insert(s.driveNodes).values({ id: nodeId, spaceId: upload.spaceId, parentId: upload.parentId, name: upload.expectedName, kind: 'file', size: upload.expectedSize, contentType: upload.expectedContentType, versionId: null })
    const [version] = await tx.insert(s.driveVersions).values({ id: upload.versionId, nodeId, size: metadata.size, contentType: metadata.contentType, checksum: metadata.checksum, objectKey: upload.objectKey, createdBy: tenant.actor.id }).returning()
    await tx.update(s.driveNodes).set({ size: metadata.size, contentType: metadata.contentType, versionId: upload.versionId, updatedAt: new Date() }).where(eq(s.driveNodes.id, nodeId))
    await tx.update(s.driveUploads).set({ status: 'committed', nodeId }).where(eq(s.driveUploads.id, upload.id))
    await audit(tx, tenant, 'drive.version.committed', {
      name: resolved?.node.name ?? upload.expectedName,
    }, { spaceId: upload.spaceId, nodeId, versionId: upload.versionId })
    return { nodeId, versionId: version?.id ?? upload.versionId, size: metadata.size, contentType: metadata.contentType, checksum: metadata.checksum }
  })))
  app.post('/v1/organizations/:organizationId/drive/files/:id/versions', async c => c.json(await operation(c, async (tx, tenant) => {
    if (objects === undefined) throw new HTTPException(503, { message: 'Drive object storage is not configured' })
    const nodeId = wire.resourceId.parse(c.req.param('id'))
    const input = versionInput.parse({ ...(await c.req.json()), nodeId })
    const resolved = await resolveNode(tx, tenant, nodeId)
    if (!writable(resolved.role)) forbidden()
    if (resolved.node.kind !== 'file' || resolved.node.versionId !== input.baseVersionId) throw new HTTPException(409, { message: 'File version conflict' })
    const [upload] = await tx.select().from(s.driveUploads).where(and(eq(s.driveUploads.id, input.uploadId), eq(s.driveUploads.nodeId, nodeId), eq(s.driveUploads.organizationId, tenant.organizationId)))
    if (!upload || upload.status !== 'created') throw new HTTPException(404, { message: 'Upload session unavailable' })
    if (upload.expiresAt <= new Date()) throw new HTTPException(410, { message: 'Upload session expired' })
    let metadata: DriveObjectMetadata
    try {
      metadata = await objects.inspect(upload.objectKey)
    } catch {
      throw new HTTPException(422, { message: 'Uploaded object is unavailable' })
    }
    if (metadata.size !== input.size || metadata.contentType !== input.contentType || metadata.checksum !== input.checksum) throw new HTTPException(422, { message: 'Uploaded object metadata does not match' })
    const [version] = await tx.insert(s.driveVersions).values({ id: upload.versionId, nodeId, size: metadata.size, contentType: metadata.contentType, checksum: metadata.checksum, objectKey: upload.objectKey, createdBy: tenant.actor.id }).returning()
    await tx.update(s.driveNodes).set({ size: metadata.size, contentType: metadata.contentType, versionId: upload.versionId, updatedAt: new Date() }).where(eq(s.driveNodes.id, nodeId))
    await tx.update(s.driveUploads).set({ status: 'committed' }).where(eq(s.driveUploads.id, upload.id))
    await audit(tx, tenant, 'drive.version.committed', { name: resolved.node.name }, {
      spaceId: resolved.node.spaceId, nodeId, versionId: upload.versionId,
    })
    return { nodeId, versionId: version?.id ?? upload.versionId, size: metadata.size, contentType: metadata.contentType, checksum: metadata.checksum }
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
    const resolved = await resolveNode(tx, tenant, input.nodeId)
    if (input.spaceId !== resolved.node.spaceId) throw new HTTPException(404, { message: 'File unavailable' })
    if (!writable(resolved.role)) forbidden()
    if (input.baseVersionId !== undefined && input.baseVersionId !== resolved.node.versionId) throw new HTTPException(409, { message: 'File version conflict' })
    const nextParent = input.parentId === undefined ? resolved.node.parentId : input.parentId
    if (nextParent !== null) {
      const parent = await resolveNode(tx, tenant, nextParent)
      if (parent.node.spaceId !== resolved.node.spaceId || parent.node.kind !== 'folder' || parent.node.deletedAt || parent.node.id === resolved.node.id) throw new HTTPException(409, { message: 'Invalid destination folder' })
    }
    await assertNameAvailable(tx, resolved.node.spaceId, nextParent, input.name ?? resolved.node.name, resolved.node.id)
    const [updated] = await tx.update(s.driveNodes).set({ ...(input.name === undefined ? {} : { name: input.name }), ...(input.parentId === undefined ? {} : { parentId: input.parentId }), updatedAt: new Date() }).where(eq(s.driveNodes.id, input.nodeId)).returning()
    await audit(tx, tenant, 'drive.file.updated', { nodeId: input.nodeId })
    return publicNode(updated ?? resolved.node)
  })))
  app.delete('/v1/organizations/:organizationId/drive/files/:id', async c => c.json(await operation(c, async (tx, tenant) => {
    const resolved = await resolveNode(tx, tenant, wire.resourceId.parse(c.req.param('id')))
    if (!writable(resolved.role)) forbidden()
    await tx.update(s.driveNodes).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(s.driveNodes.id, resolved.node.id))
    await audit(tx, tenant, 'drive.file.deleted', { name: resolved.node.name }, {
      spaceId: resolved.node.spaceId, nodeId: resolved.node.id,
      ...(resolved.node.versionId === null ? {} : { versionId: resolved.node.versionId }),
    })
    return { id: resolved.node.id, deleted: true }
  })))
  app.post('/v1/organizations/:organizationId/drive/files/:id/restore', async c => c.json(await operation(c, async (tx, tenant) => {
    const resolved = await resolveNode(tx, tenant, wire.resourceId.parse(c.req.param('id')))
    if (!writable(resolved.role)) forbidden()
    await tx.update(s.driveNodes).set({ deletedAt: null, updatedAt: new Date() }).where(eq(s.driveNodes.id, resolved.node.id))
    await audit(tx, tenant, 'drive.file.restored', { name: resolved.node.name }, {
      spaceId: resolved.node.spaceId, nodeId: resolved.node.id,
      ...(resolved.node.versionId === null ? {} : { versionId: resolved.node.versionId }),
    })
    return publicNode({ ...resolved.node, deletedAt: null, updatedAt: new Date() })
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
    const [session] = await tx.insert(s.driveEditSessions).values({ id: randomUUID(), organizationId: tenant.organizationId, nodeId: resolved.node.id, baseVersionId: input.baseVersionId, accountId: tenant.actor.id, expiresAt: new Date(Date.now() + config.driveUploadTtlSeconds * 1000) }).returning()
    if (!session) throw new HTTPException(500, { message: 'Edit session creation failed' })
    return { id: session.id, nodeId: session.nodeId, baseVersionId: session.baseVersionId, status: session.status, conflict: session.conflict, expiresAt: session.expiresAt.toISOString() }
  })))
  app.get('/v1/organizations/:organizationId/drive/edit-sessions/:id', async c => c.json(await operation(c, async (tx, tenant) => {
    const [session] = await tx.select().from(s.driveEditSessions).where(and(eq(s.driveEditSessions.id, wire.resourceId.parse(c.req.param('id'))), eq(s.driveEditSessions.accountId, tenant.actor.id), eq(s.driveEditSessions.organizationId, tenant.organizationId)))
    if (!session) throw new HTTPException(404, { message: 'Edit session unavailable' })
    if (session.expiresAt <= new Date() && session.status === 'active') await tx.update(s.driveEditSessions).set({ status: 'expired', closedAt: new Date() }).where(eq(s.driveEditSessions.id, session.id))
    return { id: session.id, nodeId: session.nodeId, baseVersionId: session.baseVersionId, status: session.expiresAt <= new Date() ? 'expired' : session.status, conflict: session.conflict, expiresAt: session.expiresAt.toISOString() }
  })))
  app.post('/v1/organizations/:organizationId/drive/edit-sessions/:id/close', async c => c.json(await operation(c, async (tx, tenant) => {
    const id = wire.resourceId.parse(c.req.param('id'))
    const [session] = await tx.update(s.driveEditSessions).set({ status: 'closed', closedAt: new Date() }).where(and(eq(s.driveEditSessions.id, id), eq(s.driveEditSessions.accountId, tenant.actor.id), eq(s.driveEditSessions.organizationId, tenant.organizationId))).returning()
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
    const [updated] = await tx.update(s.driveDescriptions).set({ content: input.content, fields: input.fields ?? current.fields, type: input.type, reference: input.reference ?? current.reference, updatedAt: new Date() }).where(eq(s.driveDescriptions.id, current.id)).returning()
    return updated
  })))
  app.post('/v1/organizations/:organizationId/drive/descriptions/:id/supersede', async c => c.json(await operation(c, async (tx, tenant) => {
    const [current] = await tx.select().from(s.driveDescriptions).where(eq(s.driveDescriptions.id, wire.resourceId.parse(c.req.param('id'))))
    if (!current) forbidden()
    const resolved = await resolveNode(tx, tenant, current.nodeId)
    if (!writable(resolved.role)) forbidden()
    await tx.update(s.driveDescriptions).set({ status: 'superseded', updatedAt: new Date() }).where(eq(s.driveDescriptions.id, current.id))
    return { id: current.id, status: 'superseded' }
  })))
}
