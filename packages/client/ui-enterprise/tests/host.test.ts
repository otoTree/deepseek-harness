import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { apply, inject } from '../src/index.ts'

void test('enterprise bridge accepts a renewed Runtime after the stored initial lease passes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-client-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const organizationId = randomUUID()
  const runtimeId = randomUUID()
  const token = 'runtime-token-123456789012345678901234567890'
  const requests: Array<{ method: string; url: string; authorization?: string }> = []
  const server = createServer((request, response) => {
    requests.push({
      method: request.method ?? '',
      url: request.url ?? '',
      ...(request.headers.authorization === undefined ? {} : { authorization: request.headers.authorization }),
    })
    response.setHeader('Content-Type', 'application/json')
    const prefix = `/v1/organizations/${organizationId}`
    if (request.url === `${prefix}/overview`) return response.end(JSON.stringify({
      organization: { id: organizationId, name: 'Acme', kind: 'team', status: 'active', policyRevision: 4 },
      subscription: { plan: 'team', seats: 8, runtimes: 4, budgetMicros: 2_000_000, spentMicros: 300_000, reservedMicros: 50_000 },
      roles: [{ role: 'member', unitId: null }],
    }))
    if (request.url === `${prefix}/models`) return response.end(JSON.stringify([
      { id: randomUUID(), name: 'Governed model', images: false, contextTokens: 32768, maxOutputTokens: 4096 },
    ]))
    if (request.url === `${prefix}/runtimes` && request.method === 'GET') return response.end(JSON.stringify([
      { id: runtimeId, name: 'This Mac', type: 'desktop', version: '0.1.0', leaseUntil: new Date(Date.now() + 60_000), revokedAt: null },
    ]))
    if (request.url === `${prefix}/usage?scope=own`) return response.end(JSON.stringify([
      { inputTokens: 12, outputTokens: 8, actualMicros: 20, billedMicros: 25 },
      { inputTokens: null, outputTokens: null, actualMicros: null, billedMicros: null },
    ]))
    if (request.url === `${prefix}/plugins/catalog`) return response.end('[]')
    if (request.url === `${prefix}/runtimes/${runtimeId}` && request.method === 'DELETE') return response.end('{}')
    return response.writeHead(404).end('{}')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.close()
    await once(server, 'close')
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const apiUrl = `http://127.0.0.1:${String(address.port)}`
  const account = createHash('sha256').update(apiUrl).digest('hex') + ':' + organizationId + ':' + runtimeId
  const helper = join(root, 'keychain')
  const credential = JSON.stringify({
    apiOrigin: apiUrl,
    organizationId,
    runtimeId,
    token,
    leaseUntil: new Date(0).toISOString(),
  })
  await writeFile(helper, `#!/bin/sh\nprintf '%s' '${credential}'\n`)
  await chmod(helper, 0o700)

  let handler: ConnectionRpcHandler | undefined
  let disposed = false
  const connection: HostConnectionHandle = {
    rpc: {
      handle(channel, callback) {
        assert.equal(channel, '/enterprise')
        handler = callback
        return async () => { disposed = true }
      },
      intercept() { throw new Error('Unexpected shared-channel interceptor') },
    },
    fetch: { register() { throw new Error('Unexpected Fetch route') } },
    createSharedFetchHandler() { throw new Error('Unexpected shared Fetch handler') },
    requestRejection() { return undefined },
    authorizeIndex() { return false },
    authenticatedUrl(value) { return value },
  }
  const ctx = new Context()
  ctx.provide('connection', connection)
  const fiber = ctx.plugin({ inject: [...inject], apply }, {
    apiUrl,
    organizationId,
    keychainHelper: helper,
    keychainAccount: account,
  })
  await fiber.await()
  assert.ok(handler)
  const dashboard = await handler('dashboard', {}, new AbortController().signal)
  assert.equal(dashboard.ok, true)
  assert.deepEqual(dashboard.ok ? dashboard.value.usage : undefined, {
    calls: 2,
    inputTokens: 12,
    outputTokens: 8,
    actualMicros: 20,
    billedMicros: 25,
  })
  assert.ok(!JSON.stringify(dashboard).includes(token))
  assert.equal(requests.every(request => request.authorization === `Bearer ${token}`), true)
  assert.ok(requests.some(request => request.url.endsWith('/usage?scope=own')))
  assert.deepEqual(await handler('plugins', {}, new AbortController().signal), { ok: true, value: [] })
  assert.deepEqual(await handler('revoke-runtime', { runtimeId }, new AbortController().signal), {
    ok: true,
    value: { runtimeId },
  })
  assert.equal((await handler('unknown', {}, new AbortController().signal)).ok, false)
  await fiber.dispose()
  assert.equal(disposed, true)
})

void test('enterprise bridge fails closed for a mismatched Keychain credential', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-client-invalid-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const organizationId = randomUUID()
  const runtimeId = randomUUID()
  const helper = join(root, 'keychain')
  await writeFile(helper, `#!/bin/sh\nprintf '%s' '${JSON.stringify({
    apiOrigin: 'http://localhost:8787',
    organizationId,
    runtimeId,
    token: 'runtime-token-123456789012345678901234567890',
    leaseUntil: new Date(0).toISOString(),
  })}'\n`)
  await chmod(helper, 0o700)
  let handler: ConnectionRpcHandler | undefined
  const ctx = new Context()
  ctx.provide('connection', {
    rpc: { handle: (_channel: string, callback: ConnectionRpcHandler) => { handler = callback; return async () => {} } },
  } as HostConnectionHandle)
  const account = createHash('sha256').update('http://127.0.0.1:8787').digest('hex') + ':' + organizationId + ':' + runtimeId
  const fiber = ctx.plugin({ inject: [...inject], apply }, {
    apiUrl: 'http://127.0.0.1:8787', organizationId, keychainHelper: helper, keychainAccount: account,
  })
  await fiber.await()
  assert.ok(handler)
  const result = await handler('dashboard', {}, new AbortController().signal)
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error.message, /does not match this organization/)
  await fiber.dispose()
})
