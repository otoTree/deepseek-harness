/** Official DeepSeek Harness occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { OfficialBrandName } from './Brand.tsx'
import { en, NS, zh, type OfficialBrandKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Official sidebar brand copy. */
    'brand.official': OfficialBrandKey
  }
}

/** Required services: the UI slot and locale registries. */
export const inject = ['slots', 'locale']

/**
 * Fill the sidebar brand-name slot in official builds.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'official') return
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-brand-official: dictionaries')
  ctx.slots.inject('sidebar.brand.name', function* () {
    yield ctx.slots.register({ name: 'sidebar.brand.name', locale: NS }, OfficialBrandName)
  })
}
