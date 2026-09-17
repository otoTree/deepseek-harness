/** Native DSH LLM composition against an owned loopback gateway; only network responses and Keychain reads are fixtures. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import LlmFilesRuntime from '@deepseek-ai/dsh-llm-files'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { EnterpriseGatewayAdapter } from '../src/gateway-provider.ts'
import { modelCall } from '@deepseek-ai/dsh-enterprise-api/contracts'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DesktopKeychain } from '../src/keychain.ts'
import { gatewayProfile } from './gateway-profile.ts'
import { gatewayMessages, gatewayResponseChunks, gatewayResponsesBody } from '../src/gateway-wire.ts'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'

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

void test('enterprise wire projects durable images to OpenAI data URLs without logging storage metadata', async () => {
  const attachment = {
    attachmentId: AttachmentId('sha256:' + 'a'.repeat(64)), mediaType: 'image/png' as const,
    bytes: 3, width: 1, height: 1,
  }
  const messages = await gatewayMessages({
    provider: 'enterprise', model: 'model', messages: [createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'text', text: 'Describe this.' }, { type: 'image', attachment },
    ] })],
  }, async (ref) => {
    assert.deepEqual(ref, attachment)
    return { mediaType: 'image/png', data: Uint8Array.from([1, 2, 3]) }
  })
  assert.deepEqual(messages[0]?.content, [
    { type: 'text', text: 'Describe this.' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
  ])
})

void test('enterprise Responses wire preserves image, video, audio, and document inputs', async () => {
  const attachmentId = AttachmentId('sha256:' + 'b'.repeat(64))
  const body = await gatewayResponsesBody({
    provider: 'enterprise', model: 'model', messages: [createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'video', attachment: { attachmentId, name: 'clip.mp4', bytes: 3, mediaType: 'video/mp4' } },
      { type: 'audio', attachment: { attachmentId, name: 'voice.wav', bytes: 3, mediaType: 'audio/wav' } },
      { type: 'document', attachment: { attachmentId, name: 'brief.pdf', bytes: 3, mediaType: 'application/pdf' } },
    ] })],
  }, undefined, async ref => ({ mediaType: ref.mediaType, data: Uint8Array.from([1, 2, 3]) }))
  const content = (body.input as Array<{ content: unknown[] }>)[0]?.content
  assert.deepEqual(content, [
    { type: 'input_video', video_url: 'data:video/mp4;base64,AQID' },
    { type: 'input_audio', audio_url: 'data:audio/wav;base64,AQID' },
    { type: 'input_file', filename: 'brief.pdf', file_data: 'data:application/pdf;base64,AQID' },
  ])
})

void test('enterprise Responses stream projects text, tools, usage, and completion', async () => {
  async function* events() {
    yield { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning' } }
    yield { type: 'response.reasoning_summary_part.added', output_index: 0, summary_index: 0, part: { type: 'summary_text' } }
    yield { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'Inspect.' }
    yield { type: 'response.reasoning_summary_text.done', output_index: 0, summary_index: 0, text: 'Inspect.' }
    yield { type: 'response.reasoning_summary_part.done', output_index: 0, summary_index: 0, part: { type: 'summary_text', text: 'Inspect.' } }
    yield { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning' } }
    yield { type: 'response.output_text.delta', delta: 'Done.' }
    yield { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', call_id: 'call-1', name: 'inspect', arguments: '' } }
    yield { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"path":"file"}' }
    yield { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', call_id: 'call-1', name: 'inspect', arguments: '{"path":"file"}' } }
    yield { type: 'response.completed', response: { usage: {
      input_tokens: 7, output_tokens: 4, total_tokens: 11,
      input_tokens_details: { cached_tokens: 2 }, output_tokens_details: { reasoning_tokens: 3 },
    } } }
  }
  const chunks = await collect(gatewayResponseChunks(events(), 65536))
  assert.deepEqual(chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block), [
    { type: 'reasoning', text: 'Inspect.' },
    { type: 'text', text: 'Done.' },
    { type: 'tool-call', id: 'call-1', name: 'inspect', arguments: '{"path":"file"}' },
  ])
  assert.deepEqual(chunks.slice(-2), [
    { type: 'usage', usage: { inputTokens: 5, cacheReadTokens: 2, outputTokens: 4, totalTokens: 11, reasoningTokens: 3 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
})

for (const event of [
  { type: 'response.output_text.delta' },
  { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'secret' },
  { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: -1, delta: 'secret' },
  { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{}' },
  { type: 'response.private.delta', delta: 'secret' },
  { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: -1 } } },
]) {
  void test('enterprise Responses stream rejects malformed critical events', async () => {
    async function* events() { yield event }
    await assert.rejects(collect(gatewayResponseChunks(events(), 65536)), (error: Error) => {
      assert.ok(!error.message.includes('secret'))
      return true
    })
  })
}

for (const type of ['response.failed', 'response.cancelled', 'response.incomplete']) {
  void test('enterprise Responses stream rejects unsuccessful terminal events', async () => {
    async function* events() { yield { type } }
    await assert.rejects(collect(gatewayResponseChunks(events(), 65536)))
  })
}

async function fixture(t: TestContext) {
  const model = randomUUID()
  const credential = { apiOrigin: '', organizationId: randomUUID(), runtimeId: randomUUID(), token: randomUUID(), leaseUntil: new Date(Date.now() + 60000).toISOString() }
  const requests: { path: string; authorization?: string; key?: string; userAgent?: string; body: unknown }[] = []
  const mode = { value: 'normal' as 'normal' | 'truncated' | 'paused' | 'rejected' | 'rateLimited' | 'fileRejected' | 'staleFile' | 'malformed' }
  const modelConfig: Record<string, unknown> = {
    id: model, name: 'Authorized model', images: false, contextTokens: 8192, maxOutputTokens: 128,
  }
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
      response.end(JSON.stringify([modelConfig]))
    } else if (request.url?.endsWith('/model-files')) {
      if (mode.value === 'fileRejected') {
        response.writeHead(409).end('private upstream-secret')
        return
      }
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ fileId: `file-${requests.filter(item => item.path.endsWith('/model-files')).length}`,
        expiresAt: new Date(Date.now() + 600_000).toISOString() }))
    } else if (mode.value === 'staleFile'
      && requests.filter(item => item.path.endsWith('/model-call')).length === 1) {
      response.writeHead(400, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: { message: 'file_id file-1 expired' } }))
    } else if (mode.value === 'rateLimited') {
      response.writeHead(429).end('private upstream-secret')
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
  const ctx = new Context()
  const filesService = await ctx.plugin(LlmFilesRuntime)
  t.after(() => filesService.dispose())
  const adapter = new EnterpriseGatewayAdapter(settings, {
    readCredential: () => Promise.resolve(JSON.stringify(credential)), request: fetch,
    files: ctx.llmFiles,
    resolveImage: async ref => ({ mediaType: ref.mediaType, data: Uint8Array.of(1, 2, 3) }),
    resolveMedia: async ref => ({ mediaType: ref.mediaType, data: Uint8Array.of(1, 2, 3) }),
  })
  const disposeFileProvider = ctx.llmFiles.registerProvider(adapter.filesProvider())
  t.after(() => { disposeFileProvider() })
  const llm = await ctx.plugin(LlmRuntime)
  t.after(() => llm.dispose())
  const fiber = await ctx.plugin({ name: 'fixture-enterprise-route', inject: ['llm'], apply: (scope: Context) => {
    scope.effect(() => scope.llm.registerAdapter(['enterprise'], adapter))
  } })
  t.after(() => fiber.dispose())
  const options = { provider: 'enterprise', model, messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect the file.' }] })] }
  return { ctx, adapter, fiber, credential, settings, requests, mode, modelConfig, options, streamClosed }
}

void test('native LLM discovers platform models and preserves ordered tools, reasoning, usage and request attribution', async (t) => {
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
  assert.deepEqual(body.body?.stop, ['END'])
  assert.deepEqual(body.body?.stream_options, { include_usage: true })
  assert.equal(body.modelId, f.options.model)
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

void test('native LLM replaces the startup sentinel after a late organization grant', async (t) => {
  const f = await fixture(t)
  const resolved = await f.ctx.llm.resolveModelInfo('enterprise', 'enterprise-unconfigured')
  assert.equal(resolved.id, 'enterprise-unconfigured')
  assert.equal(resolved.name, 'Authorized model')
  await collect(f.ctx.llm.stream({ ...f.options, model: 'enterprise-unconfigured' }))
  const request = f.requests.find(request => request.path.endsWith('/model-call'))!
  assert.equal(modelCall.parse(request.body).modelId, f.options.model)
})

void test('provider-files uploads once, reuses the receipt, and sends Responses file ids', async (t) => {
  const f = await fixture(t)
  Object.assign(f.modelConfig, {
    protocol: 'openai-responses',
    inputModalities: ['text', 'document'],
    fileInputPolicy: 'provider-files',
    maxFileBytes: 1024,
    maxRequestBytes: 2048,
    filesTtlSeconds: 600,
  })
  const attachment = {
    attachmentId: AttachmentId(`sha256:${'d'.repeat(64)}`),
    name: 'report.pdf',
    bytes: 3,
    mediaType: 'application/pdf',
  }
  const options = {
    ...f.options,
    messages: [createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'document' as const, attachment },
    ] })],
  }

  await collect(f.ctx.llm.stream(options))
  await collect(f.ctx.llm.stream(options))

  const uploads = f.requests.filter(request => request.path.endsWith('/model-files'))
  assert.equal(uploads.length, 1)
  assert.deepEqual(uploads[0]?.body, {
    modelId: f.options.model,
    runtimeId: f.credential.runtimeId,
    policyRevision: 7,
    attachmentId: attachment.attachmentId,
    name: attachment.name,
    mediaType: attachment.mediaType,
    data: 'AQID',
  })
  const calls = f.requests.filter(request => request.path.endsWith('/model-call'))
  assert.equal(calls.length, 2)
  const body = modelCall.parse(calls[0]?.body).body as { input?: Array<{ content?: unknown[] }> }
  assert.deepEqual(body.input?.[0]?.content, [{ type: 'input_file', file_id: 'file-1' }])
})

void test('provider-files upload failure does not fall back to inline Base64', async (t) => {
  const f = await fixture(t)
  Object.assign(f.modelConfig, {
    protocol: 'openai-responses', inputModalities: ['text', 'document'],
    fileInputPolicy: 'provider-files', maxFileBytes: 1024, maxRequestBytes: 2048, filesTtlSeconds: 600,
  })
  f.mode.value = 'fileRejected'
  const attachment = {
    attachmentId: AttachmentId(`sha256:${'e'.repeat(64)}`), name: 'report.pdf', bytes: 3, mediaType: 'application/pdf',
  }
  const chunks = await collect(f.ctx.llm.stream({ ...f.options, messages: [createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'document', attachment }],
  })] }))

  assert.ok(chunks.at(-1)?.type === 'finish')
  assert.equal(f.requests.filter(request => request.path.endsWith('/model-call')).length, 0)
  assert.ok(!JSON.stringify(f.requests).includes('data:application/pdf'))
})

void test('provider-files replaces one stale generation and retries the model call once', async (t) => {
  const f = await fixture(t)
  Object.assign(f.modelConfig, {
    protocol: 'openai-responses', inputModalities: ['text', 'document'],
    fileInputPolicy: 'provider-files', maxFileBytes: 1024, maxRequestBytes: 2048, filesTtlSeconds: 600,
  })
  f.mode.value = 'staleFile'
  const attachment = {
    attachmentId: AttachmentId(`sha256:${'f'.repeat(64)}`), name: 'report.pdf', bytes: 3, mediaType: 'application/pdf',
  }
  const chunks = await collect(f.ctx.llm.stream({ ...f.options, messages: [createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'document', attachment }],
  })] }))

  assert.equal(chunks.at(-1)?.type, 'finish')
  const uploads = f.requests.filter(request => request.path.endsWith('/model-files'))
  assert.equal(uploads.length, 2)
  assert.equal((uploads[1]?.body as { replaceFileId?: string }).replaceFileId, 'file-1')
  const calls = f.requests.filter(request => request.path.endsWith('/model-call'))
  assert.equal(calls.length, 2)
  assert.notEqual(calls[0]?.key, calls[1]?.key)
  const retried = modelCall.parse(calls[1]?.body)
  assert.deepEqual((retried.body?.input as Array<{ content: unknown[] }>)[0]?.content,
    [{ type: 'input_file', file_id: 'file-2' }])
  assert.deepEqual(retried.fileUsage, { uploads: 1, uploadedBytes: 3, failures: 0 })
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
  assert.deepEqual(body.body?.messages, [
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

void test('native LLM preserves an enterprise model rate limit as a retryable failure', async (t) => {
  const f = await fixture(t)
  f.mode.value = 'rateLimited'
  const chunks = await collect(f.ctx.llm.stream(f.options))
  const terminal = chunks.at(-1)
  assert.ok(terminal?.type === 'finish' && terminal.reason.kind === 'error')
  assert.deepEqual(terminal.reason.kind === 'error' && terminal.reason.failure, {
    message: 'Enterprise model rate limit exceeded',
    code: 'RATE_LIMIT',
    status: 429,
  })
  assert.ok(!JSON.stringify(chunks).includes('upstream-secret'))
})

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

void test('unavailable model and mismatched deployment credential never dispatch a model request', async (t) => {
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
