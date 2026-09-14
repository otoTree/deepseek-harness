/** Real loopback callbacks with a per-test model-independent token endpoint. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { loginDesktop } from '../src/desktop-auth.ts'
import { z } from 'zod'

void test('PKCE rejects unrelated callbacks, stores credentials once, and closes the listener', async () => {
  let callback = ''
  let challenge = ''
  let writes = 0
  let requests = 0
  const token = randomBytes(32).toString('base64url')
  const organizationId = randomUUID()
  const result = await loginDesktop({
    apiUrl: 'https://api.example.com', portalUrl: 'https://portal.example.com',
    signal: AbortSignal.timeout(15000),
    keychain: { set: async (account, value) => {
      writes++
      assert.ok(account.includes(organizationId))
      assert.equal(z.object({ token: z.string() }).parse(JSON.parse(value)).token, token)
    } },
    openBrowser: async (url) => {
      const login = new URL(url)
      assert.equal(login.origin, 'https://portal.example.com')
      challenge = login.searchParams.get('challenge')!
      callback = login.searchParams.get('callback')!
      const route = new URL(callback)
      route.searchParams.set('code', randomBytes(32).toString('base64url'))
      route.searchParams.set('state', 'invalid')
      assert.equal((await fetch(route)).status, 400)
      route.searchParams.set('state', login.searchParams.get('state')!)
      assert.equal((await fetch(route, { method: 'POST' })).status, 400)
      assert.equal((await fetch(route)).status, 204)
      assert.equal((await fetch(route)).status, 409)
    },
    request: async (input, init) => {
      requests++
      assert.equal(input instanceof Request ? input.url : input.toString(), 'https://api.example.com/desktop/token')
      assert.equal(typeof init?.body, 'string')
      const body = z.object({ verifier: z.string() }).parse(JSON.parse(init?.body as string))
      assert.equal(createHash('sha256').update(body.verifier).digest('base64url'), challenge)
      return Response.json({ runtimeId: randomUUID(), organizationId, token, leaseUntil: new Date(Date.now() + 60000).toISOString() })
    },
  })
  assert.equal(writes, 1)
  assert.equal(requests, 1)
  assert.ok(!JSON.stringify(result).includes(token))
  await assert.rejects(fetch(callback, { signal: AbortSignal.timeout(2000) }))
})

void test('aborting a pending login closes the callback listener without saving a credential', async () => {
  const controller = new AbortController()
  let callback = ''
  await assert.rejects(loginDesktop({
    apiUrl: 'http://127.0.0.1:8787', portalUrl: 'http://127.0.0.1:3001', signal: controller.signal,
    keychain: { set: async () => assert.fail('must not store') },
    request: async () => { assert.fail('must not exchange') },
    openBrowser: async (url) => {
      callback = new URL(url).searchParams.get('callback')!
      controller.abort(new Error('test cancellation'))
    },
  }), /test cancellation/)
  await assert.rejects(fetch(callback, { signal: AbortSignal.timeout(2000) }))
})

for (const [status, message] of [[403, 'Forbidden'], [409, 'Runtime limit reached']] as const) {
  void test(`reports desktop token HTTP ${status} details`, async () => {
    await assert.rejects(loginDesktop({
      apiUrl: 'https://api.example.com', portalUrl: 'https://portal.example.com', signal: AbortSignal.timeout(5000),
      keychain: { set: async () => assert.fail('must not store') },
      openBrowser: async (url) => {
        const login = new URL(url)
        const callback = new URL(login.searchParams.get('callback')!)
        callback.searchParams.set('code', randomBytes(32).toString('base64url'))
        callback.searchParams.set('state', login.searchParams.get('state')!)
        assert.equal((await fetch(callback)).status, 204)
      },
      request: async () => Response.json({ message }, { status }),
    }), new RegExp(`Desktop authorization exchange refused \\(${status}\\): ${message}`))
  })
}

void test('untrusted deployment origins and credentialed URLs refuse before opening a browser', async () => {
  for (const apiUrl of ['http://public.example.com', 'https://user:secret@api.example.com', 'file:///tmp/a']) {
    await assert.rejects(loginDesktop({ apiUrl, portalUrl: 'https://portal.example.com', signal: AbortSignal.timeout(1000),
      keychain: { set: async () => assert.fail('must not store') },
      openBrowser: async () => assert.fail('must not open'),
    }), /deployment URL/)
  }
})
