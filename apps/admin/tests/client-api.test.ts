import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request, resolveApiBase } from '../app/client-api'

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
