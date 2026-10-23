/** Single-use loopback PKCE login; only the native caller receives credential metadata. */
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { desktopCredential } from '@deepseek-ai/dsh-enterprise-api/contracts'
import type { DesktopKeychain } from './keychain.ts'

const MAX_AUTH_RESPONSE_BYTES = 8192

/** Read a token endpoint response without accepting an unbounded body. */
async function readAuthResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  let bytes = Buffer.alloc(0)
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      if (bytes.length + item.value.byteLength > MAX_AUTH_RESPONSE_BYTES) {
        throw new Error('Desktop authorization response exceeds limit')
      }
      bytes = Buffer.concat([bytes, item.value])
    }
  } finally { await reader.cancel(); reader.releaseLock() }
  return bytes.toString('utf8')
}

/** Extract a non-secret service message from an unsuccessful token response. */
function authResponseMessage(body: string): string {
  const text = body.trim()
  if (!text) return ''
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && 'message' in parsed
      && typeof parsed.message === 'string') return parsed.message
    if (typeof parsed === 'string') return parsed
  } catch {
    // A proxy may return plain text instead of the API's JSON error envelope.
  }
  return text
}

/** PKCE parameters approved through the API using the native account session. */
export interface DesktopAuthorization {
  challenge: string
  state: string
  callback: string
}

/** Dependencies and API deployment for one native login attempt. */
export interface DesktopLoginOptions {
  apiUrl: string
  keychain: Pick<DesktopKeychain, 'set'>
  authorize: (parameters: DesktopAuthorization) => Promise<void>
  signal: AbortSignal
  request?: (input: URL, init: RequestInit) => Promise<Response>
}

/** Dependencies for an SSO login that hands the browser session back through the API. */
export interface DesktopSsoLoginOptions {
  apiUrl: string
  provider: string
  keychain: Pick<DesktopKeychain, 'set'>
  openBrowser: (url: string) => Promise<void>
  signal: AbortSignal
  request?: (input: URL, init: RequestInit) => Promise<Response>
}

/** Accept HTTPS deployments and explicit IPv4 loopback development origins only.
 * @param value - deployment origin without credentials, query, fragment or a path.
 * @returns Validated URL; insecure remote origins reject before credential access.
 */
export function deploymentUrl(value: string): URL {
  const url = new URL(value)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Desktop deployment URL must be an HTTPS origin or an HTTP loopback origin')
  }
  return url
}

/** Complete PKCE and persist the credential before resolving. Always closes its loopback listener.
 * @param options - trusted API, native account authorization, Keychain and bounded cancellation signal.
 * @returns Non-secret device metadata and the Keychain account key; never the platform token.
 */
export async function loginDesktop(options: DesktopLoginOptions) {
  const api = deploymentUrl(options.apiUrl)
  options.signal.throwIfAborted()
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  let claimed = false
  let authority = ''
  let accept!: (code: string) => void
  let refuse!: (error: unknown) => void
  const code = new Promise<string>((resolve, reject) => { accept = resolve; refuse = reject })
  // Cancellation can precede authorization; rejection stays observed until the awaiting path settles.
  void code.catch(() => {})
  const abort = () => { refuse(options.signal.reason) }
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    let url: URL
    try { url = new URL(request.url ?? '/', 'http://' + authority) } catch {
      response.writeHead(400).end()
      return
    }
    const values = url.searchParams.getAll('code')
    const receivedCode = values.at(0)
    if (request.method !== 'GET' || request.headers.host !== authority || url.pathname !== '/callback'
      || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state
      || url.origin !== 'http://' + authority || values.length !== 1 || receivedCode === undefined
      || !/^[A-Za-z0-9_-]{32,128}$/.test(receivedCode)) {
      response.writeHead(400).end()
      return
    }
    if (claimed) { response.writeHead(409).end(); return }
    claimed = true
    response.writeHead(204).end()
    accept(receivedCode)
  })
  server.requestTimeout = 5000
  server.headersTimeout = 5000
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
    })
    server.on('error', refuse)
    options.signal.addEventListener('abort', abort, { once: true })
    options.signal.throwIfAborted()
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Desktop callback has no TCP address')
    authority = `127.0.0.1:${address.port}`
    await options.authorize({ challenge, state, callback: 'http://' + authority + '/callback' })
    const response = await (options.request ?? fetch)(new URL('/desktop/token', api), {
      method: 'POST', signal: options.signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', Origin: api.origin },
      body: JSON.stringify({ code: await code, verifier }),
    })
    if (!response.ok) {
      let detail = ''
      try {
        detail = authResponseMessage(await readAuthResponse(response))
      } catch {
        // Preserve the status when an intermediary sends an oversized or unreadable error body.
      }
      throw new Error(`Desktop authorization exchange refused (${response.status})${detail ? ': ' + detail : ''}`)
    }
    // Bound a compromised or misconfigured server response before parsing credential bytes.
    const body = await readAuthResponse(response)
    if (!body) throw new Error('Desktop authorization response is empty')
    const credential = desktopCredential.parse(JSON.parse(body))
    if (Date.parse(credential.expiresAt) <= Date.now()) throw new Error('Desktop login authorization expired')
    const account = createHash('sha256').update(api.origin).digest('hex') + ':' + credential.organizationId + ':' + credential.runtimeId
    await options.keychain.set(account, JSON.stringify({ apiOrigin: api.origin, ...credential }))
    return { account, accountId: credential.accountId, runtimeId: credential.runtimeId,
      organizationId: credential.organizationId, expiresAt: credential.expiresAt }
  } finally {
    options.signal.removeEventListener('abort', abort)
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error)
        else resolve()
      })
      server.closeAllConnections()
    })
  }
}

/** Complete SSO in the system browser, then exchange its one-use loopback code natively. */
export async function loginDesktopSso(options: DesktopSsoLoginOptions) {
  const api = deploymentUrl(options.apiUrl)
  options.signal.throwIfAborted()
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  let claimed = false
  let authority = ''
  let accept!: (code: string) => void
  let refuse!: (error: unknown) => void
  const code = new Promise<string>((resolve, reject) => { accept = resolve; refuse = reject })
  void code.catch(() => {})
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    let url: URL
    try { url = new URL(request.url ?? '/', 'http://' + authority) } catch {
      response.writeHead(400).end(); return
    }
    const values = url.searchParams.getAll('code')
    const receivedCode = values.at(0)
    if (request.method !== 'GET' || request.headers.host !== authority || url.pathname !== '/callback'
      || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state
      || url.origin !== 'http://' + authority || values.length !== 1 || receivedCode === undefined
      || !/^[A-Za-z0-9_-]{32,128}$/u.test(receivedCode)) {
      response.writeHead(400).end(); return
    }
    if (claimed) { response.writeHead(409).end(); return }
    claimed = true
    response.writeHead(204).end()
    accept(receivedCode)
  })
  server.requestTimeout = 5000
  server.headersTimeout = 5000
  const request = options.request ?? fetch
  const browserUrl = new URL('/auth/sso/desktop', api)
  const abort = () => { refuse(options.signal.reason) }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
    })
    server.on('error', refuse)
    options.signal.addEventListener('abort', abort, { once: true })
    options.signal.throwIfAborted()
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Desktop callback has no TCP address')
    authority = `127.0.0.1:${address.port}`
    const callback = `http://${authority}/callback`
    browserUrl.searchParams.set('challenge', challenge)
    browserUrl.searchParams.set('state', state)
    browserUrl.searchParams.set('callback', callback)
    const signIn = await request(new URL('/auth/sign-in/social', api), {
      method: 'POST', signal: options.signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', Origin: api.origin },
      body: JSON.stringify({ provider: options.provider, callbackURL: browserUrl.toString(), disableRedirect: true }),
    })
    if (!signIn.ok) throw new Error(`SSO authorization start refused (${signIn.status})`)
    const signInBody = await readAuthResponse(signIn)
    const signInData: unknown = JSON.parse(signInBody)
    if (typeof signInData !== 'object' || signInData === null || !('url' in signInData) || typeof signInData.url !== 'string') {
      throw new Error('SSO authorization URL is missing')
    }
    await options.openBrowser(signInData.url)
    const tokenResponse = await request(new URL('/desktop/token', api), {
      method: 'POST', signal: options.signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', Origin: api.origin },
      body: JSON.stringify({ code: await code, verifier }),
    })
    if (!tokenResponse.ok) throw new Error(`Desktop authorization exchange refused (${tokenResponse.status})`)
    const body = await readAuthResponse(tokenResponse)
    if (!body) throw new Error('Desktop authorization response is empty')
    const credential = desktopCredential.parse(JSON.parse(body))
    if (Date.parse(credential.expiresAt) <= Date.now()) throw new Error('Desktop login authorization expired')
    const account = createHash('sha256').update(api.origin).digest('hex') + ':' + credential.organizationId + ':' + credential.runtimeId
    await options.keychain.set(account, JSON.stringify({ apiOrigin: api.origin, ...credential }))
    return { account, accountId: credential.accountId, runtimeId: credential.runtimeId,
      organizationId: credential.organizationId, expiresAt: credential.expiresAt }
  } finally {
    options.signal.removeEventListener('abort', abort)
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error)
        else resolve()
      })
      server.closeAllConnections()
    })
  }
}
