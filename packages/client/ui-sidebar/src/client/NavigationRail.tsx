import { IconNewChatOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MainNavigation, MainSurface } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsLocale, PropsRenderSlots, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarRailItemOwnerProps } from './contract/slots.ts'
import css from './NavigationRail.module.css'

type Props = PropsRuntime<'rail'> & PropsRenderSlots<'sidebar.rail.item' | 'sidebar.settings'> & PropsLocale<'sidebar'> & InjectFace<{ navigation: MainNavigation }>

const surfaces: readonly [MainSurface, 'nav.sessions'][] = [['conversation', 'nav.sessions']]

export function NavigationRail({ active, navigate, renderSlot, t }: Props): React.ReactNode {
  return <nav className={css.root} aria-label={t('nav.sessions')}>
    {surfaces.map(([surface, label]) => <Tooltip key={surface} label={t(label)} delayMs={500}><button type="button" className={css.item} data-active={active === surface || undefined} aria-label={t(label)} aria-current={active === surface ? 'page' : undefined} onClick={() => { navigate(surface) }}>
      <IconNewChatOutline16 size={18} />
    </button></Tooltip>)}
    {renderSlot('sidebar.rail.item', { active: false, navigate: () => {} } satisfies SidebarRailItemOwnerProps)}
    <div className={css.spacer} />
    {renderSlot('sidebar.settings', { wide: false })}
  </nav>
}
