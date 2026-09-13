/** Shared SSE validation refuses truncated, oversized and malformed model responses. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelEvents } from '../src/model-stream.ts'

async function collect(source: AsyncIterable<unknown>) {
  const values: unknown[] = []
  for await (const value of source) values.push(value)
  return values
}

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
