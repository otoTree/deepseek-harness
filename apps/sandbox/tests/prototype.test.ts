/** Prototype routes must never acknowledge execution that did not occur. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSandboxPrototype } from '../src/index.ts'

void test('unimplemented execution and readiness are unavailable', async () => {
  const app = createSandboxPrototype()
  const response = await app.request('http://localhost/v1/execute', { method: 'POST', body: '{"code":"throw 1"}' })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { accepted: false, error: 'SANDBOX_ADAPTER_NOT_IMPLEMENTED' })
  assert.equal((await app.request('http://localhost/health')).status, 503)
})
