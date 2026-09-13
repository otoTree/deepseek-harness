/** Native DSH LLM composition against an owned loopback gateway; only network responses and Keychain reads are fixtures. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { EnterpriseGatewayAdapter } from '../src/gateway-provider.ts'
import { modelCall } from '@deepseek-ai/dsh-enterprise-api/contracts'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DesktopKeychain } from '../src/keychain.ts'
import { gatewayProfile } from './gateway-profile.ts'

const frames = [
  { choices: [{ index: 0, delta: { reasoning_content: 'Inspect.' } }] },
  { choices: [{ index: 0, delta: { content: 'Working.' } }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'inspect', arguments: '{"path":' } }] } }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"file"}' } }] }, finish_reason: 'tool_calls' }] },
  { choices: [], usage: { prompt_tokens: 12, completion_tokens: 8, prompt_cache_hit_tokens: 4 } },
]
const sse = (value: unknown) => 'data:' + JSON.stringify(value) + '\r\n\r\n'
async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}

async function fixture(t: TestContext) {
  const model = randomUUID()
  const credential = { apiOrigin: '', organizationId: randomUUID(), runtimeId: randomUUID(), token: randomUUID(), leaseUntil: new Date(Date.now() + 60000).toISOString() }
  const requests: { path: string; authorization?: string; key?: string; userAgent?: string; body: unknown }[] = []
  const mode = { value: 'normal' as 'normal' | 'truncated' | 'paused' | 'rejected' | 'malformed' }
  let closed!: () => void
  const streamClosed = new Promise<void>((resolve) => { closed = resolve })
  const server = createServer((request, response) => { void (async () => {
    request.setEncoding('utf8')
    let input = ''
    for await (const chunk of request) {
      if (typeof chunk !== 'string') throw new Error('Unexpected request encoding')
      input += chunk
    }
    const body: unknown = input ? JSON.parse(input) : null
    requests.push({ path: request.url ?? '', authorization: request.headers.authorization,
      key: request.headers['idempotency-key'] as string | undefined, userAgent: request.headers['user-agent'], body })
    if (request.url?.endsWith('/heartbeat')) {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ leaseUntil: credential.leaseUntil, policyRevision: 7 }))
    } else if (request.url?.endsWith('/models')) {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify([{ id: model, name: 'Authorized model', images: false, contextTokens: 8192, maxOutputTokens: 128 }]))
    } else if (mode.value === 'rejected') {
      response.writeHead(409).end('private upstream-secret')
    } else {
      response.setHeader('Content-Type', 'text/event-stream')
      response.once('close', closed)
      if (mode.value === 'malformed') { response.end('data: private upstream-secret\n\n'); return }
      response.write(sse(frames[0]))
      if (mode.value === 'paused') return
      for (const frame of frames.slice(1)) response.write(sse(frame))
      if (mode.value !== 'truncated') response.write('data: [DONE]\n\n')
      response.end()
    }
  })().catch((error: unknown) => { response.destroy(error instanceof Error ? error : new Error('Fixture failed')) }) })
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
      server.closeAllConnections()
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  credential.apiOrigin = `http://127.0.0.1:${address.port}`
  const settings = { apiUrl: credential.apiOrigin, keychainHelper: '/unused-native-helper',
    keychainAccount: createHash('sha256').update(credential.apiOrigin).digest('hex') + ':' + credential.organizationId + ':' + credential.runtimeId,
    requestTimeoutMs: 5000, maxEventChars: 65536, maxResponseChars: 262144 }
  const adapter = new EnterpriseGatewayAdapter(settings, {
    readCredential: () => Promise.resolve(JSON.stringify(credential)), request: fetch,
  })
  const ctx = new Context()
  const llm = await ctx.plugin(LlmRuntime)
  t.after(() => llm.dispose())
  const fiber = await ctx.plugin({ name: 'fixture-enterprise-route', inject: ['llm'], apply: (scope: Context) => {
    scope.effect(() => scope.llm.registerAdapter(['enterprise'], adapter))
  } })
  t.after(() => fiber.dispose())
  const options = { provider: 'enterprise', model, messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect the file.' }] })] }
  return { ctx, adapter, fiber, credential, settings, requests, mode, options, streamClosed }
}

void test('native LLM discovers authorized models and preserves ordered tools, reasoning, usage and request attribution', async (t) => {
  const f = await fixture(t)
  const model = await f.ctx.llm.resolveModelInfo('enterprise', f.options.model)
  assert.equal(model.context?.contextWindow, 8192)
  const chunks = await collect(f.ctx.llm.stream({ ...f.options, system: 'System rules', stop: ['END'], purpose: 'compaction',
    tools: [{ name: 'inspect', description: 'Read a file', parameters: { type: 'object' } }] }))
  assert.deepEqual(chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block), [
    { type: 'reasoning', text: 'Inspect.' }, { type: 'text', text: 'Working.' },
    { type: 'tool-call', id: 'call-1', name: 'inspect', arguments: '{"path":"file"}' },
  ])
  assert.deepEqual(chunks.slice(-2), [
    { type: 'usage', usage: { inputTokens: 8, cacheReadTokens: 4, outputTokens: 8, totalTokens: 20 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ])
  const request = f.requests.find(request => request.path.endsWith('/model-call'))!
  const body = modelCall.parse(request.body)
  assert.equal(body.policyRevision, 7)
  assert.equal(body.purpose, 'compaction')
  assert.deepEqual(body.stop, ['END'])
  assert.equal(body.model, f.options.model)
  assert.equal(request.authorization, 'Bearer ' + f.credential.token)
  assert.match(request.userAgent!, /deepseek-harness/)
  assert.ok(request.key && request.key.length >= 16)
  assert.ok(!JSON.stringify(body).includes(f.credential.token))
  assert.equal(f.adapter.providerRetryPolicy().mode, 'normal')
  const retry = f.adapter.providerRetryPolicy()
  assert.equal(retry.mode === 'normal' && retry.maxRetries, 0)
  await f.fiber.dispose()
  assert.deepEqual(f.ctx.llm.listProviders(), [])
})

void test('message replay retains system roles, raw tool arguments and tool-result correlation', async (t) => {
  const f = await fixture(t)
  await collect(f.ctx.llm.stream({ ...f.options, messages: [
    createMessage({ role: 'system', source: { kind: 'user' }, content: [{ type: 'text', text: 'System' }] }),
    createMessage({ role: 'assistant', source: { kind: 'model', provider: 'enterprise', model: f.options.model }, content: [
      { type: 'reasoning', text: 'Reason' }, { type: 'tool-call', id: ToolCallId('call-1'), name: 'inspect', arguments: '{ "path": "file" }' },
    ] }),
    createMessage({ role: 'user', source: { kind: 'tool', callId: ToolCallId('call-1') }, content: [
      { type: 'tool-result', toolCallId: ToolCallId('call-1'), content: [{ type: 'text', text: 'Result' }] },
    ] }),
  ] }))
  const body = modelCall.parse(f.requests.find(request => request.path.endsWith('/model-call'))!.body)
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'System' },
    { role: 'assistant', content: '', reasoning_content: 'Reason', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'inspect', arguments: '{ "path": "file" }' } }] },
    { role: 'tool', content: 'Result', tool_call_id: 'call-1' },
  ])
})

for (const mode of ['truncated', 'malformed', 'rejected'] as const) {
  void test(`native LLM rejects ${mode} responses without retry or secret disclosure`, async (t) => {
    const f = await fixture(t)
    f.mode.value = mode
    const chunks = await collect(f.ctx.llm.stream(f.options))
    const terminal = chunks.at(-1)
    assert.equal(terminal?.type, 'finish')
    assert.ok(terminal?.type === 'finish' && terminal.reason.kind === 'error')
    assert.equal(f.requests.filter(request => request.path.endsWith('/model-call')).length, 1)
    assert.ok(!JSON.stringify(chunks).includes('upstream-secret'))
  })
}

void test('cancellation closes the response before the native LLM finishes', async (t) => {
  const f = await fixture(t)
  f.mode.value = 'paused'
  const controller = new AbortController()
  const chunks: StreamChunk[] = []
  for await (const chunk of f.ctx.llm.stream({ ...f.options, signal: controller.signal })) {
    chunks.push(chunk)
    if (chunk.type === 'reasoning-delta') controller.abort()
  }
  await f.streamClosed
  const terminal = chunks.at(-1)
  assert.ok(terminal?.type === 'finish' && terminal.reason.kind === 'aborted')
})

void test('unauthorized model and mismatched deployment credential never dispatch a model request', async (t) => {
  const f = await fixture(t)
  const badModel = await collect(f.ctx.llm.stream({ ...f.options, model: randomUUID() }))
  assert.ok(badModel.at(-1)?.type === 'finish')
  assert.equal(f.requests.filter(request => request.path.endsWith('/model-call')).length, 0)
  const requests = f.requests.length
  f.credential.apiOrigin = 'https://other.example'
  await assert.rejects(f.adapter.listModels('enterprise'), /does not match/)
  assert.equal(f.requests.length, requests)
})

void test('built dsh profile loads the enterprise provider and reads only its Keychain credential', {
  skip: process.platform !== 'darwin' || process.env.ENTERPRISE_TEST_KEYCHAIN !== '1', timeout: 60000,
}, async (t) => {
  const f = await fixture(t)
  const settings = { ...f.settings, keychainHelper: fileURLToPath(new URL('../build/native/keychain', import.meta.url)) }
  const store = new DesktopKeychain(settings.keychainHelper)
  t.after(() => store.delete(settings.keychainAccount))
  await store.set(settings.keychainAccount, JSON.stringify(f.credential))
  const result = await gatewayProfile(t, settings, f.options.model)
  assert.ok(!result.includes(f.credential.token))
  const chunks = JSON.parse(result) as StreamChunk[]
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'tool-calls' } })
})
