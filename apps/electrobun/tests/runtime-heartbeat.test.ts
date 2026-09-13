import assert from 'node:assert/strict'
import test from 'node:test'
import { RuntimeHeartbeat } from '../src/runtime-heartbeat.ts'

void test('runtime heartbeat renews immediately and stops an expired lease', async () => {
  let calls = 0
  const heartbeat = new RuntimeHeartbeat({
    apiUrl: 'http://127.0.0.1:8787', organizationId: '00000000-0000-4000-8000-000000000001',
    runtimeId: '00000000-0000-4000-8000-000000000002', token: 'token', intervalMs: 100,
    request: async (_input, init) => {
      assert.equal(init?.headers && new Headers(init.headers).get('authorization'), 'Bearer token')
      calls++
      return Response.json({ leaseUntil: new Date(Date.now() + 10_000).toISOString(), policyRevision: calls })
    },
  })
  await heartbeat.start()
  assert.equal(calls, 1)
  assert.equal(heartbeat.policyRevision, 1)
  await heartbeat.stop()
  assert.equal(calls, 1)
})

void test('heartbeat invokes lease-loss callback and does not continue after refusal', async () => {
  let calls = 0
  let lost = 0
  const heartbeat = new RuntimeHeartbeat({
    apiUrl: 'http://127.0.0.1:8787', organizationId: '00000000-0000-4000-8000-000000000001',
    runtimeId: '00000000-0000-4000-8000-000000000002', token: 'token', intervalMs: 100,
    request: async () => { calls++; return new Response('', { status: 401 }) },
    onLeaseLost: () => { lost++ },
  })
  await assert.rejects(heartbeat.start(), /refused/)
  await heartbeat.stop()
  assert.equal(lost, 1)
  assert.equal(calls, 1)
})
