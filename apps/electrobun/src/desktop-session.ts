/** Coordinates Keychain credentials, organization runtime ownership, and lease fencing. */
import { desktopCredential } from '@deepseek-ai/dsh-enterprise-api/contracts'
import { DesktopKeychain } from './keychain.ts'
import { EnterpriseRuntimeController } from './runtime-controller.ts'
import { RuntimeHeartbeat } from './runtime-heartbeat.ts'
import { DesktopTaskState, type DesktopTask } from './desktop-task-state.ts'
import type { EnterpriseProfileConfig } from './enterprise-profile.ts'
import { modelCatalog } from '@deepseek-ai/dsh-enterprise-api/contracts'
import { z } from 'zod'

export interface DesktopSessionOptions {
  apiUrl: string
  binary: string
  installAnchor?: string
  dataRoot: string
  frontendIndex?: string
  keychain: Pick<DesktopKeychain, 'get' | 'delete'>
  keychainHelper: string
  plugins: EnterpriseProfileConfig['plugins']
  installAtLogin: boolean
  heartbeatIntervalMs?: number
  shutdownTimeoutMs?: number
  webReadyTimeoutMs?: number
  request?: RequestFunction
  onLeaseLost?: (error: unknown) => void | Promise<void>
}

type RequestFunction = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>

async function defaultModel(
  request: RequestFunction,
  apiUrl: string,
  credential: z.infer<typeof desktopCredential>,
): Promise<string> {
  const response = await request(new URL(`/v1/organizations/${credential.organizationId}/models`, apiUrl), {
    headers: { Authorization: `Bearer ${credential.token}` },
    redirect: 'error',
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error('Enterprise model catalog is unavailable')
  }
  const models = modelCatalog.parse(await response.json())
  const selected = models[0]
  // This sentinel represents an empty platform catalog; the gateway resolves it
  // against the live enabled catalog for the next call.
  return selected?.id ?? 'enterprise-unconfigured'
}

/** Owns one authenticated organization runtime and its heartbeat. */
export class DesktopSession {
  private readonly options: DesktopSessionOptions
  private controller?: EnterpriseRuntimeController
  private heartbeat?: RuntimeHeartbeat
  private account?: string
  private credential?: z.infer<typeof desktopCredential>
  private webUrlValue?: string
  private readonly taskState = new DesktopTaskState()

  constructor(options: DesktopSessionOptions) { this.options = options }

  /** Start the organization runtime from a Keychain account returned by PKCE login. */
  async start(account: string): Promise<void> {
    if (this.controller) throw new Error('Desktop session is already running')
    const raw = await this.options.keychain.get(account)
    if (!raw) throw new Error('Desktop credential is missing from Keychain')
    const stored = JSON.parse(raw) as {
      apiOrigin?: unknown
      runtimeId?: unknown
      token?: unknown
      leaseUntil?: unknown
      organizationId?: unknown
    }
    const credential = desktopCredential.parse({
      runtimeId: stored.runtimeId,
      token: stored.token,
      leaseUntil: stored.leaseUntil,
      organizationId: stored.organizationId,
    })
    const apiOrigin = (stored as { apiOrigin?: unknown }).apiOrigin
    if (apiOrigin !== new URL(this.options.apiUrl).origin) throw new Error('Desktop credential deployment does not match')
    const model = await defaultModel(this.options.request ?? fetch, this.options.apiUrl, credential)
    const controller = new EnterpriseRuntimeController({
      binary: this.options.binary, dataRoot: this.options.dataRoot,
      installAnchor: this.options.installAnchor,
      organizationId: credential.organizationId, installAtLogin: this.options.installAtLogin,
      shutdownTimeoutMs: this.options.shutdownTimeoutMs ?? 15000,
      enterprise: {
        ...(this.options.frontendIndex === undefined ? {} : { frontendIndex: this.options.frontendIndex }),
        apiUrl: this.options.apiUrl,
        organizationId: credential.organizationId,
        keychainHelper: this.options.keychainHelper,
        keychainAccount: account,
        defaultModel: model,
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
    const heartbeat = new RuntimeHeartbeat({
      apiUrl: this.options.apiUrl, organizationId: credential.organizationId,
      runtimeId: credential.runtimeId, token: credential.token,
      intervalMs: this.options.heartbeatIntervalMs ?? 30_000, request: this.options.request,
      onLeaseLost: async (error) => {
        this.taskState.markUnavailable('runtime-stopped')
        await controller.stopRuntime()
        await this.options.onLeaseLost?.(error)
      },
    })
    try {
      await heartbeat.start()
    } catch (error) {
      await controller.stop()
      throw error
    }
    this.controller = controller
    this.heartbeat = heartbeat
    this.account = account
    this.credential = credential
    this.webUrlValue = webUrl
  }

  /** Stop heartbeat before stopping the owned process group. */
  async stop(): Promise<void> {
    this.taskState.markUnavailable('runtime-stopped')
    await this.stopRuntime()
  }

  /** Stop the runtime and delete the active device credential from Keychain. */
  async logout(): Promise<void> {
    const account = this.account
    const credential = this.credential
    this.taskState.markUnavailable('logout')
    await this.stopRuntime()
    if (credential) await this.revoke(credential)
    if (account) await this.options.keychain.delete(account)
  }

  private async stopRuntime(): Promise<void> {
    const heartbeat = this.heartbeat
    const controller = this.controller
    this.heartbeat = undefined
    this.controller = undefined
    this.account = undefined
    this.credential = undefined
    this.webUrlValue = undefined
    if (heartbeat) await heartbeat.stop()
    if (controller) await controller.stop()
  }

  /** Replace the active organization without overlapping runtimes. */
  async switchOrganization(account: string): Promise<void> {
    const previousAccount = this.account
    const previousCredential = this.credential
    await this.stopRuntime()
    if (previousCredential) await this.revoke(previousCredential)
    if (previousAccount) await this.options.keychain.delete(previousAccount)
    await this.start(account)
  }

  private async revoke(credential: z.infer<typeof desktopCredential>): Promise<void> {
    try {
      const response = await (this.options.request ?? fetch)(
        new URL(`/v1/organizations/${credential.organizationId}/runtimes/${credential.runtimeId}`, this.options.apiUrl),
        { method: 'DELETE', headers: { Authorization: `Bearer ${credential.token}` }, redirect: 'error' },
      )
      await response.body?.cancel()
    } catch {
      // Local logout still removes the credential; an unreachable Runtime expires with its server lease.
    }
  }

  /** Currently authenticated Keychain account, if a runtime is active. */
  get activeAccount(): string | undefined { return this.account }
  /** Whether the organization-scoped local runtime is alive. */
  get running(): boolean { return this.controller?.running ?? false }
  /** Authenticated local Web UI URL reported by the managed profile. */
  get webUrl(): string | undefined { return this.webUrlValue }

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
