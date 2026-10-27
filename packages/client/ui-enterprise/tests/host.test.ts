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
  const organizationPrefix = `/v1/organizations/${organizationId}`
  const runtimeId = randomUUID()
  const token = 'runtime-token-123456789012345678901234567890'
  const requests: Array<{ method: string; url: string; authorization?: string }> = []
  let forceRemoved = false
  const departmentBodies: unknown[] = []
  const server = createServer((request, response) => {
    requests.push({
      method: request.method ?? '',
      url: request.url ?? '',
      ...(request.headers.authorization === undefined ? {} : { authorization: request.headers.authorization }),
    })
    response.setHeader('Content-Type', 'application/json')
    const prefix = organizationPrefix
    if (request.url === `${prefix}/units` && request.method === 'GET') return response.end(JSON.stringify([
      { id: 'root', name: 'Acme', parentId: null, unitType: 'root' },
    ]))
    if (request.url === `${prefix}/members`) return response.end(JSON.stringify({ assignments: [{ membershipId: 'member', unitId: 'root' }] }))
    if (request.url === `${prefix}/units` || request.url === `${prefix}/units/department` || request.url === `${prefix}/members/member/units`) {
      let body = ''
      request.on('data', (chunk) => { body += String(chunk) })
      request.on('end', () => { departmentBodies.push(body ? JSON.parse(body) as unknown : null); response.end(JSON.stringify({ id: 'department' })) })
      return
    }
    if (request.url === `${prefix}/overview`) return response.end(JSON.stringify({
      organization: { id: organizationId, name: 'Acme', kind: 'team', status: 'active', policyRevision: 4 },
      subscription: { plan: 'team', seats: 8, budgetMicros: 2_000_000, spentMicros: 300_000, reservedMicros: 50_000 },
      roles: [{ role: 'member', unitId: null }],
      permissions: ['member.read', 'member.manage', 'department.manage'],
    }))
    if (request.url === `${prefix}/models`) return response.end(JSON.stringify([
      { id: randomUUID(), name: 'Governed model', images: false, contextTokens: 32768, maxOutputTokens: 4096 },
    ]))
    if (request.url === `${prefix}/runtimes` && request.method === 'GET') return response.end(JSON.stringify([
      { id: runtimeId, name: 'This Mac', type: 'desktop', version: '0.1.0', expiresAt: new Date(Date.now() + 60_000), revokedAt: null },
    ]))
    if (request.url?.startsWith(`${prefix}/wallet/ledger`)) return response.end(JSON.stringify({ currency: 'CNY', items: [], nextCursor: null }))
    if (request.url?.startsWith(`${prefix}/usage?`)) {
      const query = new URL(request.url, 'http://fixture').searchParams
      const secondPage = query.has('cursor')
      const base = {
        accountId: randomUUID(), runtimeId, modelId: randomUUID(), purpose: 'conversation',
        protocol: 'openai-completions', inputModalities: ['text'], totalTokens: 20,
        occurredAt: new Date().toISOString(),
      }
      return response.end(JSON.stringify({
        items: secondPage ? [{ ...base, id: randomUUID(), status: 'settled', currency: 'CNY', inputTokens: 4, outputTokens: 6, totalTokens: null, totalCostMicrosCny: 19 }] : [
          { ...base, id: randomUUID(), status: 'settled', currency: 'CNY', inputTokens: 12, outputTokens: 8, totalCostMicrosCny: 81 },
          { ...base, id: randomUUID(), status: 'settled', currency: null, inputTokens: 3, outputTokens: 2, totalTokens: 5, totalCostMicrosCny: null },
          { ...base, id: randomUUID(), status: 'pending_reconciliation', currency: null, inputTokens: null, outputTokens: null, totalTokens: null, totalCostMicrosCny: null },
          { ...base, id: randomUUID(), status: 'failed', currency: null, inputTokens: null, outputTokens: null, totalTokens: null, totalCostMicrosCny: null },
        ],
        nextCursor: query.has('limit') && !secondPage ? 'page-two' : null,
        range: { from: '2026-09-01T00:00:00.000+08:00', to: '2026-10-01T00:00:00.000+08:00', timeZone: 'Asia/Shanghai' },
      }))
    }
    if (request.url === `${prefix}/plugins/catalog`) {
      if (forceRemoved) return response.writeHead(500).end(JSON.stringify({ error: 'runtime unavailable' }))
      return response.end('[]')
    }
    if (request.url === `${prefix}/plugins/installations`) return response.end('[]')
    if (request.url === `${prefix}/plugins/device-targets`) return response.end('[]')
    if (request.url === `${prefix}/plugins/installations/installation/force-remove` && request.method === 'POST') {
      forceRemoved = true
      return response.end(JSON.stringify({ id: 'installation', forced: true, releasesRevoked: 1 }))
    }
    if (request.url === `${prefix}/plugins/installations/installation` && request.method === 'DELETE') return response.end(JSON.stringify({ id: 'installation', retained: true }))
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
    expiresAt: new Date(0).toISOString(),
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
    activityRefreshMs: 30000, maxResponseBytes: 1024 * 1024,
    activationTimeoutMs: 30_000,
    cleanupTimeoutMs: 10_000,
    authorizationTimeoutMs: 300_000,
    packageLimits: { maxFiles: 256, maxPackageBytes: 32 * 1024 * 1024, maxEntryBytes: 16 * 1024 * 1024,
      maxExpandedBytes: 32 * 1024 * 1024 },
    triggerStatePath: join(root, 'triggers.json'),
    triggerCloudPollMs: 10_000,
  })
  await fiber.await()
  assert.ok(handler)
  const dashboard = await handler('dashboard', {}, new AbortController().signal)
  assert.equal(dashboard.ok, true)
  assert.equal(dashboard.ok && 'usage' in (dashboard.value as object), false)
  assert.ok(!JSON.stringify(dashboard).includes(token))
  assert.equal(requests.every(request => request.authorization === `Bearer ${token}`), true)
  assert.equal(requests.some(request => request.url.includes('/usage?')), false)
  const range = { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }
  const summary = await handler('own-usage-summary', range, new AbortController().signal)
  assert.deepEqual(summary, { ok: true, value: { calls: 5, totalTokens: 35, totalCostMicrosCny: 100, unpricedCalls: 1,
    range: { from: '2026-09-01T00:00:00.000+08:00', to: '2026-10-01T00:00:00.000+08:00', timeZone: 'Asia/Shanghai' },
  } })
  const summaryReads = requests.filter(request => request.url.includes('/usage?'))
  assert.equal(summaryReads.length, 2)
  assert.equal(summaryReads.every(read => new URL(read.url, apiUrl).searchParams.get('limit') === '100'), true)
  assert.equal(new URL(summaryReads[0]!.url, apiUrl).searchParams.get('from'), range.from)
  assert.equal(new URL(summaryReads[1]!.url, apiUrl).searchParams.get('cursor'), 'page-two')
  assert.equal((await handler('own-usage', { ...range, cursor: 'record-next' }, new AbortController().signal)).ok, true)
  assert.equal(new URL(requests.at(-1)!.url, apiUrl).searchParams.get('cursor'), 'record-next')
  assert.equal((await handler('wallet-ledger', { cursor: 'ledger-next' }, new AbortController().signal)).ok, true)
  assert.equal(new URL(requests.at(-1)!.url, apiUrl).searchParams.get('cursor'), 'ledger-next')
  const beforeInvalid = requests.length
  assert.equal((await handler('own-usage', { from: range.from }, new AbortController().signal)).ok, false)
  assert.equal((await handler('own-usage-summary', { from: range.to, to: range.from }, new AbortController().signal)).ok, false)
  assert.equal((await handler('wallet-ledger', { cursor: '' }, new AbortController().signal)).ok, false)
  assert.equal(requests.length, beforeInvalid)
  assert.deepEqual(await handler('plugins', {}, new AbortController().signal), { ok: true, value: [] })
  const beforeUninstall = requests.length
  assert.deepEqual(await handler('plugin-uninstall', { installationId: 'installation' }, new AbortController().signal), {
    ok: true,
    value: { id: 'installation', retained: true },
  })
  assert.deepEqual(await handler('plugin-force-remove', { installationId: 'installation' }, new AbortController().signal), {
    ok: true,
    value: { id: 'installation', forced: true, releasesRevoked: 1 },
  })
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 500
    const check = (): void => {
      if (requests.slice(beforeUninstall).some(request => request.url === `${organizationPrefix}/plugins/catalog`)) { resolve(); return }
      if (Date.now() >= deadline) { reject(new Error('background reconciliation did not request the plugin catalog')); return }
      setTimeout(check, 10)
    }
    check()
  })
  assert.deepEqual(await handler('revoke-runtime', { runtimeId }, new AbortController().signal), {
    ok: true,
    value: { runtimeId },
  })
  assert.deepEqual(await handler('departments', {}, new AbortController().signal), {
    ok: true, value: { units: [{ id: 'root', name: 'Acme', parentId: null, unitType: 'root' }], assignments: [{ membershipId: 'member', unitId: 'root' }] },
  })
  for (const [operation, input] of [
    ['create-department', { name: 'Research', parentId: 'root' }],
    ['update-department', { unitId: 'department', name: 'ML', parentId: 'root' }],
    ['member-departments', { membershipId: 'member', unitIds: ['department'] }],
    ['delete-department', { unitId: 'department' }],
  ] as const) assert.equal((await handler(operation, input, new AbortController().signal)).ok, true)
  assert.deepEqual(departmentBodies, [
    { name: 'Research', parentId: 'root', unitType: 'department' }, { name: 'ML', parentId: 'root' }, { unitIds: ['department'] }, null,
  ])
  const beforeInvalidDepartment = requests.length
  assert.equal((await handler('create-department', { name: '  ', parentId: 'root' }, new AbortController().signal)).ok, false)
  assert.equal(requests.length, beforeInvalidDepartment)
  assert.equal((await handler('unknown', {}, new AbortController().signal)).ok, false)
  await fiber.dispose()
  assert.equal(disposed, true)
})

void test('enterprise plugin install does not download the package a second time', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-client-install-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const organizationId = randomUUID()
  const prefix = `/v1/organizations/${organizationId}`
  const runtimeId = randomUUID()
  const token = 'runtime-token-123456789012345678901234567890'
  const requests: string[] = []
  let handler: ConnectionRpcHandler | undefined
  const server = createServer((request, response) => {
    const url = request.url ?? ''
    requests.push(url)
    response.setHeader('Content-Type', 'application/json')
    if (url === `${prefix}/plugins/release/install` && request.method === 'POST') {
      response.writeHead(201)
      return response.end(JSON.stringify({ id: 'installation' }))
    }
    if (url === `${prefix}/plugins/catalog` || url === `${prefix}/plugins/installations` || url === `${prefix}/plugins/device-targets`) return response.end('[]')
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
  await writeFile(helper, `#!/bin/sh\nprintf '%s' '${JSON.stringify({
    apiOrigin: apiUrl, organizationId, runtimeId, token, expiresAt: new Date(0).toISOString(),
  })}'\n`)
  await chmod(helper, 0o700)
  const ctx = new Context()
  ctx.provide('connection', {
    rpc: { handle: (_channel: string, callback: ConnectionRpcHandler) => { handler = callback; return async () => {} } },
  } as HostConnectionHandle)
  const fiber = ctx.plugin({ inject: [...inject], apply }, {
    apiUrl, organizationId, keychainHelper: helper, keychainAccount: account,
    activityRefreshMs: 30000, maxResponseBytes: 1024 * 1024, activationTimeoutMs: 30_000, cleanupTimeoutMs: 10_000,
    authorizationTimeoutMs: 300_000,
    packageLimits: { maxFiles: 256, maxPackageBytes: 32 * 1024 * 1024, maxEntryBytes: 16 * 1024 * 1024,
      maxExpandedBytes: 32 * 1024 * 1024 },
    triggerStatePath: join(root, 'triggers.json'), triggerCloudPollMs: 10_000,
  })
  await fiber.await()
  assert.ok(handler)
  assert.deepEqual(await handler('plugin-install', { releaseId: 'release' }, new AbortController().signal), {
    ok: true, value: { id: 'installation' },
  })
  assert.equal(requests.includes(`${prefix}/plugins/release/package`), false)
  await fiber.dispose()
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
    expiresAt: new Date(0).toISOString(),
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
    activityRefreshMs: 30000, maxResponseBytes: 1024 * 1024,
    activationTimeoutMs: 30_000,
    cleanupTimeoutMs: 10_000,
    authorizationTimeoutMs: 300_000,
    packageLimits: { maxFiles: 256, maxPackageBytes: 32 * 1024 * 1024, maxEntryBytes: 16 * 1024 * 1024,
      maxExpandedBytes: 32 * 1024 * 1024 },
    triggerStatePath: join(root, 'triggers.json'), triggerCloudPollMs: 10_000,
  })
  await fiber.await()
  assert.ok(handler)
  const result = await handler('dashboard', {}, new AbortController().signal)
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.error.message, /does not match this organization/)
  await fiber.dispose()
})

void test('enterprise force-remove returns while an initial plugin catalog read is stalled', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-client-stalled-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const organizationId = randomUUID()
  const organizationPrefix = `/v1/organizations/${organizationId}`
  const runtimeId = randomUUID()
  const token = 'runtime-token-123456789012345678901234567890'
  let catalogStartedResolve: (() => void) | undefined
  const catalogStarted = new Promise<void>((resolve) => { catalogStartedResolve = resolve })
  let releaseCatalog = (): void => {}
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === `${organizationPrefix}/plugins/catalog`) {
      catalogStartedResolve?.()
      void new Promise<void>((resolve) => { releaseCatalog = () => { response.end('[]'); resolve() } })
      return
    }
    if (request.url === `${organizationPrefix}/plugins/installations/installation/force-remove` && request.method === 'POST') {
      return response.end(JSON.stringify({ id: 'installation', forced: true, releasesRevoked: 1 }))
    }
    if (request.url === `${organizationPrefix}/plugins/installations` || request.url === `${organizationPrefix}/plugins/device-targets`) return response.end('[]')
    return response.writeHead(404).end('{}')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    releaseCatalog()
    server.close()
    await once(server, 'close')
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const apiUrl = `http://127.0.0.1:${String(address.port)}`
  const account = createHash('sha256').update(apiUrl).digest('hex') + ':' + organizationId + ':' + runtimeId
  const helper = join(root, 'keychain')
  await writeFile(helper, `#!/bin/sh\nprintf '%s' '${JSON.stringify({
    apiOrigin: apiUrl, organizationId, runtimeId, token, expiresAt: new Date(0).toISOString(),
  })}'\n`)
  await chmod(helper, 0o700)
  let handler: ConnectionRpcHandler | undefined
  const ctx = new Context()
  ctx.provide('connection', {
    rpc: { handle: (_channel: string, callback: ConnectionRpcHandler) => { handler = callback; return async () => {} } },
  } as HostConnectionHandle)
  const fiber = ctx.plugin({ inject: [...inject], apply }, {
    apiUrl, organizationId, keychainHelper: helper, keychainAccount: account,
    activityRefreshMs: 30000, maxResponseBytes: 1024 * 1024, activationTimeoutMs: 30_000, cleanupTimeoutMs: 10_000,
    authorizationTimeoutMs: 300_000,
    packageLimits: { maxFiles: 256, maxPackageBytes: 32 * 1024 * 1024, maxEntryBytes: 16 * 1024 * 1024,
      maxExpandedBytes: 32 * 1024 * 1024 },
    triggerStatePath: join(root, 'triggers.json'), triggerCloudPollMs: 10_000,
  })
  await fiber.await()
  assert.ok(handler)
  await Promise.race([catalogStarted, new Promise<never>((_, reject) => setTimeout(() =>{  reject(new Error('catalog request did not start')) }, 500))])
  const result = await Promise.race([
    handler('plugin-force-remove', { installationId: 'installation' }, new AbortController().signal),
    new Promise<never>((_, reject) => setTimeout(() =>{  reject(new Error('force-remove waited for stalled catalog')) }, 500)),
  ])
  assert.deepEqual(result, { ok: true, value: { id: 'installation', forced: true, releasesRevoked: 1 } })
  releaseCatalog()
  await fiber.dispose()
})
