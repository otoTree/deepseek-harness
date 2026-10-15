/** Playwright provider for the Session-owned browser capability. */

import { AttachedBrowserProvider } from './attached.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { BrowserProvider, BrowserProviderTab, BrowserTabId } from '@deepseek-ai/dsh-browser'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface PageLike {
  goto(url: string): Promise<unknown>
  click(selector: string): Promise<void>
  fill(selector: string, value: string): Promise<void>
  press(selector: string, key: string): Promise<void>
  goBack(): Promise<unknown>
  goForward(): Promise<unknown>
  reload(): Promise<unknown>
  close(): Promise<void>
  title(): Promise<string>
  url(): string
  locator(selector: string): { ariaSnapshot(): Promise<string> }
  mouse: {
    click(x: number, y: number, options?: { clickCount?: number }): Promise<void>
    wheel(deltaX: number, deltaY: number): Promise<void>
  }
  keyboard: {
    insertText(text: string): Promise<void>
    press(key: string): Promise<void>
  }
  waitForLoadState(state?: 'domcontentloaded'): Promise<void>
  screenshot(options?: { type: 'png' }): Promise<Buffer>
}

interface ContextLike { newPage(): Promise<PageLike>; close(): Promise<void> }
interface BrowserContextOptions {
  locale?: string
  timezoneId?: string
  viewport?: { width: number; height: number }
  userAgent?: string
  extraHTTPHeaders?: Record<string, string>
}
interface BrowserLike { newContext(options?: BrowserContextOptions): Promise<ContextLike>; close(): Promise<void> }
interface BrowserLaunchOptions { headless: boolean; channel: 'chromium' | 'chrome' | 'msedge' }
interface PlaywrightModule { chromium: { launch(options: BrowserLaunchOptions): Promise<BrowserLike> } }
interface PageRecord { readonly page: PageLike; history: string[]; index: number }
interface ContextRecord { readonly ready: Promise<ContextLike>; pendingPages: number }

/** Provider that keeps one isolated Playwright context per product Session. */
export class PlaywrightBrowserProvider implements BrowserProvider {
  readonly name = 'playwright'
  private browser: Promise<BrowserLike> | undefined
  private readonly contexts = new Map<SessionId, ContextRecord>()
  private readonly pages = new Map<string, PageRecord>()

  protected readonly launchOptions: BrowserLaunchOptions
  protected readonly contextOptions: BrowserContextOptions

  constructor(options: Config = {}) {
    const channel = options.channel ?? 'chromium'
    if (!['chromium', 'chrome', 'msedge'].includes(channel)) {
      throw new Error('browser-playwright: channel must be chromium, chrome, or msedge')
    }
    this.launchOptions = { headless: options.headless ?? true, channel }
    this.contextOptions = {
      locale: options.locale ?? 'zh-CN',
      timezoneId: options.timezoneId ?? 'Asia/Shanghai',
      viewport: options.viewport ?? { width: 1440, height: 900 },
      ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
      ...(options.extraHTTPHeaders === undefined ? {} : { extraHTTPHeaders: options.extraHTTPHeaders }),
    }
  }

  async open(sessionId: SessionId, tabId: BrowserTabId, url: string): Promise<BrowserProviderTab> {
    const record = await this.page(sessionId, tabId)
    await record.page.goto(url)
    this.recordNavigation(record)
    return this.state(record)
  }

  async close(sessionId: SessionId, tabId: BrowserTabId): Promise<void> {
    const key = this.key(sessionId, tabId)
    const record = this.pages.get(key)
    this.pages.delete(key)
    if (record !== undefined) await record.page.close()
    await this.releaseContextIfIdle(sessionId)
  }

  async read(sessionId: SessionId, tabId: BrowserTabId): Promise<BrowserProviderTab> {
    const record = await this.expectPage(sessionId, tabId)
    this.recordNavigation(record)
    return this.state(record)
  }

  async click(sessionId: SessionId, tabId: BrowserTabId, selector: string): Promise<BrowserProviderTab> {
    const record = await this.expectPage(sessionId, tabId)
    await record.page.click(selector)
    this.recordNavigation(record)
    return this.state(record)
  }

  async fill(sessionId: SessionId, tabId: BrowserTabId, selector: string, value: string): Promise<BrowserProviderTab> {
    const record = await this.expectPage(sessionId, tabId)
    await record.page.fill(selector, value)
    return this.state(record)
  }

  async press(sessionId: SessionId, tabId: BrowserTabId, selector: string, key: string): Promise<BrowserProviderTab> {
    const record = await this.expectPage(sessionId, tabId)
    await record.page.press(selector, key)
    this.recordNavigation(record)
    return this.state(record)
  }

  async clickAt(sessionId: SessionId, tabId: BrowserTabId, x: number, y: number, clicks: 1 | 2): Promise<BrowserProviderTab> {
    const record = await this.expectPage(sessionId, tabId)
    await record.page.mouse.click(x, y, { clickCount: clicks })
    await record.page.waitForLoadState('domcontentloaded')
    this.recordNavigation(record)
    return this.state(record)
  }

  async scroll(sessionId: SessionId, tabId: BrowserTabId, deltaX: number, deltaY: number): Promise<BrowserProviderTab> {
    const record = await this.expectPage(sessionId, tabId)
    await record.page.mouse.wheel(deltaX, deltaY)
    return this.state(record)
  }

  async insertText(sessionId: SessionId, tabId: BrowserTabId, text: string): Promise<BrowserProviderTab> {
    const record = await this.expectPage(sessionId, tabId)
    await record.page.keyboard.insertText(text)
    return this.state(record)
  }

  async pressFocused(sessionId: SessionId, tabId: BrowserTabId, key: string): Promise<BrowserProviderTab> {
    const record = await this.expectPage(sessionId, tabId)
    await record.page.keyboard.press(key)
    await record.page.waitForLoadState('domcontentloaded')
    this.recordNavigation(record)
    return this.state(record)
  }

  async back(sessionId: SessionId, tabId: BrowserTabId): Promise<BrowserProviderTab> {
    const record = await this.expectPage(sessionId, tabId)
    await record.page.goBack()
    if (record.index > 0) record.index -= 1
    this.reconcileHistory(record)
    return this.state(record)
  }

  async forward(sessionId: SessionId, tabId: BrowserTabId): Promise<BrowserProviderTab> {
    const record = await this.expectPage(sessionId, tabId)
    await record.page.goForward()
    if (record.index + 1 < record.history.length) record.index += 1
    this.reconcileHistory(record)
    return this.state(record)
  }

  async reload(sessionId: SessionId, tabId: BrowserTabId): Promise<BrowserProviderTab> {
    const record = await this.expectPage(sessionId, tabId)
    await record.page.reload()
    return this.state(record)
  }

  async snapshot(sessionId: SessionId, tabId: BrowserTabId): Promise<string> {
    return (await this.expectPage(sessionId, tabId)).page.locator('body').ariaSnapshot()
  }

  async screenshot(sessionId: SessionId, tabId: BrowserTabId): Promise<Uint8Array> {
    return new Uint8Array(await (await this.expectPage(sessionId, tabId)).page.screenshot({ type: 'png' }))
  }

  /** Close every page, context, and the shared browser process before plugin disposal resolves. */
  async dispose(): Promise<void> {
    const contexts = await Promise.allSettled([...this.contexts.values()].map(async record => (await record.ready).close()))
    try {
      await (await this.browser)?.close()
    } finally {
      this.contexts.clear()
      this.pages.clear()
      this.browser = undefined
    }
    const failures: unknown[] = []
    for (const result of contexts) {
      if (result.status === 'rejected') failures.push(result.reason as unknown)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'failed to close Playwright browser contexts')
  }

  private async page(sessionId: SessionId, tabId: BrowserTabId): Promise<PageRecord> {
    const key = this.key(sessionId, tabId)
    const existing = this.pages.get(key)
    if (existing !== undefined) return existing
    const context = this.context(sessionId)
    context.pendingPages += 1
    try {
      const record: PageRecord = { page: await (await context.ready).newPage(), history: [], index: -1 }
      this.pages.set(key, record)
      return record
    } finally {
      context.pendingPages -= 1
      await this.releaseContextIfIdle(sessionId)
    }
  }

  private expectPage(sessionId: SessionId, tabId: BrowserTabId): Promise<PageRecord> {
    const record = this.pages.get(this.key(sessionId, tabId))
    if (record === undefined) return Promise.reject(new Error(`Playwright page ${tabId} is not open`))
    return Promise.resolve(record)
  }

  private async state(record: PageRecord): Promise<BrowserProviderTab> {
    const title = await record.page.title()
    return {
      title,
      url: record.page.url(),
      loading: false,
      canGoBack: record.index > 0,
      canGoForward: record.index + 1 < record.history.length,
    }
  }

  private recordNavigation(record: PageRecord): void {
    const url = record.page.url()
    if (record.history[record.index] === url) return
    record.history = record.history.slice(0, record.index + 1)
    record.history.push(url)
    record.index = record.history.length - 1
  }

  private reconcileHistory(record: PageRecord): void {
    const url = record.page.url()
    if (record.history[record.index] === url) return
    const found = record.history.lastIndexOf(url)
    if (found >= 0) record.index = found
    else this.recordNavigation(record)
  }

  protected async launchBrowser(): Promise<BrowserLike> {
    const module = await import('playwright') as unknown as PlaywrightModule
    return module.chromium.launch(this.launchOptions)
  }

  protected async launchContext(): Promise<ContextLike> {
    if (this.browser === undefined) {
      const ready = this.launchBrowser()
      this.browser = ready
      void ready.catch(() => {
        if (this.browser === ready) this.browser = undefined
      })
    }
    return (await this.browser).newContext(this.contextOptions)
  }

  private context(sessionId: SessionId): ContextRecord {
    const existing = this.contexts.get(sessionId)
    if (existing !== undefined) return existing
    const record: ContextRecord = { ready: this.launchContext(), pendingPages: 0 }
    this.contexts.set(sessionId, record)
    void record.ready.catch(() => {
      if (this.contexts.get(sessionId) === record) this.contexts.delete(sessionId)
    })
    return record
  }

  private async releaseContextIfIdle(sessionId: SessionId): Promise<void> {
    const record = this.contexts.get(sessionId)
    if (record === undefined || record.pendingPages > 0) return
    if ([...this.pages.keys()].some(candidate => candidate.startsWith(`${sessionId}:`))) return
    this.contexts.delete(sessionId)
    await (await record.ready).close()
  }

  private key(sessionId: SessionId, tabId: BrowserTabId): string { return `${sessionId}:${tabId}` }
}

export const name = 'browser-playwright'
export const inject = ['browsers']

/** Register Playwright as the deployment's browser provider. */
export interface Config {
  /** Loopback CDP endpoint of the desktop embedded Chromium; unset launches isolated contexts. */
  desktopCdpEndpoint?: string
  /** Maximum time to wait for native page attachment, actions, and navigation. */
  desktopTimeoutMs?: number
  /** Run Chromium without a visible window. */
  headless?: boolean
  /** Supported browser distribution; chromium uses Playwright's full Chromium and modern headless mode. */
  channel?: 'chromium' | 'chrome' | 'msedge'
  /** Browser language sent to sites and used by locale-sensitive pages. */
  locale?: string
  /** IANA time zone presented by the browser context. */
  timezoneId?: string
  /** Stable viewport used for screenshots and responsive pages. */
  viewport?: {
    /** Viewport width in CSS pixels. */
    width: number
    /** Viewport height in CSS pixels. */
    height: number
  }
  /** Optional deployment-approved user agent; unset keeps Playwright's default. */
  userAgent?: string
  /** Additional request headers approved by the deployment. */
  extraHTTPHeaders?: Record<string, string>
}

/** Register Playwright with one isolated, consistently configured context per Session. */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = config.desktopCdpEndpoint === undefined
    ? new PlaywrightBrowserProvider(config)
    : new AttachedBrowserProvider(config.desktopCdpEndpoint, config.desktopTimeoutMs ?? 30000)
  const dispose = ctx.browsers.register(provider)
  ctx.effect(() => async () => {
    dispose()
    await provider.dispose()
  }, 'browser-playwright teardown')
}
