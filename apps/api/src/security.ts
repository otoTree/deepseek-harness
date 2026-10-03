/** Credential encryption binds ciphertext to the model ID; public errors omit upstream secrets. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { HTTPException } from 'hono/http-exception'
import { eq, sql } from 'drizzle-orm'
import type { AccountId, OrganizationId, Role } from './contracts.ts'
import type { Transaction } from './database.ts'
import { identify, selectOrganization } from './database.ts'
import { organizations, audit, platformAdmins } from './schema.ts'
import { randomUUID } from 'node:crypto'

export interface Actor {
  id: AccountId
  email: string
  runtimeId?: string
}
export interface Tenant {
  actor: Actor
  organizationId: OrganizationId
  membershipId: string
}

/** SHA-256 digest for high-entropy tokens; not a password hashing function. */
export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
/** Encrypt an upstream credential with authenticated encryption and an explicit resource binding. */
export function encrypt(value: string, key: string, binding: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv)
  cipher.setAAD(Buffer.from(binding))
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), bytes].map(v => v.toString('base64url')).join('.')
}
/** Authenticate and decrypt a previously bound upstream credential. */
export function decrypt(value: string, key: string, binding: string): string {
  const [iv, tag, bytes] = value.split('.').map(v => Buffer.from(v, 'base64url'))
  if (!iv || !tag || !bytes) throw new Error('Invalid encrypted credential')
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv)
  cipher.setAAD(Buffer.from(binding))
  cipher.setAuthTag(tag)
  return Buffer.concat([cipher.update(bytes), cipher.final()]).toString('utf8')
}
/** Deny without revealing whether an object exists in another organization. */
export function forbidden(): never {
  throw new HTTPException(403, { message: 'Access denied' })
}

/** Resolve membership before enabling tenant-table access on the pooled connection. */
export async function enterTenant(tx: Transaction, actor: Actor, organizationId: OrganizationId): Promise<Tenant> {
  await identify(tx, actor.id, actor.email)
  const membershipRows = await tx.execute(sql`
    SELECT enterprise.find_membership_for_org(${organizationId}, ${actor.id}) AS membership_id
  `)
  const membershipId = membershipRows[0]?.membership_id
  if (typeof membershipId !== 'string') forbidden()
  await selectOrganization(tx, organizationId)
  const [organization] = await tx.select().from(organizations).where(eq(organizations.id, organizationId))
  if (!organization || organization.status !== 'active') forbidden()
  return { actor, organizationId, membershipId }
}

/** Require an organization-wide role; a department grant never implies organization administration. */
export async function requireRole(tx: Transaction, tenant: Tenant, allowed: readonly Role[]): Promise<void> {
  const bindings = await tx.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM enterprise.organization
      WHERE id = ${tenant.organizationId}
      UNION ALL
      SELECT parent.id, parent.parent_id
      FROM enterprise.organization parent
      JOIN ancestors child ON child.parent_id = parent.id
    )
    SELECT r.role
    FROM enterprise.role_binding r
    JOIN enterprise.membership m ON m.id = r.membership_id
    JOIN ancestors a ON a.id = r.organization_id
    WHERE m.account_id = ${tenant.actor.id}
      AND m.status = 'active'
      AND r.unit_id IS NULL
  `)
  if (!bindings.some(binding => allowed.some(value => value === binding.role))) forbidden()
}

const fixedRolePermissions: Record<string, readonly string[]> = {
  owner: ['organization.read', 'organization.manage', 'member.read', 'member.manage', 'role.manage', 'identity.manage', 'directory.sync', 'session.read', 'session.export', 'model.manage', 'sandbox.manage', 'audit.read'],
  administrator: ['organization.read', 'member.read', 'member.manage', 'role.manage', 'identity.manage', 'directory.sync', 'session.read', 'session.export', 'sandbox.manage', 'audit.read'],
  member: ['organization.read', 'member.read', 'sandbox.manage'],
  security_reviewer: ['organization.read', 'member.read', 'session.read', 'session.export', 'audit.read'],
  plugin_publisher: ['organization.read', 'member.read'],
  finance_auditor: ['organization.read', 'audit.read'],
}

/** Require a resource/action permission, including inherited custom-role bindings. */
export async function requirePermission(tx: Transaction, tenant: Tenant, permissionId: string): Promise<void> {
  const rows = await tx.execute(sql`
    WITH RECURSIVE organization_tree AS (
      SELECT id, parent_id FROM enterprise.organization WHERE id = ${tenant.organizationId}
      UNION ALL
      SELECT parent.id, parent.parent_id
      FROM enterprise.organization parent
      JOIN organization_tree child ON child.parent_id = parent.id
    ), unit_tree AS (
      SELECT id, organization_id, parent_id
      FROM enterprise.org_unit
      WHERE organization_id IN (SELECT id FROM organization_tree) AND parent_id IS NULL
      UNION ALL
      SELECT child.id, child.organization_id, child.parent_id
      FROM enterprise.org_unit child
      JOIN unit_tree parent ON parent.id = child.parent_id AND parent.organization_id = child.organization_id
    )
    SELECT r.effect, r.role, cr.enabled, crp.permission_id
    FROM enterprise.role_binding r
    JOIN enterprise.membership m ON m.id = r.membership_id AND m.organization_id = r.organization_id
    LEFT JOIN enterprise.custom_role cr ON cr.id = substring(r.role from 8)
    LEFT JOIN enterprise.custom_role_permission crp ON crp.role_id = cr.id AND crp.permission_id = ${permissionId}
    WHERE m.account_id = ${tenant.actor.id}
      AND m.status = 'active'
      AND r.organization_id IN (SELECT id FROM organization_tree)
      AND (r.unit_id IS NULL OR r.unit_id IN (SELECT id FROM unit_tree))
  `)
  const allowed = new Set<string>()
  const denied = new Set<string>()
  for (const row of rows) {
    const role = typeof row.role === 'string' ? row.role : ''
    const effect = row.effect === 'deny' ? 'deny' : 'allow'
    const permissions = role.startsWith('custom:')
      ? (row.enabled === true && row.permission_id === permissionId ? [permissionId] : [])
      : (fixedRolePermissions[role] ?? [])
    for (const value of permissions) (effect === 'deny' ? denied : allowed).add(value)
  }
  if (denied.has(permissionId) || !allowed.has(permissionId)) forbidden()
}

/** Require platform authority without granting access to customer conversations. */
export async function requirePlatform(tx: Transaction, actor: Actor): Promise<void> {
  const found = await tx.select().from(platformAdmins).where(eq(platformAdmins.accountId, actor.id))
  if (found.length === 0) forbidden()
}

/** Lock an organization while changing seats, roles or hierarchy. */
export async function lockOrganization(tx: Transaction, id: OrganizationId): Promise<void> {
  await tx.execute(sql`select id from enterprise.organization where id = ${id} for update`)
}

/** Append an audit fact in the same transaction as the mutation or protected read. */
export async function recordAudit(
  tx: Transaction,
  tenant: Tenant,
  action: string,
  resourceId?: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(audit).values({
    id: randomUUID(),
    organizationId: tenant.organizationId,
    actorId: tenant.actor.id,
    action,
    resourceId,
    detail,
  })
}
