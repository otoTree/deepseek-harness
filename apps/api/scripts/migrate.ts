/** Migrate the marked enterprise database using the accounts supplied in its environment URLs. */
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { migrateEnterprise } from '../src/migrations.ts'
loadEnvFile(fileURLToPath(new URL('../../../.env.enterprise', import.meta.url)))
const applicationUrl = process.env.ENTERPRISE_DATABASE_URL
if (!applicationUrl) throw new Error('ENTERPRISE_DATABASE_URL is required to select migration grant recipients')
const url = process.env.ENTERPRISE_MIGRATION_URL || applicationUrl
if (!url || new URL(url).pathname !== '/dsh_enterprise')
  throw new Error('An explicit dsh_enterprise migration URL is required')
const connection = postgres(url, { max: 1 })
const application = postgres(applicationUrl, { max: 1 })
try {
  const [applicationRole] = await application<{ role: string }[]>`select current_user as role`
  const marker = await connection`select id from enterprise.installation where id = 'deepseek-enterprise-local'`
  if (marker.length !== 1) throw new Error('Enterprise installation marker missing')
  await migrateEnterprise(connection, applicationRole!.role, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) })
  console.log('Enterprise migrations applied.')
} finally {
  await Promise.all([application.end(), connection.end()])
}
