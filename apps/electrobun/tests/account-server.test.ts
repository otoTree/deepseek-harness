/** The bundled account page rejects untrusted callers and drains native operations on shutdown. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { startAccountServer, validateAccountUrl } from '../src/account-server.ts'
import { AccountError } from '../src/local-account.ts'

const frontend = fileURLToPath(new URL('../build/frontend', import.meta.url))

void test('bundled account assets load independently; privileged requests require token and origin', async (t) => {
  let mutations = 0
  const server = await startAccountServer(frontend, {
    state: async () => ({ user: null, organizations: [] }),
    run: async () => { mutations++; throw new AccountError(403) },
  })
  t.after(async () => { await server.close() })
  const url = new URL(server.url)
  const token = new URLSearchParams(url.hash.slice(1)).get('token')!
  const headers = { 'X-Desktop-Token': token, Origin: url.origin, 'Content-Type': 'application/json' }
  const html = await (await fetch(server.url)).text()
  assert.match(html, /enterprise-desktop-account/)
  assert.ok(!html.includes(token))
  for (const [, asset] of html.matchAll(/(?:src|href)="(\.\/assets\/[^\"]+)"/g)) {
    assert.equal((await fetch(new URL(asset!, url))).status, 200)
  }
  assert.equal((await fetch(new URL('/account/state', url))).status, 403)
  assert.equal((await fetch(new URL('/account/state', url), { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403)
  assert.deepEqual(await (await fetch(new URL('/account/state', url), { headers })).json(), { user: null, organizations: [] })
  const post = (body: string, supplied = headers) => fetch(new URL('/account/action', url), { method: 'POST', headers: supplied, body })
  assert.equal((await post('{')).status, 400)
  assert.equal((await post(JSON.stringify({ action: 'shell', command: 'whoami' }))).status, 400)
  assert.equal((await post(JSON.stringify({ action: 'logout' }), { ...headers, 'X-Desktop-Token': 'wrong' })).status, 403)
  assert.equal((await post(JSON.stringify({ action: 'logout' }), { ...headers, Origin: '' })).status, 403)
  assert.equal((await post(JSON.stringify({ action: 'logout', url: 'https://evil.example' }))).status, 400)
  assert.equal(mutations, 0)
  const denied = await post(JSON.stringify({ action: 'logout' }))
  assert.equal(denied.status, 403)
  assert.deepEqual(await denied.json(), { status: 403 })
  assert.equal(mutations, 1)
  const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.match(index, /createMainWindow\(\{ url: accountServer.url \}\)/)
  assert.doesNotMatch(index, /apps\/admin|apps\/portal|apps\/web\/dist/)
})

void test('account shutdown cancels pending native work and closes the allocated port', async () => {
  let resolveEntered!: () => void
  const entered = new Promise<void>((resolve) => { resolveEntered = resolve })
  let disposed = false
  const server = await startAccountServer(frontend, {
    state: async () => ({ user: null, organizations: [] }),
    run: async (_input, signal) => {
      resolveEntered()
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { disposed = true; resolve() }, { once: true }))
    },
  })
  const url = new URL(server.url)
  const headers = { 'X-Desktop-Token': new URLSearchParams(url.hash.slice(1)).get('token')!, Origin: url.origin }
  const pending = fetch(new URL('/account/action', url), { method: 'POST', headers, body: JSON.stringify({ action: 'logout' }) })
    .then(response => response.body?.cancel(), () => undefined)
  try {
    await entered
    assert.equal((await fetch(new URL('/account/action', url), { method: 'POST', headers, body: JSON.stringify({ action: 'logout' }) })).status, 409)
  } finally { await server.close(); await pending }
  assert.equal(disposed, true)
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }))
})

void test('account windows reject remote pages and malformed startup capabilities', () => {
  const good = 'http://127.0.0.1:12345/#token=' + 'a'.repeat(43)
  assert.equal(validateAccountUrl(good), good)
  for (const value of ['https://example.com', 'http://127.0.0.1:3000/', 'http://127.0.0.1:3001/',
    good.replace('/#', '/admin#'), good.replace('/#', '/?x=1#'), good.replace('127.0.0.1', 'user:pass@127.0.0.1')]) {
    assert.throws(() => validateAccountUrl(value))
  }
})
