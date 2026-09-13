/** Transaction-local tenant settings prevent pooled connections leaking authorization between requests. */
import postgres from 'postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from './schema.ts'
import type { AccountId, OrganizationId } from './contracts.ts'

export type Database = PostgresJsDatabase<typeof schema>
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Open the application pool; callers must await close during teardown. */
export function connectDatabase(url: string) {
  const client = postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 10 })
  return { db: drizzle(client, { schema }), close: () => client.end() }
}

/** Set identity only for this transaction; role and tenant authorization remain with the caller. */
export async function identify(tx: Transaction, account: AccountId, email: string): Promise<void> {
  await tx.execute(
    sql`select set_config('enterprise.account_id', ${account}, true), set_config('enterprise.email', ${email}, true)`,
  )
}

/** Set a validated organization context only for this transaction. */
export async function selectOrganization(tx: Transaction, id: OrganizationId): Promise<void> {
  await tx.execute(sql`select set_config('enterprise.organization_id', ${id}, true)`)
}
