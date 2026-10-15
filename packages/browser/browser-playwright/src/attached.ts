/** Playwright control of pages rendered by the desktop's embedded Chromium. */
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type Browser, type Page } from 'playwright'
import type { BrowserProvider, BrowserProviderTab, BrowserTabId } from '@deepseek-ai/dsh-browser'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface EmbeddedTab {
  readonly attachmentUrl: string
  url: string
  page?: Page
  ready?: Promise<Page>
  browser?: Browser
  closed: boolean
}

/** Controls only native pages carrying a registry-issued, unguessable attachment URL. */
export class AttachedBrowserProvider implements BrowserProvider {
  readonly name = 'playwright'
  private readonly tabs = new Map<string, EmbeddedTab>()

  constructor(private readonly endpoint: string, private readonly timeoutMs: number) {
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) {
      throw new Error('browser-playwright: desktopCdpEndpoint must use HTTP on 127.0.0.1')
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('browser-playwright: desktopTimeoutMs must be a positive safe integer')
    }
  }

  async open(sessionId: SessionId, tabId: BrowserTabId, url: string): Promise<BrowserProviderTab> {
    const key = this.key(sessionId, tabId)
    let tab = this.tabs.get(key)
    if (tab === undefined) {
      tab = { attachmentUrl: `about:blank#dsh-native-${randomUUID()}`, url, closed: false }
      this.tabs.set(key, tab)
      return { title: '', url, loading: true, canGoBack: false, canGoForward: false, attachmentUrl: tab.attachmentUrl }
    }
    const page = await this.page(tab)
    await page.goto(url)
    return this.state(tab)
  }

  async close(sessionId: SessionId, tabId: BrowserTabId): Promise<void> {
    const key = this.key(sessionId, tabId)
    const tab = this.tabs.get(key)
    if (tab === undefined) return
    this.tabs.delete(key)
    tab.closed = true
    // The native view owns page destruction; CDP Target.closeTarget can close its host window.
    await tab.ready?.catch(() => undefined)
    await tab.browser?.close()
  }

  async read(sessionId: SessionId, tabId: BrowserTabId): Promise<BrowserProviderTab> {
    return this.state(this.expect(sessionId, tabId))
  }

  async click(sessionId: SessionId, tabId: BrowserTabId, selector: string): Promise<BrowserProviderTab> {
    return this.act(sessionId, tabId, page => page.locator(selector).click())
  }
  async fill(sessionId: SessionId, tabId: BrowserTabId, selector: string, value: string): Promise<BrowserProviderTab> {
    return this.act(sessionId, tabId, page => page.locator(selector).fill(value))
  }
  async press(sessionId: SessionId, tabId: BrowserTabId, selector: string, key: string): Promise<BrowserProviderTab> {
    return this.act(sessionId, tabId, page => page.locator(selector).press(key))
  }
  async back(sessionId: SessionId, tabId: BrowserTabId): Promise<BrowserProviderTab> {
    return this.act(sessionId, tabId, async (page) => { await page.goBack() })
  }
  async forward(sessionId: SessionId, tabId: BrowserTabId): Promise<BrowserProviderTab> {
    return this.act(sessionId, tabId, async (page) => { await page.goForward() })
  }
  async reload(sessionId: SessionId, tabId: BrowserTabId): Promise<BrowserProviderTab> {
    return this.act(sessionId, tabId, async (page) => { await page.reload() })
  }
  async clickAt(sessionId: SessionId, tabId: BrowserTabId, x: number, y: number, clicks: 1 | 2): Promise<BrowserProviderTab> {
    return this.act(sessionId, tabId, page => page.mouse.click(x, y, { clickCount: clicks }))
  }
  async scroll(sessionId: SessionId, tabId: BrowserTabId, deltaX: number, deltaY: number): Promise<BrowserProviderTab> {
    return this.act(sessionId, tabId, page => page.mouse.wheel(deltaX, deltaY))
  }
  async insertText(sessionId: SessionId, tabId: BrowserTabId, text: string): Promise<BrowserProviderTab> {
    return this.act(sessionId, tabId, page => page.keyboard.insertText(text))
  }
  async pressFocused(sessionId: SessionId, tabId: BrowserTabId, key: string): Promise<BrowserProviderTab> {
    return this.act(sessionId, tabId, page => page.keyboard.press(key))
  }
  async snapshot(sessionId: SessionId, tabId: BrowserTabId): Promise<string> {
    return (await this.page(this.expect(sessionId, tabId))).locator('body').ariaSnapshot()
  }
  async screenshot(sessionId: SessionId, tabId: BrowserTabId): Promise<Uint8Array> {
    return new Uint8Array(await (await this.page(this.expect(sessionId, tabId))).screenshot({ type: 'png' }))
  }

  /** Disconnect automation; the desktop owns native pages and the Chromium process. */
  async dispose(): Promise<void> {
    const results = await Promise.allSettled([...this.tabs.entries()].map(async ([key, tab]) => {
      this.tabs.delete(key)
      tab.closed = true
      await tab.ready?.catch(() => undefined)
      await tab.browser?.close()
    }))
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
    if (failures.length) throw new AggregateError(failures, 'failed to release embedded browser pages')
  }

  private async act(sessionId: SessionId, tabId: BrowserTabId, action: (page: Page) => Promise<void>): Promise<BrowserProviderTab> {
    const tab = this.expect(sessionId, tabId)
    await action(await this.page(tab))
    return this.state(tab)
  }

  private async state(tab: EmbeddedTab): Promise<BrowserProviderTab> {
    const page = await this.page(tab)
    const cdp = await page.context().newCDPSession(page)
    try {
      const history = await cdp.send('Page.getNavigationHistory')
      tab.url = page.url()
      return {
        title: await page.title(), url: tab.url, loading: false, attachmentUrl: tab.attachmentUrl,
        canGoBack: history.currentIndex > 0,
        canGoForward: history.currentIndex + 1 < history.entries.length,
      }
    } finally { await cdp.detach() }
  }

  private page(tab: EmbeddedTab): Promise<Page> {
    if (this.isClosed(tab)) return Promise.reject(new Error('Native browser tab is closed'))
    if (tab.ready !== undefined) return tab.ready
    if (tab.page !== undefined && !tab.page.isClosed()) return Promise.resolve(tab.page)
    const ready = this.attach(tab)
    tab.ready = ready
    void ready.finally(() => { if (tab.ready === ready) delete tab.ready }).catch(() => undefined)
    return ready
  }

  private async attach(tab: EmbeddedTab): Promise<Page> {
    const deadline = Date.now() + this.timeoutMs
    while (!this.isClosed(tab)) {
      const response = await fetch(new URL('/json/list', this.endpoint), { signal: AbortSignal.timeout(this.timeoutMs) })
      if (!response.ok) throw new Error(`Native browser discovery failed: HTTP ${response.status}`)
      const targets: unknown = await response.json()
      if (!Array.isArray(targets)) throw new Error('Native browser discovery returned an invalid target list')
      const matches = targets.filter((target: unknown) => typeof target === 'object' && target !== null
        && 'type' in target && target.type === 'page' && 'url' in target && target.url === tab.attachmentUrl)
      if (matches.length > 1) throw new Error('Native browser attachment URL identifies multiple pages')
      if (this.isClosed(tab)) break
      if (matches.length === 1) {
        // CEF reports newly created guests through HTTP before existing CDP clients discover them.
        await tab.browser?.close()
        const browser = await chromium.connectOverCDP(this.endpoint, { timeout: this.timeoutMs })
        tab.browser = browser
        if (this.isClosed(tab)) break
        try {
          const pages = browser.contexts().flatMap(context => context.pages()).filter(page => page.url() === tab.attachmentUrl)
          if (pages.length !== 1) throw new Error('Native browser attachment URL does not identify exactly one connected page')
          const page = pages[0]
          if (page === undefined) throw new Error('Native browser attachment page is unavailable')
          page.setDefaultTimeout(this.timeoutMs)
          page.setDefaultNavigationTimeout(this.timeoutMs)
          await page.goto(tab.url)
          if (this.isClosed(tab)) throw new Error('Native browser tab closed during attachment')
          tab.page = page
          return page
        } catch (error) {
          delete tab.browser
          await browser.close()
          throw error
        }
      }
      if (Date.now() >= deadline) throw new Error('Native browser view is not mounted; open the desktop Browser panel')
      await delay(25)
    }
    throw new Error('Native browser tab closed during attachment')
  }

  private isClosed(tab: EmbeddedTab): boolean { return tab.closed }

  private expect(sessionId: SessionId, tabId: BrowserTabId): EmbeddedTab {
    const tab = this.tabs.get(this.key(sessionId, tabId))
    if (tab === undefined) throw new Error(`Native browser tab ${tabId} is not open`)
    return tab
  }
  private key(sessionId: SessionId, tabId: BrowserTabId): string { return `${sessionId}:${tabId}` }
}
