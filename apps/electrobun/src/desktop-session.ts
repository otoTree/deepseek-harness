/** Coordinates Keychain credentials, organization runtime ownership, and local data ownership. */
import { desktopCredential, runtimeAuthorization } from '@deepseek-ai/dsh-enterprise-api/contracts'
import { DesktopKeychain } from './keychain.ts'
import { EnterpriseRuntimeController } from './runtime-controller.ts'
import { DesktopTaskState, type DesktopTask } from './desktop-task-state.ts'
import type { EnterpriseProfileConfig } from './enterprise-profile.ts'
import { z } from 'zod'
import { createHash } from 'node:crypto'

export interface DesktopSessionOptions {
  apiUrl: string
  binary: string
  installAnchor?: string
  dataRoot: string
  frontendIndex?: string
  keychain: Pick<DesktopKeychain, 'get' | 'set' | 'delete'>
  keychainHelper: string
  plugins: EnterpriseProfileConfig['plugins']
  installAtLogin: boolean
  shutdownTimeoutMs?: number
  webReadyTimeoutMs?: number
  request?: RequestFunction
  clientWindowBroker?: { readonly url: string; readonly token: string }
}

type RequestFunction = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>

/** Owns one authenticated organization runtime and its local process. */
export class DesktopSession {
  private readonly options: DesktopSessionOptions
  private controller?: EnterpriseRuntimeController
  private account?: string
  private credential?: z.infer<typeof desktopCredential>
  private webUrlValue?: string
  private readonly taskState = new DesktopTaskState()

  constructor(options: DesktopSessionOptions) { this.options = options }

  private get savedAccountKey(): string {
    return 'desktop-session:' + createHash('sha256').update(new URL(this.options.apiUrl).origin).digest('hex')
  }

  /** Read the last successfully opened device account for this deployment.
   * @returns Native credential locator, or absence after logout or before first login.
   */
  async savedAccount(): Promise<string | undefined> {
    const value = await this.options.keychain.get(this.savedAccountKey)
    return value === undefined ? undefined : z.string().min(1).parse(value)
  }

  /** Start the organization runtime from a Keychain account returned by PKCE login. */
  async start(account: string): Promise<void> {
    if (this.controller) throw new Error('Desktop session is already running')
    const raw = await this.options.keychain.get(account)
    if (!raw) {
      await this.options.keychain.delete(this.savedAccountKey)
      throw new Error('Desktop credential is missing from Keychain')
    }
    const credential = desktopCredential.extend({ apiOrigin: z.string() }).parse(JSON.parse(raw))
    if (credential.apiOrigin !== new URL(this.options.apiUrl).origin) throw new Error('Desktop credential deployment does not match')
    const validation = await (this.options.request ?? fetch)(new URL(`/v1/organizations/${credential.organizationId}/runtimes/${credential.runtimeId}/authorization`, this.options.apiUrl), {
      headers: { Authorization: `Bearer ${credential.token}` }, signal: AbortSignal.timeout(30000), redirect: 'error',
    })
    if (!validation.ok) {
      await validation.body?.cancel()
      if (validation.status === 401 || validation.status === 403) {
        await this.options.keychain.delete(account)
        await this.options.keychain.delete(this.savedAccountKey)
      }
      throw new Error('Desktop team authorization is unavailable')
    }
    runtimeAuthorization.parse(await validation.json())
    const controller = new EnterpriseRuntimeController({
      binary: this.options.binary, dataRoot: this.options.dataRoot,
      storageIdentity: this.storageIdentity(credential),
      installAnchor: this.options.installAnchor,
      organizationId: credential.organizationId, installAtLogin: this.options.installAtLogin,
      shutdownTimeoutMs: this.options.shutdownTimeoutMs ?? 15000,
      enterprise: {
        ...(this.options.frontendIndex === undefined ? {} : { frontendIndex: this.options.frontendIndex }),
        apiUrl: this.options.apiUrl,
        organizationId: credential.organizationId,
        keychainHelper: this.options.keychainHelper,
        keychainAccount: account,
        defaultModel: 'enterprise-unconfigured',
        ...(this.options.clientWindowBroker === undefined ? {} : {
          clientWindowBrokerUrl: this.options.clientWindowBroker.url,
          clientWindowBrokerToken: this.options.clientWindowBroker.token,
        }),
        plugins: this.options.plugins,
      },
    })
    await controller.start()
    let webUrl: string
    try {
      webUrl = await controller.waitForWebUrl(this.options.webReadyTimeoutMs ?? 30000)
    } catch (error) {
      await controller.stop()
      throw error
    }
    try { await this.options.keychain.set(this.savedAccountKey, account) } catch (error) {
      await controller.stop()
      throw error
    }
    this.controller = controller
    this.account = account
    this.credential = credential
    this.webUrlValue = webUrl
  }

  /** Stop the owned process group, preserving the saved login for reopening. */
  async stop(): Promise<void> {
    this.taskState.markUnavailable('runtime-stopped')
    await this.stopRuntime()
  }

  /** Stop the runtime, revoke an active device and remove its saved login, including while stopped. */
  async logout(): Promise<void> {
    const account = this.account ?? await this.savedAccount()
    const saved = account === undefined ? undefined : await this.options.keychain.get(account)
    const credential = this.credential
      ?? (saved === undefined ? undefined : desktopCredential.extend({ apiOrigin: z.string() }).parse(JSON.parse(saved)))
    await this.options.keychain.delete(this.savedAccountKey)
    this.taskState.markUnavailable('logout')
    await this.stopRuntime()
    if (credential) await this.revoke(credential)
    if (account) await this.options.keychain.delete(account)
  }

  private async stopRuntime(): Promise<void> {
    const controller = this.controller
    this.controller = undefined
    this.account = undefined
    this.credential = undefined
    this.webUrlValue = undefined
    if (controller) await controller.stop()
  }

  /** Replace the active organization without overlapping runtimes. */
  async switchOrganization(account: string): Promise<void> {
    const previousAccount = this.account
    const previousCredential = this.credential
    await this.stopRuntime()
    if (previousCredential) await this.revoke(previousCredential)
    if (previousAccount) await this.options.keychain.delete(previousAccount)
    await this.options.keychain.delete(this.savedAccountKey)
    await this.start(account)
  }

  private async revoke(credential: z.infer<typeof desktopCredential>): Promise<void> {
    try {
      const response = await (this.options.request ?? fetch)(
        new URL(`/v1/organizations/${credential.organizationId}/runtimes/${credential.runtimeId}`, this.options.apiUrl),
        { method: 'DELETE', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${credential.token}` }, redirect: 'error' },
      )
      await response.body?.cancel()
    } catch {
      // Local logout still removes the credential; an unreachable Runtime expires after its configured inactivity period.
    }
  }

  /** Currently authenticated Keychain account, if a runtime is active. */
  get activeAccount(): string | undefined { return this.account }
  /** Whether the organization-scoped local runtime is alive. */
  get running(): boolean { return this.controller?.running ?? false }
  /** Authenticated local Web UI URL reported by the managed profile. */
  get webUrl(): string | undefined { return this.webUrlValue }
  /** Stable non-secret identity for browser storage owned by the active Runtime. */
  get runtimeStorageIdentity(): string | undefined {
    const credential = this.credential
    if (credential === undefined) return undefined
    return this.storageIdentity(credential)
  }

  private storageIdentity(credential: z.infer<typeof desktopCredential>): string {
    return createHash('sha256')
      .update(new URL(this.options.apiUrl).origin)
      .update('\0')
      .update(credential.organizationId)
      .update('\0')
      .update(credential.accountId)
      .digest('hex')
  }

  /** Register local scheduled work so suspension and connectivity loss can surface it. */
  registerTask(input: Parameters<DesktopTaskState['register']>[0]): DesktopTask {
    return this.taskState.register(input)
  }

  /** Mark local work missed after sleep, logout, offline, or an explicit stop. */
  markTasksUnavailable(reason: DesktopTask['missedReason']): DesktopTask[] {
    return this.taskState.markUnavailable(reason)
  }

  /** Snapshot local task state for the desktop UI and notifications. */
  listTasks(): DesktopTask[] { return this.taskState.list() }
}
