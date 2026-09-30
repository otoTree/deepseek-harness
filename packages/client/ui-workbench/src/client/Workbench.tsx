import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { WorkbenchProps } from './contract/slots.ts'
import type { WorkbenchTab } from './stores.ts'
import css from './Workbench.module.css'
import { BrowserPanel } from './panels/BrowserPanel.tsx'
import { FilesPanel } from './panels/FilesPanel.tsx'
import { TerminalPanel } from './panels/TerminalPanel.tsx'
import { TAB_KEYS, type WorkbenchKey } from './locales.ts'
import { IconCodeOutline16, IconFolderOpenOutline16, IconGlobeOutline14, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

const TABS = TAB_KEYS as readonly WorkbenchTab[]

/** Details-column shell that keeps one active tab per Session. */
export function Workbench({
  useStore,
  useConnectionGeneration,
  reconnect,
  useSessions,
  actions,
  renderSlot,
  workbench,
  fileOpener,
  sessionId,
  t,
}: WorkbenchProps) {
  const generation = useConnectionGeneration(value => value?.id)
  const activeTab = useStore(s => s.activeTab)
  const terminalId = useStore(s => s.terminalId)
  const browserId = useStore(s => s.browserId)
  const browserTabId = useStore(s => s.browserTabId)
  const filePath = useStore(s => s.filePath)
  const fileSelection = useStore(s => s.fileSelection)
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const addTabRef = useRef<HTMLButtonElement>(null)
  const tabsRef = useRef<HTMLElement>(null)
  const sessionHandlers = useMemo(() => ({
    openFile: (path: string) => { actions.openFile(path, cwd) },
    setActiveTab: actions.setActiveTab,
    focus: () => { tabsRef.current?.focus() },
  }), [actions, cwd])
  useEffect(() => fileOpener.register(sessionId, sessionHandlers), [fileOpener, sessionHandlers, sessionId])
  useEffect(() => {
    if (!pickerOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setPickerOpen(false)
        addTabRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pickerOpen])
  const label = (tab: WorkbenchTab): string => TAB_KEYS.includes(tab as WorkbenchKey) ? t(tab as WorkbenchKey) : tab
  const closeTab = (tab: WorkbenchTab): void => {
    if (tab === activeTab) actions.setActiveTab('results')
  }
  const builtInPanels: readonly { tab: WorkbenchTab; key: WorkbenchKey; icon: ReactNode }[] = [
    { tab: 'results', key: 'results', icon: <IconCodeOutline16 /> },
    { tab: 'terminal', key: 'terminal', icon: <IconCodeOutline16 /> },
    { tab: 'browser', key: 'browser', icon: <IconGlobeOutline14 size={16} /> },
    { tab: 'files', key: 'files', icon: <IconFolderOpenOutline16 /> },
  ]
  let fallback = <div className={css.empty}>{t('empty')}</div>
  if (activeTab === 'terminal') {
    fallback = generation === undefined ? fallback : <TerminalPanel
      key={`${sessionId}:${generation}`}
      reconnect={reconnect}
      t={t}
      remote={workbench}
      sessionId={sessionId}
      terminalId={terminalId}
      setTerminalId={actions.setTerminalId}
    />
  } else if (activeTab === 'browser') {
    fallback = generation === undefined ? fallback : <BrowserPanel
      key={`${sessionId}:${generation}`}
      reconnect={reconnect}
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
      <nav ref={tabsRef} className={css.tabs} aria-label={t('title')} tabIndex={-1}>
        {TABS.map(tab => (
          <div key={tab} className={css.tabGroup} data-workbench-tab={tab}>
            <button
              type="button"
              className={css.tab}
              aria-current={activeTab === tab ? 'page' : undefined}
              onClick={() => { actions.setActiveTab(tab) }}
            >{label(tab)}</button>
            <button
              type="button"
              className={css.tabClose}
              aria-label={`${t('close')} ${label(tab)}`}
              onClick={() => { closeTab(tab) }}
            >×</button>
          </div>
        ))}
        {renderSlot('workbench.tabs', { activeTab, setActiveTab: actions.setActiveTab, closeTab })}
        <div ref={pickerRef} className={css.tabPicker}>
          <button
            ref={addTabRef}
            type="button"
            className={css.addTab}
            aria-label={t('addTab')}
            aria-expanded={pickerOpen}
            aria-haspopup="dialog"
            onClick={() => { setPickerOpen(value => !value) }}
          ><IconPlusOutline16 /></button>
          {pickerOpen && (
            <div className={css.panelPicker} role="dialog" aria-label={t('choosePanel')}>
              {builtInPanels.map(panel => (
                <button
                  key={panel.tab}
                  type="button"
                  className={css.panelOption}
                  onClick={() => {
                    actions.setActiveTab(panel.tab)
                    setPickerOpen(false)
                    addTabRef.current?.focus()
                  }}
                >
                  <span className={css.panelOptionIcon} aria-hidden="true">{panel.icon}</span>
                  <span>{t(panel.key)}</span>
                </button>
              ))}
              {renderSlot('workbench.tab-picker', { activeTab, setActiveTab: actions.setActiveTab, closeTab })}
            </div>
          )}
        </div>
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
