import { IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useRef } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TopbarOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import css from './GlobalTopbar.module.css'

type Props = PropsRuntime<'topbar'> & PropsLocale<'sidebar'> & TopbarOwnerProps

export function GlobalTopbar({ productTitle, sessionTitle, sidebarOpen, workbenchOpen, toggleSidebar, toggleWorkbench, renderSession, t }: Props): React.ReactNode {
  const toggleRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (!sidebarOpen) toggleRef.current?.focus() }, [sidebarOpen])
  return <header className={css.root}>
    <button ref={toggleRef} type="button" className={css.icon} aria-label={sidebarOpen ? t('toggle.collapse') : t('toggle.open')} onClick={toggleSidebar}><IconPanelLeftOutline16 size={16} /></button>
    <strong className={css.product}>{productTitle}</strong>
    <span className={css.separator}>·</span>
    <span className={css.title}>{sessionTitle ?? t('topbar.newSession')}</span>
    <div className={css.sessionControls}>
      {renderSession()}
    </div>
    <div className={css.spacer} />
    <button type="button" className={css.workbench} aria-label={t('topbar.workbench')} aria-pressed={workbenchOpen} onClick={toggleWorkbench}>
      <IconPanelLeftOutline16 className={css.workbenchIcon} size={16} />
    </button>
  </header>
}
