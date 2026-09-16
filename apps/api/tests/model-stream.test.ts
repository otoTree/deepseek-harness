/** Shared SSE validation refuses truncated, oversized and malformed model responses. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createModelUsageObserver, modelEvents, parseResponsesUsage, responseModelEvents } from '../src/model-stream.ts'

async function collect(source: AsyncIterable<unknown>) {
  const values: unknown[] = []
  for await (const value of source) values.push(value)
  return values
}

void test('usage observer accepts fragmented CRLF records and keeps the last usage before DONE', () => {
  const observer = createModelUsageObserver(1024)
  const stream = Buffer.from([
    'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1}}\r\n\r\n',
    'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8}}\r\n\r\n',
    'data: [DONE]\r\n\r\n',
  ].join(''))
  for (const byte of stream) observer.feed(Uint8Array.of(byte))
  assert.deepEqual(observer.finish(), { promptTokens: 12, cachedPromptTokens: 0, completionTokens: 8 })
  assert.deepEqual(observer.finish(), { promptTokens: 12, cachedPromptTokens: 0, completionTokens: 8 })
})

for (const record of [
  'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8}}\n\n',
  'data: not-json\n\ndata: [DONE]\n\n',
  'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8}}\n\ndata: not-json\n\ndata: [DONE]\n\n',
  'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8}}\n\ndata: ' + 'x'.repeat(2048),
]) {
  void test('usage observer ignores incomplete, malformed, and oversized streams without throwing', () => {
    const observer = createModelUsageObserver(1024)
    assert.doesNotThrow(() => observer.feed(Buffer.from(record)))
    assert.equal(observer.finish(), undefined)
  })
}

void test('usage observer suppresses invalid fragmented UTF-8', () => {
  const observer = createModelUsageObserver(1024)
  assert.doesNotThrow(() => {
    observer.feed(Uint8Array.of(0xc3))
  })
  assert.equal(observer.finish(), undefined)
})

void test('usage observer ignores bytes after the completion marker', () => {
  const observer = createModelUsageObserver(1024)
  assert.deepEqual(observer.feed(Buffer.from([
    'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8}}\n\n',
    'data: [DONE]\n\n',
    'data: not-json\n\n',
  ].join(''))), { promptTokens: 12, cachedPromptTokens: 0, completionTokens: 8 })
  assert.deepEqual(observer.finish(), { promptTokens: 12, cachedPromptTokens: 0, completionTokens: 8 })
})

void test('usage observer preserves cached input and reasoning subdivisions', () => {
  const observer = createModelUsageObserver(1024)
  observer.feed(Buffer.from([
    'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8,',
    '"prompt_tokens_details":{"cached_tokens":5},"completion_tokens_details":{"reasoning_tokens":3}}}\n\n',
    'data: [DONE]\n\n',
  ].join('')))
  assert.deepEqual(observer.finish(), {
    promptTokens: 12,
    cachedPromptTokens: 5,
    completionTokens: 8,
    reasoningTokens: 3,
  })
})

void test('usage observer settles a Responses completion without a DONE sentinel', () => {
  const observer = createModelUsageObserver(2048)
  observer.feed(Buffer.from([
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n',
    'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":8,"input_tokens_details":{"cached_tokens":3}}}}\n\n',
  ].join('')))
  assert.deepEqual(observer.finish(), { promptTokens: 12, cachedPromptTokens: 3, completionTokens: 8 })
})

void test('Responses usage preserves cached input and reasoning subdivisions', () => {
  assert.deepEqual(parseResponsesUsage({
    input_tokens: 12,
    output_tokens: 8,
    total_tokens: 20,
    input_tokens_details: { cached_tokens: 3 },
    output_tokens_details: { reasoning_tokens: 5 },
  }), { promptTokens: 12, cachedPromptTokens: 3, completionTokens: 8, reasoningTokens: 5 })
})

for (const usage of [
  { input_tokens: -1, output_tokens: 1 },
  { input_tokens: 1.5, output_tokens: 1 },
  { input_tokens: 2, output_tokens: 1, input_tokens_details: { cached_tokens: 3 } },
  { input_tokens: 2, output_tokens: 1, output_tokens_details: { reasoning_tokens: 2 } },
  { input_tokens: 2, output_tokens: 1, total_tokens: 4 },
]) {
  void test('Responses usage rejects invalid and inconsistent token counts', () => {
    assert.throws(() => parseResponsesUsage(usage), /Responses/u)
  })
}

void test('usage observer leaves invalid Responses usage unsettled', () => {
  const observer = createModelUsageObserver(2048)
  observer.feed(Buffer.from('data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1,"input_tokens_details":{"cached_tokens":2}}}}\n\n'))
  assert.equal(observer.finish(), undefined)
})

void test('usage observer leaves failed and unknown Responses streams unsettled', () => {
  for (const type of ['response.failed', 'response.incomplete', 'response.cancelled', 'response.private.delta']) {
    const observer = createModelUsageObserver(2048)
    observer.feed(Buffer.from(`data: {"type":"${type}"}\n\n`))
    assert.equal(observer.finish(), undefined)
  }
})

void test('Responses event parser stops at the completion event', async () => {
  async function* input() {
    yield Buffer.from([
      'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
      'data: private-secret\n\n',
    ].join(''))
  }
  assert.deepEqual((await collect(responseModelEvents(input(), 2048))).map(event => (event as { type: string }).type), [
    'response.output_text.delta', 'response.completed',
  ])
})

void test('Responses event parser rejects unknown event types', async () => {
  async function* input() { yield Buffer.from('data: {"type":"response.private.delta"}\n\n') }
  await assert.rejects(collect(responseModelEvents(input(), 2048)), /Invalid model event fields/u)
})

void test('fragmented UTF-8 and CRLF produce one record and close the owned input at DONE', async () => {
  const event = { choices: [{ index: 0, delta: { content: '中文' } }] }
  const bytes = Buffer.from('data:' + JSON.stringify(event) + '\r\n\r\ndata:[DONE]\r\n\r\n')
  let closed = false
  async function* input() {
    try { for (const byte of bytes) yield Uint8Array.of(byte) } finally { closed = true }
  }
  assert.deepEqual(await collect(modelEvents(input(), 1024)), [event, '[DONE]'])
  assert.equal(closed, true)
})

for (const record of [
  'data: private-secret\n\n',
  'data: {"choices":[{"index":2}]}\n\n',
  'data: {"choices":[]}\n\n',
  'data: ' + 'x'.repeat(2048),
]) {
  void test('invalid or incomplete model records reject without reflecting their bytes', async () => {
    async function* input() { yield Buffer.from(record) }
    await assert.rejects(collect(modelEvents(input(), 1024)), (error: Error) => {
      assert.ok(!error.message.includes('private-secret'))
      return true
    })
  })
}
