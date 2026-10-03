/** Workspace routes expose lifecycle state without claiming unimplemented code execution. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSandboxPrototype } from '../src/index.ts'

void test('workspace lifecycle is isolated by organization', async () => {
  const app = createSandboxPrototype()
  const organizationId = '00000000-0000-4000-8000-000000000001'
  const created = await app.request('http://localhost/v1/workspaces', { method: 'POST', body: JSON.stringify({ organizationId, name: 'Acme workspace' }), headers: { 'content-type': 'application/json' } })
  assert.equal(created.status, 201)
  const workspace = await created.json() as { id: string; status: string }
  assert.equal(workspace.status, 'stopped')
  assert.equal((await app.request(`http://localhost/v1/organizations/${organizationId}/workspaces`)).status, 200)
  assert.equal((await app.request(`http://localhost/v1/workspaces/${workspace.id}/start`, { method: 'POST' })).status, 200)
  assert.equal((await app.request(`http://localhost/v1/workspaces/${workspace.id}/lease`, { method: 'POST' })).status, 200)
  assert.equal((await app.request('http://localhost/health')).status, 200)
})
