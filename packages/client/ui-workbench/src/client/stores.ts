import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { BrowserSessionId, BrowserTabId, TerminalSessionId } from '@deepseek-ai/dsh-api-workbench-controller/types'

/** Workbench tabs available for one Session. */
export type WorkbenchTab = 'results' | 'terminal' | 'browser' | 'files' | (string & {})

/** Session-scoped Workbench state. */
export interface WorkbenchState {
  activeTab: WorkbenchTab
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
  setTerminalId: (draft: WorkbenchState, terminalId: TerminalSessionId | undefined) => void
  setBrowser: (draft: WorkbenchState, browserId: BrowserSessionId, tabId: BrowserTabId | undefined) => void
  setBrowserTabId: (draft: WorkbenchState, tabId: BrowserTabId | undefined) => void
  setFilePath: (draft: WorkbenchState, path: string) => void
  setFileSelection: (draft: WorkbenchState, path: string | undefined) => void
  openFile: (draft: WorkbenchState, path: string, cwd: string | undefined) => void
}> {
  return defineStore({
    init: (): WorkbenchState => ({ activeTab: 'results', terminalId: undefined, browserId: undefined, browserTabId: undefined, filePath: '.', fileSelection: undefined }),
    actions: {
      setActiveTab: (draft, tab) => { draft.activeTab = tab },
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
