/** Enterprise desktop sandbox provider: the DSH local backend with explicit fail-closed policy defaults. */
import { z } from 'zod'
import { posix, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import type { SandboxPolicy, ConfinedArgv } from '@deepseek-ai/dsh-sandbox'

export const name = 'enterprise-sandbox'
export const inject: readonly string[] = []
export const Config = z.object({
  defaultMode: z.enum(['read-only', 'workspace-write']).default('read-only'),
  probeTimeoutMs: z.number().int().positive().max(30000).default(5000),
}).strict()
type Settings = z.infer<typeof Config>

/** Check that workspace roots are fully qualified for the active desktop host.
 * @param value - Workspace root supplied to the sandbox.
 * @param platform - Node platform identifier.
 * @returns Whether the root is fully qualified for the selected host.
 */
export function isEnterpriseWorkspaceRoot(value: string, platform = process.platform): boolean {
  return platform === 'win32'
    ? win32.isAbsolute(value) && win32.parse(value).root.length > 1
    : posix.isAbsolute(value)
}

/** Enterprise wrapper that never falls back to an unconfined argv for restricted modes. */
export class EnterpriseSandboxProvider extends LocalSandboxProvider {
  readonly defaultMode: Settings['defaultMode']

  constructor(ctx: Context, config: Settings) {
    const settings = Config.parse(config)
    super(ctx, { runnerCommand: [], runnerFailureSignatures: [], probeTimeoutMs: settings.probeTimeoutMs })
    this.defaultMode = settings.defaultMode
  }

  /** Resolve one user-selected mode and delegate to the real local provider.
   * @param argv - Program argv, never a shell string.
   * @param policy - Absolute workspace policy for this call.
   * @returns Platform-confined argv or the provider's fail-closed unavailable error.
   */
  override confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    if (!isEnterpriseWorkspaceRoot(policy.workspaceRoot)) throw new Error('Enterprise sandbox requires an absolute workspace root')
    return super.confine(argv, policy)
  }
}

/** Mount the enterprise sandbox provider in a named DSH profile. */
export function apply(ctx: Context, config: Settings): void {
  ctx.plugin(EnterpriseSandboxProvider, Config.parse(config))
}
