/** MCP SDK discovery and PKCE with an installation-owned native token record. */
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { auth, extractWWWAuthenticateParams, type OAuthClientProvider, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import type { pluginMcpConnection } from './wire.ts'
import { marketCredentialKey } from './plugin-credentials.ts'

/** Complete a browser authorization without exposing tokens to the browser bridge.
 * @param ctx - Host context providing native credential persistence.
 * @param scope - Installation that owns the grant.
 * @param serverUrl - MCP endpoint from the verified product configuration.
 * @param signal - Cancels discovery, exchange, and the loopback listener.
 * @param redirect - Delivers only the service's authorization URL to the caller.
 * @param verifyOwner - Rechecks installation ownership before committing the grant.
 * @param options - Verified provider-specific metadata compatibility settings.
 * @returns After the validated callback commits a grant to the native store.
 */
export async function authorizePluginMcp(
  ctx: Context,
  scope: { readonly organizationId: string; readonly installationId: string },
  serverUrl: string,
  signal: AbortSignal,
  redirect: (url: string) => void,
  verifyOwner: () => Promise<void>,
  options?: z.infer<typeof pluginMcpConnection>['oauth'],
): Promise<void> {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) throw new Error('plugin/credentials-unavailable')
  const state = randomBytes(32).toString('base64url')
  let redirectUrl = ''
  let verifier = ''
  let client: OAuthClientInformationMixed | undefined
  let tokens: OAuthTokens | undefined
  let discovery: OAuthDiscoveryState | undefined
  const progress: { phase: 'discovery' | 'registration' | 'callback' | 'exchange' | 'commit' } = { phase: 'discovery' }
  let received = false
  let resolveCode!: (code: string) => void
  let rejectCode!: (error: Error) => void
  const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject })
  // Discovery can fail before the code is awaited.
  void code.catch(() => {})
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', redirectUrl)
    if (url.pathname !== '/callback' || received || url.searchParams.get('state') !== state) {
      response.writeHead(400).end(); return
    }
    const value = url.searchParams.get('code')
    if (!value || url.searchParams.has('error')) {
      received = true; rejectCode(new Error('plugin/authorization-denied')); response.writeHead(400).end(); return
    }
    received = true
    resolveCode(value)
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end()
  })
  const abort = (): void => { rejectCode(new Error('plugin/authorization-cancelled')) }
  signal.addEventListener('abort', abort, { once: true })
  const provider: OAuthClientProvider = {
    get redirectUrl() { return redirectUrl },
    get clientMetadata() { return {
      client_name: 'Harness', redirect_uris: [redirectUrl],
      grant_types: discovery?.authorizationServerMetadata?.grant_types_supported?.includes('refresh_token') ? ['authorization_code', 'refresh_token'] : ['authorization_code'],
      response_types: ['code'], token_endpoint_auth_method: 'none',
    } },
    state: () => state,
    clientInformation: () => client,
    saveClientInformation: (value) => { client = value },
    discoveryState: () => discovery,
    saveDiscoveryState: (value) => { discovery = value; if (progress.phase === 'discovery') progress.phase = 'registration' },
    tokens: () => tokens,
    saveTokens: (value) => { tokens = value },
    redirectToAuthorization: (url) => { progress.phase = 'callback'; redirect(url.toString()) },
    saveCodeVerifier: (value) => { verifier = value },
    codeVerifier: () => verifier,
  }
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const metadataRequest = url.pathname.startsWith('/.well-known/oauth-authorization-server')
    const target = metadataRequest && options?.authorizationServerMetadataUrl ? options.authorizationServerMetadataUrl : input
    const response = await fetch(target, { ...init, signal })
    if (!metadataRequest || !options?.responseTypesSupported || !response.ok) return response
    const metadata: unknown = await response.json()
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) throw new Error('plugin/authorization-discovery-failed')
    // Only a verified provider declaration can supply the missing response types.
    return Response.json({ response_types_supported: options.responseTypesSupported, ...metadata })
  }
  try {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('plugin/authorization-callback-unavailable')
    redirectUrl = `http://127.0.0.1:${address.port}/callback`
    const challenge = await fetch(serverUrl, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'Harness', version: '1.0.0' },
      } }),
    })
    const { resourceMetadataUrl, scope: requestedScope } = extractWWWAuthenticateParams(challenge)
    await challenge.body?.cancel()
    const authOptions = {
      serverUrl, fetchFn,
      ...(resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl }),
      ...(requestedScope === undefined ? {} : { scope: requestedScope }),
    }
    const outcome = await auth(provider, authOptions)
    if (outcome === 'REDIRECT') {
      const authorizationCode = await code
      progress.phase = 'exchange'
      const result = await auth(provider, { ...authOptions, authorizationCode })
      if (result !== 'AUTHORIZED') throw new Error('plugin/authorization-incomplete')
    }
    signal.throwIfAborted()
    if (!tokens) throw new Error('plugin/authorization-incomplete')
    progress.phase = 'commit'
    await verifyOwner()
    signal.throwIfAborted()
    await credentials.modifyRecord(marketCredentialKey(scope, 'oauth-state'), () => Promise.resolve({
      kind: 'grant', payload: { name: 'oauth-state', value: JSON.stringify({ client, tokens, redirectUrl, discovery }) },
    }))
  } catch (error) {
    if (signal.aborted) throw new Error('plugin/authorization-cancelled')
    if (error instanceof Error && (error.message === 'plugin/authorization-denied' || error.message === 'plugin/authorization-cancelled')) throw error
    throw new Error(`plugin/authorization-${progress.phase === 'callback' || progress.phase === 'commit' ? 'failed' : `${progress.phase}-failed`}`)
  } finally {
    signal.removeEventListener('abort', abort)
    server.closeAllConnections()
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
    }
  }
}
