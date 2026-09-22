/* oxlint-disable @stylistic/max-len -- Activation requests mirror the enterprise lifecycle wire protocol. */
import { verifyPluginRelease, type PluginRelease } from './plugin-verifier.ts'
import { bindPluginSdk } from '@deepseek-ai/dsh-plugin-runtime'
import { createHttpPluginTransport } from '@deepseek-ai/dsh-plugin-sdk'
import type { PluginSdk } from '@deepseek-ai/dsh-plugin-protocol'

/** Host callback used by the desktop runtime to register a verified plugin. */
export type PluginLoadCallback = (release: PluginRelease) => Promise<() => void | Promise<void>> | (() => void | Promise<void>)

/** Single gate for install, dynamic loading, tool registration and panel activation. */
export async function loadVerifiedPlugin(
  input: unknown,
  organizationId: string,
  load: PluginLoadCallback,
): Promise<() => Promise<void>> {
  const release = verifyPluginRelease(input, organizationId)
  const disposer = await load(release)
  let disposed = false
  return async () => {
    if (disposed) return
    disposed = true
    await disposer()
  }
}

/** Remote activation lease used by the desktop Host and Client loaders. */
export class PluginActivationSession {
  private activationId: string | undefined
  private disposeSdk: (() => void) | undefined
  private readonly request: typeof globalThis.fetch
  /** SDK becomes available after start has completed. */
  sdk: PluginSdk | undefined

  constructor(private readonly options: {
    readonly apiUrl: string
    readonly organizationId: string
    readonly installationId: string
    readonly deviceId: string
    readonly targetKind: 'host' | 'client'
    readonly authorization: string
    readonly fetch?: typeof globalThis.fetch
  }) {
    this.request = options.fetch ?? globalThis.fetch
  }

  /** Enable the target, mint an activation lease, and bind the installation-scoped SDK. */
  async start(): Promise<PluginSdk> {
    if (this.sdk !== undefined) return this.sdk
    const base = this.options.apiUrl.replace(/\/$/u, '')
    const headers = { Authorization: this.options.authorization, 'Content-Type': 'application/json' }
    try {
      const state = await this.request(`${base}/v1/organizations/${this.options.organizationId}/plugins/installations/${this.options.installationId}/devices/${encodeURIComponent(this.options.deviceId)}`, { method: 'PUT', headers, body: JSON.stringify({ targetKind: this.options.targetKind, enabled: true }) })
      if (!state.ok) throw new Error(`Plugin target enable failed (${state.status})`)
      const response = await this.request(`${base}/v1/organizations/${this.options.organizationId}/plugins/installations/${this.options.installationId}/activate`, { method: 'POST', headers, body: JSON.stringify({ deviceId: this.options.deviceId, targetKind: this.options.targetKind }) })
      if (!response.ok) throw new Error(`Plugin activation failed (${response.status})`)
      const lease = await response.json() as { activationId?: unknown; token?: unknown }
      if (typeof lease.activationId !== 'string' || typeof lease.token !== 'string' || lease.activationId.length === 0 || lease.token.length === 0) {
        throw new Error('Plugin activation returned an invalid lease')
      }
      this.activationId = lease.activationId
      const transport = createHttpPluginTransport({ baseUrl: base, activationId: lease.activationId, token: lease.token, fetch: this.request })
      const bound = bindPluginSdk(transport)
      this.sdk = bound.sdk
      this.disposeSdk = bound.dispose
      return bound.sdk
    } catch (error) {
      await this.heartbeat('failed', error instanceof Error ? error.message : 'Plugin activation failed').catch(() => {})
      throw error
    }
  }

  /** Report observed state so the control plane can distinguish a loaded target from a desired one. */
  async heartbeat(observedState: 'active' | 'failed', error: string | null = null): Promise<void> {
    if (this.activationId === undefined) return
    const headers = { Authorization: this.options.authorization, 'Content-Type': 'application/json' }
    await this.request(`${this.options.apiUrl.replace(/\/$/u, '')}/v1/organizations/${this.options.organizationId}/plugins/installations/${this.options.installationId}/devices/${encodeURIComponent(this.options.deviceId)}/heartbeat`, { method: 'POST', headers, body: JSON.stringify({ activationId: this.activationId, targetKind: this.options.targetKind, observedState, error }) })
  }

  /** Revoke the lease and invalidate retained SDK handles. */
  async stop(): Promise<void> {
    this.disposeSdk?.()
    this.disposeSdk = undefined
    this.sdk = undefined
    if (!this.activationId) return
    const headers = { Authorization: this.options.authorization, 'Content-Type': 'application/json' }
    await this.request(`${this.options.apiUrl.replace(/\/$/u, '')}/v1/organizations/${this.options.organizationId}/plugins/installations/${this.options.installationId}/deactivate`, { method: 'POST', headers, body: JSON.stringify({ deviceId: this.options.deviceId, targetKind: this.options.targetKind }) })
    this.activationId = undefined
  }
}
