import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { WorkbenchProps } from './contract/slots.ts'
import type { WorkbenchTab } from './stores.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchRemote } from '@deepseek-ai/dsh-api-workbench-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

type WorkbenchRuntimeRemote = {
  ensureWorkbenchRuntime: (request: { sessionId?: SessionId; cwd?: string }) => Promise<RemoteResult<{
    workbenchSessionId: SessionId
    cwd: string
    capabilities: { terminal: boolean; filesystem: boolean; sandbox: boolean; browser: boolean }
  }>>
  releaseWorkbenchRuntime: (request: { sessionId?: SessionId; cwd?: string }) => Promise<RemoteResult<{ released: true }>>
}
import css from './Workbench.module.css'
import { BrowserPanel } from './panels/BrowserPanel.tsx'
import { FilesPanel } from './panels/FilesPanel.tsx'
import { TerminalPanel } from './panels/TerminalPanel.tsx'
import { TAB_KEYS, type WorkbenchKey } from './locales.ts'
import { IconCodeOutline16, IconCordisPluginOutline14, IconFolderOpenOutline16, IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'

/** Details-column shell that keeps one active tab per Session. */
export function Workbench({
  useStore,
  useConnectionGeneration,
  reconnect,
  useSessions,
  actions,
  renderSlot,
  workbench,
  runtime,
  fileOpener,
  sessionId,
  open,
  t,
}: WorkbenchProps) {
  const generation = useConnectionGeneration(value => value?.id)
  const activeTab = useStore(s => s.activeTab)
  const tabs = useStore(s => s.tabs)
  const registeredTabs = useStore(s => s.registeredTabs)
  const terminalId = useStore(s => s.terminalId)
  const browserId = useStore(s => s.browserId)
  const browserTabId = useStore(s => s.browserTabId)
  const filePath = useStore(s => s.filePath)
  const fileSelection = useStore(s => s.fileSelection)
  const [runtimeSessionId, setRuntimeSessionId] = useState<SessionId | undefined>()
  const cwd = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.cwd)
  const runtimeRemote = runtime as (WorkbenchRemote & WorkbenchRuntimeRemote) | undefined
  const runtimeLifecycle = runtimeRemote?.ensureWorkbenchRuntime !== undefined
    && runtimeRemote.releaseWorkbenchRuntime !== undefined
  const runtimePending = runtimeLifecycle && open === true && generation !== undefined && runtimeSessionId === undefined
  const effectiveSessionId = runtimePending ? undefined : runtimeSessionId ?? sessionId
  const tabsRef = useRef<HTMLElement>(null)
  const sessionHandlers = useMemo(() => ({
    openFile: (path: string) => { actions.openFile(path, cwd) },
    setActiveTab: actions.setActiveTab,
    focus: () => { tabsRef.current?.focus() },
  }), [actions, cwd])
  useEffect(() => {
    if (sessionId === undefined) return
    return fileOpener.register(sessionId, sessionHandlers)
  }, [fileOpener, sessionHandlers, sessionId])
  useEffect(() => { setRuntimeSessionId(undefined) }, [generation, sessionId])
  useEffect(() => {
    // The workspace package may still expose a pre-generated Client catalog
    // during source-plane tests; keep the runtime methods explicit here until
    // the package artifact is regenerated.
    if (!runtimeLifecycle || runtimeRemote === undefined || open !== true || generation === undefined) return
    let cancelled = false
    void runtimeRemote.ensureWorkbenchRuntime({ ...(sessionId === undefined ? {} : { sessionId }), ...(cwd === undefined ? {} : { cwd }) }).then(result => {
      if (!cancelled && result.ok) setRuntimeSessionId(result.value.workbenchSessionId)
    })
    return () => {
      cancelled = true
      void runtimeRemote.releaseWorkbenchRuntime({ ...(sessionId === undefined ? {} : { sessionId }), ...(cwd === undefined ? {} : { cwd }) })
    }
  }, [cwd, generation, open, runtime, sessionId])
  const label = (tab: WorkbenchTab): string => TAB_KEYS.includes(tab as WorkbenchKey) ? t(tab as WorkbenchKey) : tab
  const closeTab = (tab: WorkbenchTab): void => {
    const instance = tabs.find(item => item.key === tab)
    if (instance !== undefined) actions.closeTab(instance.id)
  }
  const selectTab = (tab: WorkbenchTab): void => {
    if (!tabs.some(item => item.key === tab)) {
      const definition = registeredTabs.find(item => item.key === tab)
      if (definition === undefined) throw new Error(`Workbench tab has no registered definition: ${tab}`)
      actions.addTab(definition)
    } else actions.setActiveTab(tab)
  }
  const registerTab = useCallback((tab: { id: string; key: string; label: string; closable: boolean; order?: number }): (() => void) => {
    actions.addTab({ ...tab, key: tab.key as WorkbenchTab, kind: 'plugin' })
    return () => { actions.unregisterTab(tab.id) }
  }, [actions])
  const builtInPanels: readonly { tab: WorkbenchTab; key: WorkbenchKey; icon: ReactNode }[] = [
    { tab: 'results', key: 'results', icon: <IconCodeOutline16 /> },
    { tab: 'terminal', key: 'terminal', icon: <IconCodeOutline16 /> },
    { tab: 'browser', key: 'browser', icon: <IconGlobeOutline14 size={16} /> },
    { tab: 'files', key: 'files', icon: <IconFolderOpenOutline16 /> },
  ]
  let fallback = <div className={css.empty}>{t('empty')}</div>
  if (activeTab === 'start') {
    fallback = (
      <div className={css.start} data-workbench-start>
        <header className={css.startHeader}>
          <h2>{t('start')}</h2>
          <p>{t('openPanel')}</p>
        </header>
        <div className={css.startGrid}>
          {builtInPanels.map(panel => (
            <button key={panel.tab} type="button" className={css.startCard} onClick={() => { selectTab(panel.tab) }}>
              <span className={css.panelOptionIcon} aria-hidden="true">{panel.icon}</span>
              <span>{t(panel.key)}</span>
            </button>
          ))}
          {registeredTabs.filter(tab => tab.kind === 'plugin').map(tab => (
            <button key={tab.id} type="button" className={css.startCard} onClick={() => { selectTab(tab.key) }}>
              <span className={css.panelOptionIcon} aria-hidden="true"><IconCordisPluginOutline14 size={16} /></span>
              <span>{tab.label ?? tab.key}</span>
            </button>
          ))}
        </div>
      </div>
    )
  } else if (activeTab === 'terminal') {
    fallback = generation === undefined || effectiveSessionId === undefined ? fallback : <TerminalPanel
      key={`${sessionId}:${generation}`}
      reconnect={reconnect}
      t={t}
      remote={workbench}
      sessionId={effectiveSessionId!}
      terminalId={terminalId}
      setTerminalId={actions.setTerminalId}
    />
  } else if (activeTab === 'browser') {
    fallback = generation === undefined || effectiveSessionId === undefined ? fallback : <BrowserPanel
      key={`${sessionId}:${generation}`}
      reconnect={reconnect}
      t={t}
      remote={workbench}
      sessionId={effectiveSessionId!}
      browserId={browserId}
      activeTabId={browserTabId}
      setBrowser={actions.setBrowser}
      setActiveTabId={actions.setBrowserTabId}
    />
  } else if (activeTab === 'files' && effectiveSessionId !== undefined) {
    fallback = <FilesPanel
      t={t}
      remote={workbench}
      sessionId={effectiveSessionId!}
      path={filePath}
      selectedPath={fileSelection}
      setPath={actions.setFilePath}
      setSelectedPath={actions.setFileSelection}
    />
  }
  return (
    <section className={css.root} data-workbench data-active-tab={activeTab}>
      <div className={css.tabBar}>
        <nav ref={tabsRef} className={css.tabs} aria-label={t('title')} tabIndex={-1}>
          {tabs.map(instance => {
            const tab = instance.key
            return (
            <div key={tab} className={css.tabGroup} data-workbench-tab={tab}>
            <button
              type="button"
              className={css.tab}
              aria-current={activeTab === tab ? 'page' : undefined}
              onClick={() => { selectTab(tab) }}
            >{instance.label ?? label(tab)}</button>
              {instance.closable && <button
                type="button"
                className={css.tabClose}
                aria-label={`${t('close')} ${label(tab)}`}
                onClick={() => { closeTab(tab) }}
              >×</button>}
            </div>
            )
          })}
          {renderSlot('workbench.tabs', { activeTab, setActiveTab: selectTab, closeTab, registerTab })}
        </nav>
      </div>
      <div className={css.body}>
        {renderSlot('workbench.panel', { tab: activeTab, openFile: (path) => { actions.openFile(path, cwd) } }, {
          entryKey: activeTab,
          fallback,
        })}
      </div>
    </section>
  )
}
