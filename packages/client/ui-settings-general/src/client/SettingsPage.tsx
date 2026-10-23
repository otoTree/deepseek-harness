/** Settings page in the application main column. */
import { useEffect, useId, useRef } from 'react'
import clsx from 'clsx'
import { IconAgentPresetOutline16, IconDataOutline16, IconPersonalizationOutline16, IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsPageProps, SettingsSectionRow } from './shell-contract.ts'
import css from './SettingsRoot.module.css'

/** Nav glyph by section id; unknown ids fall back to the settings gear. */
function navIcon(id: string) {
  if (id === 'models') return <IconDataOutline16 className={css.navIcon} size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutline16 className={css.navIcon} size={16} />
  if (id === 'plugins') return <IconPersonalizationOutline16 className={css.navIcon} size={16} />
  return <IconSettingsOutline16 className={css.navIcon} size={16} />
}

type PanelProps = {
  rows: readonly SettingsSectionRow[]
  renderSlot: SettingsPageProps['renderSlot']
  activeId: string | undefined
  onSelect: (id: string) => void
  onClose: () => void
  t: SettingsPageProps['t']
}

/**
 * Settings section navigation and content in the application main column.
 */
function SettingsPanel({ rows, renderSlot, activeId, onSelect, onClose, t }: PanelProps) {
  // Entries can unmount underneath the requested id, so the render-time
  // projection falls back to the first row when the id is gone.
  const active = rows.find(r => r.id === activeId)?.id ?? rows[0]?.id
  const titleId = useId()
  const groups = [
    { key: 'preferences', label: t('group.preferences'), rows: rows.filter(row => row.id !== 'plugins' && (!row.id.startsWith('enterprise') || row.id === 'enterprise-models')) },
    { key: 'organization', label: t('group.organization'), rows: rows.filter(row => row.id.startsWith('enterprise') && row.id !== 'enterprise-models') },
    { key: 'extensions', label: t('group.extensions'), rows: rows.filter(row => row.id === 'plugins') },
  ].filter(group => group.rows.length > 0)

  const content = useRef<HTMLDivElement>(null)
  useEffect(() => { content.current?.focus() }, [])

  return (
    <section className={css.page} role="region" aria-labelledby={titleId}>
      <div className={css.panel}>
        <nav className={css.nav} aria-labelledby={titleId}>
          <div className={css.navTitle} id={titleId}>{renderSlot('settings.header', {})}</div>
          <div className={css.navList}>
            {groups.map(group => <div key={group.key} className={css.navGroup} role="group" aria-labelledby={`${titleId}-${group.key}`}>
              <div className={css.groupLabel} id={`${titleId}-${group.key}`}>{group.label}</div>
              {group.rows.map(row => (
                <button
                  key={row.id}
                  type="button"
                  className={clsx(css.navCell, row.id === active && css.active)}
                  aria-current={row.id === active ? 'page' : undefined}
                  onClick={() => { onSelect(row.id) }}
                >
                  {row.icon ? row.icon({ size: 16, className: css.navIcon }) : navIcon(row.id)}
                  <span className={css.navLabel}>{row.label}</span>
                </button>
              ))}
            </div>)}
          </div>
        </nav>
        <div className={css.content}>
          <div className={css.header}>
            <div className={css.actions}>{renderSlot('settings.action', {})}</div>
          </div>
          <div ref={content} tabIndex={-1} className={css.options}>
            {active !== undefined && renderSlot('settings.section', { close: onClose }, { only: active })}
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Render the selected settings section while retaining navigation across visits.
 * @param props - Page slots, section ledger, navigation store, and exit action.
 * @returns The Settings page.
 */
export function SettingsPage({ useSections, useStore, actions, renderSlot, exitSettings, t }: SettingsPageProps) {
  return <SettingsPanel
    rows={useSections(rows => rows)}
    renderSlot={renderSlot}
    activeId={useStore(state => state.activeId)}
    onSelect={actions.select}
    onClose={exitSettings}
    t={t}
  />
}
