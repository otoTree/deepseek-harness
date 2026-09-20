import { describe, expect, it } from 'vitest'
import { BrowserTabId } from '@deepseek-ai/dsh-browser'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { PlaywrightBrowserProvider } from '../src/index.ts'

interface FakePageState {
  closed: boolean
  history: string[]
  index: number
  clicks: Array<{ x: number; y: number; clickCount: number }>
  wheels: Array<{ deltaX: number; deltaY: number }>
  inputs: string[]
  keys: string[]
}

interface FakeContextState {
  closed: boolean
  closeError?: Error
  pages: FakePageState[]
}

class TestProvider extends PlaywrightBrowserProvider {
  readonly observedContexts: FakeContextState[] = []
  failNextPage = false

  protected override async launchContext() {
    const context: FakeContextState = { closed: false, pages: [] }
    this.observedContexts.push(context)
    return {
      newPage: async () => {
        if (this.failNextPage) {
          this.failNextPage = false
          throw new Error('new page failed')
        }
        const state: FakePageState = { closed: false, history: ['about:blank'], index: 0, clicks: [], wheels: [], inputs: [], keys: [] }
        context.pages.push(state)
        const navigate = (url: string): void => {
          state.history = state.history.slice(0, state.index + 1)
          state.history.push(url)
          state.index = state.history.length - 1
        }
        return {
          async goto(url: string) { navigate(url) },
          async click() { navigate('https://example.test/clicked') },
          async fill() {},
          async press() { navigate('https://example.test/submitted') },
          async goBack() { if (state.index > 0) state.index -= 1 },
          async goForward() { if (state.index + 1 < state.history.length) state.index += 1 },
          async reload() {},
          async close() { state.closed = true },
          async title() { return new URL(state.history[state.index] ?? 'about:blank').pathname },
          url() { return state.history[state.index] ?? 'about:blank' },
          locator() { return { async ariaSnapshot() { return '- document "Example"' } } },
          mouse: {
            async click(x: number, y: number, options?: { clickCount?: number }) {
              state.clicks.push({ x, y, clickCount: options?.clickCount ?? 1 })
            },
            async wheel(deltaX: number, deltaY: number) { state.wheels.push({ deltaX, deltaY }) },
          },
          keyboard: {
            async insertText(text: string) { state.inputs.push(text) },
            async press(key: string) { state.keys.push(key) },
          },
          async waitForLoadState() {},
          async screenshot() { return Buffer.from([1, 2, 3]) },
        }
      },
      close: async () => {
        context.closed = true
        if (context.closeError !== undefined) throw context.closeError
      },
    }
  }
}

describe('Playwright browser provider', () => {
  it('shares one context across concurrent tabs in a Session and isolates another Session', async () => {
    const provider = new TestProvider()
    const first = SessionId('first')
    const second = SessionId('second')
    await Promise.all([
      provider.open(first, BrowserTabId('first-a'), 'https://example.test/a'),
      provider.open(first, BrowserTabId('first-b'), 'https://example.test/b'),
      provider.open(second, BrowserTabId('second-a'), 'https://example.test/c'),
    ])

    expect(provider.observedContexts).toHaveLength(2)
    expect(provider.observedContexts.map(context => context.pages.length).sort()).toEqual([1, 2])
    await provider.close(first, BrowserTabId('first-a'))
    expect(provider.observedContexts.find(context => context.pages.length === 2)?.closed).toBe(false)
    await provider.close(first, BrowserTabId('first-b'))
    expect(provider.observedContexts.find(context => context.pages.length === 2)?.closed).toBe(true)
    await provider.dispose()
  })

  it('reports navigation history and provider content from the actual page', async () => {
    const provider = new TestProvider()
    const sessionId = SessionId('history')
    const tabId = BrowserTabId('tab')
    await provider.open(sessionId, tabId, 'https://example.test/start')
    await provider.click(sessionId, tabId, '#next')
    await expect(provider.read(sessionId, tabId)).resolves.toMatchObject({
      url: 'https://example.test/clicked', canGoBack: true, canGoForward: false,
    })
    await expect(provider.back(sessionId, tabId)).resolves.toMatchObject({
      url: 'https://example.test/start', canGoBack: false, canGoForward: true,
    })
    await expect(provider.forward(sessionId, tabId)).resolves.toMatchObject({
      url: 'https://example.test/clicked', canGoBack: true, canGoForward: false,
    })
    await expect(provider.snapshot(sessionId, tabId)).resolves.toBe('- document "Example"')
    await expect(provider.screenshot(sessionId, tabId)).resolves.toEqual(Uint8Array.of(1, 2, 3))
    await provider.clickAt(sessionId, tabId, 40, 60, 2)
    await provider.scroll(sessionId, tabId, 0, 120)
    await provider.insertText(sessionId, tabId, 'hello')
    await provider.pressFocused(sessionId, tabId, 'Enter')
    expect(provider.observedContexts[0]?.pages[0]).toMatchObject({
      clicks: [{ x: 40, y: 60, clickCount: 2 }],
      wheels: [{ deltaX: 0, deltaY: 120 }],
      inputs: ['hello'],
      keys: ['Enter'],
    })
    await provider.dispose()
  })

  it('closes an empty context after page creation fails and can retry', async () => {
    const provider = new TestProvider()
    const sessionId = SessionId('rollback')
    const tabId = BrowserTabId('tab')
    provider.failNextPage = true
    await expect(provider.open(sessionId, tabId, 'https://example.test')).rejects.toThrow('new page failed')
    expect(provider.observedContexts).toHaveLength(1)
    expect(provider.observedContexts[0]?.closed).toBe(true)
    await expect(provider.open(sessionId, tabId, 'https://example.test')).resolves.toMatchObject({
      url: 'https://example.test',
    })
    expect(provider.observedContexts).toHaveLength(2)
    await provider.dispose()
  })

  it('aggregates context disposal failures and clears retained state', async () => {
    const provider = new TestProvider()
    const sessionId = SessionId('dispose')
    const tabId = BrowserTabId('tab')
    await provider.open(sessionId, tabId, 'https://example.test')
    const failure = new Error('context close failed')
    if (provider.observedContexts[0] !== undefined) provider.observedContexts[0].closeError = failure
    await expect(provider.dispose()).rejects.toMatchObject({ errors: [failure] })
    await expect(provider.read(sessionId, tabId)).rejects.toThrow('is not open')
  })
})
