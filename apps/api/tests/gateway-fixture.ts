/** A per-test HTTP upstream; production DNS policy remains outside this transport fixture. */
import { createServer, request as httpRequest } from 'node:http'
import type { TestContext } from 'node:test'
import type { ModelTransport } from '../src/gateway.ts'
import assert from 'node:assert/strict'

/** Allocate an upstream server whose pause barrier proves budget reservations overlap.
 * @param t - Cleanup owner for this server and every accepted socket.
 * @returns Transport injection, request observations, and an explicit pause/release barrier.
 */
export async function modelFixture(t: TestContext) {
  const state = {
    mode: 'normal' as 'normal' | 'pause' | 'truncated' | 'silent' | 'rateLimited',
    calls: 0,
    requests: [] as unknown[],
    headers: [] as import('node:http').IncomingHttpHeaders[],
    fileUploads: [] as string[],
    fileDeletes: [] as string[],
    fileDeleteStatus: 204,
    secret: '',
  }
  let notify!: () => void
  let finish!: () => void
  const paused = new Promise<void>((resolve) => { notify = resolve })
  const released = new Promise<void>((resolve) => { finish = resolve })
  const server = createServer((request, response) => { void (async () => {
    request.setEncoding('utf8')
    let body = ''
    for await (const chunk of request) {
      if (typeof chunk !== 'string') throw new Error('Unexpected request bytes')
      body += chunk
    }
    state.headers.push(request.headers)
    state.secret = request.headers.authorization ?? ''
    if (request.url?.startsWith('/files/') && request.method === 'DELETE') {
      state.fileDeletes.push(request.url)
      response.statusCode = state.fileDeleteStatus
      response.end()
      return
    }
    if (request.url === '/files' && request.method === 'POST') {
      state.fileUploads.push(body)
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ id: `file-${state.fileUploads.length}`, status: 'active' }))
      return
    }
    state.requests.push(JSON.parse(body) as unknown)
    state.calls++
    if (state.mode === 'silent') {
      await new Promise<void>(resolve => response.once('close', resolve))
      return
    }
    if (state.mode === 'rateLimited') {
      response.statusCode = 429
      response.end('private upstream detail')
      return
    }
    response.setHeader('Content-Type', 'text/event-stream')
    response.write('data:{"choices":[{"index":0,"delta":{"content":"Gateway reply"}}]}\r\n\r\n')
    if (state.mode === 'pause') { notify(); await released }
    response.write('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n')
    response.write('data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8,"prompt_tokens_details":{"cached_tokens":5},"completion_tokens_details":{"reasoning_tokens":3}}}\n\n')
    if (state.mode !== 'truncated') response.write('data:[DONE]\n\n')
    response.end()
  })().catch((error: unknown) => { response.destroy(error instanceof Error ? error : new Error('Fixture failed')) }) })
  t.after(async () => {
    finish()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
      server.closeAllConnections()
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const transport: ModelTransport = (target, body, secret, signal, method = 'POST', headers = {}) => new Promise((resolve, reject) => {
    const request = httpRequest(`http://127.0.0.1:${address.port}${target.pathname}`, {
      method, signal, headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json', ...headers },
    }, resolve)
    request.once('error', reject)
    request.end(body)
  })
  return { state, transport, paused, release: finish }
}
