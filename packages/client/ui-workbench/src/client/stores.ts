import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { BrowserSessionId, BrowserTabId, TerminalSessionId } from '@deepseek-ai/dsh-api-workbench-controller/types'

/** Workbench tabs available for one Session. */
export type WorkbenchTab = 'start' | 'results' | 'terminal' | 'browser' | 'files' | (string & {})
export interface WorkbenchTabInstance { readonly id: string; readonly kind: 'builtin' | 'plugin'; readonly key: WorkbenchTab; readonly label?: string; readonly closable: boolean; readonly order?: number }

/** Session-scoped Workbench state. */
export interface WorkbenchState {
  activeTab: WorkbenchTab
  tabs: readonly WorkbenchTabInstance[]
  registeredTabs: readonly WorkbenchTabInstance[]
  terminalId: TerminalSessionId | undefined
  browserId: BrowserSessionId | undefined
  browserTabId: BrowserTabId | undefined
  filePath: string
  fileSelection: string | undefined
}

/**
 * Create the minimal session-scoped state used by the tab shell.
 * @returns a store handle instantiated once per Session-keyed slot entry.
 */
export function createWorkbenchStore(): EngineStoreHandle<WorkbenchState, {
  setActiveTab: (draft: WorkbenchState, tab: WorkbenchTab) => void
  addTab: (draft: WorkbenchState, tab: WorkbenchTabInstance) => void
  closeTab: (draft: WorkbenchState, tabId: string) => void
  unregisterTab: (draft: WorkbenchState, tabId: string) => void
  replaceTabs: (draft: WorkbenchState, tabs: readonly WorkbenchTabInstance[]) => void
  resetTabs: (draft: WorkbenchState) => void
  setTerminalId: (draft: WorkbenchState, terminalId: TerminalSessionId | undefined) => void
  setBrowser: (draft: WorkbenchState, browserId: BrowserSessionId, tabId: BrowserTabId | undefined) => void
  setBrowserTabId: (draft: WorkbenchState, tabId: BrowserTabId | undefined) => void
  setFilePath: (draft: WorkbenchState, path: string) => void
  setFileSelection: (draft: WorkbenchState, path: string | undefined) => void
  openFile: (draft: WorkbenchState, path: string, cwd: string | undefined) => void
}> {
  return defineStore({
    init: (): WorkbenchState => {
      const registeredTabs = builtinTabs()
      return { activeTab: 'start', tabs: [registeredTabs[0]!], registeredTabs, terminalId: undefined, browserId: undefined, browserTabId: undefined, filePath: '.', fileSelection: undefined }
    },
    actions: {
      setActiveTab: (draft, tab) => { draft.activeTab = tab },
      addTab: (draft, tab) => {
        const registered = draft.registeredTabs.find(item => item.id === tab.id || item.key === tab.key)
        if (registered !== undefined && (registered.id !== tab.id || registered.key !== tab.key)) {
          throw new Error(`Workbench tab definition already registered: ${tab.key}`)
        }
        if (registered === undefined) draft.registeredTabs = [...draft.registeredTabs, tab].sort(tabOrder)
        const existing = draft.tabs.find(item => item.id === tab.id || item.key === tab.key)
        if (existing !== undefined) {
          if (existing.id !== tab.id || existing.key !== tab.key) throw new Error(`Workbench tab key already registered: ${tab.key}`)
          draft.activeTab = existing.key
          return
        }
        draft.tabs = [...draft.tabs, tab].sort(tabOrder)
        draft.activeTab = tab.key
      },
      closeTab: (draft, tabId) => {
        const index = draft.tabs.findIndex(tab => tab.id === tabId)
        if (index < 0 || !draft.tabs[index]!.closable) return
        const closing = draft.tabs[index]!
        const wasActive = closing.key === draft.activeTab
        draft.tabs = draft.tabs.filter((_, itemIndex) => itemIndex !== index)
        if (closing.key === 'results') {
          draft.activeTab = 'start'
        } else if (wasActive) {
          const next = draft.tabs[Math.min(index, draft.tabs.length - 1)]
          draft.activeTab = next?.key ?? 'start'
        }
      },
      unregisterTab: (draft, tabId) => {
        const definition = draft.registeredTabs.find(tab => tab.id === tabId)
        if (definition === undefined || definition.kind === 'builtin') return
        draft.registeredTabs = draft.registeredTabs.filter(tab => tab.id !== tabId)
        const index = draft.tabs.findIndex(tab => tab.id === tabId)
        if (index < 0) return
        const wasActive = draft.tabs[index]!.key === draft.activeTab
        draft.tabs = draft.tabs.filter(tab => tab.id !== tabId)
        if (wasActive) draft.activeTab = draft.tabs[index]?.key ?? 'start'
      },
      replaceTabs: (draft, tabs) => { draft.tabs = [...tabs]; if (!draft.tabs.some(tab => tab.key === draft.activeTab)) draft.activeTab = 'start' },
      resetTabs: (draft) => { const registeredTabs = builtinTabs(); draft.registeredTabs = registeredTabs; draft.tabs = [registeredTabs[0]!]; draft.activeTab = 'start' },
      setTerminalId: (draft, terminalId) => { draft.terminalId = terminalId },
      setBrowser: (draft, browserId, tabId) => { draft.browserId = browserId; draft.browserTabId = tabId },
      setBrowserTabId: (draft, tabId) => { draft.browserTabId = tabId },
      setFilePath: (draft, path) => { draft.filePath = path },
      setFileSelection: (draft, path) => { draft.fileSelection = path },
      openFile: (draft, path, cwd) => {
        const target = workspaceRelativePath(cwd, path)
        const separator = target.lastIndexOf('/')
        draft.activeTab = 'files'
        draft.filePath = separator < 0 ? '.' : target.slice(0, separator) || '.'
        draft.fileSelection = target
      },
    },
  })
}

function builtinTabs(): WorkbenchTabInstance[] {
  return [
    { id: 'start', kind: 'builtin', key: 'start', closable: false, order: 0 },
    { id: 'results', kind: 'builtin', key: 'results', closable: true, order: 10 },
    { id: 'terminal', kind: 'builtin', key: 'terminal', closable: true, order: 20 },
    { id: 'browser', kind: 'builtin', key: 'browser', closable: true, order: 30 },
    { id: 'files', kind: 'builtin', key: 'files', closable: true, order: 40 },
  ]
}

function tabOrder(left: WorkbenchTabInstance, right: WorkbenchTabInstance): number {
  return (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
}

/** Actions bound by the slot framework for a Workbench store. */
export type WorkbenchActions = BoundActions<typeof createWorkbenchStore>

function workspaceRelativePath(cwd: string | undefined, path: string): string {
  const target = path.replaceAll('\\', '/')
  if (cwd === undefined || cwd === '') return target
  const root = cwd.replaceAll('\\', '/').replace(/\/+$/, '')
  const windowsPath = /^[A-Za-z]:\//.test(root) || root.startsWith('//')
  const comparableRoot = windowsPath ? root.toLowerCase() : root
  const comparableTarget = windowsPath ? target.toLowerCase() : target
  if (comparableTarget.startsWith(`${comparableRoot}/`)) return target.slice(root.length + 1)
  return target
}
