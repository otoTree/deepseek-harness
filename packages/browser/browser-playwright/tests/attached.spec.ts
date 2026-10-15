import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserTabId } from '@deepseek-ai/dsh-browser'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Browser } from 'playwright'
import { AttachedBrowserProvider } from '../src/attached.ts'

const { connect } = vi.hoisted(() => ({ connect: vi.fn<(endpoint: string, options: { timeout: number }) => Promise<Browser>>() }))
vi.mock('playwright', () => ({ chromium: { connectOverCDP: connect } }))

const owner = SessionId('owner')
const tabId = BrowserTabId('tab')

function desktopPage(initialUrl: string) {
  let url = initialUrl
  let closed = false
  const page = {
    url: () => url,
    isClosed: () => closed,
    goto: vi.fn(async (next: string) => { url = next }),
    close: vi.fn(async () => { closed = true }),
    title: async () => 'Native document',
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    locator: vi.fn(() => ({
      ariaSnapshot: async () => '- textbox "Manual value"',
      click: vi.fn(async () => {}), fill: vi.fn(async () => {}), press: vi.fn(async () => {}),
    })),
    context: () => ({ newCDPSession: async () => ({
      send: async () => ({ currentIndex: 1, entries: [{}, {}] }), detach: async () => {},
    }) }),
  }
  return page
}

function desktop(pages: ReturnType<typeof desktopPage>[]) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(pages.filter(page => !page.isClosed()).map(page => ({ type: 'page', url: page.url() })))))
  const disconnect = vi.fn(async () => {})
  // The fixture owns these pages; the provider must neither create a page nor launch a process.
  const connection = { contexts: () => [{ pages: () => pages }], close: disconnect, on: vi.fn() }
  connect.mockResolvedValue(connection as unknown as Browser)
  return { disconnect }
}

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('native browser attachment', () => {
  it('attaches only the issued page and keeps one document for manual and Agent actions', async () => {
    const provider = new AttachedBrowserProvider('http://127.0.0.1:9333', 1000)
    const provisional = await provider.open(owner, tabId, 'https://example.test/form')
    expect(provisional).toMatchObject({ loading: true, url: 'https://example.test/form' })
    expect(connect).not.toHaveBeenCalled()
    const unrelated = desktopPage('https://example.test/form')
    const guest = desktopPage(provisional.attachmentUrl!)
    const { disconnect } = desktop([unrelated, guest])
    try {
      expect(await provider.read(owner, tabId)).toMatchObject({ loading: false, title: 'Native document', canGoBack: true })
      expect(await provider.snapshot(owner, tabId)).toContain('Manual value')
      await provider.fill(owner, tabId, '#name', 'Agent value')
      expect(guest.goto).toHaveBeenCalledExactlyOnceWith('https://example.test/form')
      expect(unrelated.goto).not.toHaveBeenCalled()
      await expect(provider.read(SessionId('foreign'), tabId)).rejects.toThrow('not open')
    } finally { await provider.dispose() }
    expect(guest.close).not.toHaveBeenCalled()
    expect(unrelated.close).not.toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('shares attachment readiness so another action cannot use the marker document', async () => {
    const provider = new AttachedBrowserProvider('http://127.0.0.1:9333', 1000)
    const tab = await provider.open(owner, tabId, 'https://example.test/form')
    const guest = desktopPage(tab.attachmentUrl!)
    const started = Promise.withResolvers<undefined>()
    const navigation = Promise.withResolvers<undefined>()
    const originalGoto = guest.goto.getMockImplementation()!
    guest.goto.mockImplementation(async (url) => { started.resolve(undefined); await navigation.promise; await originalGoto(url) })
    desktop([guest])
    const read = provider.read(owner, tabId)
    await started.promise
    const snapshot = provider.snapshot(owner, tabId)
    expect(guest.locator).not.toHaveBeenCalled()
    navigation.resolve(undefined)
    try { await Promise.all([read, snapshot]) } finally { await provider.dispose() }
    expect(guest.goto).toHaveBeenCalledOnce()
  })

  it('connects after native discovery so a new guest is visible to the CDP connection', async () => {
    const provider = new AttachedBrowserProvider('http://127.0.0.1:9333', 1000)
    const tab = await provider.open(owner, tabId, 'https://example.test/form')
    const guest = desktopPage(tab.attachmentUrl!)
    desktop([guest])
    const discovery = Promise.withResolvers<Response>()
    vi.mocked(fetch).mockReturnValueOnce(discovery.promise)
    const read = provider.read(owner, tabId)
    expect(connect).not.toHaveBeenCalled()
    discovery.resolve(Response.json([{ type: 'page', url: tab.attachmentUrl }]))
    try { await read } finally { await provider.dispose() }
    expect(guest.goto).toHaveBeenCalledExactlyOnceWith('https://example.test/form')
  })

  it('rejects ambiguous targets and a missing native view without choosing another page', async () => {
    const provider = new AttachedBrowserProvider('http://127.0.0.1:9333', 1)
    const tab = await provider.open(owner, tabId, 'https://example.test/form')
    const first = desktopPage(tab.attachmentUrl!)
    const second = desktopPage(tab.attachmentUrl!)
    const pages = [first, second]
    desktop(pages)
    try {
      await expect(provider.read(owner, tabId)).rejects.toThrow('multiple pages')
      pages.splice(0, pages.length, desktopPage('about:blank'))
      await expect(provider.read(owner, tabId)).rejects.toThrow('not mounted')
      expect(first.goto).not.toHaveBeenCalled()
    } finally { await provider.dispose() }
  })

  it('does not navigate a page when its tab closes during connection', async () => {
    const provider = new AttachedBrowserProvider('http://127.0.0.1:9333', 1000)
    const tab = await provider.open(owner, tabId, 'https://example.test/form')
    const guest = desktopPage(tab.attachmentUrl!)
    // Delay the wire connection rather than relying on a timer to race page discovery.
    const gate = Promise.withResolvers<Browser>()
    const connection = { contexts: () => [{ pages: () => [guest] }], close: vi.fn(async () => {}), on: vi.fn() }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ type: 'page', url: tab.attachmentUrl }])))
    connect.mockReturnValue(gate.promise)
    const pending = provider.read(owner, tabId)
    await vi.waitFor(() => { expect(connect).toHaveBeenCalledOnce() })
    const rejected = expect(pending).rejects.toThrow('closed during attachment')
    const closing = provider.close(owner, tabId)
    gate.resolve(connection as unknown as Browser)
    await Promise.all([rejected, closing])
    expect(guest.goto).not.toHaveBeenCalled()
    await provider.dispose()
  })

  it('rejects non-loopback CDP and invalid timeouts before connecting', () => {
    expect(() => new AttachedBrowserProvider('http://example.test:9333', 1000)).toThrow('127.0.0.1')
    expect(() => new AttachedBrowserProvider('http://127.0.0.1:9333', 0)).toThrow('positive safe integer')
  })

  it('disconnects a failed attachment and retries without caching the marker document', async () => {
    const provider = new AttachedBrowserProvider('http://127.0.0.1:9333', 1000)
    const tab = await provider.open(owner, tabId, 'https://example.test/form')
    const guest = desktopPage(tab.attachmentUrl!)
    guest.goto.mockRejectedValueOnce(new Error('Navigation interrupted'))
    const { disconnect } = desktop([guest])
    try {
      await expect(provider.read(owner, tabId)).rejects.toThrow('Navigation interrupted')
      expect(disconnect).toHaveBeenCalledOnce()
      expect(guest.close).not.toHaveBeenCalled()
      expect(await provider.read(owner, tabId)).toMatchObject({ url: 'https://example.test/form' })
      expect(guest.goto).toHaveBeenCalledTimes(2)
    } finally { await provider.dispose() }
    expect(disconnect).toHaveBeenCalledTimes(2)
  })
})
