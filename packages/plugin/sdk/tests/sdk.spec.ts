import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginSdk } from '../src/index.ts'

test('sdk routes every capability through the installation transport', async () => {
  const calls: string[] = []
  const sdk = createPluginSdk({
    call: async <T>(operation: string, input: unknown): Promise<T> => {
      calls.push(`${operation}:${JSON.stringify(input)}`)
      if (operation === 'identity.current') return { userId: 'u', name: 'Ada', avatarUrl: null, email: 'ada@example.com', organizationId: 'o', owner: { kind: 'personal', accountId: 'u' } } as T
      return (operation === 'cache.increment' ? 2 : {}) as T
    },
    stream: async function* <T>() { yield { text: 'ok', done: true } as T },
  })
  assert.equal((await sdk.identity.current()).email, 'ada@example.com')
  assert.equal(await sdk.cache.increment('counter'), 2)
  assert.match(calls[0] ?? '', /^identity\.current:/)
  assert.match(calls[1] ?? '', /^cache\.increment:/)
})

test('model task create and query use the provider-neutral plugin capabilities', async () => {
  const calls: string[] = []
  const sdk = createPluginSdk({
    call: async <T>(operation: string): Promise<T> => {
      calls.push(operation)
      return { id: 'task-1', status: 'processing' } as T
    },
    stream: async function* <T>() { yield { done: true } as T },
  })
  await sdk.models.createTask({
    operation: 'image.generate', model: 'image-model' as never, input: { prompt: 'A lake' }, idempotencyKey: 'canvas-call-0001',
  })
  await sdk.models.queryTask({ taskId: 'task-1' })
  await sdk.models.listTasks()
  assert.deepEqual(calls, ['models.task.create', 'models.task.query', 'models.task.list'])
})

test('canonical text streams retain platform accounting and cancel on early consumer exit', async () => {
  const { createHttpPluginTransport } = await import('../src/index.ts')
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"text":"hello","done":false}\n\n')) },
    cancel() { cancelled = true },
  })
  const sdk = createPluginSdk(createHttpPluginTransport({ baseUrl: 'https://platform.example', activationId: 'activation', token: 'test',
    fetch: async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }) }))
  for await (const event of sdk.models.textStream({ modelId: 'model' as never, messages: [{ role: 'user', content: 'hello' }], idempotencyKey: 'plugin-stream-call' })) {
    assert.equal(event.text, 'hello')
    break
  }
  assert.equal(cancelled, true)
  assert.equal(stream.locked, false)
})

test('canonical stream completion requires a platform event and propagates stream failures', async () => {
  const { createHttpPluginTransport } = await import('../src/index.ts')
  const collect = async (events: string) => {
    const sdk = createPluginSdk(createHttpPluginTransport({ baseUrl: 'https://platform.example', activationId: 'activation', token: 'test',
      fetch: async () => new Response(events, { headers: { 'content-type': 'text/event-stream' } }) }))
    const values: unknown[] = []
    for await (const value of sdk.models.textStream({ modelId: 'model' as never, messages: [{ role: 'user', content: 'hello' }], idempotencyKey: 'plugin-stream-call' })) values.push(value)
    return values
  }
  const usage = { callId: 'platform-call', status: 'settled', totalCostMicrosCny: 123 }
  assert.deepEqual(await collect(`data: ${JSON.stringify({ text: 'hello', done: true, usage })}\n\n`), [{ text: 'hello', done: true, usage }])
  await assert.rejects(collect('data: {"text":"partial","done":false}\n\n'), /without completion/)
  await assert.rejects(collect('data: {"error":{"code":"plugin\/model-stream-failed"}}\n\n'), /stream failed/)
})
