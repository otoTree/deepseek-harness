/* oxlint-disable @stylistic/max-len -- SQL validation expressions mirror the database capability protocol. */
import postgres from 'postgres'
import { createHash } from 'node:crypto'

/** Restricted statement accepted by the plugin database capability. */
export type PluginSqlStatement = { readonly sql: string; readonly params?: readonly unknown[] }
export type PluginSqlResult = { readonly rows: readonly Record<string, unknown>[]; readonly rowCount: number }
type Executor = { unsafe(query: string, values?: readonly unknown[]): Promise<readonly Record<string, unknown>[] & { count: number }> }

/** Independent PostgreSQL service for plugin data spaces. */
export interface PluginDatabaseService {
  query(dataSpaceId: string, statement: PluginSqlStatement): Promise<PluginSqlResult>
  transaction(dataSpaceId: string, statements: readonly PluginSqlStatement[]): Promise<readonly PluginSqlResult[]>
  migrate(dataSpaceId: string, migrations: readonly { version: number; statements: readonly string[] }[]): Promise<void>
  deleteDataSpace(dataSpaceId: string): Promise<void>
  close(): Promise<void>
}

function schemaName(dataSpaceId: string): string {
  return `plugin_${createHash('sha256').update(dataSpaceId).digest('hex').slice(0, 32)}`
}

function validateStatement(statement: PluginSqlStatement): void {
  if (!statement.sql.trim() || statement.sql.length > 64 * 1024 || statement.sql.includes(';')) throw new Error('plugin/database-invalid-sql')
  if (statement.params !== undefined && statement.params.length > 100) throw new Error('plugin/database-too-many-parameters')
  if (/(?:^|\W)(?:alter|create|drop|grant|revoke|copy|listen|notify|set|reset|vacuum|analyze|do|call|prepare|execute|pg_catalog|information_schema)(?:\W|$)/iu.test(statement.sql)) {
    throw new Error('plugin/database-statement-forbidden')
  }
  if (/--|\/\*/u.test(statement.sql)) throw new Error('plugin/database-invalid-sql')
  if (!/^(?:select|insert|update|delete|with)\b/iu.test(statement.sql.trim())) throw new Error('plugin/database-statement-forbidden')
}

/** Connect to the separate plugin database and isolate each data space with a private schema. */
export function connectPluginDatabase(url: string): PluginDatabaseService {
  const client = postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 10 })
  const ensureSchema = async (dataSpaceId: string): Promise<string> => {
    const schema = schemaName(dataSpaceId)
    await client.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    return schema
  }
  const execute = async (statement: PluginSqlStatement, executor: Executor): Promise<PluginSqlResult> => {
    validateStatement(statement)
    const rows = await executor.unsafe(statement.sql, statement.params ?? [])
    return { rows: rows as readonly Record<string, unknown>[], rowCount: rows.count }
  }
  const migrate = async (dataSpaceId: string, migrations: readonly { version: number; statements: readonly string[] }[]): Promise<void> => {
    if (migrations.length > 128 || migrations.some(item => !Number.isInteger(item.version) || item.version < 1 || item.statements.length === 0 || item.statements.length > 128)) throw new Error('plugin/database-invalid-migration')
    const schema = await ensureSchema(dataSpaceId)
    await client.begin(async (tx) => {
      const executor = tx as unknown as Executor
      await executor.unsafe(`SET LOCAL search_path TO "${schema}"`)
      await executor.unsafe('CREATE TABLE IF NOT EXISTS _dsh_migrations (version integer PRIMARY KEY)')
      for (const migration of migrations) {
        const applied = await executor.unsafe('SELECT version FROM _dsh_migrations WHERE version = $1', [migration.version])
        if (applied.length > 0) continue
        for (const statement of migration.statements) {
          if (!/^(?:create|alter|insert|update|delete)\b/iu.test(statement.trim()) || statement.length > 64 * 1024 || statement.includes(';') || /--|\/\*/u.test(statement)) throw new Error('plugin/database-invalid-migration')
          await executor.unsafe(statement)
        }
        await executor.unsafe('INSERT INTO _dsh_migrations (version) VALUES ($1)', [migration.version])
      }
    })
  }
  return {
    query: async (dataSpaceId, statement) => {
      const schema = await ensureSchema(dataSpaceId)
      return client.begin(async (tx) => {
        await (tx as unknown as Executor).unsafe(`SET LOCAL search_path TO "${schema}"`)
        return execute(statement, tx as unknown as Executor)
      })
    },
    transaction: async (dataSpaceId, statements) => {
      if (statements.length === 0 || statements.length > 100) throw new Error('plugin/database-transaction-bounds')
      const schema = await ensureSchema(dataSpaceId)
      return client.begin(async (tx) => {
        await (tx as unknown as Executor).unsafe(`SET LOCAL search_path TO "${schema}"`)
        const results: PluginSqlResult[] = []
        for (const statement of statements) results.push(await execute(statement, tx as unknown as Executor))
        return results
      })
    },
    migrate,
    deleteDataSpace: async (dataSpaceId) => {
      const schema = schemaName(dataSpaceId)
      await client.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    },
    close: () => client.end(),
  }
}
