import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchTab } from './stores.ts'

/** Callbacks owned by one mounted Session Workbench store. */
export interface WorkbenchSessionHandlers {
  openFile(path: string): void
  setActiveTab(tab: WorkbenchTab): void
  focus?(): void
}

/** Cross-surface file opener used by Chat and the Workbench Results panel. */
export interface WorkbenchFileOpener {
  /** Request a file to open in the Session's Workbench Files panel. */
  openFile(sessionId: SessionId, path: string): Promise<void>
  /** Select a Session Workbench tab and open the details column. */
  openTab(sessionId: SessionId, tab: WorkbenchTab): void
  /** Attach the mounted Session Workbench store and return its disposer. */
  register(sessionId: SessionId, handlers: WorkbenchSessionHandlers | ((path: string) => void)): () => void
}

/** Create the root-scoped bridge between Chat actions and Session Workbench stores. */
export function createWorkbenchFileOpener(openDetails: () => void): WorkbenchFileOpener {
  const handlers = new Map<SessionId, (path: string) => void>()
  const tabHandlers = new Map<SessionId, Pick<WorkbenchSessionHandlers, 'setActiveTab' | 'focus'>>()
  const pending = new Map<SessionId, string>()
  const pendingTabs = new Map<SessionId, WorkbenchTab>()
  return {
    openFile: async (sessionId, path) => {
      const handler = handlers.get(sessionId)
      if (handler === undefined) pending.set(sessionId, path)
      else handler(path)
      openDetails()
    },
    openTab: (sessionId, tab) => {
      const handler = tabHandlers.get(sessionId)
      if (handler === undefined) pendingTabs.set(sessionId, tab)
      else {
        handler.setActiveTab(tab)
        handler.focus?.()
      }
      openDetails()
    },
    register: (sessionId, registered) => {
      const sessionHandlers: WorkbenchSessionHandlers = typeof registered === 'function'
        ? { openFile: registered, setActiveTab: () => {} }
        : registered
      handlers.set(sessionId, sessionHandlers.openFile)
      tabHandlers.set(sessionId, sessionHandlers)
      const path = pending.get(sessionId)
      if (path !== undefined) {
        pending.delete(sessionId)
        sessionHandlers.openFile(path)
      }
      const tab = pendingTabs.get(sessionId)
      if (tab !== undefined) {
        pendingTabs.delete(sessionId)
        sessionHandlers.setActiveTab(tab)
        sessionHandlers.focus?.()
      }
      return () => {
        if (handlers.get(sessionId) === sessionHandlers.openFile) handlers.delete(sessionId)
        if (tabHandlers.get(sessionId) === sessionHandlers) tabHandlers.delete(sessionId)
      }
    },
  }
}
