import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import BrowserService, {
  BrowserError,
  BrowserTabId,
  type BrowserProvider,
  type BrowserProviderTab,
  type BrowserTabId as BrowserTabIdType,
} from '@deepseek-ai/dsh-browser'

class StubProvider implements BrowserProvider {
  readonly name: string
  readonly pages = new Map<string, BrowserProviderTab>()
  readonly opened: string[] = []
  readonly closed: string[] = []
  readonly interactions: string[] = []
  closeGate: PromiseWithResolvers<undefined> | undefined
  failOpen = false

  constructor(name = 'stub') { this.name = name }

  async open(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabIdType, url: string): Promise<BrowserProviderTab> {
    this.opened.push(`${sessionId}:${tabId}:${url}`)
    if (this.failOpen) throw new Error('open failed')
    const tab = this.observed(url)
    this.pages.set(`${sessionId}:${tabId}`, tab)
    return tab
  }

  async close(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabIdType): Promise<void> {
    this.closed.push(`${sessionId}:${tabId}`)
    await this.closeGate?.promise
    this.pages.delete(`${sessionId}:${tabId}`)
  }

  async read(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabIdType): Promise<BrowserProviderTab> {
    const tab = this.pages.get(`${sessionId}:${tabId}`)
    if (tab === undefined) throw new Error('missing page')
    return tab
  }

  async click(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabIdType): Promise<BrowserProviderTab> {
    const current = await this.read(sessionId, tabId)
    const tab = { ...current, title: 'clicked', url: `${current.url}#clicked` }
    this.pages.set(`${sessionId}:${tabId}`, tab)
    return tab
  }

  async clickAt(
    sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabIdType, x: number, y: number, clicks: 1 | 2,
  ): Promise<BrowserProviderTab> {
    this.interactions.push(`click:${x}:${y}:${clicks}`)
    return this.read(sessionId, tabId)
  }

  async scroll(
    sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabIdType, deltaX: number, deltaY: number,
  ): Promise<BrowserProviderTab> {
    this.interactions.push(`scroll:${deltaX}:${deltaY}`)
    return this.read(sessionId, tabId)
  }

  async insertText(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabIdType, text: string): Promise<BrowserProviderTab> {
    this.interactions.push(`text:${text}`)
    return this.read(sessionId, tabId)
  }

  async pressFocused(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabIdType, key: string): Promise<BrowserProviderTab> {
    this.interactions.push(`key:${key}`)
    return this.read(sessionId, tabId)
  }

  snapshot(): Promise<string> { return Promise.resolve('provider snapshot') }

  private observed(url: string): BrowserProviderTab {
    return { title: `title:${url}`, url, loading: false, canGoBack: false, canGoForward: false }
  }
}

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(maxTabs = 2) {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(BrowserService, { maxTabs })
  const provider = new StubProvider()
  const alternate = new StubProvider('alternate')
  ctx.browsers.register(provider)
  ctx.browsers.register(alternate)
  return { ctx, provider, alternate }
}

describe('BrowserService Session ownership', () => {
  it('keeps one provider context per Session and fences provider selection', async () => {
    const { ctx } = await harness()
    const owner = SessionId('owner')
    const browserId = ctx.browsers.ensure(owner, 'stub')

    expect(ctx.browsers.ensure(owner)).toBe(browserId)
    expect(() => ctx.browsers.ensure(owner, 'alternate')).toThrow(BrowserError)
    expect(ctx.browsers.find(owner)).toBe(browserId)
    expect(ctx.browsers.list(owner, browserId)).toEqual([])
    expect(() => ctx.browsers.list(SessionId('foreign'), browserId)).toThrow('not owned')
  })

  it('awaits one close transaction across explicit and owner cleanup', async () => {
    const { ctx, provider } = await harness()
    const owner = SessionId('owner')
    const browserId = ctx.browsers.ensure(owner, 'stub')
    await ctx.browsers.open(owner, browserId, 'https://example.com')
    const closeGate = Promise.withResolvers<undefined>()
    provider.closeGate = closeGate

    const first = ctx.browsers.close(owner, browserId)
    const second = ctx.browsers.closeSession(owner)
    expect(() => ctx.browsers.ensure(owner, 'stub')).toThrow(/closing/)
    closeGate.resolve(undefined)
    await Promise.all([first, second])

    expect(provider.closed).toHaveLength(1)
    expect(ctx.browsers.find(owner)).toBeUndefined()
    expect(ctx.browsers.ensure(owner, 'stub')).not.toBe(browserId)
  })

  it('closes every tab when the Session owner scope is disposed', async () => {
    const { ctx, provider } = await harness()
    const owner = SessionId('owner')
    const scope = ctx.plugin(() => {})
    const browserId = ctx.browsers.ensure(owner, 'stub', scope.ctx)
    await ctx.browsers.open(owner, browserId, 'https://one.example')
    await ctx.browsers.open(owner, browserId, 'https://two.example')

    await scope.dispose()

    expect(ctx.browsers.find(owner)).toBeUndefined()
    expect(provider.closed).toHaveLength(2)
  })
})

describe('BrowserService tab state', () => {
  it('commits provider-observed state, selection, close fallback, and revisions', async () => {
    const { ctx } = await harness()
    const owner = SessionId('owner')
    const browserId = ctx.browsers.ensure(owner, 'stub')
    const initialRevision = ctx.browsers.revision(owner, browserId)
    const first = await ctx.browsers.open(owner, browserId, 'https://one.example')
    const second = await ctx.browsers.open(owner, browserId, 'https://two.example')

    expect(first.tab).toMatchObject({ title: 'title:https://one.example', active: true })
    expect(ctx.browsers.list(owner, browserId).map(tab => tab.active)).toEqual([false, true])
    expect(ctx.browsers.select(owner, browserId, first.tab.tabId).tab.active).toBe(true)
    const clicked = await ctx.browsers.action(owner, browserId, first.tab.tabId, 'click', '#result')
    expect(clicked.tab).toMatchObject({ title: 'clicked', url: 'https://one.example#clicked', active: true })
    await ctx.browsers.closeTab(owner, browserId, first.tab.tabId)
    expect(ctx.browsers.list(owner, browserId)).toEqual([{ ...second.tab, active: true }])
    expect(ctx.browsers.revision(owner, browserId)).toBe(initialRevision + 5)
  })

  it('enforces URL and tab limits before provider operations', async () => {
    const { ctx, provider } = await harness(1)
    const owner = SessionId('owner')
    const browserId = ctx.browsers.ensure(owner, 'stub')

    await expect(ctx.browsers.open(owner, browserId, 'file:///tmp/nope')).rejects.toMatchObject({ code: 'INVALID_URL' })
    await ctx.browsers.open(owner, browserId, 'about:blank')
    await expect(ctx.browsers.open(owner, browserId, 'https://second.example')).rejects.toMatchObject({ code: 'TAB_LIMIT' })
    expect(provider.opened).toHaveLength(1)
    await expect(ctx.browsers.action(owner, browserId, BrowserTabId('missing'), 'fill', '#q', 'x')).rejects.toMatchObject({ code: 'UNKNOWN_TAB' })
  })

  it('forwards Client viewport input to the provider page and publishes each result', async () => {
    const { ctx, provider } = await harness()
    const owner = SessionId('owner')
    const browserId = ctx.browsers.ensure(owner, 'stub')
    const opened = await ctx.browsers.open(owner, browserId, 'https://example.com')
    const revision = ctx.browsers.revision(owner, browserId)

    await ctx.browsers.clickAt(owner, browserId, opened.tab.tabId, 10, 20, 1)
    await ctx.browsers.scroll(owner, browserId, opened.tab.tabId, 0, 120)
    await ctx.browsers.insertText(owner, browserId, opened.tab.tabId, 'query')
    await ctx.browsers.pressFocused(owner, browserId, opened.tab.tabId, 'Enter')

    expect(provider.interactions).toEqual(['click:10:20:1', 'scroll:0:120', 'text:query', 'key:Enter'])
    expect(ctx.browsers.revision(owner, browserId)).toBe(revision + 4)
  })

  it('uses bounded native observations for model snapshots until a provider action invalidates them', async () => {
    const { ctx } = await harness()
    const owner = SessionId('owner')
    const browserId = ctx.browsers.ensure(owner, 'stub')
    const opened = await ctx.browsers.open(owner, browserId, 'https://example.com')

    const observed = ctx.browsers.observe(owner, browserId, opened.tab.tabId, {
      title: 'Native page',
      url: 'https://example.com/current',
      snapshot: '- document "Native page"\n- heading "Current"',
      canGoBack: true,
      canGoForward: false,
    })

    expect(observed.tab).toMatchObject({ title: 'Native page', url: 'https://example.com/current', canGoBack: true })
    await expect(ctx.browsers.snapshot(owner, browserId, opened.tab.tabId)).resolves.toContain('heading "Current"')
    await ctx.browsers.scroll(owner, browserId, opened.tab.tabId, 0, 10)
    await expect(ctx.browsers.snapshot(owner, browserId, opened.tab.tabId)).resolves.toBe('provider snapshot')
    expect(() => ctx.browsers.observe(owner, browserId, opened.tab.tabId, {
      title: 'x', url: 'https://example.com', snapshot: 'x'.repeat(200_001), canGoBack: false, canGoForward: false,
    })).toThrow(/configured limit/)
  })

  it('rolls back failed opens without changing the selected tab', async () => {
    const { ctx, provider } = await harness()
    const owner = SessionId('owner')
    const browserId = ctx.browsers.ensure(owner, 'stub')
    const first = await ctx.browsers.open(owner, browserId, 'https://one.example')
    provider.failOpen = true

    await expect(ctx.browsers.open(owner, browserId, 'https://broken.example')).rejects.toThrow('open failed')

    expect(ctx.browsers.list(owner, browserId)).toEqual([first.tab])
    expect(provider.closed.at(-1)).toMatch(/^owner:tab-/)
  })
})
