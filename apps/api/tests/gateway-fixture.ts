/** A per-test HTTP upstream; production DNS policy remains outside this transport fixture. */
import { createServer, request as httpRequest } from 'node:http'
import { gzipSync } from 'node:zlib'
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
    compressFileResponses: false,
    responseContent: 'Gateway reply',
    responseHeaders: {} as Record<string, string>,
    responseMetadata: {} as Record<string, unknown>,
    responseSplitMarker: '',
    secret: '',
    paths: [] as string[],
    methods: [] as string[],
  }
  let notify!: () => void
  let finish!: () => void
  const paused = new Promise<void>((resolve) => { notify = resolve })
  const released = new Promise<void>((resolve) => { finish = resolve })
  const server = createServer((request, response) => { void (async () => {
    for (const [name, value] of Object.entries(state.responseHeaders)) response.setHeader(name, value)
    request.setEncoding('utf8')
    let body = ''
    for await (const chunk of request) {
      if (typeof chunk !== 'string') throw new Error('Unexpected request bytes')
      body += chunk
    }
    state.headers.push(request.headers)
    state.paths.push(request.url ?? '')
    state.methods.push(request.method ?? '')
    state.secret = request.headers.authorization ?? ''
    if (request.url?.startsWith('/files/') && request.method === 'DELETE') {
      state.fileDeletes.push(request.url)
      response.statusCode = state.fileDeleteStatus
      response.end()
      return
    }
    if (request.url?.startsWith('/files/') && request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ id: request.url.slice('/files/'.length), status: 'active' }))
      return
    }
    if (request.url === '/files' && request.method === 'POST') {
      state.fileUploads.push(body)
      response.setHeader('Content-Type', 'application/json')
      const output = JSON.stringify({ id: `file-${state.fileUploads.length}`, status: 'active' })
      if (state.compressFileResponses) {
        response.setHeader('Content-Encoding', 'gzip')
        response.end(gzipSync(output))
      } else response.end(output)
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
    const firstEvent = `data:${JSON.stringify({ ...state.responseMetadata, choices: [{ index: 0, delta: { content: state.responseContent } }] })}\r\n\r\n`
    const marker = state.responseSplitMarker && firstEvent.indexOf(state.responseSplitMarker)
    if (typeof marker === 'number' && marker >= 0) {
      const split = marker + Math.max(1, Math.floor(state.responseSplitMarker.length / 2))
      response.write(firstEvent.slice(0, split))
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      response.write(firstEvent.slice(split))
    } else response.write(firstEvent)
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
    const request = httpRequest(`http://127.0.0.1:${address.port}${target.pathname}${target.search}`, {
      method, signal, headers: { ...headers, Authorization: 'Bearer ' + secret },
    }, resolve)
    request.once('error', reject)
    request.end(body)
  })
  return { state, transport, paused, release: finish }
}
