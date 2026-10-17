import type { Context } from '@deepseek-ai/cordis'

interface ClientSlots {
  inject(name: string, callback: () => () => void): void
  register(options: Record<string, unknown>, component: () => string): () => void
}

interface ClientContext extends Context {
  slots: ClientSlots
}

export const name = 'acme-enterprise-report-client'
export const inject = ['slots']

/** Add one settings page while the settings owner is mounted. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'acme-report-settings',
    order: 80,
    label: 'Acme report',
  }, () => 'Acme report plugin is installed and active.'))
}
