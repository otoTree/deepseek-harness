import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { publishDesktopRelease, publishPlatformPlugin, request, requestBinary, resolveApiBase } from '../app/client-api'

let runtimeApiUrl: string | undefined
const originalGlobals = new Map<string, PropertyDescriptor | undefined>()
beforeEach(() => {
  runtimeApiUrl = 'http://127.0.0.1:8787'
  for (const [name, value] of Object.entries({
    document: { querySelector: () => runtimeApiUrl === undefined ? null : { content: runtimeApiUrl } },
    window: { location: { hostname: 'localhost' } },
  })) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
})
afterEach(() => {
  for (const [name, original] of originalGlobals) {
    if (original) Object.defineProperty(globalThis, name, original)
    else Reflect.deleteProperty(globalThis, name)
  }
  originalGlobals.clear()
})

void test('JSON and binary requests use the public runtime API URL and session credentials', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const calls: Array<{ url: string; credentials: RequestCredentials | undefined }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : input instanceof URL ? input.href : input, credentials: init?.credentials })
    return Response.json({})
  }
  runtimeApiUrl = 'https://api.first.example/'
  await request('/v1/accounts')
  runtimeApiUrl = 'https://api.second.example'
  await requestBinary('/v1/platform/plugins/packages', new ArrayBuffer(1))
  assert.deepEqual(calls, [
    { url: 'https://api.first.example/v1/accounts', credentials: 'include' },
    { url: 'https://api.second.example/v1/platform/plugins/packages', credentials: 'include' },
  ])
})

void test('missing or invalid runtime configuration rejects before sending credentials', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let calls = 0
  globalThis.fetch = async () => { calls++; return Response.json({}) }
  for (const value of [undefined, '', 'not a URL', 'javascript:alert(1)']) {
    runtimeApiUrl = value
    await assert.rejects(request('/fixture'))
    await assert.rejects(requestBinary('/fixture', new ArrayBuffer(1)))
  }
  assert.equal(calls, 0)
})

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

void test('desktop publication streams the selected File after signed size validation', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const installer = new File(['installer'], 'installer.dmg')
  const controller = new AbortController()
  const id = '9d443b93-784b-4383-8dd5-b9431d7cbfeb'
  const calls: string[] = []
  globalThis.fetch = async (url, init) => {
    calls.push(url instanceof Request ? url.url : url instanceof URL ? url.href : url)
    assert.equal(init?.credentials, 'include')
    if (init?.method === 'POST') return Response.json({ id, size: installer.size })
    assert.equal(init?.method, 'PUT')
    assert.equal(init?.body, installer)
    assert.equal(init?.signal, controller.signal)
    return Response.json({ version: '1.2.3', target: 'darwin-arm64', published: true })
  }
  assert.equal((await publishDesktopRelease('signed-envelope', installer, controller.signal)).version, '1.2.3')
  assert.equal(calls.length, 2)
  assert.ok(calls[1]?.endsWith(`/${id}/installer`))
  globalThis.fetch = async () => Response.json({ id, size: installer.size + 1 })
  await assert.rejects(publishDesktopRelease('signed-envelope', installer, controller.signal), /大小/)
  controller.abort()
  await assert.rejects(publishDesktopRelease('signed-envelope', installer, controller.signal), { name: 'AbortError' })
})
