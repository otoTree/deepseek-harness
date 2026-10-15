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
  loading: true,
  attachmentUrl: 'about:blank#dsh-native-first',
  active: true,
  canGoBack: true,
  canGoForward: true,
}
const secondTabId = 'tab-2' as BrowserTabId
const secondTab: BrowserTab = {
  tabId: secondTabId,
  title: 'Second page',
  url: 'https://example.org',
  attachmentUrl: 'about:blank#dsh-native-second',
  loading: false,
  active: false,
  canGoBack: false,
  canGoForward: false,
}

class MockElectrobunWebview extends HTMLElement {
  webviewId: number | null = null
  nativeHidden = false
  nativeTransparent = false
  nativePassthrough = false
  private readonly listeners = new Map<string, Set<(event: CustomEvent<unknown>) => void>>()
  readonly executed: string[] = []
  readonly hiddenValues: boolean[] = []
  readonly passthroughValues: boolean[] = []
  readonly transparentValues: boolean[] = []
  readonly dimensionForces: Array<boolean | undefined> = []
  readonly loadedUrls: string[] = []
  backCalls = 0
  forwardCalls = 0
  reloadCalls = 0
  offCalls = 0
  initialize(): void {
    this.nativeTransparent = this.hasAttribute('transparent')
    this.nativePassthrough = this.hasAttribute('passthrough')
    this.webviewId = 1
    this.id = 'electrobun-webview-1'
  }
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
  toggleHidden(value = false): void {
    if (this.webviewId === null) return
    this.hiddenValues.push(value)
    this.nativeHidden = value
  }
  toggleTransparent(value = false): void {
    if (this.webviewId === null) return
    this.transparentValues.push(value)
    this.nativeTransparent = value
    this.style.opacity = value ? '0' : ''
  }
  togglePassthrough(value = false): void {
    if (this.webviewId === null) return
    this.passthroughValues.push(value)
    this.nativePassthrough = value
  }
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
  vi.useRealTimers()
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
  const browserAttach = vi.fn(() => successful({ tab: initialTab }))
  const browserScreenshot = vi.fn()
  const browserObserve = vi.fn(() => successful({ tab: initialTab }))
  const browserBack = vi.fn(() => successful({ tab: initialTab }))
  const browserForward = vi.fn(() => successful({ tab: initialTab }))
  const browserReload = vi.fn(() => successful({ tab: initialTab }))
  const browserSelectTab = vi.fn(() => successful({ tab: initialTab }))
  const browserOpen = vi.fn(() => successful({ tab }))
  const browserList = vi.fn(() => successful({ tabs: initialTabs }))
  const remote = {
    browserOpen,
    browserAttach,
    browserScreenshot,
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
    remote, browserAttach, browserScreenshot, browserOpen, browserList, browserNavigate, browserObserve,
    browserBack, browserForward, browserReload, browserSelectTab, pushFollow,
  }
}

function mount(h: ReturnType<typeof remoteHarness>, visible = true) {
  let generation = 1
  function Panel({ shown }: { shown: boolean }) {
    const [id, setId] = useState('stale-browser' as BrowserSessionId)
    const [active, setActive] = useState<BrowserTabId | undefined>(tabId)
    return <BrowserPanel t={key => key} remote={h.remote} sessionId={sessionId}
      initializationTimeoutMs={5000} connectionGeneration={generation}
      visible={shown} browserId={id} activeTabId={active} setBrowser={setId}
      setActiveTabId={setActive} reconnect={vi.fn()} />
  }
  const result = render(<Panel shown={visible} />)
  return {
    ...result,
    show: (shown: boolean) => { result.rerender(<Panel shown={shown} />) },
    reconnect: () => { generation += 1; result.rerender(<Panel shown={visible} />) },
  }
}

async function nativeView(container: HTMLElement) {
  await waitFor(() => { expect(container.querySelector('electrobun-webview')).not.toBeNull() })
  const view = container.querySelector('electrobun-webview') as MockElectrobunWebview
  await act(async () => {
    for (const element of container.querySelectorAll('electrobun-webview')) {
      const native = element as MockElectrobunWebview
      if (native.webviewId === null) native.initialize()
    }
  })
  return view
}

describe('BrowserPanel embedded Chromium', () => {
  it('keeps a newly created native view invisible on Start before any page readiness event', async () => {
    const h = remoteHarness()
    const ui = mount(h, false)
    await waitFor(() => { expect(ui.container.querySelector('electrobun-webview')).not.toBeNull() })
    const view = ui.container.querySelector('electrobun-webview') as MockElectrobunWebview
    expect(view.webviewId).toBeNull()
    expect(view.hasAttribute('transparent')).toBe(true)
    expect(view.hasAttribute('passthrough')).toBe(true)
    await act(async () => { view.initialize() })
    expect(view.nativeHidden).toBe(true)
    expect(view.nativeTransparent).toBe(true)
    expect(view.nativePassthrough).toBe(true)
    ui.show(true)
    expect(ui.container.querySelector('electrobun-webview')).toBe(view)
    expect(view.nativeHidden).toBe(false)
    expect(view.nativeTransparent).toBe(false)
    expect(view.nativePassthrough).toBe(false)
    ui.show(false)
    expect(view.nativeHidden).toBe(true)
    expect(view.nativeTransparent).toBe(true)
    expect(view.nativePassthrough).toBe(true)
    ui.unmount()
    const calls = view.hiddenValues.length
    await act(async () => { view.id = 'electrobun-webview-disposed' })
    expect(view.hiddenValues).toHaveLength(calls)
  })

  it('uses the latest visibility when native initialization finishes after a panel switch', async () => {
    const h = remoteHarness()
    const ui = mount(h)
    await waitFor(() => { expect(ui.container.querySelector('electrobun-webview')).not.toBeNull() })
    const view = ui.container.querySelector('electrobun-webview') as MockElectrobunWebview
    ui.show(false)
    await act(async () => { view.initialize() })
    expect(view.nativeHidden).toBe(true)
    expect(view.nativeTransparent).toBe(true)
    expect(view.nativePassthrough).toBe(true)
    ui.show(true)
    expect(view.nativeHidden).toBe(false)
    expect(view.nativeTransparent).toBe(false)
  })

  it('mounts a sandboxed native page and attaches the discovered tab without screenshot polling', async () => {
    const h = remoteHarness()
    const { container } = mount(h)
    const view = await nativeView(container)
    expect(view.getAttribute('src')).toBe(tab.attachmentUrl)
    expect(view.nativeHidden).toBe(false)
    expect(view.nativeTransparent).toBe(false)
    expect(view.nativePassthrough).toBe(false)
    expect(view.getAttribute('renderer')).toBe('cef')
    expect(view.hasAttribute('sandbox')).toBe(true)
    expect(view.getAttribute('partition')).toBe(`${runtimePartition}-${sessionId}`)
    expect(container.querySelector('img, iframe')).toBeNull()
    await act(async () => { view.emit('dom-ready', {}); view.emit('load-finished', {}) })
    expect(h.browserAttach).toHaveBeenCalledExactlyOnceWith({ sessionId, browserId, tabId })
    expect(h.browserScreenshot).not.toHaveBeenCalled()
    expect(h.browserNavigate).not.toHaveBeenCalled()
    expect(view.executed.length).toBeGreaterThan(0)
  })

  it('sends toolbar navigation and history to the attached provider identity', async () => {
    const h = remoteHarness()
    const { container } = mount(h)
    const view = await nativeView(container)
    fireEvent.change(screen.getByRole('textbox', { name: 'browserAddress' }), { target: { value: 'example.org/path' } })
    fireEvent.click(screen.getByRole('button', { name: 'browserOpen' }))
    await waitFor(() => { expect(h.browserNavigate).toHaveBeenCalledWith({ sessionId, browserId, tabId, url: 'https://example.org/path' }) })
    for (const [name, method] of [['browserBack', h.browserBack], ['browserForward', h.browserForward], ['browserReload', h.browserReload]] as const) {
      fireEvent.click(screen.getByRole('button', { name }))
      await waitFor(() => { expect(method).toHaveBeenCalledWith({ sessionId, browserId, tabId }) })
    }
    expect(view.loadedUrls).toEqual([])
    expect(view.backCalls + view.forwardCalls + view.reloadCalls).toBe(0)
  })

  it('observes manual changes without loading the URL a second time', async () => {
    const h = remoteHarness()
    const { container } = mount(h)
    const view = await nativeView(container)
    const observation = { type: 'dsh-browser-observation', title: 'Manual edit', url: 'https://example.com/form', snapshot: '- textbox "中文"' }
    await act(async () => { view.emit('host-message', JSON.stringify(observation)) })
    await waitFor(() => { expect(h.browserObserve).toHaveBeenCalledExactlyOnceWith({
      sessionId, browserId, tabId, title: observation.title, url: observation.url,
      snapshot: observation.snapshot, canGoBack: true, canGoForward: false,
    }) })
    expect(h.browserNavigate).not.toHaveBeenCalled()
  })

  it('keeps native elements mounted across panel visibility and provider tab changes', async () => {
    const h = remoteHarness([tab, secondTab])
    const ui = mount(h)
    const first = await nativeView(ui.container)
    const second = ui.container.querySelectorAll('electrobun-webview')[1] as MockElectrobunWebview
    ui.show(false)
    expect(first.hiddenValues.at(-1)).toBe(true)
    ui.show(true)
    expect(ui.container.querySelector('electrobun-webview')).toBe(first)
    await act(async () => { h.pushFollow([{ ...tab, active: false }, { ...secondTab, active: true }]) })
    expect(first.hiddenValues.at(-1)).toBe(true)
    expect(second.hiddenValues.at(-1)).toBe(false)
    expect(ui.container.querySelectorAll('electrobun-webview')[1]).toBe(second)
    ui.unmount()
    expect(second.hiddenValues.at(-1)).toBe(true)
    expect(second.offCalls).toBeGreaterThan(0)
  })

  it('recreates an unready native view once with the same persistent partition and target', async () => {
    const h = remoteHarness()
    const ui = mount(h)
    const first = await nativeView(ui.container)
    vi.useFakeTimers()
    // Re-arm the initial document deadline under the test clock.
    ui.unmount()
    const next = mount(h)
    await act(async () => {})
    const pending = next.container.querySelector('electrobun-webview') as MockElectrobunWebview
    await act(async () => { await vi.advanceTimersByTimeAsync(5016) })
    const replacement = next.container.querySelector('electrobun-webview') as MockElectrobunWebview
    expect(replacement).not.toBe(pending)
    expect(replacement.getAttribute('partition')).toBe(first.getAttribute('partition'))
    expect(replacement.getAttribute('src')).toBe(tab.attachmentUrl)
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(next.container.querySelector('electrobun-webview')).toBe(replacement)
    const attempts = h.browserAttach.mock.calls.length
    await act(async () => { replacement.emit('dom-ready', {}) })
    expect(h.browserAttach).toHaveBeenCalledTimes(attempts)
  })

  it('cancels creation recovery after readiness or disposal and retains a ready page on reconnect', async () => {
    const h = remoteHarness()
    vi.useFakeTimers()
    const ui = mount(h)
    await act(async () => {})
    const view = ui.container.querySelector('electrobun-webview') as MockElectrobunWebview
    await act(async () => { view.emit('dom-ready', {}) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(ui.container.querySelector('electrobun-webview')).toBe(view)
    ui.reconnect()
    await act(async () => {})
    expect(ui.container.querySelector('electrobun-webview')).toBe(view)
    await act(async () => { view.emit('host-message', { type: 'dsh-browser-observation', title: 'Still live', url: 'https://example.com', snapshot: '- text "retained"' }) })
    expect(h.browserObserve).toHaveBeenCalledOnce()
    ui.unmount()
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => { view.emit('host-message', { type: 'dsh-browser-observation', title: 'Disposed', url: 'https://example.com', snapshot: '' }) })
    expect(h.browserObserve).toHaveBeenCalledOnce()
  })

  it('waits for the hidden window to render before timing native initialization', async () => {
    vi.useFakeTimers()
    let firstFrame: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { firstFrame = callback; return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => { firstFrame = undefined })
    const h = remoteHarness()
    const ui = mount(h)
    await act(async () => {})
    const view = ui.container.querySelector('electrobun-webview')
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(ui.container.querySelector('electrobun-webview')).toBe(view)
    await act(async () => { firstFrame?.(performance.now()) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(ui.container.querySelector('electrobun-webview')).not.toBe(view)
  })

  it('requires the trusted Runtime identity and never substitutes an image or iframe', async () => {
    vi.stubGlobal('__dshNative', undefined)
    const h = remoteHarness()
    const { container } = mount(h)
    await screen.findByText('browserUnavailable')
    expect(container.querySelector('electrobun-webview, img, iframe')).toBeNull()
    await act(async () => {
      vi.stubGlobal('__dshNative', { runtimeStorageIdentity })
      window.dispatchEvent(new Event('dsh-native-bridge-ready'))
    })
    await nativeView(container)
  })

  it('creates a blank tab only for an empty baseline and rejects script addresses', async () => {
    const h = remoteHarness()
    mount(h)
    await screen.findByRole('application')
    fireEvent.change(screen.getByRole('textbox', { name: 'browserAddress' }), { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'browserOpen' }))
    expect(screen.getByRole('alert').textContent).toContain('browserInvalidAddress')
    expect(h.browserNavigate).not.toHaveBeenCalled()
    const replacement = 'browser-2' as BrowserSessionId
    await act(async () => { h.pushFollow([], replacement, 'baseline') })
    expect(h.browserOpen).toHaveBeenCalledExactlyOnceWith({ sessionId, browserId: replacement, url: 'about:blank' })
    await act(async () => { h.pushFollow([], replacement) })
    expect(h.browserOpen).toHaveBeenCalledTimes(1)
  })
})
