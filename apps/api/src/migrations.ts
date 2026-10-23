/** Deployment account names are bound into historical grants without changing migration files or hashes. */
import type postgres from 'postgres'
import { readMigrationFiles, type MigrationConfig } from 'drizzle-orm/migrator'
import { PgDialect } from 'drizzle-orm/pg-core'
import { PostgresJsSession } from 'drizzle-orm/postgres-js'

/**
 * Apply the enterprise journal with grants targeting the configured application account.
 * @param connection - Migration pool; the caller owns initialization locking and pool disposal.
 * @param applicationRole - Actual PostgreSQL role returned by the application connection.
 * @param config - Drizzle migration directory and optional journal location.
 * @returns Completion after Drizzle commits pending migrations with their original file hashes.
 * @throws If migration files, role grants or SQL execution fail.
 */
export async function migrateEnterprise(connection: postgres.Sql, applicationRole: string, config: MigrationConfig): Promise<void> {
  const dialect = new PgDialect()
  const migrations = readMigrationFiles(config).map(migration => ({
    ...migration,
    // Historical SQL uses this role only as the recipient of GRANT and REVOKE statements.
    sql: migration.sql.map(statement => statement.replace(/\b(TO|FROM) enterprise_app\b/g,
      (_, direction: string) => `${direction} ${dialect.escapeName(applicationRole)}`)),
  }))
  await dialect.migrate(migrations, new PostgresJsSession(connection, dialect, undefined), config)
}
