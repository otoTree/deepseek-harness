import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publishPlatformPlugin, request, resolveApiBase } from '../app/client-api'

void test('aligns loopback API host with the browser host for session cookies', () => {
  assert.equal(resolveApiBase('http://127.0.0.1:8787', 'localhost'), 'http://localhost:8787')
  assert.equal(resolveApiBase('http://localhost:8787', '127.0.0.1'), 'http://127.0.0.1:8787')
  assert.equal(resolveApiBase('https://api.example.com', 'localhost'), 'https://api.example.com')
})

void test('surfaces bounded API error codes from the enterprise service', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = () => Promise.resolve(Response.json({ error: 'INSUFFICIENT_TEAM_BALANCE' }, { status: 402 }))
  await assert.rejects(request('/fixture'), { message: 'INSUFFICIENT_TEAM_BALANCE' })
})

void test('localizes Better Auth invalid credential responses', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = () => Promise.resolve(Response.json({ message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' }, { status: 401 }))
  await assert.rejects(request('/auth/sign-in/email', 'POST', {}), { message: '邮箱或密码错误，请重试。' })
})

void test('platform administrator upload approves the returned package digest', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const releaseId = '00000000-0000-4000-8000-000000000019'
  const digest = 'a'.repeat(64)
  const calls: Array<{ path: string; method: string; body: unknown }> = []
  globalThis.fetch = async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input).pathname
    calls.push({ path, method: init?.method ?? 'GET', body: init?.body })
    if (path === '/v1/platform/plugins/packages') return Response.json({ id: releaseId, pluginId: 'feishu-daily-report', version: '0.1.0', digest }, { status: 201 })
    return Response.json({ id: releaseId, status: 'published', digest })
  }
  const result = await publishPlatformPlugin(new ArrayBuffer(3))
  assert.deepEqual(result, { id: releaseId, pluginId: 'feishu-daily-report', version: '0.1.0' })
  assert.equal(calls.length, 2)
  assert.equal(calls[0]?.path, '/v1/platform/plugins/packages')
  assert.equal(calls[1]?.path, `/v1/platform/plugins/${releaseId}/approve`)
  assert.deepEqual(JSON.parse(String(calls[1]?.body)), { digest })
})

void test('failed approval does not report a published plugin', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const releaseId = '00000000-0000-4000-8000-000000000019'
  globalThis.fetch = async input => new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input).pathname === '/v1/platform/plugins/packages'
    ? Response.json({ id: releaseId, pluginId: 'feishu-daily-report', version: '0.1.0', digest: 'a'.repeat(64) }, { status: 201 })
    : Response.json({ message: 'Approval failed' }, { status: 409 })
  await assert.rejects(publishPlatformPlugin(new ArrayBuffer(1)), { message: 'Approval failed' })
})
