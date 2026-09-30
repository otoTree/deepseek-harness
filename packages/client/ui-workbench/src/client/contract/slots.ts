import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkbenchRemote } from '@deepseek-ai/dsh-api-workbench-controller/client'
import type { createWorkbenchStore } from '../stores.ts'
import type { WorkbenchFileOpener } from '../file-opener.ts'

/** Workbench child-slot props supplied by the active tab shell. */
export type WorkbenchPanelProps = PropsRuntime<'workbench.panel'> & PropsLocale<'workbench'>

/** Complete props for the details-column Workbench owner. */
export type WorkbenchProps =
  & PropsRuntime<'details'>
  & PropsRenderSlots<'workbench.panel' | 'workbench.tabs' | 'workbench.tab-picker'>
  & PropsStore<ReturnType<typeof createWorkbenchStore>>
  & InjectFace<{
    closeDetails: () => void
    workbench: WorkbenchRemote
    fileOpener: WorkbenchFileOpener
    reconnect: () => void
    hooks: { connectionGeneration: HostObservable<ReturnType<ConnectionHandle['generation']['getSnapshot']>> }
  }>
  & PropsLocale<'workbench'>

/** Props for the persistent launcher that opens the session Workbench. */
export type WorkbenchLauncherProps =
  & PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<{ openDetails: () => void }>
  & PropsLocale<'workbench'>
