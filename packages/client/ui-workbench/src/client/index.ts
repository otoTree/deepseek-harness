import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-workbench-controller/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { Workbench } from './Workbench.tsx'
import type { WorkbenchTab } from './stores.ts'
import { createWorkbenchStore } from './stores.ts'
import { createWorkbenchFileOpener } from './file-opener.ts'
import type { WorkbenchFileOpener } from './file-opener.ts'
import { en, zh, type WorkbenchKey } from './locales.ts'

export type { WorkbenchTab } from './stores.ts'
export type { WorkbenchFileOpener } from './file-opener.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Routes Chat file actions into the Session Workbench Files panel. */
    uiWorkbench: WorkbenchFileOpener
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Active panel rendered inside the session-scoped Workbench shell. */
    'workbench.panel': {
      kind: 'keyed'
      scope: 'session'
      owner: { tab: WorkbenchTab }
      keyProps: { [key: string]: { openFile?: (path: string) => void } }
    }
    /** Additive tab-strip contributions. Registrants receive the active tab and callbacks; absence leaves only built-in tabs. */
    'workbench.tabs': {
      kind: 'list'
      scope: 'session-maybe'
      owner: {
        activeTab: WorkbenchTab
        setActiveTab: (tab: WorkbenchTab) => void
        closeTab?: (tab: WorkbenchTab) => void
        registerTab: (tab: {
          id: string
          key: string
          label: string
          closable: boolean
          order?: number
        }) => () => void
      }
    }
  }
  interface LocaleNamespaceMap { workbench: WorkbenchKey }
}

/** Services consumed by the Workbench shell. */
export const inject = ['locale', 'slots', 'layout', 'connection', 'sessions', 'remote', 'remote.workbench']

/** Register the Workbench as the sole details-column owner. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  let pendingSession: Promise<import('@deepseek-ai/dsh-session/types').SessionId> | undefined
  const ensureSession = (): Promise<import('@deepseek-ai/dsh-session/types').SessionId> => {
    const current = ctx.sessions.list.getSnapshot().current
    if (current !== undefined) return Promise.resolve(current)
    pendingSession ??= ctx.sessions.create().then((sessionId) => {
      ctx.sessions.open(sessionId)
      return sessionId
    }).finally(() => { pendingSession = undefined })
    return pendingSession
  }
  ctx.effect(() => ctx.locale.register('workbench', { zh, en }), 'ui-workbench: dictionaries')
  ctx.effect(() => {
    const opener = createWorkbenchFileOpener(() => { ctx.layout.openDetails() })
    const dispose = ctx.reflect.provide('uiWorkbench', opener)
    return () => { void dispose() }
  }, 'ui-workbench: Chat file opener')
  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    locale: 'workbench',
    children: {
      'workbench.panel': { kind: 'keyed', scope: 'session' },
      'workbench.tabs': { kind: 'list', scope: 'session-maybe' },
    },
    store: createWorkbenchStore,
    inject: () => ({
      hooks: { connectionGeneration: connection.generation },
      reconnect: () => { connection.reconnect() },
      closeDetails: () => { ctx.layout.closeDetails() },
      workbench: ctx.remote.workbench,
      runtime: ctx.remote.workbench,
      fileOpener: ctx.uiWorkbench,
      ensureSession,
    }),
  }, Workbench))
}
