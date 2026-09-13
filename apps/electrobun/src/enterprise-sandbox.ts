/** Enterprise desktop sandbox provider: the DSH local backend with explicit fail-closed policy defaults. */
import { z } from 'zod'
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
   * @returns Seatbelt-wrapped argv or the provider's fail-closed unavailable error.
   */
  override confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    if (!policy.workspaceRoot.startsWith('/')) throw new Error('Enterprise sandbox requires an absolute workspace root')
    return super.confine(argv, policy)
  }
}

/** Mount the enterprise sandbox provider in a named DSH profile. */
export function apply(ctx: Context, config: Settings): void {
  ctx.plugin(EnterpriseSandboxProvider, Config.parse(config))
}
