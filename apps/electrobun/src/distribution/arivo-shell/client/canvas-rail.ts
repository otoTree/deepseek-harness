/** Canvas sidebar metadata and intents for one loaded Workbench frame. */
import { createElement, useSyncExternalStore } from 'react'
import { z } from 'zod'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
export const canvasRailMessages = {
  zh: { 'canvas.list': '画布', 'canvas.create': '新建画布', 'canvas.empty': '还没有画布', 'canvas.rename': '重命名画布', 'canvas.delete': '删除画布' },
  en: { 'canvas.list': 'Canvases', 'canvas.create': 'Create canvas', 'canvas.empty': 'No canvases yet', 'canvas.rename': 'Rename canvas', 'canvas.delete': 'Delete canvas' },
}
export type CanvasRailKey = keyof typeof canvasRailMessages.en
const stateSchema = z.strictObject({ type: z.literal('arivo:canvas-state'), version: z.literal(1), id: z.uuid(),
  projectId: z.uuid(), selected: z.uuid().optional(), busy: z.boolean(),
  canvases: z.array(z.strictObject({ id: z.uuid(), title: z.string().min(1).max(255) })),
})
type State = z.infer<typeof stateSchema>
type Entry = { state: State; run: (action: 'create' | 'open' | 'rename' | 'delete', canvasId?: string) => void }
/** Only the latest binding may publish metadata or forward actions. */
export class CanvasRailStore {
  private current: Entry | undefined
  private owner: symbol | undefined
  private listeners = new Set<() => void>()
  readonly snapshot = () => this.current
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  /** Bind the loaded frame; disposal and stale callbacks cannot affect its successor.
   * @param frame Loaded creative iframe.
   * @param origin Verified plugin origin.
   * @param projectId Exact Session project.
   * @returns Listener and contribution disposer.
   */
  bind(frame: HTMLIFrameElement, origin: string, projectId: string): () => void {
    // eslint-disable-next-line no-restricted-properties
    const id = crypto.randomUUID(), owner = Symbol()
    this.owner = owner; this.current = undefined; this.emit()
    const connect = () => { frame.contentWindow?.postMessage({ type: 'arivo:canvas-connect', version: 1, id }, origin) }
    const receive = (event: MessageEvent) => {
      if (this.owner !== owner || event.source !== frame.contentWindow || event.origin !== origin) return
      if (z.strictObject({ type: z.literal('arivo:canvas-ready'), version: z.literal(1) }).safeParse(event.data).success) { connect(); return }
      const parsed = stateSchema.safeParse(event.data)
      if (!parsed.success || parsed.data.id !== id || parsed.data.projectId !== projectId) return
      const entry: Entry = { state: parsed.data, run: (action, canvasId) => {
        if (this.owner !== owner || this.current !== entry || entry.state.busy) return
        if (action !== 'create' && !entry.state.canvases.some(canvas => canvas.id === canvasId)) return
        frame.contentWindow?.postMessage({ type: 'arivo:canvas-action', version: 1, id, action, ...(canvasId ? { canvasId } : {}) }, origin)
      } }
      this.current = entry; this.emit()
    }
    window.addEventListener('message', receive); connect()
    return () => {
      window.removeEventListener('message', receive)
      if (this.owner === owner) { this.owner = undefined; this.current = undefined; this.emit() }
    }
  }
  private emit() { for (const listener of this.listeners) listener() }
}
/** Display canvas navigation below conversations while its Workbench panel owns the slot.
 * @param props Reactive metadata, sidebar width and locale.
 * @returns Canvas controls, or nothing when the panel is absent or sidebar collapsed.
 */
export function CanvasRail({ store, wide, t }: { store: CanvasRailStore; wide: boolean } & PropsLocale<'arivo.shell'>) {
  const entry = useSyncExternalStore(store.subscribe, store.snapshot)
  if (!wide || !entry) return null
  const { state, run } = entry
  return createElement('section', { className: 'arivo-story-rail arivo-canvas-rail', 'aria-label': t('canvas.list'), 'data-project': state.projectId },
    createElement('header', null, createElement('h2', null, t('canvas.list')), createElement('span', null, state.canvases.length),
      createElement('button', { type: 'button', disabled: state.busy, 'aria-label': t('canvas.create'), title: t('canvas.create'), onClick: () => { run('create') } }, '+')),
    createElement('div', { className: 'arivo-story-rail-list' }, state.canvases.length ? state.canvases.map(canvas =>
      createElement('div', { key: canvas.id, className: 'arivo-canvas-rail-row' }, createElement('button', { type: 'button', className: 'arivo-story-episode', disabled: state.busy,
        'aria-current': canvas.id === state.selected ? 'page' : undefined, onClick: () => { run('open', canvas.id) } },
      createElement('span', null, canvas.title)),
      createElement('button', { type: 'button', disabled: state.busy, 'aria-label': t('canvas.rename') + ' ' + canvas.title, title: t('canvas.rename'), onClick: () => { run('rename',canvas.id) } }, '✎'),
      createElement('button', { type: 'button', disabled: state.busy, 'aria-label': t('canvas.delete') + ' ' + canvas.title, title: t('canvas.delete'), onClick: () => { run('delete',canvas.id) } }, '×'))) : createElement('p', null, t('canvas.empty'))))
}
