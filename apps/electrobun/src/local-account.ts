/** Native-owned account cookies and PKCE exchange for the bundled account UI. */
import { z } from 'zod'
import { deploymentUrl, loginDesktop } from './desktop-auth.ts'
import { accountState, type AccountAction } from '@deepseek-ai/dsh-client-ui-enterprise-account'
import type { DesktopKeychain } from './keychain.ts'

/** Safe status for the account UI; upstream response bodies and cookies stay native. */
export class AccountError extends Error {
  constructor(readonly status: number, readonly detail?: string) { super('Account request failed') }
}

/** One in-memory login session, shared by registration and organization selection. */
export class LocalAccount {
  private busy = false
  private readonly cookies = new Map<string, string>()
  private readonly api: URL
  private readonly origin: string

  constructor(private readonly options: {
    apiUrl: string
    portalOrigin: string
    keychain: Pick<DesktopKeychain, 'set' | 'delete'>
    enter: (account: string) => Promise<void>
    logout: () => Promise<void>
    request?: typeof fetch
  }) {
    this.api = deploymentUrl(options.apiUrl)
    // This value identifies the API's trusted client; it is never loaded as a page.
    this.origin = deploymentUrl(options.portalOrigin).origin
  }

  private async request(path: string, method: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const response = await (this.options.request ?? fetch)(new URL(path, this.api), {
      method, signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', Origin: this.origin,
        Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ') },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0] ?? ''
      const separator = pair.indexOf('=')
      if (separator > 0) {
        const name = pair.slice(0, separator)
        const value = pair.slice(separator + 1)
        if (!value || /;\s*max-age=0(?:;|$)/i.test(cookie)) this.cookies.delete(name)
        else this.cookies.set(name, value)
      }
    }
    if (!response.ok) {
      const detail = await response.text()
      throw new AccountError(response.status, detail.slice(0, 256))
    }
    return response.json()
  }

  /** Return only display identity and organization names; never the API login cookie. */
  async state(signal: AbortSignal): Promise<z.infer<typeof accountState>> {
    if (!this.cookies.size) return { user: null, organizations: [] }
    try {
      const user = await this.request('/v1/me', 'GET', signal)
      const organizations = await this.request('/v1/organizations', 'GET', signal)
      return accountState.parse({ user, organizations })
    } catch (error) {
      if (error instanceof AccountError && error.status === 401) {
        this.cookies.clear()
        return { user: null, organizations: [] }
      }
      throw error
    }
  }

  /** Execute one account mutation at a time, including menu requests.
   * @param input - Validated command from the local account page.
   * @param signal - Host lifetime and request deadline.
   * @returns Completion after API and native effects settle; rejects concurrent mutations.
   */
  async run(input: AccountAction, signal: AbortSignal): Promise<void> {
    if (this.busy) throw new AccountError(409)
    this.busy = true
    try { await this.execute(input, signal) } finally { this.busy = false }
  }

  private async execute(input: AccountAction, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    switch (input.action) {
      case 'login':
        await this.request('/auth/sign-in/email', 'POST', signal, { email: input.email, password: input.password })
        return
      case 'register':
        await this.request('/auth/sign-up/email', 'POST', signal, {
          name: input.name, email: input.email, password: input.password,
        })
        return
      case 'create':
        await this.request('/v1/organizations', 'POST', signal, { name: input.name })
        return
      case 'join':
        await this.request('/v1/invitations/accept', 'POST', signal, { token: input.token })
        return
      case 'logout':
        await this.options.logout()
        try { await this.request('/auth/sign-out', 'POST', signal, {}) } finally { this.cookies.clear() }
        return
      case 'enter': {
        const result = await loginDesktop({
          apiUrl: this.api.origin, portalUrl: this.origin, keychain: this.options.keychain, signal,
          request: this.options.request,
          openBrowser: async (value) => {
            const request = new URL(value)
            const authorization = z.object({ callback: z.url() }).parse(await this.request('/v1/desktop/authorize', 'POST', signal, {
              organizationId: input.organizationId,
              challenge: request.searchParams.get('challenge'), state: request.searchParams.get('state'),
              callback: request.searchParams.get('callback'),
            }))
            const callback = new URL(authorization.callback)
            const callbackValue = request.searchParams.get('callback')
            if (!callbackValue) throw new AccountError(502)
            const expected = new URL(callbackValue)
            if (callback.origin !== expected.origin || callback.pathname !== expected.pathname
              || callback.searchParams.get('state') !== request.searchParams.get('state')) throw new AccountError(502)
            const response = await fetch(callback, { signal, redirect: 'error' })
            await response.body?.cancel()
            if (!response.ok) throw new AccountError(502)
          },
        })
        try { signal.throwIfAborted(); await this.options.enter(result.account) } catch (error) {
          try {
            await this.request(`/v1/organizations/${input.organizationId}/runtimes/${result.runtimeId}`, 'DELETE', signal)
          } finally { await this.options.keychain.delete(result.account) }
          throw error
        }
      }
    }
  }
}
