import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseEnv } from 'node:util'
import { connectPluginDatabase } from '../src/plugin-database.ts'

const env = parseEnv(readFileSync(new URL('../../../.env.enterprise', import.meta.url), 'utf8'))

void test('plugin PostgreSQL keeps data spaces isolated and rolls transactions back', { skip: !env.ENTERPRISE_PLUGIN_DATABASE_URL }, async () => {
  const database = connectPluginDatabase(env.ENTERPRISE_PLUGIN_DATABASE_URL!)
  const first = `integration-${randomUUID()}`
  const second = `integration-${randomUUID()}`
  try {
    await database.migrate(first, [{ version: 1, statements: ['CREATE TABLE probe (id text PRIMARY KEY, value text NOT NULL)'] }])
    await database.query(first, { sql: 'INSERT INTO probe (id, value) VALUES ($1, $2)', params: ['kept', 'first'] })
    await assert.rejects(() => database.transaction(first, [
      { sql: 'INSERT INTO probe (id, value) VALUES ($1, $2)', params: ['rolled-back', 'second'] },
      { sql: 'INSERT INTO probe (id, value) VALUES ($1, $2)', params: ['kept', 'duplicate'] },
    ]))
    const result = await database.query(first, { sql: 'SELECT id, value FROM probe ORDER BY id' })
    assert.deepEqual([...result.rows], [{ id: 'kept', value: 'first' }])
    await assert.rejects(() => database.query(second, { sql: 'SELECT id FROM probe' }), /relation "probe" does not exist/)
    await assert.rejects(() => database.query(first, { sql: 'SELECT current_user FROM pg_catalog.pg_roles' }), /plugin\/database-statement-forbidden/)
  } finally {
    await database.deleteDataSpace(first)
    await database.deleteDataSpace(second)
    await database.close()
  }
})
