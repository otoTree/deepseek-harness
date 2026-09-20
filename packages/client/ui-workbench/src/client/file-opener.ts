import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Cross-surface file opener used by Chat and the Workbench Results panel. */
export interface WorkbenchFileOpener {
  /** Request a file to open in the Session's Workbench Files panel. */
  openFile(sessionId: SessionId, path: string): Promise<void>
  /** Attach the mounted Session Workbench store and return its disposer. */
  register(sessionId: SessionId, openFile: (path: string) => void): () => void
}

/** Create the root-scoped bridge between Chat actions and Session Workbench stores. */
export function createWorkbenchFileOpener(openDetails: () => void): WorkbenchFileOpener {
  const handlers = new Map<SessionId, (path: string) => void>()
  const pending = new Map<SessionId, string>()
  return {
    openFile: async (sessionId, path) => {
      const handler = handlers.get(sessionId)
      if (handler === undefined) pending.set(sessionId, path)
      else handler(path)
      openDetails()
    },
    register: (sessionId, handler) => {
      handlers.set(sessionId, handler)
      const path = pending.get(sessionId)
      if (path !== undefined) {
        pending.delete(sessionId)
        handler(path)
      }
      return () => {
        if (handlers.get(sessionId) === handler) handlers.delete(sessionId)
      }
    },
  }
}
