/** Provision a fresh enterprise installation; existing deployments and accounts are never overwritten. */
import { loadEnvFile } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { hashPassword } from 'better-auth/crypto'
import { connectDatabase, selectOrganization } from '../src/database.ts'
import { organizationId } from '../src/contracts.ts'
import * as s from '../src/schema.ts'
import { sql } from 'drizzle-orm'

loadEnvFile(fileURLToPath(new URL('../../../.env.enterprise', import.meta.url)))
const database = z.url().parse(process.env.ENTERPRISE_DATABASE_URL)
const mode = z.enum(['open', 'private']).default('open').parse(process.env.ENTERPRISE_MODE)
const ifNeeded = process.argv.includes('--if-needed')

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
  const alreadyProvisioned = await inspector.db.select().from(s.deployment)
  if (alreadyProvisioned.length) {
    if (!ifNeeded) throw new Error('Deployment already provisioned; no account or policy changed')
    console.log('Enterprise deployment already provisioned; no account or policy changed.')
  } else {
    const bootstrap = await bootstrapValues()
    const input = { database, mode, ...bootstrap }
    await pool.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(731937124)`)
      const existing = await tx.select().from(s.deployment)
      if (existing.length) throw new Error('Deployment already provisioned; no account or policy changed')
      const id = randomUUID()
      await tx
        .insert(s.user)
        .values({ id, name: 'Platform Owner', email: input.email, emailVerified: true })
      await tx.insert(s.account).values({
        id: randomUUID(),
        userId: id,
        accountId: id,
        providerId: 'credential',
        password: await hashPassword(input.password),
      })
      await tx.insert(s.platformAdmins).values({ accountId: id })
      await tx.insert(s.deployment).values({
        id: 'primary',
        mode: input.mode,
        registration: input.mode === 'private' ? 'invite_only' : 'open',
      })
      if (input.mode === 'private') {
        const org = organizationId.parse(randomUUID())
        const member = randomUUID()
        const unit = randomUUID()
        await selectOrganization(tx, org)
        await tx.insert(s.organizations).values({ id: org, name: 'Enterprise', kind: 'enterprise' })
        await tx.insert(s.units).values({ id: unit, organizationId: org, name: 'Enterprise', unitType: 'root' })
        await tx.insert(s.memberships).values({ id: member, organizationId: org, accountId: id })
        await tx.insert(s.roles).values({ id: randomUUID(), organizationId: org, membershipId: member, role: 'owner' })
        await tx.insert(s.assignments).values({ organizationId: org, membershipId: member, unitId: unit })
        await tx.insert(s.subscriptions).values({ organizationId: org, plan: 'private' })
      }
    })
    console.log('Enterprise deployment provisioned; bootstrap credentials were not printed.')
  }
} finally {
  await pool.close()
  await inspector.close()
}
