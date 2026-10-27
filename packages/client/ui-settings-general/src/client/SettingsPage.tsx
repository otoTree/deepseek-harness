/** Settings page in the application main column. */
import { useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconAgentPresetOutline16, IconChevronRightOutline14, IconDataOutline16, IconPersonalizationOutline16, IconSearchOutline16, IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
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
  const [query, setQuery] = useState('')
  const matchingRows = rows.filter(row => row.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const groups = [
    { key: 'preferences', label: t('group.preferences'), rows: matchingRows.filter(row => row.id !== 'plugins' && (!row.id.startsWith('enterprise') || row.id === 'enterprise-models')) },
    { key: 'organization', label: t('group.organization'), rows: matchingRows.filter(row => row.id.startsWith('enterprise') && row.id !== 'enterprise-models') },
    { key: 'extensions', label: t('group.extensions'), rows: matchingRows.filter(row => row.id === 'plugins') },
  ].filter(group => group.rows.length > 0)

  const content = useRef<HTMLDivElement>(null)
  useEffect(() => { content.current?.focus() }, [])

  return (
    <section data-settings-page="" className={css.page} role="region" aria-labelledby={titleId}>
      <div className={css.panel}>
        <nav data-settings-nav="" className={css.nav} aria-labelledby={titleId}>
          <div className={css.navTitle} id={titleId}>{renderSlot('settings.header', {})}</div>
          <label className={css.search}>
            <IconSearchOutline16 size={14} />
            <input type="search" aria-label={t('search')} placeholder={t('search')} value={query}
              onChange={(event) => { setQuery(event.currentTarget.value) }} />
          </label>
          <div className={css.navList}>
            {groups.length === 0 && <p className={css.emptySearch} role="status">{t('search.empty')}</p>}
            {groups.map(group => <div key={group.key} className={css.navGroup} role="group" aria-labelledby={`${titleId}-${group.key}`}>
              <div className={css.groupLabel} id={`${titleId}-${group.key}`}>{group.label}</div>
              {group.rows.map(row => (
                <button
                  key={row.id}
                  type="button"
                  data-settings-section={row.id}
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
          <div data-settings-header="" className={css.header}>
            <div className={css.breadcrumb} aria-hidden="true">
              <span>{t('title')}</span><IconChevronRightOutline14 size={12} />
              <span>{rows.find(row => row.id === active)?.label}</span>
            </div>
            <div className={css.actions}>{renderSlot('settings.action', {})}</div>
          </div>
          <div data-settings-options={active} ref={content} tabIndex={-1} className={css.options}>
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
