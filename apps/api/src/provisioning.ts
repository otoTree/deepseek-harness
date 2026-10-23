/** Shared tenant-root and initial-administrator provisioning for development and container startup. */
import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { and, eq, sql } from 'drizzle-orm'
import { selectOrganization, type Transaction } from './database.ts'
import { organizationId } from './contracts.ts'
import * as s from './schema.ts'

/**
 * Repair the selected root's tenant access records without replacing existing identities.
 * @param tx - Application transaction with an installation provisioning lock.
 * @param root - Deployment root organization ID.
 * @param accountId - Existing platform administrator account ID.
 * @param kind - Root organization type selected by deployment mode.
 * @returns Completion after missing access records exist.
 */
export async function ensureRootAccess(
  tx: Transaction,
  root: string,
  accountId: string,
  kind: 'platform' | 'enterprise',
): Promise<void> {
  await selectOrganization(tx, organizationId.parse(root))
  const [existingOrganization] = await tx.select().from(s.organizations).where(eq(s.organizations.id, root))
  if (!existingOrganization) {
    await tx.insert(s.organizations).values({ id: root, rootId: root, name: kind === 'platform' ? 'Platform' : 'Enterprise', kind })
  }
  const [existingUnit] = await tx.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.organizationId, root), eq(s.units.unitType, 'root')))
  const unitId = existingUnit?.id ?? randomUUID()
  if (!existingUnit) await tx.insert(s.units).values({ id: unitId, organizationId: root, name: kind === 'platform' ? 'Platform' : 'Enterprise', unitType: 'root' })
  const [existingMembership] = await tx.select().from(s.memberships)
    .where(and(eq(s.memberships.organizationId, root), eq(s.memberships.accountId, accountId)))
  const membershipId = existingMembership?.id ?? randomUUID()
  if (!existingMembership) {
    await tx.insert(s.memberships).values({ id: membershipId, organizationId: root, accountId, status: 'active' })
  } else if (existingMembership.status !== 'active') {
    await tx.update(s.memberships).set({ status: 'active' }).where(eq(s.memberships.id, membershipId))
  }
  const [existingRole] = await tx.select({ id: s.roles.id }).from(s.roles).where(and(eq(s.roles.organizationId, root), eq(s.roles.membershipId, membershipId), eq(s.roles.role, 'owner'), sql`${s.roles.unitId} IS NULL`))
  if (!existingRole) await tx.insert(s.roles).values({ id: randomUUID(), organizationId: root, membershipId, role: 'owner', effect: 'allow' })
  await tx.insert(s.assignments).values({ organizationId: root, membershipId, unitId }).onConflictDoNothing()
  await tx.insert(s.subscriptions).values({ organizationId: root, plan: kind === 'platform' ? 'enterprise' : 'private' }).onConflictDoNothing()
  await tx.insert(s.organizationWallets).values({ organizationId: root }).onConflictDoNothing()
}


/**
 * Create a deployment and its first administrator in the caller's transaction.
 * @param tx - Application transaction holding the installation provisioning lock.
 * @param input - Validated administrator credentials, root ID and deployment mode.
 * @returns New administrator account ID; passwords are stored only as Better Auth hashes.
 */
export async function createInitialDeployment(tx: Transaction, input: {
  email: string
  password: string
  root: string
  mode: 'open' | 'private'
}): Promise<string> {
  const accountId = randomUUID()
  await tx.insert(s.user).values({ id: accountId, name: 'Platform Owner', email: input.email, emailVerified: true })
  await tx.insert(s.account).values({ id: randomUUID(), userId: accountId, accountId, providerId: 'credential', password: await hashPassword(input.password) })
  await tx.insert(s.platformAdmins).values({ accountId })
  await tx.insert(s.deployment).values({ id: 'primary', rootOrganizationId: input.root, mode: input.mode, registration: input.mode === 'private' ? 'invite_only' : 'open' })
  return accountId
}
