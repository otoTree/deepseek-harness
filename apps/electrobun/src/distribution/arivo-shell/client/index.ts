import { apply as registerEnterpriseClient, registerPluginMarket } from '@deepseek-ai/dsh-enterprise-client/client'
/** Startup-loaded Arivo branding and navigation extend the original OS Agent shell. */
import type { Context } from '@deepseek-ai/cordis'
import { Fragment, createElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { z } from 'zod'
import { IconUserOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { ArivoDeparture, installNativeDeparture, prepareFrame, type PrepareDeparture } from './departure.ts'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import type { MainSurface } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime, SlotIconProps } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workbench/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { DirectoryBrowser, type DirectoryBrowserProps } from '@deepseek-ai/dsh-client-ui-directory-picker-browse/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { arivoTokens, arivoStyles } from './theme.ts'
import { installProjectFolders, type FolderRequest } from './project-folders.ts'
import { ArivoTopbar, type TopbarKey } from './topbar.ts'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { CreativeLauncher, creativeMessages, creativeViews, type CreativeView, type CreativeKey } from './workbench-entries.ts'
import { CanvasRail, CanvasRailStore, canvasRailMessages, type CanvasRailKey } from './canvas-rail.ts'
import { StoryRail, StoryRailStore, storyRailMessages, type StoryRailKey } from './story-rail.ts'
import { sessionCatalogSchema } from '../session-catalog-protocol.ts'

declare const ARIVO_BRAND_MARK: string
const pages = ['projects', 'tasks', 'assets', 'backups', 'account', 'settings'] as const
type Page = typeof pages[number]
type Entry = { version: 1; page: Page; language: 'en' | 'zh'; scheme: 'light' | 'dark'; sessionId?: string; view?: CreativeView }
type Key = CreativeKey | Page | 'loading' | 'failed' | 'retry' | 'brand' | 'leaveBlocked' | TopbarKey | StoryRailKey | CanvasRailKey
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'arivo.shell': Key } }
interface PaneInjected {
  canvasRail: CanvasRailStore
  storyRail: StoryRailStore
  load: (entry: Entry, signal: AbortSignal) => Promise<string>
  folderRequest: (input: FolderRequest & { selectedPath?: string | null }, signal: AbortSignal) => Promise<unknown>
  directory: Pick<DirectoryBrowserProps, 'listDirectory' | 'createDirectory' | 't'>
  transition: (change: () => void) => void
  registerDeparture: (prepare: PrepareDeparture) => () => void
  hooks: { language: HostObservable<LocaleSnapshot>; appearance: HostObservable<ThemeSnapshot> }
}
type PaneProps = PropsLocale<'arivo.shell'> & InjectFace<PaneInjected> & { page: Page; view?: CreativeView }
type RailProps = PropsRuntime<'sidebar.rail.item'> & PropsLocale<'arivo.shell'> & InjectFace<{
  open: () => void
  hooks: { active: HostObservable<MainSurface> }
}>

/** Original OS providers used without replacing conversations, settings or Session owners. */
export const inject = ['sessions', 'connection', 'slots', 'locale', 'theme', 'mainNavigation', 'layoutPresentation', 'uiWorkspace', 'remote', 'remote.session', 'modules']

function Pane({ page, view, t, load, storyRail, canvasRail, folderRequest, directory, transition, registerDeparture,
  useLanguage, useAppearance, docked = false, sessionId }:
  PaneProps & { docked?: boolean; sessionId?: string }) {
  useEffect(() => {
    if (docked) return
    document.body.setAttribute('data-arivo-pane', '')
    return () => { document.body.removeAttribute('data-arivo-pane') }
  }, [docked])
  const language = useLanguage(snapshot => snapshot.active.startsWith('zh') ? 'zh' : 'en')
  const scheme = useAppearance(snapshot => snapshot.active.colorScheme)
  const [picker, setPicker] = useState<{ resolve: (path: string | null) => void }>()
  const frame = useRef<HTMLIFrameElement>(null)
  const [entry, setEntry] = useState<Entry>({
    version: 1, page, language, scheme, ...(view ? { view } : {}), ...(sessionId ? { sessionId } : {}),
  })
  useEffect(() => {
    if (entry.page === page && entry.view === view && entry.language === language
      && entry.scheme === scheme && entry.sessionId === sessionId) return
    let active = true
    queueMicrotask(() => {
      if (active) transition(() => {
        setEntry({ version: 1, page, language, scheme, ...(view ? { view } : {}), ...(sessionId ? { sessionId } : {}) })
      })
    })
    return () => { active = false }
  }, [entry, page, view, language, scheme, sessionId, transition])
  const [result, setResult] = useState<{ url?: string; failed?: boolean }>({})
  const [attempt, setAttempt] = useState(0)
  const [loadedUrl, setLoadedUrl] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    setLoadedUrl(undefined)
    setResult({})
    void load(entry, controller.signal).then((url) => {
      if (!controller.signal.aborted) setResult({ url })
    }).catch(() => { if (!controller.signal.aborted) setResult({ failed: true }) })
    return () => { controller.abort() }
  }, [entry, attempt, load])
  useLayoutEffect(() => {
    if((view !== 'script' && view !== 'storyboard') || !docked || !frame.current || !result.url || loadedUrl !== result.url)return
    const url=new URL(result.url)
    return storyRail.bind(frame.current,url.origin,z.uuid().parse(url.searchParams.get('project')))
  },[view,docked,result.url,loadedUrl,storyRail])
  useLayoutEffect(() => {
    if (view !== 'canvas' || !docked || !frame.current || !result.url || loadedUrl !== result.url) return
    const url = new URL(result.url)
    return canvasRail.bind(frame.current, url.origin, z.uuid().parse(url.searchParams.get('project')))
  }, [view, docked, result.url, loadedUrl, canvasRail])
  useLayoutEffect(() => {
    const iframe = frame.current
    if (!iframe || !result.url || loadedUrl !== result.url) return
    const origin = new URL(result.url).origin
    return registerDeparture(signal => prepareFrame(iframe, origin, signal))
  }, [result.url, loadedUrl, registerDeparture])
  useLayoutEffect(() => {
    const iframe = frame.current
    if (!iframe || !result.url) return
    const origin = new URL(result.url).origin
    const removeFolders = installProjectFolders(iframe, origin, async (input, signal) => {
      if (input.operation !== 'bind' && input.operation !== 'create') return folderRequest(input, signal)
      if (input.operation === 'bind') {
        const existing = await folderRequest({ ...input, operation: 'get' }, signal)
        if (z.object({ folder: z.unknown().nullable() }).parse(existing).folder !== null) return existing
      }
      signal.throwIfAborted()
      const selectedPath = await new Promise<string | null>((resolve, reject) => {
        const abort = () => { setPicker(undefined); reject(new DOMException('Directory selection cancelled', 'AbortError')) }
        signal.addEventListener('abort', abort, { once: true })
        setPicker({ resolve(path) { signal.removeEventListener('abort', abort); setPicker(undefined); resolve(path) } })
      })
      return folderRequest({ ...input, selectedPath }, signal)
    })
    return removeFolders
  }, [result.url, folderRequest])
  if (result.url) return createElement(Fragment, null, createElement('iframe', { ref: frame, onLoad: () => { setLoadedUrl(result.url) }, title: t(view ? `creative.${view}` : page), src: result.url, referrerPolicy: 'no-referrer',
    sandbox: 'allow-scripts allow-same-origin allow-forms allow-modals', className: docked ? 'arivo-pane arivo-workbench-pane' : 'arivo-pane' }),
  picker ? createElement(DirectoryBrowser, { ...directory, open: true, busy: false,
    onOpen: (path) => { picker.resolve(path) }, onClose: () => { picker.resolve(null) } }) : null)
  return createElement('div', { className: 'arivo-pane-status' }, createElement('p', { role: 'status' }, t(result.failed ? 'failed' : 'loading')),
    result.failed ? createElement('button', { type: 'button', onClick: () => { setAttempt(value => value + 1) } }, t('retry')) : null)
}

function Glyph({ page }: { page: Page }) {
  if (page === 'projects') return createElement('img', { src: ARIVO_BRAND_MARK, alt: '', 'aria-hidden': true })
  if (page === 'account') return createElement(IconUserOutline16, { size: 20 })
  const path = page === 'assets' ? 'M3 3h14v14H3z M7 7h14v14H7'
    : page === 'tasks' ? 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'
      : 'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2'
  return createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, createElement('path', { d: path }))
}

/** Register lifecycle-owned appearance, rail pages and an account page in the OS Settings shell.
 * @param ctx - OS Client context.
 */
export function apply(ctx: Context, input: { leaveTimeoutMs?: number } = {}): void {
  registerPluginMarket(ctx, '/arivo-market', { name: 'Arivo', workspacePublishing: false })
  registerEnterpriseClient(ctx, { mode: 'triggers', rpcPath: '/arivo-triggers', cloudFiles: false })
  const config = z.object({ leaveTimeoutMs: z.number().int().min(1000).max(60000).default(15000) }).strict().parse(input)
  ctx.effect(() => ctx.locale.register('arivo.shell', {
    en: { ...canvasRailMessages.en, ...storyRailMessages.en, ...creativeMessages.en, leaveBlocked: 'The editor could not confirm a save. Your input is retained. Finish or close the current dialog, or retry saving before leaving.', openSidebar: 'Open sidebar', closeSidebar: 'Collapse sidebar', openWorkbench: 'Workbench', newConversation: 'New session', localWorkspace: 'Local workspace', projects: 'Arivo Studio', tasks: 'Tasks', assets: 'Asset library', backups: 'Backups & recovery', account: 'Arivo account', settings: 'Local runtime', loading: 'Opening workspace…', failed: 'Could not open this project. Connect its folder in Studio and open a conversation there.', retry: 'Retry', brand: 'Arivo' },
    zh: { ...canvasRailMessages.zh, ...storyRailMessages.zh, ...creativeMessages.zh, leaveBlocked: '尚未确认保存，已保留当前输入。请完成或关闭当前弹窗，或重试保存后再离开。', openSidebar: '展开侧栏', closeSidebar: '收起侧栏', openWorkbench: '工作台', newConversation: '新对话', localWorkspace: '本机工作区', projects: 'Arivo 创作', tasks: '任务', assets: '资产库', backups: '备份与恢复', account: 'Arivo 账号', settings: '本地运行环境', loading: '正在打开工作区…', failed: '暂时无法打开项目。请先在创作页关联项目文件夹，并从该文件夹打开对话。', retry: '重试', brand: 'Arivo' },
  }), 'arivo-shell: dictionaries')
  ctx.effect(() => ctx.layoutPresentation.setProductTitle('Arivo'), 'arivo-shell: product title')
  ctx.effect(() => ctx.theme.overrideTokens('arivo.startup', arivoTokens), 'arivo-shell: product theme')
  ctx.effect(() => {
    const tag = document.createElement('style'); tag.dataset.plugin = '@arivo/startup-shell'; tag.textContent = arivoStyles
    document.head.appendChild(tag)
    document.body.setAttribute('data-arivo-shell', '')
    return () => { tag.remove(); document.body.removeAttribute('data-arivo-shell') }
  }, 'arivo-shell: product styles')
  ctx.slots.inject('topbar', () => ctx.slots.register({ name: 'topbar', locale: 'arivo.shell', priority: -10 }, ArivoTopbar))
  const t = ctx.locale.bind('arivo.shell')
  const navigation = ctx.mainNavigation
  const departures = new ArivoDeparture(config.leaveTimeoutMs, (change) => { flushSync(change) }, () => { window.alert(t('leaveBlocked')) })
  ctx.effect(() => installNativeDeparture(departures), 'arivo-shell: native editor departure')
  const transition = (change: () => void) => { void departures.run(change) }
  const registerDeparture = (prepare: PrepareDeparture) => departures.register(prepare)
  if (!ctx.sessions.setSelectionHandler) throw new Error('Arivo requires Session departure coordination')
  const coordinateSelection = ctx.sessions.setSelectionHandler.bind(ctx.sessions)
  ctx.effect(() => coordinateSelection(transition), 'arivo-shell: Session editor departure')
  ctx.effect(() => navigation.setTransitionHandler(transition), 'arivo-shell: editor departure coordination')
  ctx.effect(() => () => { departures.dispose() }, 'arivo-shell: cancel editor departure')
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.inject(['modelDirectories'], (scope) => {
    scope.effect(() => scope.modelDirectories.registerCatalogSource(async (sessionId, signal) => {
      const response = await connection.rpc.call('/arivo-session-models', 'catalog', { version: 1, sessionId }, signal)
      signal.throwIfAborted()
      if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      return sessionCatalogSchema.parse(response.value)
    }), 'arivo-shell: project Session catalog source')
  })
  const active = { getSnapshot: () => navigation.get(), subscribe: navigation.subscribe.bind(navigation) }
  const appearance = { getSnapshot: () => ctx.theme.getTheme(), subscribe: (listener: () => void) => ctx.on('theme/change', listener) }
  const load = async (entry: Entry, signal: AbortSignal): Promise<string> => {
    const response = await connection.rpc.call('/arivo-studio', 'workbench', entry, signal)
    if (!response.ok) throw new Error('Studio request failed')
    const value = response.value
    if (!value || typeof value !== 'object' || !('url' in value) || typeof value.url !== 'string') throw new Error('Invalid Studio response')
    const url = new URL(value.url)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/embedded'
      || url.username || url.password || url.hash || url.searchParams.size !== (5 + (entry.sessionId ? 1 : 0) + (entry.view ? 1 : 0))
      || (entry.sessionId && !z.uuid().safeParse(url.searchParams.get('project')).success)
      || !/^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get('token') ?? '')
      || url.searchParams.get('v') !== '1' || url.searchParams.get('page') !== entry.page
      || url.searchParams.get('view') !== (entry.view ?? null)
      || url.searchParams.get('lang') !== entry.language || url.searchParams.get('scheme') !== entry.scheme) throw new Error('Invalid Studio URL')
    return url.toString()
  }
  const folderRequest = async (input: FolderRequest, signal: AbortSignal): Promise<unknown> => {
    const response = await connection.rpc.call('/arivo-project-folders', 'request', input, signal)
    if (!response.ok) throw new Error(response.error.code)
    if (input.operation === 'conversation') {
      const result = z.object({ folder: z.object({ workspaceId: z.uuid(), model: z.strictObject({ provider: z.literal('arivo'), model: z.string().min(1).max(256) }).nullable() }) }).parse(response.value)
      if (!input.conversationId) throw new Error('PROJECT_MODEL_REQUIRED')
      signal.throwIfAborted()
      const sessionId = await ctx.sessions.create({ workspaceId: result.folder.workspaceId as WorkspaceId, sessionId: `session-${input.conversationId}` as SessionId })
      signal.throwIfAborted()
      if (result.folder.model && ctx.sessions.list.getSnapshot().byId[sessionId]?.blank) {
        const selection = await ctx.remote.session.selectModel({ sessionId, ...result.folder.model })
        if (!selection.ok) throw new Error('PROJECT_MODEL_UNAVAILABLE')
      }
      if (!signal.aborted) { ctx.sessions.open(sessionId); navigation.openConversation() }
    }
    const value = z.object({ cancelled: z.boolean(),
      folder: z.object({ projectId: z.uuid(), name: z.string(), workspaceId: z.uuid().optional() }).nullable(),
      ...(input.operation === 'create' || input.operation === 'recover' ? { project: z.unknown() } : {}),
    }).parse(response.value)
    return value
  }
  const directory = { listDirectory: ctx.uiWorkspace.listDirectory.bind(ctx.uiWorkspace),
    createDirectory: ctx.uiWorkspace.createDirectory.bind(ctx.uiWorkspace), t: ctx.locale.bind('directory-browser') }
  const canvasRail = new CanvasRailStore()
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'arivo.canvas.library', locale: 'arivo.shell' },
    (props: PropsRuntime<'sidebar.footer.action'> & PropsLocale<'arivo.shell'>) => createElement(CanvasRail, { ...props, store: canvasRail })))
  const storyRail = new StoryRailStore()
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'arivo.story.episodes', locale: 'arivo.shell' },
    (props: PropsRuntime<'sidebar.footer.action'> & PropsLocale<'arivo.shell'>) => createElement(StoryRail, { ...props, store: storyRail })))
  const paneInject = () => ({ canvasRail, storyRail, load, folderRequest, directory, transition, registerDeparture,
    hooks: { language: ctx.locale, appearance } })
  for (const view of creativeViews) {
    const key = `arivo.creative.${view}`
    ctx.slots.inject('workbench.tabs', () => ctx.slots.register({ name: 'workbench.tabs', id: key, locale: 'arivo.shell' },
      (props: PropsRuntime<'workbench.tabs'> & PropsLocale<'arivo.shell'>) => createElement(CreativeLauncher, { ...props, view })))
    ctx.slots.inject('workbench.panel', () => ctx.slots.register({ name: 'workbench.panel', key, locale: 'arivo.shell', inject: paneInject },
      (props: PropsRuntime<'workbench.panel'> & PropsLocale<'arivo.shell'> & InjectFace<PaneInjected>) => createElement(Pane, { ...props, key: props.sessionId, page: 'projects', view, docked: true, sessionId: props.sessionId })))
  }
  ctx.slots.inject('workbench.tabs', () => ctx.slots.register({ name: 'workbench.tabs', id: 'arivo.studio', locale: 'arivo.shell' },
    ({ registerTab, t, sessionId }: PropsRuntime<'workbench.tabs'> & PropsLocale<'arivo.shell'>) => createElement('button', {
      type: 'button', className: 'arivo-workbench-open', disabled: sessionId === undefined, onClick: () => { registerTab({ id: 'arivo.studio', key: 'arivo.studio', label: t('projects'), closable: true }) },
    }, t('projects'))))
  ctx.slots.inject('workbench.panel', () => ctx.slots.register({ name: 'workbench.panel', key: 'arivo.studio', locale: 'arivo.shell', inject: paneInject },
    (props: PropsRuntime<'workbench.panel'> & PropsLocale<'arivo.shell'> & InjectFace<PaneInjected>) => createElement(Pane, { ...props, key: props.sessionId, page: 'projects', docked: true, sessionId: props.sessionId })))
  for (const [index, page] of pages.entries()) {
    const key = page === 'projects' ? 'arivo.studio' : `arivo.${page}` as const
    if (page !== 'settings') {
      function Rail({ open, useActive, t }: RailProps) {
        const selected = useActive(surface => surface === key)
        return createElement('button', { type: 'button', title: t(page), 'aria-label': t(page), 'aria-pressed': selected,
          'aria-current': selected ? 'page' : undefined, onClick: open, className: 'arivo-rail-item' }, createElement(Glyph, { page }))
      }
      ctx.slots.inject('sidebar.rail.item', () => ctx.slots.register({ name: 'sidebar.rail.item', id: key, order: 15 + index,
        locale: 'arivo.shell', label: () => t(page), inject: () => ({ open: () => { navigation.openPluginSurface(key) }, hooks: { active } }) }, Rail))
    }
    ctx.slots.inject('main.surface', () => ctx.slots.register({ name: 'main.surface', key, locale: 'arivo.shell', inject: paneInject },
      (props: PropsRuntime<'main.surface'> & PropsLocale<'arivo.shell'> & InjectFace<PaneInjected>) => createElement(Pane, { ...props, page })))
  }
  for (const page of ['account', 'settings'] as const) {
    ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: `arivo.${page}`, order: page === 'account' ? 5 : 90,
      icon: page === 'account' ? IconUserOutline16 : RuntimeIcon, label: () => t(page), locale: 'arivo.shell', inject: paneInject },
    (props: PropsRuntime<'settings.section'> & PropsLocale<'arivo.shell'> & InjectFace<PaneInjected>) => createElement(Pane, { ...props, page })))
  }
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark' },
    ({ size }: PropsRuntime<'sidebar.brand.mark'>) => createElement('img', { src: ARIVO_BRAND_MARK, alt: '', width: size, height: size, className: 'arivo-brand-mark' })))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', locale: 'arivo.shell' }, () => createElement('span', null, t('brand'))))
  navigation.openPluginSurface('arivo.studio')
  ctx.effect(() => () => { if (navigation.get().startsWith('arivo.')) navigation.openConversation() }, 'arivo-shell: restore conversation on removal')
}

/** Local runtime has its own machine glyph, distinct from account and preferences. */
function RuntimeIcon({ size = 16, className }: SlotIconProps) {
  return createElement('svg', { width: size, height: size, className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    createElement('path', { d: 'M3 4h18v13H3z M8 21h8 M12 17v4 M7 8l3 3-3 3 M13 14h4' }))
}
