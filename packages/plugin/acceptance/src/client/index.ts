import type { Context } from '@deepseek-ai/cordis'
import type { PluginSdk } from '@deepseek-ai/dsh-plugin-sdk'

interface AcceptanceClientContext extends Context {
  pluginSdk: PluginSdk
  slots: {
    inject(name: 'settings.section', register: () => () => void): void
    register(options: Record<string, unknown>, component: () => string): () => void
  }
}

/** Cordis function-plugin name used by the Client target. */
export const name = 'enterprise-plugin-acceptance-client'
/** Browser services injected by the enterprise target runtime. */
export const inject = ['pluginSdk', 'slots']

/**
 * Build the serializable view consumed by a Client page.
 * @param sdk - Installation-scoped plugin SDK.
 * @param signal - Optional cancellation signal for capability calls.
 * @returns The user, model, and activation fields shown by the page.
 */
export async function createAcceptancePanel(sdk: PluginSdk, signal?: AbortSignal): Promise<{
  userName: string
  ownerKind: string
  modelCount: number
  activation: 'active'
}> {
  const [identity, models] = await Promise.all([sdk.identity.current(signal), sdk.models.list(signal)])
  return { userName: identity.name, ownerKind: identity.owner.kind, modelCount: models.length, activation: 'active' }
}

/** Register a visible settings panel whose lifetime follows the Client target fiber. */
export function apply(ctx: AcceptanceClientContext): void {
  let status = 'Enterprise SDK acceptance: loading'
  void createAcceptancePanel(ctx.pluginSdk).then(
    (panel) => { status = `Enterprise SDK acceptance: ${panel.userName} · ${panel.ownerKind} · ${String(panel.modelCount)} models` },
    () => { status = 'Enterprise SDK acceptance: failed' },
  )
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'enterprise-plugin-acceptance', order: 30,
    label: 'Enterprise SDK acceptance',
  }, () => status))
}
