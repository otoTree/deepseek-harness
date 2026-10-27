/** One-use loopback acknowledgement for sandboxed Arivo windows; no general native RPC is exposed. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const acknowledgement = z.object({ version: z.literal(1), id: z.uuid(), allow: z.boolean() }).strict()

/** Freeze the original shell until native shutdown finishes, or release it on refusal/cancellation.
 * @param options - Exact current OS origin, script dispatcher, native deadline and generation lifetime.
 * @returns Idempotent release on acknowledgement; false on refusal, timeout, invalidation or failed transport.
 */
export async function prepareArivoNativeDeparture(options: {
  origin: string
  execute: (script: string) => void
  timeoutMs: number
  signal: AbortSignal
}): Promise<false | (() => void)> {
  const parsed = new URL(options.origin)
  if (parsed.origin !== options.origin || parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) {
    throw new Error('Arivo editor departure requires the current loopback OS origin')
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60000) throw new Error('Invalid departure deadline')
  if (options.signal.aborted) return false
  const id = randomUUID(), controller = new AbortController()
  const signal = AbortSignal.any([options.signal, controller.signal])
  const timer = setTimeout(() => { controller.abort() }, options.timeoutMs)
  const result = Promise.withResolvers<boolean>()
  let granted = false, settled = false
  const finish = (allow: boolean) => { if (!settled) { settled = true; result.resolve(allow) } }
  const release = () => {
    if (!granted) return
    granted = false
    options.execute(`if (location.origin === ${JSON.stringify(options.origin)}) window.__arivoNativeDeparture?.release(${JSON.stringify(id)});`)
  }
  const aborted = () => { finish(false); release() }
  signal.addEventListener('abort', aborted, { once: true })
  const isSettled = () => settled, isAborted = () => signal.aborted
  const server = createServer((request, response) => {
    void accept(request, response).catch(() => { response.destroy() })
  })
  async function accept(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const address = server.address()
    if (!address || typeof address === 'string' || request.method !== 'POST' || request.url !== `/${id}`
      || request.headers.host !== `127.0.0.1:${address.port}` || request.headers.origin !== options.origin || isSettled()) {
      response.writeHead(403).end(); return
    }
    try {
      let body = ''
      for await (const chunk of request) {
        body += String(chunk)
        if (Buffer.byteLength(body) > 1024) { response.writeHead(413).end(); request.destroy(); return }
      }
      const value = acknowledgement.parse(JSON.parse(body))
      if (value.id !== id || signal.aborted || isSettled()) { response.writeHead(403).end(); return }
      response.setHeader('Access-Control-Allow-Origin', options.origin)
      response.writeHead(204).end()
      finish(value.allow)
    } catch { response.writeHead(400).end() /* A malformed callback cannot grant native shutdown. */ }
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (!address || typeof address === 'string' || signal.aborted) return false
    const callback = `http://127.0.0.1:${address.port}/${id}`
    // Only the active OS page may grant departure. Missing/unloaded startup code fails closed.
    options.execute(`(() => {
      if (location.origin !== ${JSON.stringify(options.origin)}) return;
      Promise.resolve().then(() => window.__arivoNativeDeparture?.prepare(${JSON.stringify(id)}))
        .then(allow => fetch(${JSON.stringify(callback)}, { method: 'POST', credentials: 'omit',
          headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ version: 1, id: ${JSON.stringify(id)}, allow: allow === true }) }))
        .catch(() => {});
    })();`)
    const allowed = await result.promise
    if (!allowed || isAborted()) return false
    granted = true
    return release
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', aborted)
    // Failure also cancels preparation that may finish after the callback deadline.
    if (!granted) options.execute(`if (location.origin === ${JSON.stringify(options.origin)}) window.__arivoNativeDeparture?.release(${JSON.stringify(id)});`)
    if (server.listening) await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
      server.closeAllConnections()
    })
  }
}
