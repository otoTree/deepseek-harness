import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import BrowserService, { type BrowserProvider, type BrowserProviderTab, type BrowserTabId } from '@deepseek-ai/dsh-browser'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolBrowser from '../src/index.ts'

class LoaderProvider implements BrowserProvider {
  readonly name = 'playwright'
  private readonly pages = new Map<string, BrowserProviderTab>()

  async open(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId, url: string): Promise<BrowserProviderTab> {
    const page = { title: 'Loader page', url, loading: false, canGoBack: false, canGoForward: false }
    this.pages.set(`${sessionId}:${tabId}`, page)
    return page
  }

  async close(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId): Promise<void> {
    this.pages.delete(`${sessionId}:${tabId}`)
  }

  read(sessionId: ReturnType<typeof SessionId>, tabId: BrowserTabId): Promise<BrowserProviderTab> {
    const page = this.pages.get(`${sessionId}:${tabId}`)
    if (page === undefined) return Promise.reject(new Error('missing Loader page'))
    return Promise.resolve(page)
  }
}

const ProviderPlugin = {
  name: 'loader-browser-provider',
  inject: ['browsers'],
  apply(ctx: Context) {
    ctx.effect(() => ctx.browsers.register(new LoaderProvider()))
  },
}

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('browser tools through a real Loader composition', () => {
  it('discovers and executes the model-facing browser workflow', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-tool-browser-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-browser'",
      "- name: '@test/browser-provider'",
      "- name: '@deepseek-ai/dsh-tool-browser'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-browser', BrowserService],
      ['@test/browser-provider', ProviderPlugin],
      ['@deepseek-ai/dsh-tool-browser', ToolBrowser],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const agent = { id: SessionId('loader-owner'), ctx: context }
    const opened = await context.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('loader-browser-open'),
      name: 'browser_open',
      arguments: { url: 'https://example.test/loader' },
      agent: agent as never,
    })
    expect(opened).toMatchObject({
      isError: false,
      value: { browserId: 'browser-1', tab: { title: 'Loader page', url: 'https://example.test/loader' } },
    })
    const openedContent = opened.content[0]
    expect(openedContent?.type).toBe('text')
    if (openedContent?.type !== 'text') throw new Error('expected text tool content')
    expect(openedContent.text).toContain('Loader page')

    const browserId = (opened.value as { browserId: string }).browserId
    await expect(context.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('loader-browser-list'),
      name: 'browser_tabs',
      arguments: { browserId },
      agent: agent as never,
    })).resolves.toMatchObject({
      isError: false,
      value: { tabs: [{ active: true, url: 'https://example.test/loader' }] },
    })
  })
})
