/** Provision a fresh enterprise installation; existing deployments and accounts are never overwritten. */
import { loadEnvFile } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { hashPassword } from 'better-auth/crypto'
import { connectDatabase, selectOrganization, type Transaction } from '../src/database.ts'
import { organizationId } from '../src/contracts.ts'
import * as s from '../src/schema.ts'
import { and, eq, sql } from 'drizzle-orm'

loadEnvFile(fileURLToPath(new URL('../../../.env.enterprise', import.meta.url)))
const database = z.url().parse(process.env.ENTERPRISE_DATABASE_URL)
const mode = z.enum(['open', 'private']).default('open').parse(process.env.ENTERPRISE_MODE)
const ifNeeded = process.argv.includes('--if-needed')
const developmentRootOrganizationId = organizationId.parse('00000000-0000-4000-8000-000000000001')

/** Ask for development bootstrap values only when the empty deployment has no environment values. */
async function bootstrapValues(): Promise<{ email: string; password: string }> {
  const email = process.env.ENTERPRISE_BOOTSTRAP_EMAIL
  const password = process.env.ENTERPRISE_BOOTSTRAP_PASSWORD
  if (email && password) return { email: z.email().parse(email).toLowerCase(), password }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Set ENTERPRISE_BOOTSTRAP_EMAIL and ENTERPRISE_BOOTSTRAP_PASSWORD for non-interactive provisioning')
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const enteredEmail = email ?? await prompt.question('Initial administrator email: ')
    const enteredPassword = password ?? await prompt.question('Initial administrator password: ')
    return { email: z.email().parse(enteredEmail).toLowerCase(), password: z.string().min(1).parse(enteredPassword) }
  } finally {
    prompt.close()
  }
}

/** Ensure one deployment root has the records required by tenant entry and Runtime registration. */
async function ensureRootAccess(
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

const pool = connectDatabase(database)
const inspector = connectDatabase(z.url().parse(process.env.ENTERPRISE_MIGRATION_URL))
try {
  const marker = await pool.db.execute(
    sql`select id from enterprise.installation where id = 'deepseek-enterprise-local'`,
  )
  if (marker.length !== 1) throw new Error('Enterprise installation marker missing')
  const existingDeployments = await inspector.db.select().from(s.deployment)
  if (existingDeployments.length > 0 && !ifNeeded) throw new Error('Deployment already provisioned; no account or policy changed')
  const bootstrap = existingDeployments.length === 0 ? await bootstrapValues() : undefined
  await pool.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(731937124)`)
    let [deployment] = await tx.select().from(s.deployment).where(eq(s.deployment.id, 'primary')).for('update')
    let accountId: string | undefined
    if (deployment === undefined) {
      if (bootstrap === undefined) throw new Error('Bootstrap credentials are required for a new deployment')
      accountId = randomUUID()
      await tx.insert(s.user).values({ id: accountId, name: 'Platform Owner', email: bootstrap.email, emailVerified: true })
      await tx.insert(s.account).values({ id: randomUUID(), userId: accountId, accountId, providerId: 'credential', password: await hashPassword(bootstrap.password) })
      await tx.insert(s.platformAdmins).values({ accountId })
      await tx.insert(s.deployment).values({ id: 'primary', rootOrganizationId: developmentRootOrganizationId, mode, registration: mode === 'private' ? 'invite_only' : 'open' })
      ;[deployment] = await tx.select().from(s.deployment).where(eq(s.deployment.id, 'primary'))
    } else {
      const [admin] = await tx.select({ accountId: s.platformAdmins.accountId }).from(s.platformAdmins)
      accountId = admin?.accountId
      if (accountId === undefined) {
        const [adminUser] = await tx.select({ id: s.user.id }).from(s.user).where(eq(s.user.email, bootstrap?.email ?? 'admin@example.com'))
        accountId = adminUser?.id
      }
      if (accountId === undefined) throw new Error('Existing deployment has no platform administrator; repair it explicitly before starting')
      if (deployment.rootOrganizationId === null) {
        await tx.update(s.deployment).set({ rootOrganizationId: developmentRootOrganizationId }).where(eq(s.deployment.id, 'primary'))
        deployment = { ...deployment, rootOrganizationId: developmentRootOrganizationId }
      }
    }
    if (deployment === undefined || deployment.rootOrganizationId === null) throw new Error('Enterprise deployment root organization is missing')
    await tx.insert(s.platformAdmins).values({ accountId }).onConflictDoNothing()
    await ensureRootAccess(tx, deployment.rootOrganizationId, accountId, deployment.mode === 'private' ? 'enterprise' : 'platform')
  })
  console.log(existingDeployments.length === 0
    ? 'Enterprise deployment provisioned; bootstrap credentials were not printed.'
    : 'Enterprise deployment verified and repaired where required.')
} finally {
  await pool.close()
  await inspector.close()
}
