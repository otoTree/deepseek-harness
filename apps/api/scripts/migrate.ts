/** Migration entry restricted to the explicitly provisioned enterprise database and migration role. */
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
loadEnvFile(fileURLToPath(new URL('../../../.env.enterprise', import.meta.url)))
const url = process.env.ENTERPRISE_MIGRATION_URL
if (!url || new URL(url).pathname !== '/dsh_enterprise')
  throw new Error('An explicit dsh_enterprise migration URL is required')
const connection = postgres(url, { max: 1 })
try {
  const [identity] = await connection`select current_user as role`
  if (identity?.role !== 'enterprise_migrator')
    throw new Error('Refusing migrations without the enterprise_migrator role')
  const marker = await connection`select id from enterprise.installation where id = 'deepseek-enterprise-local'`
  if (marker.length !== 1) throw new Error('Enterprise installation marker missing')
  await migrate(drizzle(connection), { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) })
  console.log('Enterprise migrations applied.')
} finally {
  await connection.end()
}
