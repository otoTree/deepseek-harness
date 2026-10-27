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
export async function enterTenant(tx: Transaction, actor: Actor, organizationId: OrganizationId,
  allowInactiveTeam = false): Promise<Tenant> {
  await identify(tx, actor.id, actor.email)
  const membershipRows = await tx.execute(sql`
    SELECT enterprise.find_membership_for_org(${organizationId}, ${actor.id}) AS membership_id
  `)
  const membershipId = membershipRows[0]?.membership_id
  if (typeof membershipId !== 'string') forbidden()
  await selectOrganization(tx, organizationId)
  const [organization] = await tx.select().from(organizations).where(eq(organizations.id, organizationId))
  if (!organization) forbidden()
  if (organization.status !== 'active' && !allowInactiveTeam) {
    throw new HTTPException(403, { message: organization.status === 'closed' ? 'TEAM_CLOSED' : 'TEAM_SUSPENDED' })
  }
  return { actor, organizationId, membershipId }
}

/** Require an organization-wide role; a department grant never implies organization administration. */
export async function requireRole(tx: Transaction, tenant: Tenant, allowed: readonly Role[]): Promise<void> {
  if (!(await hasRole(tx, tenant, allowed))) forbidden()
}

/** Return whether the actor holds an organization-wide fixed role; department and other-team bindings confer no authority. */
export async function hasRole(tx: Transaction, tenant: Tenant, allowed: readonly Role[]): Promise<boolean> {
  const bindings = await tx.execute(sql`
    SELECT r.role, r.effect
    FROM enterprise.role_binding r
    JOIN enterprise.membership m ON m.id = r.membership_id AND m.organization_id = r.organization_id
    JOIN enterprise.authorization_organizations(${tenant.organizationId}) a ON a.id = r.organization_id
    WHERE m.account_id = ${tenant.actor.id}
      AND m.status = 'active'
      AND r.unit_id IS NULL
  `)
  return allowed.some(role => bindings.some(binding => binding.role === role && binding.effect === 'allow')
    && !bindings.some(binding => binding.role === role && binding.effect === 'deny'))
}

const fixedRolePermissions: Record<string, readonly string[]> = {
  owner: ['organization.read', 'organization.manage', 'member.read', 'member.manage', 'role.manage',
    'identity.manage', 'directory.sync', 'sandbox.manage', 'audit.read', 'budget.manage', 'billing.read',
    'storage.manage', 'plugin.manage', 'plugin.publish', 'plugin.review', 'model.use', 'storage.write'],
  administrator: ['organization.read', 'member.read', 'member.manage', 'role.manage', 'identity.manage',
    'directory.sync', 'sandbox.manage', 'audit.read', 'budget.manage', 'billing.read', 'storage.manage', 'plugin.manage', 'plugin.review', 'model.use', 'storage.write'],
  member: ['organization.read', 'member.read', 'sandbox.manage', 'model.use', 'storage.write'],
  security_reviewer: ['organization.read', 'member.read', 'audit.read', 'plugin.review'],
  plugin_publisher: ['organization.read', 'member.read', 'plugin.publish', 'plugin.review'],
  finance_auditor: ['organization.read', 'audit.read', 'billing.read'],
}

/**
 * Resolve enabled, team-wide permissions with explicit denials taking precedence.
 * @param tx Tenant-selected transaction.
 * @param tenant Active membership and actor.
 * @returns Effective permission IDs, without department or other-team grants.
 */
export async function effectivePermissions(tx: Transaction, tenant: Tenant): Promise<string[]> {
  const rows = await tx.execute(sql`
    SELECT r.effect, r.role, cr.enabled, crp.permission_id
    FROM enterprise.role_binding r
    JOIN enterprise.membership m ON m.id = r.membership_id AND m.organization_id = r.organization_id
    LEFT JOIN enterprise.custom_role cr ON cr.id = substring(r.role from 8) AND cr.organization_id = r.organization_id
    LEFT JOIN enterprise.custom_role_permission crp ON crp.role_id = cr.id
    WHERE m.account_id = ${tenant.actor.id} AND m.status = 'active'
      AND r.organization_id = ${tenant.organizationId} AND r.unit_id IS NULL
  `)
  const allowed = new Set<string>()
  const denied = new Set<string>()
  for (const row of rows) {
    const role = String(row.role)
    const permissions = role.startsWith('custom:')
      ? (row.enabled === true && typeof row.permission_id === 'string' ? [row.permission_id] : [])
      : (fixedRolePermissions[role] ?? [])
    for (const value of permissions) (row.effect === 'deny' ? denied : allowed).add(value)
  }
  return [...allowed].filter(value => !denied.has(value)).sort()
}

/**
 * Require a current team-wide permission.
 * @param tx Tenant-selected transaction.
 * @param tenant Active membership and actor.
 * @param permissionId Required resource/action ID.
 * @returns Completion if authorized; otherwise rejects without revealing protected records.
 */
export async function requirePermission(tx: Transaction, tenant: Tenant, permissionId: string): Promise<void> {
  if (!(await effectivePermissions(tx, tenant)).includes(permissionId)) forbidden()
}

/**
 * Protect the final active Owner before changing a membership or its Owner grant.
 * @param tx Transaction holding the team lock.
 * @param organizationId Team receiving the mutation.
 * @param membershipId Membership losing access or ownership.
 * @returns Completion if another active Owner exists or the target is not an Owner.
 */
export async function protectFinalOwner(tx: Transaction, organizationId: OrganizationId, membershipId: string): Promise<void> {
  const owners = await tx.execute(sql`
    SELECT DISTINCT m.id FROM enterprise.membership m JOIN enterprise.role_binding r ON r.membership_id = m.id
    WHERE m.organization_id = ${organizationId} AND m.status = 'active' AND r.organization_id = m.organization_id
      AND r.unit_id IS NULL AND r.role = 'owner' AND r.effect = 'allow'
      AND NOT EXISTS (SELECT 1 FROM enterprise.role_binding d WHERE d.membership_id = m.id
        AND d.organization_id = m.organization_id AND d.unit_id IS NULL AND d.role = 'owner' AND d.effect = 'deny')
  `)
  if (owners.some(owner => owner.id === membershipId) && !owners.some(owner => owner.id !== membershipId)) {
    throw new HTTPException(409, { message: 'FINAL_OWNER_REQUIRED' })
  }
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
