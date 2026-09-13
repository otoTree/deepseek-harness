/** Loopback host for bundled account assets; platform credentials never reach the WebView. */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { accountAction } from '@deepseek-ai/dsh-client-ui-enterprise-account'
import { AccountError } from './local-account.ts'
import type { LocalAccount } from './local-account.ts'

/** Validate a native-issued account URL before opening a window.
 * @param value - Loopback URL whose fragment holds the per-launch account token.
 * @returns Validated URL; external origins, paths and queries are rejected.
 */
export function validateAccountUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || url.username || url.password || url.pathname !== '/' || url.search
    || !/^#token=[A-Za-z0-9_-]{43}$/.test(url.hash)) throw new Error('Invalid local account URL')
  return url.toString()
}

/** Start the bundled account page on a private loopback port.
 * @param frontend - Absolute directory containing Vite's account.html and assets.
 * @param account - Native account owner; responses contain no platform credentials.
 * @returns Startup URL and shutdown that cancels and awaits all requests.
 */
export async function startAccountServer(frontend: string, account: Pick<LocalAccount, 'state' | 'run'>) {
  const html = await readFile(join(frontend, 'account.html'), 'utf8')
  const token = randomBytes(32).toString('base64url')
  const lifetime = new AbortController()
  const pending = new Set<Promise<void>>()
  let origin = ''
  let busy = false
  const server = createServer((request, response) => {
    const handle = async (): Promise<void> => {
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Referrer-Policy', 'no-referrer')
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
      const url = new URL(request.url ?? '/', origin)
      if (request.headers.host !== new URL(origin).host || url.origin !== origin
        || (request.headers.origin !== undefined && request.headers.origin !== origin)) { response.writeHead(403).end(); return }
      if (request.method === 'GET' && url.pathname === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end(html)
        return
      }
      if (request.method === 'GET' && /^\/assets\/[A-Za-z0-9_.-]+$/.test(url.pathname)) {
        const bytes = await readFile(join(frontend, url.pathname.slice(1)))
        const extension = url.pathname.split('.').at(-1)
        const types: Record<string, string> = { js: 'text/javascript', css: 'text/css', woff: 'font/woff', woff2: 'font/woff2' }
        response.setHeader('Content-Type', types[extension ?? ''] ?? 'application/octet-stream')
        response.end(bytes)
        return
      }
      if (request.headers['x-desktop-token'] !== token
        || (request.method === 'POST' && request.headers.origin !== origin)) { response.writeHead(403).end(); return }
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(120000)])
      response.setHeader('Content-Type', 'application/json')
      if (request.method === 'GET' && url.pathname === '/account/state') {
        response.end(JSON.stringify(await account.state(signal)))
        return
      }
      if (request.method !== 'POST' || url.pathname !== '/account/action') { response.writeHead(404).end(); return }
      if (busy) { response.writeHead(409).end(JSON.stringify({ status: 409 })); return }
      busy = true
      try {
        let body = ''
        for await (const bytes of request) {
          body += String(bytes)
          if (Buffer.byteLength(body) > 16384) { response.writeHead(413).end(); return }
        }
        const input = accountAction.safeParse(JSON.parse(body))
        if (!input.success) { response.writeHead(400).end(JSON.stringify({ status: 400 })); return }
        await account.run(input.data, signal)
        response.end(JSON.stringify({ ok: true }))
      } finally { busy = false }
    }
    const task = handle().catch((error: unknown) => {
      if (response.destroyed) return
      const status = error instanceof AccountError ? error.status : error instanceof SyntaxError ? 400 : 503
      // Keep the browser response deliberately opaque, but retain the native
      // diagnostic in development so Runtime/profile failures are actionable.
      if (status >= 500) console.error('[enterprise desktop] account action failed', error)
      response.writeHead(status).end(JSON.stringify({ status }))
    })
    pending.add(task)
    void task.finally(() => pending.delete(task))
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Account server did not bind loopback')
  origin = `http://127.0.0.1:${address.port}`
  return {
    // A fragment stays in the WebView; requests carry the token in a header.
    url: validateAccountUrl(`${origin}/#token=${token}`),
    async close(): Promise<void> {
      lifetime.abort()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error) reject(error); else resolve() })
        server.closeAllConnections()
      })
      await Promise.allSettled(pending)
    },
  }
}
