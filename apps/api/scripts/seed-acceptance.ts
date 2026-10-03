/** Seed the deterministic Acme acceptance organization without replacing existing data. */
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as s from '../src/schema.ts'
import { enterpriseCompanyFixture } from '../tests/fixtures/enterprise-company.ts'
import { hashPassword } from 'better-auth/crypto'

loadEnvFile(fileURLToPath(new URL('../../../.env.enterprise', import.meta.url)))
const url = process.env.ENTERPRISE_MIGRATION_URL
if (!url || new URL(url).pathname !== '/dsh_enterprise') throw new Error('An explicit dsh_enterprise migration URL is required')
const connection = postgres(url, { max: 1 })
const [identity] = await connection`select current_user as role`
if (identity?.role !== 'enterprise_migrator') throw new Error('Refusing acceptance seed without the enterprise_migrator role')
const marker = await connection`select id from enterprise.installation where id = 'deepseek-enterprise-local'`
if (marker.length !== 1) throw new Error('Enterprise installation marker missing')
const pool = { db: drizzle(connection, { schema: s }), close: () => connection.end() }
const rootId = '10000000-0000-4000-8000-000000000001'
const userIds = ['10000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000103']
const orgIds = ['10000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000013']
const unitIds = [
  ['10000000-0000-4000-8000-000000000111', '10000000-0000-4000-8000-000000000112', '10000000-0000-4000-8000-000000000113', '10000000-0000-4000-8000-000000000114'],
  ['10000000-0000-4000-8000-000000000121', '10000000-0000-4000-8000-000000000122', '10000000-0000-4000-8000-000000000123', '10000000-0000-4000-8000-000000000124'],
  ['10000000-0000-4000-8000-000000000131', '10000000-0000-4000-8000-000000000132', '10000000-0000-4000-8000-000000000133', '10000000-0000-4000-8000-000000000134'],
] as const

try {
  await pool.db.transaction(async (tx) => {
    const setTenant = async (organizationId: string): Promise<void> => {
      await tx.execute(sql`select set_config('enterprise.organization_id', ${organizationId}, true)`)
    }
    await setTenant(rootId)
    const [root] = await tx.select().from(s.organizations).where(eq(s.organizations.id, rootId))
    if (!root) await tx.insert(s.organizations).values({ id: rootId, rootId, name: enterpriseCompanyFixture.root.name, kind: 'group' })
    for (const [index, item] of enterpriseCompanyFixture.organizations.entries()) {
      const organizationId = orgIds[index]
      if (!organizationId) continue
      await setTenant(organizationId)
      const [organization] = await tx.select().from(s.organizations).where(eq(s.organizations.id, organizationId))
      if (!organization) await tx.insert(s.organizations).values({ id: organizationId, parentId: rootId, rootId, name: item.name, kind: 'company' })
      const rootUnitId = unitIds[index]?.[0]
      if (!rootUnitId) continue
      const [unit] = await tx.select().from(s.units).where(eq(s.units.id, rootUnitId))
      if (!unit) await tx.insert(s.units).values({ id: rootUnitId, organizationId, name: item.name, unitType: 'root' })
      for (const [departmentIndex, department] of item.departments.entries()) {
        const unitId = unitIds[index]?.[departmentIndex + 1]
        if (!unitId) continue
        const [departmentRow] = await tx.select().from(s.units).where(eq(s.units.id, unitId))
        if (!departmentRow) await tx.insert(s.units).values({ id: unitId, organizationId, parentId: rootUnitId, name: department, unitType: 'department' })
      }
    }
    const emails = ['ada@example.invalid', 'lin@example.invalid', 'morgan@example.invalid']
    for (const [index, email] of emails.entries()) {
      const accountId = userIds[index]
      if (!accountId) continue
      const [user] = await tx.select().from(s.user).where(eq(s.user.id, accountId))
      if (!user) {
        await tx.insert(s.user).values({ id: accountId, name: enterpriseCompanyFixture.users[index]?.name ?? email, email, emailVerified: true })
        await tx.insert(s.account).values({ id: randomUUID(), userId: accountId, accountId, providerId: 'credential', password: await hashPassword('AcmeFixturePassword123!') })
      }
      const organizationId = orgIds[index % orgIds.length] as string
      await setTenant(organizationId)
      const membershipId = `10000000-0000-4000-8000-00000000020${index + 1}`
      const [membership] = await tx.select().from(s.memberships).where(eq(s.memberships.id, membershipId))
      if (!membership) await tx.insert(s.memberships).values({ id: membershipId, organizationId, accountId, status: index === 2 ? 'suspended' : 'active' })
      const rootUnitId = unitIds[index % unitIds.length]?.[0]
      if (!rootUnitId) continue
      const [assignment] = await tx.select().from(s.assignments).where(and(eq(s.assignments.membershipId, membershipId), eq(s.assignments.unitId, rootUnitId)))
      if (!assignment) await tx.insert(s.assignments).values({ organizationId, membershipId, unitId: rootUnitId })
      const role = index === 0 ? 'administrator' : index === 1 ? 'finance_auditor' : 'member'
      const [binding] = await tx.select().from(s.roles).where(and(eq(s.roles.membershipId, membershipId), eq(s.roles.role, role)))
      if (!binding) await tx.insert(s.roles).values({ id: randomUUID(), organizationId, membershipId, role })
    }
    const [admin] = await tx.select().from(s.user).where(eq(s.user.email, 'admin@example.invalid'))
    if (admin) {
      await setTenant(orgIds[0]!)
      const membershipId = '10000000-0000-4000-8000-000000000299'
      await tx.insert(s.memberships).values({ id: membershipId, organizationId: orgIds[0]!, accountId: admin.id, status: 'active' }).onConflictDoNothing()
      await tx.insert(s.roles).values({ id: '10000000-0000-4000-8000-000000000399', organizationId: orgIds[0]!, membershipId, role: 'owner', effect: 'allow' }).onConflictDoNothing()
    }
    for (const organizationId of orgIds) {
      await setTenant(organizationId)
      await tx.insert(s.subscriptions).values({ organizationId, plan: 'enterprise', seats: 100, runtimes: 20 }).onConflictDoNothing()
      await tx.insert(s.organizationWallets).values({ organizationId }).onConflictDoNothing()
    }
  })
  console.log('Acceptance organization seeded: Acme Group with three subsidiaries and nine departments.')
} finally {
  await pool.close()
}
