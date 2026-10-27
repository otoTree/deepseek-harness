/** Installed Host SDK projection over a deterministic, keyless HTTP control plane. */
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { zipSync, strToU8 } from 'fflate'
import { EnterprisePluginRuntime } from '../src/plugin-runtime.ts'

export const name = 'model-platform-sdk-fixture'
export const inject = ['tools']
export const Config = z.object({ legacy: z.boolean().default(true) }).default({ legacy: true })

const model = '00000000-0000-4000-8000-000000000002'
const task = {
  id: 'model-platform-task', modelId: model, publicModel: 'Fixture video', operation: 'video.generate',
  status: 'succeeded', providerStatus: 'succeeded', assetStatus: 'ready', billingStatus: 'settled',
  billingBasis: 'reservation_fallback', estimatedMicrosCny: 15_000_000, finalMicrosCny: 15_000_000,
  collectedMicrosCny: 15_000_000, outstandingMicrosCny: 0, results: [{ kind: 'video', assetId: 'owned-asset' }],
}

/** Install a verified Host ZIP and expose its public SDK calls through real HTTP. */
export async function apply(ctx, config) {
  const legacy = config.legacy
  const settled = { ...task, billingBasis: legacy ? task.billingBasis : 'actual_usage' }
  const source = `
    export const inject = ['tools', 'pluginSdk']
    export function apply(ctx) {
      ctx.effect(() => ctx.tools.register({ name: 'model_platform_probe', description: 'Inspect catalog, preview and persistent media result through the installed SDK.', parameters: {},
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        async execute(_args, exec) {
          const sdk = ctx.pluginSdk
          const catalog = await sdk.models.list({ operation: 'video.generate' }, exec.signal)
          const request = { operation: 'video.generate', model: catalog[0].id, input: { prompt: 'Ocean at sunset' }, parameters: { duration: -1 } }
          const preview = await sdk.models.previewTask(request, exec.signal)
          const created = await sdk.models.createTask({ ...request, idempotencyKey: 'recorded-sdk-task' }, exec.signal)
          const result = await sdk.models.queryTask({ taskId: created.id }, exec.signal)
          ${legacy ? '' : `await sdk.models.cancelTask({ taskId: created.id }, exec.signal)
          await sdk.models.retryTaskSave({ taskId: created.id }, exec.signal)`}
          const history = ${legacy ? 'await sdk.models.listTasks(exec.signal)' : "(await sdk.models.listTaskPage({ status: 'succeeded', query: 'Fixture', limit: 2 }, exec.signal)).items"}
          return { modelId: catalog[0].id, ${legacy ? 'reserveMicrosCny' : 'estimatedMicrosCny'}: preview.estimatedMicrosCny, settlementUnits: preview.settlementUnits,
            taskId: result.id, status: result.status, assetStatus: result.assetStatus, billingStatus: result.billingStatus,
            billingBasis: result.billingBasis, finalMicrosCny: result.finalMicrosCny, results: result.results, historyCount: history.length }
        }
      }))
    }
  `
  const manifest = { schemaVersion: 3, pluginId: 'model.platform.snapshot', name: 'Model platform SDK snapshot', version: '1.0.0',
    packages: [{ id: 'core', name: '@example/model-platform-snapshot', version: '1.0.0', dependencies: {},
      targets: [{ kind: 'host', entry: 'packages/core/host/index.js', compatibility: 'dsh-host>=1', contributions: ['tool:model_platform_probe'] }] }],
    permissions: [], resources: [], migrations: [], build: { runtime: 'node22', lockfileDigest: '0'.repeat(64) } }
  const entries = {
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'packages/core/package.json': strToU8(JSON.stringify({ name: '@example/model-platform-snapshot', version: '1.0.0', type: 'module', exports: './host/index.js' })),
    'packages/core/host/index.js': strToU8(source),
  }
  const digest = bytes => createHash('sha256').update(bytes).digest('hex')
  const archive = zipSync({ ...entries, 'integrity.json': strToU8(JSON.stringify(Object.fromEntries(Object.entries(entries).map(([path, bytes]) => [path, digest(bytes)])))) })
  const calls = []
  const server = createServer((request, response) => { void (async () => {
    assert.equal(request.headers.authorization, 'Bearer snapshot-activation')
    let raw = ''
    for await (const chunk of request) raw += String(chunk)
    const input = JSON.parse(raw)
    const operation = decodeURIComponent(request.url.split('/').at(-1))
    calls.push(operation)
    let result
    switch (operation) {
      case 'models.list':
        assert.equal(input.operation, 'video.generate')
        result = [{ id: model, name: 'Fixture video', operations: ['video.generate'], inputModalities: ['text'], outputCapabilities: ['video'] }]
        break
      case 'models.task.preview':
        assert.equal(input.parameters.duration, -1)
        result = { modelId: model, operation: 'video.generate', adapterVersion: 1, estimatedMicrosCny: 15_000_000,
          priceCondition: 'standard', prices: { completion_tokens: '46000000' }, settlementUnits: { completion_tokens: 'token_million' } }
        break
      case 'models.task.create':
        assert.equal(input.model, model)
        assert.equal(input.idempotencyKey, 'recorded-sdk-task')
        result = { ...task, status: 'processing', providerStatus: 'processing', assetStatus: 'pending', billingStatus: legacy ? 'reserved' : 'pending', results: [] }
        break
      case 'models.task.query':
        assert.equal(input.taskId, task.id)
        result = settled
        break
      case 'models.task.cancel':
      case 'models.task.retry-save': result = settled; break
      case 'models.task.list': result = [settled]; break
      case 'models.task.page':
        assert.deepEqual(input, { status: 'succeeded', query: 'Fixture', limit: 2 })
        result = { items: [settled], nextCursor: null }; break
      default: throw new Error('Unexpected snapshot SDK operation: ' + operation)
    }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(result))
  })().catch(error => { response.writeHead(500).end(JSON.stringify({ error: String(error) })) }) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const failures = []
  const runtime = new EnterprisePluginRuntime({ ctx, apiUrl: `http://127.0.0.1:${address.port}`, organizationId: 'snapshot-org', deviceId: async () => 'snapshot-device',
    request: async (path, _signal, init) => {
      if (path === 'plugins/catalog') return [{ id: 'snapshot-release', pluginId: manifest.pluginId, version: manifest.version, digest: digest(archive) }]
      if (path === 'plugins/installations') return [{ id: 'snapshot-installation', releaseId: 'snapshot-release', enabled: true, desiredState: 'enabled', permissionRevision: 1, config: {} }]
      if (path.endsWith('/activate')) return { activationId: '00000000-0000-4000-8000-000000000001', token: 'snapshot-activation' }
      if (path.endsWith('/heartbeat')) {
        const body = JSON.parse(init.body)
        if (body.observedState === 'failed') failures.push(body.error)
      }
      return {}
    }, requestBytes: async () => archive })
  ctx.effect(() => async () => {
    await runtime.dispose()
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })
  await runtime.reconcile(new AbortController().signal)
  assert.deepEqual(failures, [])
  ctx.on('tools/post-execute', async (exec, result, next) => {
    if (exec.name === 'model_platform_probe') {
      assert.ok(!result.isError)
      assert.deepEqual(calls, ['models.list', 'models.task.preview', 'models.task.create', 'models.task.query', ...(legacy ? [] : ['models.task.cancel', 'models.task.retry-save']), legacy ? 'models.task.list' : 'models.task.page'])
    }
    return next()
  })
}
