/** Reset the development platform administrator password without changing tenant data. */
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { hashPassword } from 'better-auth/crypto'
import { eq } from 'drizzle-orm'
import { connectDatabase } from '../src/database.ts'
import * as s from '../src/schema.ts'

loadEnvFile(fileURLToPath(new URL('../../../.env.enterprise', import.meta.url)))
const database = z.url().parse(process.env.ENTERPRISE_DATABASE_URL)
const email = z.email().parse(process.env.ENTERPRISE_BOOTSTRAP_EMAIL).toLowerCase()
const password = z.string().min(1).parse(process.env.ENTERPRISE_BOOTSTRAP_PASSWORD)
const pool = connectDatabase(database)

try {
  const admins = await pool.db
    .select({ accountId: s.platformAdmins.accountId, userId: s.user.id })
    .from(s.platformAdmins)
    .innerJoin(s.user, eq(s.user.id, s.platformAdmins.accountId))
  if (admins.length !== 1) throw new Error(`Expected exactly one platform administrator; found ${admins.length}`)
  const admin = admins[0]
  await pool.db.transaction(async (tx) => {
    await tx.update(s.user).set({ email, emailVerified: true }).where(eq(s.user.id, admin.userId))
    await tx.update(s.account).set({ password: await hashPassword(password) }).where(eq(s.account.userId, admin.userId))
  })
  console.log(`Development administrator credentials reset for ${email}.`)
} finally {
  await pool.close()
}
