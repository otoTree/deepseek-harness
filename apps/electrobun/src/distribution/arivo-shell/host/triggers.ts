/** Arivo account-local composition of the original managed trigger runtime. */
import type { Context } from '@deepseek-ai/cordis'
import { TriggerService, triggerConfigSchema, TriggerRuleId, TriggerBatchId, matchesGlob } from '@deepseek-ai/dsh-trigger'
import type { TriggerRuleInput } from '@deepseek-ai/dsh-trigger'
import { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'

/** Mount local sources and authenticated rule controls in the current account's DSH home.
 * @param ctx - Startup Host with the native account and project services.
 * @param statePath - Native-supervisor-selected, account-isolated rule store.
 */
export function registerArivoTriggers(ctx: Context, statePath: string): void {
  ctx.plugin(TriggerService, triggerConfigSchema.parse({ statePath }))
  ctx.effect(() => ctx.connection.rpc.handle('/arivo-triggers', async (endpoint, payload, signal) => {
    let account: Awaited<ReturnType<typeof ctx.arivoStudio.marketSession>> | undefined
    try {
      const { args } = z.strictObject({ args: z.unknown() }).parse(payload)
      account = await ctx.arivoStudio.marketSession()
      if (account.protocolVersion !== 1) throw new Error('TRIGGER_ACCOUNT_UNAVAILABLE')
      const active = AbortSignal.any([signal, account.signal])
      active.throwIfAborted()
      const runtime = ctx.get('triggers')
      if (!runtime) throw new Error('TRIGGER_RUNTIME_UNAVAILABLE')
      let value: unknown
      switch (endpoint) {
        case 'trigger-snapshot': value = await runtime.snapshot(); break
        case 'trigger-save': {
          // The shared editor schema is validated by the original runtime before persistence.
          const input = z.strictObject({ id: z.string().optional(), name: z.string(), enabled: z.boolean(),
            source: z.object({ kind: z.enum(['timer', 'local-file']) }).loose(),
            delivery: z.unknown(), target: z.discriminatedUnion('kind', [
              z.strictObject({ kind: z.literal('existing-session'), sessionId: z.string().min(1) }),
              z.strictObject({ kind: z.literal('new-session'), workspacePath: z.string().min(1), agentPreset: z.string(), permissionPreset: z.string(),
                titleTemplate: z.string(), model: z.unknown().optional() }),
            ]), instructionTemplate: z.unknown(),
          }).parse(args)
          const path = input.target.kind === 'existing-session'
            ? ctx.sessions.get(SessionId(input.target.sessionId))?.header.cwd : input.target.workspacePath
          if (!path) throw new Error('PROJECT_FOLDER_REQUIRED')
          const folder = await ctx.arivoStudio.projectFolderSession()
          try {
            const project = await folder.resolve(path)
            if (!project || !folder.conversationModel) throw new Error('PROJECT_MODEL_REQUIRED')
            const model = await folder.conversationModel(project.projectId, active)
            if (!model) throw new Error('PROJECT_MODEL_REQUIRED')
            active.throwIfAborted()
            value = await runtime.saveRule({ ...input, createdBy: account.scopeId,
              target: input.target.kind === 'new-session' ? { ...input.target, model } : input.target,
            } as unknown as TriggerRuleInput)
          } finally { folder.dispose() }
          break
        }
        case 'trigger-enable': {
          const input = z.strictObject({ ruleId: z.string().min(1), enabled: z.boolean() }).parse(args)
          value = await runtime.setEnabled(TriggerRuleId(input.ruleId), input.enabled); break
        }
        case 'trigger-remove': {
          const input = z.strictObject({ ruleId: z.string().min(1) }).parse(args)
          await runtime.removeRule(TriggerRuleId(input.ruleId)); value = null; break
        }
        case 'trigger-retry': {
          const input = z.strictObject({ batchId: z.string().min(1) }).parse(args)
          await runtime.retryBatch(TriggerBatchId(input.batchId)); value = null; break
        }
        case 'trigger-test-match': {
          const input = z.strictObject({ path: z.string().min(1).max(32768), includes: z.array(z.string().min(1).max(500)).max(100),
            excludes: z.array(z.string().min(1).max(500)).max(100) }).parse(args)
          value = { matched: input.includes.some(pattern => matchesGlob(input.path, pattern))
            && !input.excludes.some(pattern => matchesGlob(input.path, pattern)) }; break
        }
        default: throw new Error('TRIGGER_OPERATION_UNAVAILABLE')
      }
      active.throwIfAborted()
      return { ok: true as const, value }
    } catch {
      return { ok: false as const, error: { code: 'arivo/triggers-unavailable', message: 'Connect your Arivo account and check the project model and trigger settings.', details: {} } }
    } finally { account?.dispose() }
  }), 'arivo-shell: account trigger controls')
}
