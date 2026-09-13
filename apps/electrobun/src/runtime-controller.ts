/** Enterprise desktop lifecycle: one organization-scoped local runtime and optional LaunchAgent. */
import { z } from 'zod'
import { LocalRuntime } from './runtime.ts'
import { installLaunchAgent, uninstallLaunchAgent } from './launch-agent.ts'
import { enterpriseProfileConfig } from './enterprise-profile.ts'

const configSchema = z.object({
  binary: z.string().min(1), installAnchor: z.string().min(1).optional(), dataRoot: z.string().min(1), organizationId: z.uuid(),
  installAtLogin: z.boolean().default(false),
  shutdownTimeoutMs: z.number().int().min(1).max(60000).default(15000),
  enterprise: enterpriseProfileConfig.omit({ home: true }),
}).strict()

/** Coordinates runtime and login-start lifecycle without putting credentials in process arguments. */
export class EnterpriseRuntimeController {
  private readonly config: z.infer<typeof configSchema>
  private runtime?: LocalRuntime
  private agentInstalled = false

  constructor(input: z.input<typeof configSchema>) { this.config = configSchema.parse(input) }

  /** Start the organization runtime and optionally register its non-secret login-start command. */
  async start(): Promise<void> {
    if (this.runtime !== undefined) return
    const runtime = new LocalRuntime({
      binary: this.config.binary, organizationId: this.config.organizationId,
      installAnchor: this.config.installAnchor,
      dataRoot: this.config.dataRoot, shutdownTimeoutMs: this.config.shutdownTimeoutMs,
      enterprise: this.config.enterprise,
    })
    await runtime.start()
    try {
      if (this.config.installAtLogin && process.platform === 'darwin') {
        await installLaunchAgent(this.config.binary, ['--profile', 'enterprise-desktop', '--no-open', '--host', '127.0.0.1', '--port', '0'], {
          DSH_HOME: runtime.home,
          ...(this.config.installAnchor ? { DSH_INSTALL_ANCHOR: this.config.installAnchor } : {}),
        }, { load: false })
        this.agentInstalled = true
      }
    } catch (error) {
      await runtime.stop()
      throw error
    }
    this.runtime = runtime
  }

  /** Stop the local process group and remove an agent installed by this controller. */
  async stop(): Promise<void> {
    const runtime = this.runtime
    this.runtime = undefined
    if (runtime !== undefined) await runtime.stop()
    if (this.agentInstalled) {
      this.agentInstalled = false
      await uninstallLaunchAgent()
    }
  }

  /** Stop runtime work while leaving login-start preference unchanged. */
  async stopRuntime(): Promise<void> {
    const runtime = this.runtime
    this.runtime = undefined
    if (runtime !== undefined) await runtime.stop()
  }

  /** Whether this controller owns an active local process. */
  get running(): boolean { return this.runtime !== undefined }

  /** Wait for the managed runtime's local Web UI URL. */
  waitForWebUrl(timeoutMs?: number): Promise<string> {
    if (!this.runtime) return Promise.reject(new Error('Desktop runtime is not running'))
    return this.runtime.waitForWebUrl(timeoutMs)
  }
}
