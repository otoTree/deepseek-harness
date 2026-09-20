import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import BrowserService, { type BrowserProvider, type BrowserProviderTab, type BrowserTabId } from '@deepseek-ai/dsh-browser'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolBrowser from '@deepseek-ai/dsh-tool-browser'

class StubProvider implements BrowserProvider {
  readonly name = 'playwright'
  private readonly pages = new Map<string, BrowserProviderTab>()

  async open(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId, url: string): Promise<BrowserProviderTab> {
    return this.set(sessionId, tabId, { title: url, url, loading: false, canGoBack: false, canGoForward: false })
  }
  async close(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId): Promise<void> { this.pages.delete(this.key(sessionId, tabId)) }
  read(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId): Promise<BrowserProviderTab> {
    return Promise.resolve(this.get(sessionId, tabId))
  }
  click(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId): Promise<BrowserProviderTab> {
    return Promise.resolve(this.set(sessionId, tabId, { ...this.get(sessionId, tabId), title: 'clicked' }))
  }
  fill(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId): Promise<BrowserProviderTab> { return this.read(sessionId, tabId) }
  press(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId): Promise<BrowserProviderTab> { return this.read(sessionId, tabId) }
  snapshot(): Promise<string> { return Promise.resolve('snapshot-data') }
  screenshot(): Promise<Uint8Array> { return Promise.resolve(Uint8Array.of(1, 2, 3)) }
  private key(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId): string { return `${sessionId}:${tabId}` }
  private get(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId): BrowserProviderTab {
    const value = this.pages.get(this.key(sessionId, tabId))
    if (value === undefined) throw new Error('missing page')
    return value
  }
  private set(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId, value: BrowserProviderTab): BrowserProviderTab {
    this.pages.set(this.key(sessionId, tabId), value)
    return value
  }
}

const contexts: Context[] = []
const signal = new AbortController().signal

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(config: ToolBrowser.Config = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(BrowserService)
  ctx.browsers.register(new StubProvider())
  await ctx.plugin(ToolBrowser, config)
  const agent = { id: SessionId('owner'), ctx }
  let sequence = 0
  const call = (name: string, args: unknown, withAgent = true) => ctx.tools.execute({
    signal,
    callId: ToolCallId(`browser-${++sequence}`),
    name,
    arguments: args,
    ...(withAgent ? { agent: agent as never } : {}),
  })
  return { ctx, call }
}

describe('browser tools through ToolRuntime', () => {
  it('validates and renders the complete tab workflow without output-schema failures', async () => {
    const { call } = await harness()
    const opened = await call('browser_open', { url: 'https://example.com' })
    expect(opened).toMatchObject({ isError: false, value: { tab: { active: true, url: 'https://example.com' } } })
    const value = opened.value as { browserId: string; tab: { tabId: string } }
    expect(typeof value.browserId).toBe('string')
    const address = { browserId: value.browserId, tabId: value.tab.tabId }

    for (const [name, args] of [
      ['browser_tabs', { browserId: value.browserId }],
      ['browser_navigate', { ...address, url: 'https://example.org' }],
      ['browser_select_tab', address],
      ['browser_click', { ...address, selector: '#result' }],
      ['browser_fill', { ...address, selector: '#query', value: 'hello' }],
      ['browser_press', { ...address, selector: '#query', key: 'Enter' }],
      ['browser_snapshot', address],
      ['browser_screenshot', address],
    ] as const) {
      const result = await call(name, args)
      expect(result.isError, name).toBe(false)
      expect(result.error, name).toBeUndefined()
    }

    const closed = await call('browser_close', { browserId: value.browserId })
    expect(closed).toMatchObject({ isError: false, value: { closed: true } })
  })

  it('enforces bounded model-visible snapshot and screenshot results', async () => {
    const { call } = await harness({ maxSnapshotChars: 4, maxScreenshotBytes: 2 })
    const opened = await call('browser_open', { url: 'https://example.com' })
    const value = opened.value as { browserId: string; tab: { tabId: string } }
    const address = { browserId: value.browserId, tabId: value.tab.tabId }

    await expect(call('browser_snapshot', address)).resolves.toMatchObject({
      isError: false, value: { text: 'snap', truncated: true },
    })
    const screenshot = await call('browser_screenshot', address)
    expect(screenshot.isError).toBe(true)
    const screenshotContent = screenshot.content[0]
    expect(screenshotContent?.type).toBe('text')
    if (screenshotContent?.type !== 'text') throw new Error('expected text tool content')
    expect(screenshotContent.text).toContain('2-byte limit')
  })

  it('discovers the Session browser that the Workbench already opened', async () => {
    const { ctx, call } = await harness()
    const owner = SessionId('owner')
    const browserId = ctx.browsers.ensure(owner, 'playwright', ctx)
    const opened = await ctx.browsers.open(owner, browserId, 'https://example.com/workbench')

    await expect(call('browser_tabs', {})).resolves.toMatchObject({
      isError: false,
      value: {
        browserId,
        tabs: [{ tabId: opened.tab.tabId, url: 'https://example.com/workbench' }],
      },
    })
    await expect(call('browser_snapshot', { browserId, tabId: opened.tab.tabId })).resolves.toMatchObject({
      isError: false,
      value: { text: 'snapshot-data', truncated: false },
    })
  })

  it('rejects invalid arguments and calls without an initiating agent in the executor', async () => {
    const { call } = await harness()
    const invalid = await call('browser_open', { url: 42 })
    expect(invalid.isError).toBe(true)
    const unowned = await call('browser_open', { url: 'https://example.com' }, false)
    expect(unowned.isError).toBe(true)
    const unownedContent = unowned.content[0]
    expect(unownedContent?.type).toBe('text')
    if (unownedContent?.type !== 'text') throw new Error('expected text tool content')
    expect(unownedContent.text).toContain('initiating agent')
  })
})
