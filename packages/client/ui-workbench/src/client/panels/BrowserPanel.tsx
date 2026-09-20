import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchRemote } from '@deepseek-ai/dsh-api-workbench-controller/client'
import type { BrowserSessionId, BrowserTab, BrowserTabId } from '@deepseek-ai/dsh-api-workbench-controller/types'
import type { WorkbenchKey } from '../locales.ts'
import css from './panels.module.css'

type Translator = (key: WorkbenchKey) => string
const NEW_TAB_URL = 'about:blank'
const NATIVE_PARTITION_PREFIX = 'persist:dsh-workbench-runtime-'
const OBSERVATION_TYPE = 'dsh-browser-observation'
const OBSERVATION_SCRIPT = `(() => {
  const send = () => {
    const clean = value => String(value ?? '').replace(/\\s+/g, ' ').trim();
    const lines = ['- document "' + clean(document.title) + '"'];
    document.querySelectorAll('h1,h2,h3,h4,h5,h6,a,button,input,textarea,select,[role]').forEach(node => {
      const tag = node.tagName.toLowerCase();
      const role = node.getAttribute('role') || ({a:'link',button:'button',input:'textbox',textarea:'textbox',select:'combobox'}[tag] ?? (tag.startsWith('h') ? 'heading' : tag));
      const value = 'value' in node ? node.value : '';
      const name = clean(node.getAttribute('aria-label') || node.innerText || value || node.getAttribute('title'));
      if (name) lines.push('- ' + role + ' "' + name.slice(0, 1000) + '"');
    });
    const text = clean(document.body?.innerText).slice(0, 160000);
    if (text) lines.push('- text "' + text + '"');
    window.__electrobunSendToHost?.({ type: '${OBSERVATION_TYPE}', title: document.title, url: location.href, snapshot: lines.join('\\n').slice(0, 200000) });
  };
  if (!window.__dshWorkbenchObservation) {
    let timer;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(send, 160); };
    window.__dshWorkbenchObservation = send;
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    addEventListener('input', schedule, true);
    addEventListener('change', schedule, true);
    addEventListener('click', schedule, true);
  }
  window.__dshWorkbenchObservation();
})()`

interface NativeBrowserElement extends HTMLElement {
  on(event: string, listener: (event: CustomEvent<unknown>) => void): void
  off(event: string, listener: (event: CustomEvent<unknown>) => void): void
  canGoBack(): Promise<boolean>
  canGoForward(): Promise<boolean>
  goBack(): void
  goForward(): void
  loadURL(url: string): void
  reload(): void
  toggleHidden(hidden?: boolean): void
  togglePassthrough(passthrough?: boolean): void
  syncDimensions(force?: boolean): void
  executeJavascript(script: string): void
}

interface BrowserPanelProps {
  t: Translator
  remote: WorkbenchRemote
  sessionId: SessionId
  browserId: BrowserSessionId | undefined
  activeTabId: BrowserTabId | undefined
  setBrowser: (browserId: BrowserSessionId, tabId: BrowserTabId | undefined) => void
  setActiveTabId: (tabId: BrowserTabId | undefined) => void
}

interface NativeObservation { type: typeof OBSERVATION_TYPE; title: string; url: string; snapshot: string }

interface NativeBrowserViewProps {
  tab: BrowserTab
  partition: string
  active: boolean
  attach: (tabId: BrowserTabId, view: NativeBrowserElement | null) => void
}

function NativeBrowserView({ tab, partition, active, attach }: NativeBrowserViewProps) {
  const initialUrl = useRef(tab.url)
  const ref = useCallback((element: HTMLElement | null) => {
    attach(tab.tabId, element as NativeBrowserElement | null)
  }, [attach, tab.tabId])
  return createElement('electrobun-webview', {
    ref,
    className: css.nativeBrowser,
    style: {
      position: 'absolute',
      inset: 0,
      display: active ? 'block' : 'none',
      width: '100%',
      height: '100%',
      border: 0,
      background: '#fff',
    },
    src: initialUrl.current,
    renderer: 'native',
    sandbox: '',
    partition,
    'data-active': active ? 'true' : 'false',
    'aria-hidden': active ? undefined : 'true',
  })
}

function decoded(value: unknown): unknown {
  let result = value
  for (let index = 0; index < 3; index += 1) {
    if (typeof result === 'object' && result !== null && 'detail' in result) {
      result = result.detail
      continue
    }
    if (typeof result === 'string' && result.startsWith('{')) {
      try { result = JSON.parse(result) as unknown; continue } catch { return result }
    }
    break
  }
  return result
}

function eventUrl(event: CustomEvent<unknown>): string | undefined {
  const value = decoded(event.detail)
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && typeof (value as { url?: unknown }).url === 'string') return (value as { url: string }).url
  return undefined
}

function nativeObservation(event: CustomEvent<unknown>): NativeObservation | undefined {
  const value = decoded(event.detail)
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Partial<NativeObservation>
  if (record.type !== OBSERVATION_TYPE || typeof record.title !== 'string' || typeof record.url !== 'string' || typeof record.snapshot !== 'string') return undefined
  return { type: record.type, title: record.title, url: record.url, snapshot: record.snapshot }
}

function hasNativeBrowser(): boolean {
  return typeof customElements !== 'undefined' && customElements.get('electrobun-webview') !== undefined
}

function nativeRuntimePartition(): string {
  const identity = (globalThis as {
    __dshNative?: { runtimeStorageIdentity?: unknown }
  }).__dshNative?.runtimeStorageIdentity
  if (typeof identity !== 'string' || !/^[a-f0-9]{64}$/.test(identity)) {
    throw new Error('Native Workbench browser requires a valid Runtime storage identity')
  }
  return `${NATIVE_PARTITION_PREFIX}${identity}`
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/** Browser panel backed by a native Electrobun WebView and a Session Playwright mirror. */
export function BrowserPanel({
  t, remote, sessionId, browserId, activeTabId, setBrowser, setActiveTabId,
}: BrowserPanelProps) {
  const [tabs, setTabs] = useState<readonly BrowserTab[]>([])
  const [selectedTabId, setSelectedTabId] = useState(activeTabId)
  const [address, setAddress] = useState(NEW_TAB_URL)
  const [error, setError] = useState<string | undefined>()
  const native = hasNativeBrowser()
  const partition = native ? nativeRuntimePartition() : undefined
  const viewportRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef(tabs)
  const views = useRef(new Map<BrowserTabId, NativeBrowserElement>())
  const viewCleanups = useRef(new Map<BrowserTabId, () => void>())
  const nativeQueues = useRef(new Map<BrowserTabId, Promise<void>>())
  const lastMirroredNativeUrls = useRef(new Map<BrowserTabId, string>())
  const selectedTabIdRef = useRef(activeTabId)
  const current = tabs.find(tab => tab.tabId === selectedTabId) ?? tabs.find(tab => tab.active) ?? tabs[0]
  tabsRef.current = tabs

  const syncNativeViews = useCallback((activeTabId: BrowserTabId | undefined): void => {
    const activeView = activeTabId === undefined ? undefined : views.current.get(activeTabId)
    for (const [tabId, view] of views.current) {
      if (tabId === activeTabId) continue
      view.togglePassthrough(true)
      view.toggleHidden(true)
    }
    if (activeView === undefined) return
    activeView.togglePassthrough(false)
    activeView.toggleHidden(false)
    activeView.syncDimensions(true)
  }, [])

  const revealNativeTab = useCallback((tabId: BrowserTabId | undefined): void => {
    selectedTabIdRef.current = tabId
    setSelectedTabId(tabId)
    syncNativeViews(tabId)
  }, [syncNativeViews])

  useEffect(() => {
    if (activeTabId !== selectedTabIdRef.current) revealNativeTab(activeTabId)
  }, [activeTabId, revealNativeTab])

  const applyTabs = useCallback((nextTabs: readonly BrowserTab[], id: BrowserSessionId, publishBrowser: boolean): void => {
    setTabs(nextTabs)
    const selected = selectedTabIdRef.current
    const resolved = nextTabs.some(tab => tab.tabId === selected)
      ? selected
      : nextTabs.find(tab => tab.active)?.tabId ?? nextTabs[0]?.tabId
    if (resolved !== selected) revealNativeTab(resolved)
    if (publishBrowser) setBrowser(id, resolved)
    else setActiveTabId(resolved)
    const tab = nextTabs.find(candidate => candidate.tabId === resolved)
    if (tab !== undefined) setAddress(tab.url)
  }, [revealNativeTab, setActiveTabId, setBrowser])

  const refresh = async (id: BrowserSessionId): Promise<void> => {
    const result = await remote.browserList({ sessionId, browserId: id })
    if (!result.ok) { setError(result.error.message); return }
    applyTabs(result.value.tabs, id, false)
  }

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      let id = browserId
      if (id === undefined) {
        const created = await remote.browserCreate({ sessionId, provider: 'playwright' })
        if (!created.ok) { if (!controller.signal.aborted) setError(created.error.message); return }
        id = created.value.browserId
        if (!controller.signal.aborted) setBrowser(id, undefined)
      }
      const listed = await remote.browserList({ sessionId, browserId: id })
      if (!listed.ok) { if (!controller.signal.aborted) setError(listed.error.message); return }
      if (listed.value.tabs.length === 0) {
        const opened = await remote.browserOpen({ sessionId, browserId: id, url: NEW_TAB_URL })
        if (!opened.ok) { if (!controller.signal.aborted) setError(opened.error.message); return }
      }
      if (controller.signal.aborted) return
      await refresh(id)
      for await (const frame of remote.browserFollow({ sessionId, provider: 'playwright' }, controller.signal)) {
        if (isAborted(controller.signal)) return
        applyTabs(frame.tabs, frame.browserId, true)
      }
    })().catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
    })
    return () => {
      controller.abort()
      for (const cleanup of viewCleanups.current.values()) cleanup()
      viewCleanups.current.clear()
      views.current.clear()
      lastMirroredNativeUrls.current.clear()
    }
  }, [sessionId])

  useEffect(() => {
    syncNativeViews(current?.tabId)
  }, [current?.tabId, syncNativeViews, tabs.length])

  useEffect(() => {
    const viewport = viewportRef.current
    const tabId = current?.tabId
    if (!native || viewport === null || tabId === undefined) return
    const sync = (): void => { views.current.get(tabId)?.syncDimensions(true) }
    sync()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sync)
      return () => { window.removeEventListener('resize', sync) }
    }
    const observer = new ResizeObserver(sync)
    observer.observe(viewport)
    return () => { observer.disconnect() }
  }, [native, current?.tabId])

  const enqueueNative = useCallback((tabId: BrowserTabId, operation: () => Promise<void>): void => {
    const previous = nativeQueues.current.get(tabId) ?? Promise.resolve()
    const next = previous.then(operation).catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : String(failure))
    })
    nativeQueues.current.set(tabId, next)
  }, [])

  const mirrorNativeNavigation = useCallback((tabId: BrowserTabId, view: NativeBrowserElement, url: string): void => {
    if (browserId === undefined || url.length === 0) return
    enqueueNative(tabId, async () => {
      if (lastMirroredNativeUrls.current.get(tabId) === url) {
        view.executeJavascript(OBSERVATION_SCRIPT)
        return
      }
      const tab = tabsRef.current.find(candidate => candidate.tabId === tabId)
      if (tab?.url !== url) {
        const result = await remote.browserNavigate({ sessionId, browserId, tabId, url })
        if (!result.ok) throw new Error(result.error.message)
      }
      lastMirroredNativeUrls.current.set(tabId, url)
      view.executeJavascript(OBSERVATION_SCRIPT)
    })
  }, [browserId, enqueueNative, remote, sessionId])

  const attachNativeView = useCallback((tabId: BrowserTabId, view: NativeBrowserElement | null): void => {
    viewCleanups.current.get(tabId)?.()
    viewCleanups.current.delete(tabId)
    if (view === null) {
      views.current.delete(tabId)
      lastMirroredNativeUrls.current.delete(tabId)
      return
    }
    views.current.set(tabId, view)
    syncNativeViews(selectedTabIdRef.current)
    const tab = tabsRef.current.find(candidate => candidate.tabId === tabId)
    if (tab !== undefined) lastMirroredNativeUrls.current.set(tabId, tab.url)
    const navigate = (event: CustomEvent<unknown>): void => {
      const url = eventUrl(event)
      if (url !== undefined) mirrorNativeNavigation(tabId, view, url)
    }
    const ready = (): void => {
      syncNativeViews(selectedTabIdRef.current)
      view.executeJavascript(OBSERVATION_SCRIPT)
    }
    const message = (event: CustomEvent<unknown>): void => {
      const observation = nativeObservation(event)
      if (observation === undefined || browserId === undefined) return
      enqueueNative(tabId, async () => {
        const [canGoBack, canGoForward] = await Promise.all([view.canGoBack(), view.canGoForward()])
        const result = await remote.browserObserve({
          sessionId, browserId, tabId,
          title: observation.title, url: observation.url, snapshot: observation.snapshot,
          canGoBack, canGoForward,
        })
        if (!result.ok) throw new Error(result.error.message)
      })
    }
    const newWindow = (event: CustomEvent<unknown>): void => {
      const url = eventUrl(event)
      if (url === undefined || browserId === undefined) return
      enqueueNative(tabId, async () => {
        const result = await remote.browserOpen({ sessionId, browserId, url })
        if (!result.ok) throw new Error(result.error.message)
      })
    }
    view.on('did-navigate', navigate)
    view.on('did-navigate-in-page', navigate)
    view.on('dom-ready', ready)
    view.on('load-finished', ready)
    view.on('host-message', message)
    view.on('new-window-open', newWindow)
    viewCleanups.current.set(tabId, () => {
      view.off('did-navigate', navigate)
      view.off('did-navigate-in-page', navigate)
      view.off('dom-ready', ready)
      view.off('load-finished', ready)
      view.off('host-message', message)
      view.off('new-window-open', newWindow)
    })
  }, [browserId, enqueueNative, mirrorNativeNavigation, remote, sessionId, syncNativeViews])

  const navigate = async (url: string): Promise<void> => {
    if (browserId === undefined || current === undefined || url.length === 0) return
    const view = views.current.get(current.tabId)
    if (view !== undefined) {
      view.loadURL(url)
      setError(undefined)
      return
    }
    const result = await remote.browserNavigate({ sessionId, browserId, tabId: current.tabId, url })
    if (!result.ok) { setError(result.error.message); return }
    setError(undefined)
    await refresh(browserId)
  }

  const command = async (action: 'back' | 'forward' | 'reload'): Promise<void> => {
    if (browserId === undefined || current === undefined) return
    const view = views.current.get(current.tabId)
    if (view !== undefined) {
      if (action === 'back') view.goBack()
      else if (action === 'forward') view.goForward()
      else view.reload()
      setError(undefined)
      return
    }
    const request = { sessionId, browserId, tabId: current.tabId }
    const result = action === 'back'
      ? await remote.browserBack(request)
      : action === 'forward'
        ? await remote.browserForward(request)
        : await remote.browserReload(request)
    if (!result.ok) setError(result.error.message)
    else await refresh(browserId)
  }

  const addTab = async (): Promise<void> => {
    if (browserId === undefined) return
    const result = await remote.browserOpen({ sessionId, browserId, url: NEW_TAB_URL })
    if (!result.ok) setError(result.error.message)
    else { setActiveTabId(result.value.tab.tabId); await refresh(browserId) }
  }

  const closeTab = async (tabId: BrowserTabId): Promise<void> => {
    if (browserId === undefined) return
    const result = await remote.browserCloseTab({ sessionId, browserId, tabId })
    if (!result.ok) setError(result.error.message)
    else await refresh(browserId)
  }

  const selectTab = async (tabId: BrowserTabId): Promise<void> => {
    if (browserId === undefined) return
    const previousTabId = selectedTabIdRef.current
    revealNativeTab(tabId)
    setActiveTabId(tabId)
    const result = await remote.browserSelectTab({ sessionId, browserId, tabId })
    if (!result.ok) {
      if (selectedTabIdRef.current === tabId) {
        revealNativeTab(previousTabId)
        setActiveTabId(previousTabId)
      }
      setError(result.error.message)
    } else {
      setError(undefined)
      await refresh(browserId)
    }
  }

  const viewport = current === undefined
    ? <div className={css.muted}>{t('browserNewTab')}</div>
    : <div ref={viewportRef} className={css.browserViewport} role="application" aria-label={t('browserViewport')}>
      {partition !== undefined && browserId !== undefined
        ? tabs.map(tab => <NativeBrowserView
          key={tab.tabId}
          tab={tab}
          partition={partition}
          active={tab.tabId === current.tabId}
          attach={attachNativeView}
        />)
        : <iframe className={css.browserFrame} src={current.url} title={current.title || current.url} referrerPolicy="no-referrer" />}
    </div>

  return <section className={css.panel} aria-label={t('browser')}>
    <div className={css.tabs} role="tablist">
      {tabs.map(tab => <div key={tab.tabId} className={css.tab} data-active={tab.tabId === current?.tabId} role="tab">
        <button type="button" onClick={() => { void selectTab(tab.tabId) }}>{tab.title || tab.url}</button>
        <button type="button" className={css.tabClose} aria-label={t('browserCloseTab')} onClick={() => { void closeTab(tab.tabId) }}>×</button>
      </div>)}
      <button type="button" className={css.tab} aria-label={t('browserNewTab')} onClick={() => { void addTab() }}>＋</button>
    </div>
    <form className={css.toolbar} onSubmit={(event) => { event.preventDefault(); void navigate(address.trim()) }}>
      <button type="button" aria-label={t('browserBack')} disabled={!current?.canGoBack} onClick={() => { void command('back') }}>‹</button>
      <button type="button" aria-label={t('browserForward')} disabled={!current?.canGoForward} onClick={() => { void command('forward') }}>›</button>
      <button type="button" aria-label={t('browserReload')} disabled={current === undefined} onClick={() => { void command('reload') }}>↻</button>
      <input
        className={css.address}
        aria-label={t('browserAddress')}
        value={address}
        onChange={(event) => { setAddress(event.target.value) }}
      />
      <button type="submit" aria-label={t('browserOpen')} disabled={current === undefined}>↵</button>
    </form>
    {error === undefined ? null : <div className={css.error} role="alert">{error}</div>}
    {viewport}
  </section>
}
