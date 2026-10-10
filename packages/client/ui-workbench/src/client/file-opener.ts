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
  /**
   * Request a file to open in the Session's Workbench Files panel.
   * @param sessionId - owning chat Session.
   * @param path - workspace-relative or absolute file path.
   */
  openFile(sessionId: SessionId, path: string): void
  /**
   * Select a Session Workbench tab and open the details column.
   * @param sessionId - owning chat Session.
   * @param tab - registered tab key to select.
   */
  openTab(sessionId: SessionId, tab: WorkbenchTab): void
  /**
   * Attach the mounted Session Workbench store.
   * @param sessionId - owning chat Session.
   * @param handlers - mounted Workbench callbacks or a file-only callback.
   * @returns a disposer that removes only this registration.
   */
  register(sessionId: SessionId, handlers: WorkbenchSessionHandlers | ((path: string) => void)): () => void
}

/**
 * Create the root-scoped bridge between Chat actions and Session Workbench stores.
 * @param openDetails - action that reveals the details column.
 * @returns the bridge that queues actions until the target Session Workbench mounts.
 */
export function createWorkbenchFileOpener(openDetails: () => void): WorkbenchFileOpener {
  const handlers = new Map<SessionId, (path: string) => void>()
  const tabHandlers = new Map<SessionId, Pick<WorkbenchSessionHandlers, 'setActiveTab' | 'focus'>>()
  const pending = new Map<SessionId, string>()
  const pendingTabs = new Map<SessionId, WorkbenchTab>()
  return {
    openFile: (sessionId, path) => {
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
      const openFile = (path: string): void => { sessionHandlers.openFile(path) }
      handlers.set(sessionId, openFile)
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
        if (handlers.get(sessionId) === openFile) handlers.delete(sessionId)
        if (tabHandlers.get(sessionId) === sessionHandlers) tabHandlers.delete(sessionId)
      }
    },
  }
}
