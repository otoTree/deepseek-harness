/** Shared SSE validation refuses truncated, oversized and malformed model responses. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createModelUsageObserver, modelEvents } from '../src/model-stream.ts'

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
