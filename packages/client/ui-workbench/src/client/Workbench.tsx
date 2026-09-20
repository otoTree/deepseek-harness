import { useEffect } from 'react'
import type { WorkbenchProps } from './contract/slots.ts'
import type { WorkbenchTab } from './stores.ts'
import css from './Workbench.module.css'
import { BrowserPanel } from './panels/BrowserPanel.tsx'
import { FilesPanel } from './panels/FilesPanel.tsx'
import { TerminalPanel } from './panels/TerminalPanel.tsx'
import { TAB_KEYS } from './locales.ts'

const TABS = TAB_KEYS as readonly WorkbenchTab[]

/** Details-column shell that keeps one active tab per Session. */
export function Workbench({
  useStore,
  useSessions,
  actions,
  renderSlot,
  closeDetails,
  workbench,
  fileOpener,
  sessionId,
  t,
}: WorkbenchProps) {
  const activeTab = useStore(s => s.activeTab)
  const terminalId = useStore(s => s.terminalId)
  const browserId = useStore(s => s.browserId)
  const browserTabId = useStore(s => s.browserTabId)
  const filePath = useStore(s => s.filePath)
  const fileSelection = useStore(s => s.fileSelection)
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  useEffect(() => fileOpener.register(sessionId, (path) => { actions.openFile(path, cwd) }), [actions, cwd, fileOpener, sessionId])
  const label = (tab: WorkbenchTab): string => t(tab)
  let fallback = <div className={css.empty}>{t('empty')}</div>
  if (activeTab === 'terminal') {
    fallback = <TerminalPanel
      t={t}
      remote={workbench}
      sessionId={sessionId}
      terminalId={terminalId}
      setTerminalId={actions.setTerminalId}
    />
  } else if (activeTab === 'browser') {
    fallback = <BrowserPanel
      t={t}
      remote={workbench}
      sessionId={sessionId}
      browserId={browserId}
      activeTabId={browserTabId}
      setBrowser={actions.setBrowser}
      setActiveTabId={actions.setBrowserTabId}
    />
  } else if (activeTab === 'files') {
    fallback = <FilesPanel
      t={t}
      remote={workbench}
      sessionId={sessionId}
      path={filePath}
      selectedPath={fileSelection}
      setPath={actions.setFilePath}
      setSelectedPath={actions.setFileSelection}
    />
  }
  return (
    <section className={css.root} data-workbench data-active-tab={activeTab}>
      <header className={css.header}>
        <div className={css.title}>{t('title')}</div>
        <button type="button" className={css.close} aria-label={t('close')} onClick={closeDetails}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </header>
      <nav className={css.tabs} aria-label={t('title')}>
        {TABS.map(tab => (
          <button
            key={tab}
            type="button"
            className={css.tab}
            aria-current={activeTab === tab ? 'page' : undefined}
            data-workbench-tab={tab}
            onClick={() => { actions.setActiveTab(tab) }}
          >
            {label(tab)}
          </button>
        ))}
      </nav>
      <div className={css.body}>
        {renderSlot('workbench.panel', { tab: activeTab, openFile: (path) => { actions.openFile(path, cwd) } }, {
          entryKey: activeTab,
          fallback,
        })}
      </div>
    </section>
  )
}
