/** Native-owned account cookies and PKCE exchange for the bundled account UI. */
import { z } from 'zod'
import { deploymentUrl, loginDesktop, loginDesktopSso } from './desktop-auth.ts'
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

  constructor(private readonly options: {
    apiUrl: string
    keychain: Pick<DesktopKeychain, 'set' | 'delete'>
    enter: (account: string) => Promise<void>
    logout: () => Promise<void>
    openExternal: (url: string) => Promise<void>
    request?: typeof fetch
  }) {
    this.api = deploymentUrl(options.apiUrl)
  }

  private async request(path: string, method: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const response = await (this.options.request ?? fetch)(new URL(path, this.api), {
      method, signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', Origin: this.api.origin,
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
    const deployment = await this.request('/auth/deployment', 'GET', signal)
    if (!this.cookies.size) {
      const ssoProviders = await this.request('/auth/sso/providers', 'GET', signal)
      return accountState.parse({ deployment, user: null, organizations: [], ssoProviders })
    }
    try {
      const user = await this.request('/v1/me', 'GET', signal)
      const organizations = await this.request('/v1/desktop/organizations', 'GET', signal)
      const ssoProviders = await this.request('/auth/sso/providers', 'GET', signal)
      return accountState.parse({ deployment, user, organizations, ssoProviders })
    } catch (error) {
      if (error instanceof AccountError && error.status === 401) {
        this.cookies.clear()
        const ssoProviders = await this.request('/auth/sso/providers', 'GET', signal)
        return accountState.parse({ deployment, user: null, organizations: [], ssoProviders })
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
      case 'sso': {
        const result = await loginDesktopSso({
          apiUrl: this.api.origin, provider: input.provider,
          keychain: this.options.keychain, signal, request: this.options.request,
          openBrowser: this.options.openExternal,
        })
        await this.options.enter(result.account)
        return
      }
      case 'register':
        await this.request('/auth/sign-up/email', 'POST', signal, {
          name: input.name, email: input.email, password: input.password,
        })
        return
      case 'create':
        await this.request('/v1/organizations', 'POST', signal, { name: input.name, defaultBudget: input.defaultBudget })
        return
      case 'recover': {
        const entry = z.object({ url: z.url() }).strict().parse(await this.request('/auth/account-entry', 'GET', signal))
        await this.options.openExternal(entry.url)
        return
      }
      case 'join':
        await this.request('/v1/invitations/accept', 'POST', signal, { token: input.token })
        return
      case 'logout':
        await this.options.logout()
        try { await this.request('/auth/sign-out', 'POST', signal, {}) } finally { this.cookies.clear() }
        return
      case 'enter': {
        let result: Awaited<ReturnType<typeof loginDesktop>>
        try {
          result = await loginDesktop({
            apiUrl: this.api.origin, keychain: this.options.keychain, signal,
            request: this.options.request,
            authorize: async (parameters) => {
              const authorization = z.object({ callback: z.url() }).parse(await this.request('/v1/desktop/authorize', 'POST', signal, {
                organizationId: input.organizationId,
                ...parameters,
              }))
              const callback = new URL(authorization.callback)
              const expected = new URL(parameters.callback)
              if (callback.origin !== expected.origin || callback.pathname !== expected.pathname
                || callback.searchParams.get('state') !== parameters.state) throw new AccountError(502)
              const response = await fetch(callback, { signal, redirect: 'error' })
              await response.body?.cancel()
              if (!response.ok) throw new AccountError(502)
            },
          })
        } catch (error) {
          if (error instanceof AccountError && error.status === 401) this.cookies.clear()
          throw error
        }
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
