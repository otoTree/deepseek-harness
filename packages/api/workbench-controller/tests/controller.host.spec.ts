import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import BrowserService, { type BrowserProvider, type BrowserProviderTab, type BrowserTabId } from '@deepseek-ai/dsh-browser'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TerminalSessionId, type TerminalOutputDelta } from '@deepseek-ai/dsh-terminal'
import WorkbenchController from '../src/index.ts'
import type { BrowserFollowFrame, TerminalFollowFrame } from '../src/types.ts'

class StubBrowserProvider implements BrowserProvider {
  readonly name = 'stub'
  readonly pages = new Map<string, BrowserProviderTab>()
  readonly interactions: string[] = []

  async open(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId, url: string): Promise<BrowserProviderTab> {
    const tab = { title: url, url, loading: false, canGoBack: false, canGoForward: false }
    this.pages.set(`${sessionId}:${tabId}`, tab)
    return tab
  }

  async close(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId): Promise<void> {
    this.pages.delete(`${sessionId}:${tabId}`)
  }

  async read(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId): Promise<BrowserProviderTab> {
    const tab = this.pages.get(`${sessionId}:${tabId}`)
    if (tab === undefined) throw new Error('missing page')
    return tab
  }

  async clickAt(
    sessionId: ReturnType<typeof SessionId>,
    tabId: BrowserTabId,
    x: number,
    y: number,
    clicks: 1 | 2,
  ): Promise<BrowserProviderTab> {
    this.interactions.push(`click:${x}:${y}:${clicks}`)
    return this.read(sessionId, tabId)
  }

  async scroll(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId, deltaX: number, deltaY: number): Promise<BrowserProviderTab> {
    this.interactions.push(`scroll:${deltaX}:${deltaY}`)
    return this.read(sessionId, tabId)
  }

  async insertText(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId, text: string): Promise<BrowserProviderTab> {
    this.interactions.push(`text:${text}`)
    return this.read(sessionId, tabId)
  }

  async pressFocused(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId, key: string): Promise<BrowserProviderTab> {
    this.interactions.push(`key:${key}`)
    return this.read(sessionId, tabId)
  }
}

class StubTerminals {
  listener: ((delta: TerminalOutputDelta) => void) | undefined
  readonly stop = vi.fn()
  readonly resizes: Array<{ rows: number; cols: number }> = []
  readonly writes: string[] = []
  emitDuringRead = false
  revision = 0

  list(): [] { return [] }
  readOutput() {
    if (this.emitDuringRead) {
      this.emitDuringRead = false
      this.revision += 1
      this.listener?.({ revision: this.revision, text: 'during-read', truncated: false })
    }
    return { revision: this.revision, text: '\u001b[32mbaseline\u001b[0mduring-read', truncated: false }
  }
  async write(_owner: Agent, _id: ReturnType<typeof TerminalSessionId>, data: string): Promise<void> { this.writes.push(data) }
  subscribeOutput(_owner: Agent, _id: ReturnType<typeof TerminalSessionId>, listener: (delta: TerminalOutputDelta) => void): () => void {
    this.listener = listener
    return this.stop
  }
  async resize(_owner: Agent, _id: ReturnType<typeof TerminalSessionId>, size: { rows: number; cols: number }): Promise<void> {
    this.resizes.push(size)
  }
}

const contexts: Context[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function harness(maxFileBytes = 32, maxMediaBytes = 64) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-workbench-'))
  directories.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  const id = SessionId('session')
  const agent = { id, ctx, session: { id, header: { cwd: root } } } as Agent
  const resolveSandboxPolicy = vi.fn((_request: { session: Agent['session'] }) => ({
    mode: 'workspace-write' as const,
    workspaceRoot: root,
    sessionId: id,
  }))
  ctx.provide('sessionController', {
    resolveAgent: async (requested: ReturnType<typeof SessionId>) => requested === id
      ? { agent }
      : { error: new Error('missing Session') },
    inspect: async () => ({ meta: { cwd: root } }),
  } as never)
  ctx.provide('sandboxPolicy', { defaultMode: 'workspace-write', resolve: resolveSandboxPolicy } as never)
  const dispose = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => dispose },
    contexts: { configureHost: () => dispose },
  } as never)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(BrowserService)
  const browserProvider = new StubBrowserProvider()
  ctx.browsers.register(browserProvider)
  const controller = new WorkbenchController(ctx, { maxFileBytes, maxMediaBytes })
  const terminals = new StubTerminals()
  ;(controller as unknown as { terminalsFor(owner: Agent): StubTerminals }).terminalsFor = () => terminals
  return { ctx, controller, root, id, agent, terminals, browserProvider, resolveSandboxPolicy }
}

async function nextFrame<T>(iterator: AsyncIterator<T>): Promise<T> {
  const next = await iterator.next()
  if (next.done === true) throw new Error('stream ended before the expected frame')
  return next.value
}

describe('WorkbenchController terminal stream', () => {
  it('subscribes before its baseline, orders deltas, and detaches on abort', async () => {
    const { controller, id, terminals } = await harness()
    terminals.emitDuringRead = true
    const abort = new AbortController()
    const iterator = controller.terminalFollow({ sessionId: id, terminalId: TerminalSessionId('pty-1') }, abort.signal)[Symbol.asyncIterator]()

    await expect(nextFrame<TerminalFollowFrame>(iterator)).resolves.toEqual({
      type: 'baseline', terminalId: 'pty-1', revision: 1, text: '\u001b[32mbaseline\u001b[0mduring-read', truncated: false,
    })
    terminals.listener?.({ revision: 2, text: 'second', truncated: true })
    await expect(nextFrame<TerminalFollowFrame>(iterator)).resolves.toMatchObject({ revision: 2, text: 'second', truncated: true })
    abort.abort()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(terminals.stop).toHaveBeenCalledOnce()
  })

  it('routes measured rows and columns unchanged', async () => {
    const { controller, id, terminals } = await harness()
    await controller.terminalResize({ sessionId: id, terminalId: TerminalSessionId('pty-1'), rows: 41, cols: 128 })
    expect(terminals.resizes).toEqual([{ rows: 41, cols: 128 }])
  })

  it('writes terminal control bytes unchanged', async () => {
    const { controller, id, terminals } = await harness()
    await controller.terminalWrite({ sessionId: id, terminalId: TerminalSessionId('pty-1'), data: '\u001b[A\t\u0003' })
    expect(terminals.writes).toEqual(['\u001b[A\t\u0003'])
  })
})

describe('WorkbenchController files', () => {
  it.each(['/absolute', '../escape', 'nested/../escape', 'windows\\path', 'bad\0path'])(
    'rejects paths outside the relative workspace namespace: %s',
    async (path) => {
      const { controller, id } = await harness()
      await expect(controller.fileRead({ sessionId: id, path }, new AbortController().signal))
        .rejects.toMatchObject({ code: 'workbench/file-invalid' })
    },
  )

  it('rejects symlink escapes, invalid UTF-8, NUL content, and oversized files', async () => {
    const { controller, id, root } = await harness(8)
    const outside = mkdtempSync(join(tmpdir(), 'dsh-workbench-outside-'))
    directories.push(outside)
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    symlinkSync(join(outside, 'secret.txt'), join(root, 'escape.txt'))
    writeFileSync(join(root, 'invalid.txt'), Uint8Array.of(0xff))
    writeFileSync(join(root, 'nul.txt'), 'a\0b')
    writeFileSync(join(root, 'large.txt'), '123456789')
    const signal = new AbortController().signal

    await expect(controller.fileRead({ sessionId: id, path: 'escape.txt' }, signal)).rejects.toMatchObject({ code: 'workbench/file-invalid' })
    await expect(controller.fileRead({ sessionId: id, path: 'invalid.txt' }, signal)).rejects.toMatchObject({ code: 'workbench/file-binary' })
    await expect(controller.fileRead({ sessionId: id, path: 'nul.txt' }, signal)).rejects.toMatchObject({ code: 'workbench/file-binary' })
    await expect(controller.fileRead({ sessionId: id, path: 'large.txt' }, signal)).rejects.toMatchObject({ code: 'workbench/file-too-large' })
  })

  it('writes only the observed version and maps only stale writes to conflict', async () => {
    const { controller, id, root, agent, resolveSandboxPolicy } = await harness()
    writeFileSync(join(root, 'note.txt'), 'first')
    mkdirSync(join(root, 'folder'))
    const signal = new AbortController().signal
    const observed = await controller.fileRead({ sessionId: id, path: 'note.txt' }, signal)
    const written = await controller.fileWrite({ kind: 'text', sessionId: id, path: 'note.txt', content: 'second', expectedVersion: observed.version }, signal)
    expect(written.version).not.toBe(observed.version)
    expect(resolveSandboxPolicy).toHaveBeenCalledWith({ session: agent.session })
    writeFileSync(join(root, 'note.txt'), 'external')
    await expect(controller.fileWrite({ kind: 'text', sessionId: id, path: 'note.txt', content: 'stale', expectedVersion: written.version }, signal))
      .rejects.toMatchObject({ code: 'workbench/file-conflict' })
    await expect(controller.fileWrite({ kind: 'text', sessionId: id, path: 'folder', content: 'bad', expectedVersion: written.version }, signal))
      .rejects.toMatchObject({ code: 'workbench/file-error' })
  })

  it('writes bounded DOCX, PPTX, and XLSX replacements but rejects malformed binary payloads', async () => {
    const { controller, id, root } = await harness(32, 64)
    const original = Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 1)
    writeFileSync(join(root, 'report.docx'), original)
    writeFileSync(join(root, 'deck.pptx'), original)
    const signal = new AbortController().signal
    const observed = await controller.fileRead({ sessionId: id, path: 'report.docx' }, signal)
    const replacement = Buffer.from(Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 2)).toString('base64')
    await expect(controller.fileWrite({
      kind: 'binary', sessionId: id, path: 'report.docx', data: replacement, expectedVersion: observed.version,
    }, signal)).resolves.toMatchObject({ path: 'report.docx' })
    const deckObserved = await controller.fileRead({ sessionId: id, path: 'deck.pptx' }, signal)
    await expect(controller.fileWrite({
      kind: 'binary', sessionId: id, path: 'deck.pptx', data: replacement, expectedVersion: deckObserved.version,
    }, signal)).resolves.toMatchObject({ path: 'deck.pptx' })
    await expect(controller.fileWrite({
      kind: 'binary', sessionId: id, path: 'report.docx', data: 'not base64', expectedVersion: observed.version,
    }, signal)).rejects.toMatchObject({ code: 'workbench/file-invalid' })
  })

  it('returns browser-native media as bounded Base64 without decoding it as text', async () => {
    const { controller, id, root } = await harness(8, 4)
    writeFileSync(join(root, 'pixel.PNG'), Uint8Array.of(0x89, 0x50, 0x4e, 0x47))
    writeFileSync(join(root, 'large.mp3'), Uint8Array.of(1, 2, 3, 4, 5))
    const signal = new AbortController().signal

    await expect(controller.fileRead({ sessionId: id, path: 'pixel.PNG' }, signal)).resolves.toMatchObject({
      kind: 'media',
      path: 'pixel.PNG',
      data: 'iVBORw==',
      mediaType: 'image/png',
    })
    await expect(controller.fileRead({ sessionId: id, path: 'large.mp3' }, signal)).rejects.toMatchObject({
      code: 'workbench/file-too-large',
      details: { path: 'large.mp3', maxBytes: 4 },
    })
  })

  it('returns Office and CSV files as bounded document payloads', async () => {
    const { controller, id, root } = await harness(8, 64)
    writeFileSync(join(root, 'table.csv'), 'name,value\nAda,10')
    writeFileSync(join(root, 'report.docx'), Uint8Array.of(80, 75, 3, 4))
    const signal = new AbortController().signal
    await expect(controller.fileRead({ sessionId: id, path: 'table.csv' }, signal)).resolves.toMatchObject({
      kind: 'document', path: 'table.csv', format: 'csv', data: 'bmFtZSx2YWx1ZQpBZGEsMTA=',
    })
    await expect(controller.fileRead({ sessionId: id, path: 'report.docx' }, signal)).resolves.toMatchObject({
      kind: 'document', path: 'report.docx', format: 'docx', data: 'UEsDBA==',
    })
  })
})

describe('WorkbenchController browser stream', () => {
  it('emits a baseline and ordered state revisions, then removes its listener', async () => {
    const { controller, ctx, id } = await harness()
    const originalOn = ctx.on.bind(ctx)
    const stopped = vi.fn()
    vi.spyOn(ctx, 'on').mockImplementation(((...args: Parameters<Context['on']>) => {
      const stop = originalOn(...args)
      return () => { stopped(); stop() }
    }) as Context['on'])
    const abort = new AbortController()
    const iterator = controller.browserFollow({ sessionId: id, provider: 'stub' }, abort.signal)[Symbol.asyncIterator]()
    const baseline = await nextFrame<BrowserFollowFrame>(iterator)
    expect(baseline).toMatchObject({ type: 'baseline', revision: 1, tabs: [] })
    const browserId = baseline.browserId
    await ctx.browsers.open(id, browserId, 'https://example.com')
    await expect(nextFrame<BrowserFollowFrame>(iterator)).resolves.toMatchObject({ type: 'state', revision: 2, tabs: [{ active: true }] })

    abort.abort()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(stopped).toHaveBeenCalledOnce()
  })

  it('forwards viewport pointer, wheel, text, and key input to the Session page', async () => {
    const { controller, id, browserProvider } = await harness()
    const created = await controller.browserCreate({ sessionId: id, provider: 'stub' })
    const opened = await controller.browserOpen({ sessionId: id, browserId: created.browserId, url: 'https://example.com' })
    const request = { sessionId: id, browserId: created.browserId, tabId: opened.tab.tabId }

    await controller.browserPointer({ ...request, x: 25, y: 40, clicks: 1 })
    await controller.browserScroll({ ...request, deltaX: 3, deltaY: 120 })
    await controller.browserType({ ...request, text: 'query' })
    await controller.browserKey({ ...request, key: 'Enter' })

    expect(browserProvider.interactions).toEqual([
      'click:25:40:1',
      'scroll:3:120',
      'text:query',
      'key:Enter',
    ])
  })

  it('commits native browser text for the Agent snapshot path', async () => {
    const { controller, id } = await harness()
    const created = await controller.browserCreate({ sessionId: id, provider: 'stub' })
    const opened = await controller.browserOpen({ sessionId: id, browserId: created.browserId, url: 'https://example.com' })
    const request = { sessionId: id, browserId: created.browserId, tabId: opened.tab.tabId }

    controller.browserObserve({
      ...request,
      title: 'Native page',
      url: 'https://example.com/current',
      snapshot: '- document "Native page"\n- heading "Current"',
      canGoBack: true,
      canGoForward: false,
    })

    await expect(controller.browserSnapshot(request)).resolves.toEqual({
      text: '- document "Native page"\n- heading "Current"',
    })
  })
})
