import assert from 'node:assert/strict'
import test from 'node:test'
import { runSyncScript } from '../src/sync-runner.ts'

test('runs the canonical paged directory response in the bounded worker', async () => {
  const result = await runSyncScript({
    source: `module.exports = input => ({
      organizations: { items: input.rows.map(row => ({ externalId: row.code, name: row.name })), nextCursor: 'next-2', total: 120000 },
      users: [],
      memberships: []
    })`,
    input: { rows: [{ code: 'dept-1', name: '研发中心' }] },
  })
  assert.deepEqual(result.organizations, { items: [{ externalId: 'dept-1', name: '研发中心' }], nextCursor: 'next-2', total: 120000 })
})

test('keeps compatibility with scripts that return arrays', async () => {
  const result = await runSyncScript({
    source: 'module.exports = () => ({ users: [{ externalId: \'u-1\', email: \'u@example.com\', name: \'用户\' }] })',
    input: {},
  })
  assert.deepEqual(result.users, [{ externalId: 'u-1', email: 'u@example.com', name: '用户' }])
})
