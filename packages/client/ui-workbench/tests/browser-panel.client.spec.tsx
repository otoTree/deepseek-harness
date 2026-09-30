// @vitest-environment jsdom

import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchRemote } from '@deepseek-ai/dsh-api-workbench-controller/client'
import type { BrowserSessionId, BrowserTab, BrowserTabId } from '@deepseek-ai/dsh-api-workbench-controller/types'
import { BrowserPanel } from '../src/client/panels/BrowserPanel.tsx'

const sessionId = 'session' as SessionId
const browserId = 'browser-1' as BrowserSessionId
const runtimeStorageIdentity = 'a'.repeat(64)
const runtimePartition = `persist:dsh-workbench-runtime-${runtimeStorageIdentity}`
const tabId = 'tab-1' as BrowserTabId
const tab: BrowserTab = {
  tabId,
  title: 'Interactive page',
  url: 'https://example.com',
  loading: false,
  active: true,
  canGoBack: false,
  canGoForward: false,
}
const secondTabId = 'tab-2' as BrowserTabId
const secondTab: BrowserTab = {
  tabId: secondTabId,
  title: 'Second page',
  url: 'https://example.org',
  loading: false,
  active: false,
  canGoBack: false,
  canGoForward: false,
}

class MockElectrobunWebview extends HTMLElement {
  private readonly listeners = new Map<string, Set<(event: CustomEvent<unknown>) => void>>()
  readonly executed: string[] = []
  readonly hiddenValues: boolean[] = []
  readonly passthroughValues: boolean[] = []
  readonly dimensionForces: Array<boolean | undefined> = []
  readonly loadedUrls: string[] = []
  backCalls = 0
  forwardCalls = 0
  reloadCalls = 0
  offCalls = 0
  on(event: string, listener: (event: CustomEvent<unknown>) => void): void {
    const group = this.listeners.get(event) ?? new Set()
    group.add(listener)
    this.listeners.set(event, group)
  }
  off(event: string, listener: (event: CustomEvent<unknown>) => void): void {
    this.offCalls += 1
    this.listeners.get(event)?.delete(listener)
  }
  emit(event: string, detail: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(new CustomEvent(event, { detail }))
  }
  canGoBack(): Promise<boolean> { return Promise.resolve(true) }
  canGoForward(): Promise<boolean> { return Promise.resolve(false) }
  goBack(): void { this.backCalls += 1 }
  goForward(): void { this.forwardCalls += 1 }
  loadURL(url: string): void { this.loadedUrls.push(url) }
  reload(): void { this.reloadCalls += 1 }
  toggleHidden(value = false): void { this.hiddenValues.push(value) }
  togglePassthrough(value = false): void { this.passthroughValues.push(value) }
  syncDimensions(force?: boolean): void { this.dimensionForces.push(force) }
  executeJavascript(script: string): void { this.executed.push(script) }
}

if (customElements.get('electrobun-webview') === undefined) customElements.define('electrobun-webview', MockElectrobunWebview)

class MockResizeObserver {
  static instances: MockResizeObserver[] = []
  readonly observe = vi.fn()
  readonly disconnect = vi.fn()
  constructor(private readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this)
  }
  resize(): void { this.callback([], this as unknown as ResizeObserver) }
}

beforeEach(() => {
  vi.stubGlobal('__dshNative', Object.freeze({ runtimeStorageIdentity }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  MockResizeObserver.instances.length = 0
})

function successful(value: unknown) { return Promise.resolve({ ok: true as const, value }) }

function remoteHarness(initial: BrowserTab | readonly BrowserTab[] = tab) {
  const initialTabs = Array.isArray(initial) ? initial : [initial]
  const initialTab = initialTabs[0] as BrowserTab
  type FollowFrame = { type: 'baseline' | 'state'; browserId: BrowserSessionId; tabs: readonly BrowserTab[] }
  const queuedFrames: FollowFrame[] = []
  let frameWaiter: ((frame: FollowFrame | undefined) => void) | undefined
  const browserNavigate = vi.fn((request: { url: string }) => successful({ tab: { ...initialTab, url: request.url } }))
  const browserObserve = vi.fn(() => successful({ tab: initialTab }))
  const browserBack = vi.fn(() => successful({ tab: initialTab }))
  const browserForward = vi.fn(() => successful({ tab: initialTab }))
  const browserReload = vi.fn(() => successful({ tab: initialTab }))
  const browserSelectTab = vi.fn(() => successful({ tab: initialTab }))
  const browserOpen = vi.fn(() => successful({ tab }))
  const browserList = vi.fn(() => successful({ tabs: initialTabs }))
  const remote = {
    browserOpen,
    browserList,
    browserNavigate,
    browserObserve,
    browserBack,
    browserForward,
    browserReload,
    browserSelectTab,
    browserFollow: (_request: unknown, signal?: AbortSignal) => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'baseline', browserId, revision: 0, tabs: initialTabs }
        while (signal?.aborted !== true) {
          const queued = queuedFrames.shift()
          const frame = queued ?? await new Promise<FollowFrame | undefined>((resolve) => {
            frameWaiter = resolve
            signal?.addEventListener('abort', () => { resolve(undefined) }, { once: true })
          })
          if (frame === undefined) return
          frameWaiter = undefined
          yield frame
        }
      },
    }),
  } as unknown as WorkbenchRemote
  const pushFollow = (tabs: readonly BrowserTab[], id = browserId, type: 'baseline' | 'state' = 'state'): void => {
    const frame = { type, browserId: id, tabs }
    if (frameWaiter !== undefined) {
      const resolve = frameWaiter
      frameWaiter = undefined
      resolve(frame)
    } else {
      queuedFrames.push(frame)
    }
  }
  return {
    remote, browserOpen, browserList, browserNavigate, browserObserve, browserBack, browserForward, browserReload,
    browserSelectTab, pushFollow,
  }
}

describe('BrowserPanel native viewport', () => {
  it('replaces a cached browser id from the live baseline before sending actions', async () => {
    const { remote, browserNavigate, browserList } = remoteHarness()
    function Panel() {
      const [id, setId] = useState('stale-browser' as BrowserSessionId)
      return <BrowserPanel t={key => key} remote={remote} sessionId={sessionId}
        browserId={id} activeTabId={tabId} setBrowser={setId} setActiveTabId={vi.fn()} reconnect={vi.fn()} />
    }
    const { container } = render(<Panel />)
    await screen.findByRole('application', { name: 'browserViewport' })
    const view = container.querySelector('electrobun-webview') as MockElectrobunWebview
    view.emit('did-navigate', 'https://example.com/recovered')
    await waitFor(() => { expect(browserNavigate).toHaveBeenCalledWith({
      sessionId, browserId, tabId, url: 'https://example.com/recovered',
    }) })
    expect(browserList).not.toHaveBeenCalled()
  })

  it('opens a blank tab for an empty replacement baseline but respects closing all tabs', async () => {
    const { remote, browserOpen, pushFollow } = remoteHarness()
    const setBrowser = vi.fn()
    render(<BrowserPanel t={key => key} remote={remote} sessionId={sessionId}
      browserId={browserId} activeTabId={tabId} setBrowser={setBrowser} setActiveTabId={vi.fn()} reconnect={vi.fn()} />)
    await screen.findByRole('application', { name: 'browserViewport' })
    const replacement = 'browser-2' as BrowserSessionId
    await act(async () => { pushFollow([], replacement, 'baseline') })
    expect(browserOpen).toHaveBeenCalledExactlyOnceWith({ sessionId, browserId: replacement, url: 'about:blank' })
    expect(setBrowser).toHaveBeenLastCalledWith(replacement, undefined)
    await act(async () => { pushFollow([], replacement) })
    expect(browserOpen).toHaveBeenCalledTimes(1)
  })

  it('falls back to the web browser when the native Runtime identity is unavailable', async () => {
    vi.stubGlobal('__dshNative', Object.freeze({ runtimeStorageIdentity: 'session' }))
    const { remote } = remoteHarness()
    const { container } = render(<BrowserPanel
      reconnect={vi.fn()}
      t={key => key}
      remote={remote}
      sessionId={sessionId}
      browserId={browserId}
      activeTabId={tabId}
      setBrowser={vi.fn()}
      setActiveTabId={vi.fn()}
    />)
    await screen.findByRole('application', { name: 'browserViewport' })
    expect(container.querySelector('electrobun-webview')).toBeNull()
    expect(container.querySelector('iframe')).not.toBeNull()
  })

  it('does not select the native renderer when the host bridge is not installed yet', async () => {
    vi.stubGlobal('__dshNative', undefined)
    const { remote } = remoteHarness()
    const { container } = render(<BrowserPanel
      reconnect={vi.fn()}
      t={key => key}
      remote={remote}
      sessionId={sessionId}
      browserId={browserId}
      activeTabId={tabId}
      setBrowser={vi.fn()}
      setActiveTabId={vi.fn()}
    />)
    await screen.findByRole('application', { name: 'browserViewport' })
    expect(container.querySelector('electrobun-webview')).toBeNull()
    expect(container.querySelector('iframe')).not.toBeNull()
  })

  it('switches to the native renderer when the host bridge becomes ready', async () => {
    vi.stubGlobal('__dshNative', undefined)
    const { remote } = remoteHarness()
    const { container } = render(<BrowserPanel
      reconnect={vi.fn()}
      t={key => key}
      remote={remote}
      sessionId={sessionId}
      browserId={browserId}
      activeTabId={tabId}
      setBrowser={vi.fn()}
      setActiveTabId={vi.fn()}
    />)
    await screen.findByRole('application', { name: 'browserViewport' })
    expect(container.querySelector('iframe')).not.toBeNull()
    vi.stubGlobal('__dshNative', Object.freeze({ runtimeStorageIdentity }))
    await act(async () => { window.dispatchEvent(new Event('dsh-native-bridge-ready')) })
    await waitFor(() => { expect(container.querySelector('electrobun-webview')).not.toBeNull() })
  })

  it('shares persistent storage across Browser contexts in one Runtime and isolates another Runtime', async () => {
    const renderContext = async (id: BrowserSessionId, owner: SessionId = sessionId): Promise<string | null> => {
      const { remote } = remoteHarness()
      const result = render(<BrowserPanel
        reconnect={vi.fn()}
        t={key => key}
        remote={remote}
        sessionId={owner}
        browserId={id}
        activeTabId={tabId}
        setBrowser={vi.fn()}
        setActiveTabId={vi.fn()}
      />)
      await screen.findByRole('application', { name: 'browserViewport' })
      const partition = result.container.querySelector('electrobun-webview')?.getAttribute('partition') ?? null
      result.unmount()
      return partition
    }

    expect(await renderContext(browserId)).toBe(runtimePartition)
    expect(await renderContext('browser-2' as BrowserSessionId, 'session-2' as SessionId)).toBe(runtimePartition)

    const otherIdentity = 'b'.repeat(64)
    vi.stubGlobal('__dshNative', Object.freeze({ runtimeStorageIdentity: otherIdentity }))
    expect(await renderContext(browserId)).toBe(`persist:dsh-workbench-runtime-${otherIdentity}`)
  })

  it('resynchronizes the active native view when its viewport changes size', async () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    const { remote } = remoteHarness()
    const { container, unmount } = render(<BrowserPanel
      reconnect={vi.fn()}
      t={key => key}
      remote={remote}
      sessionId={sessionId}
      browserId={browserId}
      activeTabId={tabId}
      setBrowser={vi.fn()}
      setActiveTabId={vi.fn()}
    />)

    const viewport = await screen.findByRole('application', { name: 'browserViewport' })
    const view = container.querySelector('electrobun-webview') as MockElectrobunWebview
    expect(view.style.position).toBe('absolute')
    expect(view.style.inset).toBe('0px')
    expect(view.style.width).toBe('100%')
    expect(view.style.height).toBe('100%')
    expect(view.style.display).toBe('block')
    const observer = MockResizeObserver.instances[0]
    expect(observer).toBeDefined()
    expect(observer?.observe).toHaveBeenCalledWith(viewport)
    const beforeResize = view.dimensionForces.length
    observer?.resize()
    expect(view.dimensionForces).toHaveLength(beforeResize + 1)
    expect(view.dimensionForces.at(-1)).toBe(true)

    unmount()
    expect(observer?.disconnect).toHaveBeenCalledOnce()
  })

  it('renders a real Electrobun WebView and mirrors navigation and semantic content', async () => {
    const { remote, browserNavigate, browserObserve } = remoteHarness()
    const setBrowser = vi.fn()
    const setActiveTabId = vi.fn()
    const panel = <BrowserPanel
      reconnect={vi.fn()}
      t={key => key}
      remote={remote}
      sessionId={sessionId}
      browserId={browserId}
      activeTabId={tabId}
      setBrowser={setBrowser}
      setActiveTabId={setActiveTabId}
    />
    const { container, rerender } = render(panel)

    await screen.findByRole('application', { name: 'browserViewport' })
    const view = container.querySelector('electrobun-webview') as MockElectrobunWebview
    expect(view).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    expect(view.getAttribute('sandbox')).toBe('')
    expect(view.getAttribute('partition')).toBe(runtimePartition)
    rerender(panel)
    expect(view.offCalls).toBe(0)

    view.emit('dom-ready', 'https://example.com')
    expect(view.executed.some(script => script.includes('dsh-browser-observation'))).toBe(true)

    view.emit('host-message', JSON.stringify({
      type: 'dsh-browser-observation',
      title: 'Observed title',
      url: 'https://example.com',
      snapshot: '- document "Observed title"\n- heading "Example"',
    }))
    await waitFor(() => {
      expect(browserObserve).toHaveBeenCalledWith({
        sessionId,
        browserId,
        tabId,
        title: 'Observed title',
        url: 'https://example.com',
        snapshot: '- document "Observed title"\n- heading "Example"',
        canGoBack: true,
        canGoForward: false,
      })
    })

    view.emit('did-navigate', 'https://example.com/next')
    await waitFor(() => {
      expect(browserNavigate).toHaveBeenCalledWith({ sessionId, browserId, tabId, url: 'https://example.com/next' })
    })
  })

  it('keeps inactive native views hidden and input-transparent across late readiness events', async () => {
    const { remote, browserSelectTab } = remoteHarness([tab, secondTab])
    const { container } = render(<BrowserPanel
      reconnect={vi.fn()}
      t={key => key}
      remote={remote}
      sessionId={sessionId}
      browserId={browserId}
      activeTabId={tabId}
      setBrowser={vi.fn()}
      setActiveTabId={vi.fn()}
    />)

    await screen.findByRole('application', { name: 'browserViewport' })
    const views = [...container.querySelectorAll('electrobun-webview')] as MockElectrobunWebview[]
    const firstView = views.find(view => view.getAttribute('src') === tab.url)
    const secondView = views.find(view => view.getAttribute('src') === secondTab.url)
    expect(firstView?.getAttribute('partition')).toBe(runtimePartition)
    expect(secondView?.getAttribute('partition')).toBe(runtimePartition)
    expect(firstView?.hiddenValues.at(-1)).toBe(false)
    expect(firstView?.passthroughValues.at(-1)).toBe(false)
    expect(secondView?.hiddenValues.at(-1)).toBe(true)
    expect(secondView?.passthroughValues.at(-1)).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: secondTab.title }))
    await waitFor(() => {
      expect(browserSelectTab).toHaveBeenCalledWith({ sessionId, browserId, tabId: secondTabId })
      expect(firstView?.hiddenValues.at(-1)).toBe(true)
      expect(firstView?.passthroughValues.at(-1)).toBe(true)
      expect(secondView?.hiddenValues.at(-1)).toBe(false)
      expect(secondView?.passthroughValues.at(-1)).toBe(false)
    })

    firstView?.emit('dom-ready', undefined)
    firstView?.emit('load-finished', undefined)
    expect(firstView?.hiddenValues.at(-1)).toBe(true)
    expect(firstView?.passthroughValues.at(-1)).toBe(true)
    expect(secondView?.hiddenValues.at(-1)).toBe(false)
    expect(secondView?.passthroughValues.at(-1)).toBe(false)
  })

  it('keeps the native WebView source stable across mirrored URL encoding changes', async () => {
    const encodedUrl = 'https://www.baidu.com/s?wd=a%2Bb%2Fc'
    const doubleEncodedUrl = 'https://www.baidu.com/s?wd=a%252Bb%252Fc'
    const { remote, pushFollow } = remoteHarness({ ...tab, url: encodedUrl })
    const { container } = render(<BrowserPanel
      reconnect={vi.fn()}
      t={key => key}
      remote={remote}
      sessionId={sessionId}
      browserId={browserId}
      activeTabId={tabId}
      setBrowser={vi.fn()}
      setActiveTabId={vi.fn()}
    />)

    await screen.findByRole('application', { name: 'browserViewport' })
    const view = container.querySelector('electrobun-webview') as MockElectrobunWebview
    expect(view.getAttribute('src')).toBe(encodedUrl)
    pushFollow([{ ...tab, url: doubleEncodedUrl }])
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'browserAddress' }).value).toBe(doubleEncodedUrl)
    })
    expect(view.getAttribute('src')).toBe(encodedUrl)
    expect(view.loadedUrls).toEqual([])

    pushFollow([{ ...tab, url: encodedUrl }])
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'browserAddress' }).value).toBe(encodedUrl)
    })
    expect(view.getAttribute('src')).toBe(encodedUrl)
    expect(view.loadedUrls).toEqual([])
  })

  it('loads an address in the native view before mirroring its navigation', async () => {
    const { remote, browserNavigate } = remoteHarness()
    const { container } = render(<BrowserPanel
      reconnect={vi.fn()}
      t={key => key}
      remote={remote}
      sessionId={sessionId}
      browserId={browserId}
      activeTabId={tabId}
      setBrowser={vi.fn()}
      setActiveTabId={vi.fn()}
    />)

    await screen.findByRole('application', { name: 'browserViewport' })
    const view = container.querySelector('electrobun-webview') as MockElectrobunWebview
    const input = screen.getByRole('textbox', { name: 'browserAddress' })
    fireEvent.change(input, { target: { value: 'https://example.com/native' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect(view.loadedUrls).toEqual(['https://example.com/native'])
    expect(browserNavigate).not.toHaveBeenCalled()

    view.emit('did-navigate', 'https://example.com/native')
    await waitFor(() => {
      expect(browserNavigate).toHaveBeenCalledWith({
        sessionId, browserId, tabId, url: 'https://example.com/native',
      })
    })
  })

  it('runs history and reload commands only in the native view', async () => {
    const { remote, browserBack, browserForward, browserReload } = remoteHarness({
      ...tab, canGoBack: true, canGoForward: true,
    })
    const { container } = render(<BrowserPanel
      reconnect={vi.fn()}
      t={key => key}
      remote={remote}
      sessionId={sessionId}
      browserId={browserId}
      activeTabId={tabId}
      setBrowser={vi.fn()}
      setActiveTabId={vi.fn()}
    />)

    await screen.findByRole('application', { name: 'browserViewport' })
    const view = container.querySelector('electrobun-webview') as MockElectrobunWebview
    fireEvent.click(screen.getByRole('button', { name: 'browserBack' }))
    fireEvent.click(screen.getByRole('button', { name: 'browserForward' }))
    fireEvent.click(screen.getByRole('button', { name: 'browserReload' }))
    expect(view.backCalls).toBe(1)
    expect(view.forwardCalls).toBe(1)
    expect(view.reloadCalls).toBe(1)
    expect(browserBack).not.toHaveBeenCalled()
    expect(browserForward).not.toHaveBeenCalled()
    expect(browserReload).not.toHaveBeenCalled()
  })

  it('uses the provider reload command in the Web fallback', async () => {
    vi.spyOn(customElements, 'get').mockReturnValue(undefined)
    const { remote, browserReload } = remoteHarness()
    render(<BrowserPanel
      reconnect={vi.fn()}
      t={key => key}
      remote={remote}
      sessionId={sessionId}
      browserId={browserId}
      activeTabId={tabId}
      setBrowser={vi.fn()}
      setActiveTabId={vi.fn()}
    />)

    await screen.findByRole('application', { name: 'browserViewport' })
    fireEvent.click(screen.getByRole('button', { name: 'browserReload' }))
    await waitFor(() => { expect(browserReload).toHaveBeenCalledWith({ sessionId, browserId, tabId }) })
  })
})
