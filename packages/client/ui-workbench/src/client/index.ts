import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-workbench-controller/client'
import { Workbench } from './Workbench.tsx'
import { WorkbenchLauncher } from './WorkbenchLauncher.tsx'
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
    'workbench.tabs': {
      kind: 'list'
      scope: 'session'
      owner: { activeTab: WorkbenchTab; setActiveTab: (tab: WorkbenchTab) => void; closeTab?: (tab: WorkbenchTab) => void }
    }
    'workbench.tab-picker': {
      kind: 'single'
      scope: 'session'
      owner: { activeTab: WorkbenchTab; setActiveTab: (tab: WorkbenchTab) => void; closeTab?: (tab: WorkbenchTab) => void }
    }
  }
  interface LocaleNamespaceMap { workbench: WorkbenchKey }
}

/** Services consumed by the Workbench shell. */
export const inject = ['locale', 'slots', 'layout', 'connection', 'remote', 'remote.workbench']

/** Register the Workbench as the sole details-column owner. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => ctx.locale.register('workbench', { zh, en }), 'ui-workbench: dictionaries')
  ctx.effect(() => {
    const opener = createWorkbenchFileOpener(() => { ctx.layout.openDetails() })
    const dispose = ctx.reflect.provide('uiWorkbench', opener)
    return () => { void dispose() }
  }, 'ui-workbench: Chat file opener')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'workbench-launcher',
    locale: 'workbench',
    inject: () => ({ openDetails: () => { ctx.layout.openDetails() } }),
  }, WorkbenchLauncher))
  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    locale: 'workbench',
    children: {
      'workbench.panel': { kind: 'keyed', scope: 'session' },
      'workbench.tabs': { kind: 'list', scope: 'session' },
      'workbench.tab-picker': { kind: 'single', scope: 'session' },
    },
    store: createWorkbenchStore,
    inject: () => ({
      hooks: { connectionGeneration: connection.generation },
      reconnect: () => { connection.reconnect() },
      closeDetails: () => { ctx.layout.closeDetails() },
      workbench: ctx.remote.workbench,
      fileOpener: ctx.uiWorkbench,
    }),
  }, Workbench))
}
