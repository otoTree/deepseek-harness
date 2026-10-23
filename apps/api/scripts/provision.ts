/** Provision a fresh enterprise installation; existing deployments and accounts are never overwritten. */
import { loadEnvFile } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { connectDatabase } from '../src/database.ts'
import { createInitialDeployment, ensureRootAccess } from '../src/provisioning.ts'
import { organizationId } from '../src/contracts.ts'
import * as s from '../src/schema.ts'
import { eq, sql } from 'drizzle-orm'

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
      accountId = await createInitialDeployment(tx, { ...bootstrap, root: developmentRootOrganizationId, mode })
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
