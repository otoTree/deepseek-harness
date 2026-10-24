/** Arivo presentation for the original topbar slot; Session controls remain owned by the OS. */
import { createElement, useEffect, useRef } from 'react'
import type { TopbarOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

declare const ARIVO_BRAND_LOGO: string

/** Product-owned labels for the existing OS header actions. */
export type TopbarKey = 'openSidebar' | 'closeSidebar' | 'openWorkbench' | 'newConversation' | 'localWorkspace'
type Props = PropsRuntime<'topbar'> & TopbarOwnerProps & PropsLocale<'arivo.shell'>

/** Render the Arivo brand beside existing conversation navigation and scoped Session actions.
 * @param props - Original OS topbar runtime and localized Arivo labels.
 * @returns Header content for the startup-owned slot.
 */
export function ArivoTopbar({ productTitle, sessionTitle, conversationActive, sidebarOpen, workbenchOpen,
  toggleSidebar, toggleWorkbench, renderSession, t }: Props) {
  const toggle = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (!sidebarOpen) toggle.current?.focus() }, [sidebarOpen])
  const glyph = (flipped = false) => createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.5, 'aria-hidden': true, style: flipped ? { transform: 'scaleX(-1)' } : undefined },
  createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }), createElement('path', { d: 'M9 4v16' }))
  return createElement('header', { className: 'arivo-topbar' },
    conversationActive ? createElement('button', { type: 'button', ref: toggle, className: 'arivo-topbar-icon',
      'aria-label': t(sidebarOpen ? 'closeSidebar' : 'openSidebar'), onClick: toggleSidebar }, glyph()) : null,
    createElement('img', { src: ARIVO_BRAND_LOGO, alt: productTitle, className: 'arivo-topbar-logo' }),
    conversationActive ? createElement('span', { className: 'arivo-topbar-title' }, sessionTitle ?? t('newConversation')) : null,
    conversationActive ? createElement('div', { className: 'arivo-topbar-session' }, renderSession()) : null,
    createElement('span', { className: 'arivo-topbar-local' }, t('localWorkspace')),
    conversationActive ? createElement('button', { type: 'button', className: 'arivo-topbar-icon',
      'aria-label': t('openWorkbench'), 'aria-pressed': workbenchOpen, onClick: toggleWorkbench }, glyph(true)) : null)
}
