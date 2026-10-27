/** Background identity reads preserve active forms until authorization is explicitly lost. */
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import AdminShell from '../app/admin-shell'

async function mount(t: TestContext) {
  const dom = new JSDOM('<html><head><meta name="enterprise-api-url" content="http://localhost:8787"></head><body></body></html>',
    { url: 'http://localhost:4000/platform/desktop-releases' })
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
  const originalFetch = globalThis.fetch
  let refresh: Promise<Response> | undefined
  globalThis.fetch = async (input) => {
    const path = new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input).pathname
    if (path === '/v1/me') return refresh ?? Response.json({ platformAdmin: true, name: 'Admin' })
    if (path === '/auth/sso/providers') return Response.json([])
    assert.equal(path, '/v1/platform/desktop-releases')
    return Response.json({ apiUrl: 'https://api.example.test', configured: true, maxBytes: 1000,
      requirements: { signingKey: true, storage: true, https: true }, releases: [] })
  }
  const container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
  const root = createRoot(container)
  t.after(async () => {
    try { await act(async () => { root.unmount() }) }
    finally {
      globalThis.fetch = originalFetch
      dom.window.close()
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    }
  })
  await act(async () => { root.render(createElement(AdminShell, { segments: ['platform', 'desktop-releases'] })) })
  return {
    container,
    async beginRefresh() {
      let finish!: (response: Response) => void
      refresh = new Promise((resolve) => { finish = resolve })
      await act(async () => dom.window.dispatchEvent(new dom.window.Event('enterprise-admin-refresh')))
      return async (response: Response) => { await act(async () => { finish(response) }) }
    },
  }
}

void test('identity refresh and temporary failures retain the selected installer input', async (t) => {
  const fixture = await mount(t)
  const installer = fixture.container.querySelector<HTMLInputElement>('input[name="installer"]')!
  assert.ok(installer)
  const selected = [new File(['installer'], 'client.dmg')]
  Object.defineProperty(installer, 'files', { configurable: true, value: selected })
  for (const response of [Response.json({ platformAdmin: true }), Response.json({ message: 'Unavailable' }, { status: 503 }),
    Response.json({ platformAdmin: true })]) {
    const finish = await fixture.beginRefresh()
    assert.equal(fixture.container.querySelector('input[name="installer"]'), installer)
    await finish(response)
    assert.equal(fixture.container.querySelector('input[name="installer"]'), installer)
    assert.equal(installer.files, selected)
  }
  assert.equal(fixture.container.querySelector('[role="alert"]'), null)
})

for (const status of [401, 403, 200]) {
  void test(`identity refresh removes management controls when access is denied (${status})`, async (t) => {
    const fixture = await mount(t)
    const finish = await fixture.beginRefresh()
    await finish(Response.json(status === 200 ? { platformAdmin: false } : { message: 'Access denied' }, { status }))
    assert.equal(fixture.container.querySelector('input[name="installer"]'), null)
    if (status !== 200) {
      const retry = await fixture.beginRefresh()
      assert.equal(fixture.container.querySelector('input[name="installer"]'), null)
      await retry(Response.json({ message: 'Access denied' }, { status }))
    }
  })
}
