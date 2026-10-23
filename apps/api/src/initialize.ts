/** Container initialization serializes schema upgrades and creates only a missing deployment. */
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { connectDatabase } from './database.ts'
import { migrateEnterprise } from './migrations.ts'
import { createInitialDeployment, ensureRootAccess } from './provisioning.ts'
import * as schema from './schema.ts'

const initializationLock = 731937125
const bootstrapSchema = z.object({
  ENTERPRISE_BOOTSTRAP_EMAIL: z.email().transform(value => value.toLowerCase()),
  ENTERPRISE_BOOTSTRAP_PASSWORD: z.string().min(12),
})

function databaseUrl(value: string | undefined, name: string): URL {
  if (!value) throw new Error(`${name} is required for automatic database initialization`)
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
    throw new Error(`${name} must identify a PostgreSQL database`)
  }
  return url
}

async function prepareSchemas(connection: postgres.Sql, applicationRole: string, env: NodeJS.ProcessEnv): Promise<void> {
  const recipient = new PgDialect().escapeName(applicationRole)
  const [marker] = await connection`select to_regclass('enterprise.installation') as relation`
  if (!marker?.relation) {
    const [existing] = await connection<{ relation: string }[]>`
      select format('%I.%I', n.nspname, c.relname) as relation
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and (
        n.nspname in ('enterprise', 'enterprise_auth', 'drizzle')
        or (n.nspname = 'public' and not exists (
          select 1 from pg_depend d
          where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.objsubid = 0
            and d.refclassid = 'pg_extension'::regclass and d.deptype = 'e'
        ))
      ) order by n.nspname, c.relname limit 1
    `
    if (existing) throw new Error(`Refusing to initialize an unmarked, non-empty database: existing relation ${existing.relation}`)
    bootstrapSchema.parse(env)
  } else {
    const rows = await connection`select id from enterprise.installation`
    if (rows.length !== 1 || rows[0]?.id !== 'deepseek-enterprise-local') {
      throw new Error('Enterprise installation marker is invalid')
    }
  }
  await connection.begin(async (tx) => {
    await tx`create schema if not exists enterprise`
    await tx`create schema if not exists enterprise_auth`
    await tx`create schema if not exists drizzle`
    await tx`grant usage on schema enterprise, enterprise_auth to ${tx.unsafe(recipient)}`
    await tx`alter default privileges in schema enterprise, enterprise_auth
      grant select, insert, update, delete on tables to ${tx.unsafe(recipient)}`
    await tx`alter default privileges in schema enterprise, enterprise_auth
      grant usage, select on sequences to ${tx.unsafe(recipient)}`
    if (!marker?.relation) {
      await tx`create table enterprise.installation (
        id text primary key check (id = 'deepseek-enterprise-local')
      )`
      await tx`insert into enterprise.installation values ('deepseek-enterprise-local')`
      await tx`revoke insert, update, delete on enterprise.installation from ${tx.unsafe(recipient)}`
      await tx`grant select on enterprise.installation to ${tx.unsafe(recipient)}`
    }
  })
}

/**
 * Upgrade a dedicated enterprise database and bootstrap its first platform administrator.
 * @param env - Database URL and bootstrap values; an optional migration URL overrides the same-account default.
 * @returns Initialization result after both pools close; existing deployments retain their accounts and policy.
 * @throws If database targets, credentials, installation data, DDL permissions or migrations are invalid.
 */
export async function initializeEnterprise(env: NodeJS.ProcessEnv): Promise<'created' | 'existing'> {
  const applicationUrl = databaseUrl(env.ENTERPRISE_DATABASE_URL, 'ENTERPRISE_DATABASE_URL')
  const migrationUrl = env.ENTERPRISE_MIGRATION_URL
    ? databaseUrl(env.ENTERPRISE_MIGRATION_URL, 'ENTERPRISE_MIGRATION_URL')
    : applicationUrl
  if (applicationUrl.hostname !== migrationUrl.hostname
    || (applicationUrl.port || '5432') !== (migrationUrl.port || '5432')
    || applicationUrl.pathname !== migrationUrl.pathname) {
    throw new Error('Application and migration URLs must identify the same database host, port and database')
  }
  const mode = z.enum(['open', 'private']).default('open').parse(env.ENTERPRISE_MODE)
  // The private single-connection pool retains the session lock across Drizzle transactions.
  const connection = postgres(migrationUrl.href, { max: 1, idle_timeout: 0, max_lifetime: 0, connect_timeout: 10, onnotice: () => {} })
  const application = connectDatabase(applicationUrl.href)
  try {
    const [appRole] = await application.db.execute<{ role: string }>(sql`select current_user as role`)
    if (!appRole) throw new Error('PostgreSQL did not return the connected application account')
    await connection`select pg_advisory_lock(${initializationLock})`
    try {
      await prepareSchemas(connection, appRole.role, env)
      await migrateEnterprise(connection, appRole.role, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) })
      return await application.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(731937124)`)
        const [deployment] = await tx.select().from(schema.deployment)
        if (deployment) {
          if (deployment.id !== 'primary' || deployment.mode !== mode || !deployment.rootOrganizationId) {
            throw new Error('Existing enterprise deployment does not match ENTERPRISE_MODE or has no root organization')
          }
          const [admin] = await tx.select().from(schema.platformAdmins)
          if (!admin) throw new Error('Existing deployment has no platform administrator; repair it explicitly')
          return 'existing'
        }
        const bootstrap = bootstrapSchema.parse(env)
        // An unprovisioned database with accounts must not acquire an implicit replacement administrator.
        const [user] = await tx.select({ id: schema.user.id }).from(schema.user).limit(1)
        if (user) throw new Error('Refusing to bootstrap a deployment that already contains accounts')
        const root = randomUUID()
        const accountId = await createInitialDeployment(tx, {
          email: bootstrap.ENTERPRISE_BOOTSTRAP_EMAIL, password: bootstrap.ENTERPRISE_BOOTSTRAP_PASSWORD, root, mode,
        })
        await ensureRootAccess(tx, root, accountId, mode === 'private' ? 'enterprise' : 'platform')
        return 'created'
      })
    } finally {
      await connection`select pg_advisory_unlock(${initializationLock})`
    }
  } finally {
    await Promise.all([application.close(), connection.end()])
  }
}
