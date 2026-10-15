/** Real MCP SDK discovery, PKCE exchange, and callback listener disposal. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { authorizePluginMcp } from '../src/plugin-oauth.ts'

async function fixture(t: test.TestContext, options: {
  metadataPath?: string
  authorizationOrigin?: string
  authMetadataPath?: string
  responseTypes?: string[] | null
  failure?: 'discovery' | 'registration' | 'exchange'
  discoveryGate?: Promise<void>
  onDiscovery?: () => void
} = {}) {
  let origin = ''
  let client: Record<string, unknown> = {}
  let challenge = ''
  const records: unknown[] = []
  const requests: Array<{ path: string; body?: string }> = []
  const ctx = new Context()
  ctx.provide('credentials', {
    async modifyRecord(key: string, update: () => Promise<unknown>) { records.push({ key, record: await update() }) },
  } as never)
  t.after(() => ctx.fiber.dispose())
  const failures: unknown[] = []
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', origin)
    const path = url.pathname
    const record: { path: string; body?: string } = { path: url.pathname + url.search }
    requests.push(record)
    response.setHeader('Content-Type', 'application/json')
    if (path === '/mcp') {
      response.writeHead(401, { 'WWW-Authenticate': `Bearer resource_metadata="${origin}${options.metadataPath ?? '/.well-known/oauth-protected-resource/mcp'}", scope="fixture:read"` }).end('{}')
    } else if (url.pathname + url.search === (options.metadataPath ?? '/.well-known/oauth-protected-resource/mcp')) {
      options.onDiscovery?.()
      await options.discoveryGate
      response.end(JSON.stringify({ resource: `${origin}/mcp`, authorization_servers: [options.authorizationOrigin ?? origin] }))
    } else if (path === (options.authMetadataPath ?? '/.well-known/oauth-authorization-server')) {
      if (options.failure === 'discovery') { response.end('invalid JSON'); return }
      response.end(JSON.stringify({ issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`, ...(options.responseTypes === null ? {} : { response_types_supported: options.responseTypes ?? ['code'] }), code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] }))
    } else if (path === '/register' || path === '/token') {
      const chunks: Uint8Array[] = []
      for await (const chunk of request) {
        const value: unknown = chunk
        assert.ok(Buffer.isBuffer(value))
        chunks.push(value)
      }
      const body = Buffer.concat(chunks).toString()
      record.body = body
      if (path === '/register') {
        if (options.failure === 'registration') { response.writeHead(400).end(JSON.stringify({ error: 'invalid_client_metadata', error_description: 'PRIVATE_SERVICE_ERROR' })); return }
        client = JSON.parse(body) as Record<string, unknown>
        response.statusCode = 201
        response.end(JSON.stringify({ ...client, client_id: 'fixture-client' }))
      } else {
        if (options.failure === 'exchange') { response.writeHead(400).end(JSON.stringify({ error: 'invalid_grant', error_description: 'PRIVATE_SERVICE_ERROR' })); return }
        const fields = new URLSearchParams(body)
        assert.equal(fields.get('grant_type'), 'authorization_code')
        assert.equal(fields.get('code'), 'fixture-code')
        assert.equal(fields.get('redirect_uri'), (client.redirect_uris as string[])[0])
        assert.equal(createHash('sha256').update(fields.get('code_verifier') ?? '').digest('base64url'), challenge)
        response.end(JSON.stringify({ access_token: 'PRIVATE_ACCESS', refresh_token: 'PRIVATE_REFRESH', token_type: 'Bearer' }))
      }
    } else { response.statusCode = 404; response.end('{}') }
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => { failures.push(error); response.writeHead(500).end('{}') })
  })
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
    assert.deepEqual(failures, [])
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  origin = `http://127.0.0.1:${address.port}`
  return { ctx, origin, records, requests, setChallenge: (value: string) => { challenge = value } }
}

void test('OAuth validates state and PKCE, persists only in Host, and closes callback after exchange', async (t) => {
  const f = await fixture(t)
  const controller = new AbortController()
  t.after(() => { controller.abort() })
  let redirect!: (url: string) => void
  const redirected = new Promise<string>((resolve) => { redirect = resolve })
  const done = authorizePluginMcp(f.ctx, { organizationId: 'org', installationId: 'install' }, `${f.origin}/mcp`, controller.signal, redirect, async () => {})
  void done.catch(() => {})
  const url = new URL(await redirected)
  assert.ok(!url.toString().includes('PRIVATE_'))
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  f.setChallenge(url.searchParams.get('code_challenge') ?? '')
  const callback = new URL(url.searchParams.get('redirect_uri') ?? '')
  callback.searchParams.set('code', 'fixture-code')
  callback.searchParams.set('state', 'invalid')
  assert.equal((await fetch(callback)).status, 400)
  assert.equal(f.records.length, 0)
  callback.searchParams.set('state', url.searchParams.get('state') ?? '')
  assert.equal((await fetch(callback)).status, 200)
  await done
  assert.equal(f.records.length, 1)
  assert.ok(JSON.stringify(f.records).includes('PRIVATE_ACCESS'))
  const record = f.records[0] as { record: { payload: { value: string } } }
  const stored = JSON.parse(record.record.payload.value) as { discovery: { resourceMetadata: { resource: string } } }
  assert.equal(stored.discovery.resourceMetadata.resource, `${f.origin}/mcp`)
  await assert.rejects(fetch(callback))
})

for (const metadataPath of ['/provider/.well-known/resource', '/.well-known/oauth-protected-resource?resource=mcp']) {
  void test(`OAuth follows the 401 metadata URL ${metadataPath} and sends its resource and scope`, async (t) => {
    const f = await fixture(t, { metadataPath })
    const controller = new AbortController()
    let deliver!: (url: string) => void
    const redirected = new Promise<string>((resolve) => { deliver = resolve })
    const done = authorizePluginMcp(f.ctx, { organizationId: 'org', installationId: 'install' }, `${f.origin}/mcp`, controller.signal, deliver, async () => {})
    const rejected = assert.rejects(done, /authorization-cancelled/u)
    try {
      const url = new URL(await redirected)
      assert.equal(url.searchParams.get('resource'), `${f.origin}/mcp`)
      assert.equal(url.searchParams.get('scope'), 'fixture:read')
      assert.ok(f.requests.some(request => request.path === metadataPath))
      assert.ok(!f.requests.some(request => request.path === '/.well-known/oauth-protected-resource/mcp'))
    } finally { controller.abort(); await rejected }
    assert.equal(f.records.length, 0)
  })
}

void test('OAuth follows a different authorization server origin', async (t) => {
  const provider = await fixture(t)
  const resource = await fixture(t, { authorizationOrigin: provider.origin })
  const controller = new AbortController()
  let deliver!: (url: string) => void
  const redirected = new Promise<string>((resolve) => { deliver = resolve })
  const done = authorizePluginMcp(resource.ctx, { organizationId: 'org', installationId: 'install' }, `${resource.origin}/mcp`, controller.signal, deliver, async () => {})
  const rejected = assert.rejects(done, /authorization-cancelled/u)
  try {
    const url = new URL(await redirected)
    assert.equal(url.origin, provider.origin)
    assert.equal(url.searchParams.get('resource'), `${resource.origin}/mcp`)
    assert.ok(provider.requests.some(request => request.path === '/register'))
    assert.ok(!resource.requests.some(request => request.path === '/register'))
  } finally { controller.abort(); await rejected }
})

void test('verified metadata location and missing response types allow authorization without weakening other metadata', async (t) => {
  const f = await fixture(t, { authMetadataPath: '/provider/metadata', responseTypes: null })
  const controller = new AbortController()
  let deliver!: (url: string) => void
  const redirected = new Promise<string>((resolve) => { deliver = resolve })
  const done = authorizePluginMcp(f.ctx, { organizationId: 'org', installationId: 'install' }, `${f.origin}/mcp`, controller.signal, deliver, async () => {}, {
    authorizationServerMetadataUrl: `${f.origin}/provider/metadata`, responseTypesSupported: ['code'],
  })
  const rejected = assert.rejects(done, /authorization-cancelled/u)
  try {
    assert.equal(new URL(await redirected).pathname, '/authorize')
    assert.ok(f.requests.some(request => request.path === '/provider/metadata'))
    const registration = JSON.parse(f.requests.find(request => request.path === '/register')!.body!) as { grant_types: string[] }
    assert.deepEqual(registration.grant_types, ['authorization_code'])
  } finally { controller.abort(); await rejected }
})

for (const responseTypes of [null, []]) {
  void test(`OAuth rejects ${responseTypes === null ? 'undeclared missing' : 'explicitly unsupported'} response types`, async (t) => {
    const f = await fixture(t, { responseTypes })
    const controller = new AbortController()
    t.after(() => { controller.abort() })
    await assert.rejects(authorizePluginMcp(f.ctx, { organizationId: 'org', installationId: 'install' }, `${f.origin}/mcp`, controller.signal,
      () => assert.fail('invalid metadata must not open the browser'), async () => {}, responseTypes === null ? undefined : { responseTypesSupported: ['code'] }), /authorization-(discovery|registration)-failed/u)
    assert.equal(f.records.length, 0)
  })
}

void test('OAuth reports registration failure without leaking the provider response', async (t) => {
  const f = await fixture(t, { failure: 'registration' })
  await assert.rejects(authorizePluginMcp(f.ctx, { organizationId: 'org', installationId: 'install' }, `${f.origin}/mcp`, new AbortController().signal,
    () => assert.fail('registration failure must not open the browser'), async () => {}), { message: 'plugin/authorization-registration-failed' })
  assert.equal(f.records.length, 0)
})

void test('OAuth reports malformed discovery without opening a browser or saving credentials', async (t) => {
  const f = await fixture(t, { failure: 'discovery' })
  await assert.rejects(authorizePluginMcp(f.ctx, { organizationId: 'org', installationId: 'install' }, `${f.origin}/mcp`, new AbortController().signal,
    () => assert.fail('invalid discovery must not open the browser'), async () => {}), { message: 'plugin/authorization-discovery-failed' })
  assert.equal(f.records.length, 0)
})

for (const outcome of ['denied', 'exchange-failed', 'success'] as const) {
  void test(`OAuth callback ${outcome} releases the listener and permits a second service authorization`, async (t) => {
    const f = await fixture(t, { ...(outcome === 'exchange-failed' ? { failure: 'exchange' as const } : {}) })
    const controller = new AbortController()
    t.after(() => { controller.abort() })
    let deliver!: (url: string) => void
    const redirected = new Promise<string>((resolve) => { deliver = resolve })
    const done = authorizePluginMcp(f.ctx, { organizationId: 'org', installationId: 'first' }, `${f.origin}/mcp`, controller.signal, deliver, async () => {})
    const settled = outcome === 'success' ? done : assert.rejects(done, { message: `plugin/authorization-${outcome}` })
    const url = new URL(await redirected)
    f.setChallenge(url.searchParams.get('code_challenge')!)
    const callback = new URL(url.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', url.searchParams.get('state')!)
    callback.searchParams.set(outcome === 'denied' ? 'error' : 'code', outcome === 'denied' ? 'access_denied' : 'fixture-code')
    await fetch(callback)
    await settled
    await assert.rejects(fetch(callback))
    assert.equal(f.records.length, outcome === 'success' ? 1 : 0)
    const second = await fixture(t)
    let deliverSecond!: (url: string) => void
    const nextRedirect = new Promise<string>((resolve) => { deliverSecond = resolve })
    const next = authorizePluginMcp(second.ctx, { organizationId: 'org', installationId: 'second' }, `${second.origin}/mcp`, controller.signal, deliverSecond, async () => {})
    const rejected = assert.rejects(next, /authorization-cancelled/u)
    try { assert.equal(new URL(await nextRedirect).origin, second.origin) } finally { controller.abort(); await rejected }
  })
}

void test('cancelling discovery prevents a late browser redirect and saves no grant', async (t) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let entered!: () => void
  const discovered = new Promise<void>((resolve) => { entered = resolve })
  const f = await fixture(t, { discoveryGate: gate, onDiscovery: entered })
  const controller = new AbortController()
  const done = authorizePluginMcp(f.ctx, { organizationId: 'org', installationId: 'install' }, `${f.origin}/mcp`, controller.signal,
    () => assert.fail('cancelled discovery must not open browser'), async () => {})
  const rejected = assert.rejects(done, /authorization-cancelled/u)
  try { await discovered; controller.abort(); await rejected } finally { controller.abort(); release() }
  assert.equal(f.records.length, 0)
})

void test('cancelling browser authorization closes its callback without persisting a grant', async (t) => {
  const f = await fixture(t)
  const controller = new AbortController()
  t.after(() => { controller.abort() })
  let redirect!: (url: string) => void
  const redirected = new Promise<string>((resolve) => { redirect = resolve })
  const done = authorizePluginMcp(f.ctx, { organizationId: 'org', installationId: 'install' }, `${f.origin}/mcp`, controller.signal, redirect, async () => { assert.fail('cancelled grant cannot commit') })
  const rejected = assert.rejects(done, /authorization-cancelled/u)
  const callback = new URL(new URL(await redirected).searchParams.get('redirect_uri') ?? '')
  controller.abort()
  await rejected
  assert.equal(f.records.length, 0)
  await assert.rejects(fetch(callback))
})
