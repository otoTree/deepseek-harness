/** Model-facing browser tools over the Session-owned browser capability. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BrowserSessionId, BrowserTabId } from '@deepseek-ai/dsh-browser'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-browser'
export const inject = ['browsers', 'tools']

/** Default maximum characters returned by one semantic page snapshot. */
export const DEFAULT_MAX_SNAPSHOT_CHARS = 200_000
/** Default maximum decoded bytes returned by one PNG screenshot. */
export const DEFAULT_MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024

/** Bounds for complete browser results written to the Session log. */
export interface Config {
  /** Maximum characters returned by one accessibility snapshot. */
  maxSnapshotChars?: number
  /** Maximum decoded PNG bytes returned by one screenshot. */
  maxScreenshotBytes?: number
}

/** Schemastery configuration for model-facing browser result limits. */
export const Config: z<Config> = z.object({
  maxSnapshotChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_SNAPSHOT_CHARS),
  maxScreenshotBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_SCREENSHOT_BYTES),
})

const TAB_PROPERTIES = {
  tabId: { type: 'string', required: true },
  title: { type: 'string', required: true },
  url: { type: 'string', required: true },
  favicon: { type: 'string' },
  loading: { type: 'boolean', required: true },
  active: { type: 'boolean', required: true },
  canGoBack: { type: 'boolean', required: true },
  canGoForward: { type: 'boolean', required: true },
} as const

const TAB_SCHEMA = { type: 'object', additionalProperties: false, properties: TAB_PROPERTIES } as const
const ACTION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { tab: { ...TAB_SCHEMA, required: true } },
} as const
const renderJson = (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]

function session(exec: { agent?: { id: string } }): SessionId {
  if (exec.agent === undefined) throw new Error('browser tools require an initiating agent')
  return exec.agent.id as SessionId
}

/** Register browser tools that share the UI's one browser context per Session. */
export function apply(ctx: Context, config: Config = {}): void {
  const maxSnapshotChars = config.maxSnapshotChars ?? DEFAULT_MAX_SNAPSHOT_CHARS
  const maxScreenshotBytes = config.maxScreenshotBytes ?? DEFAULT_MAX_SCREENSHOT_BYTES
  if (!Number.isSafeInteger(maxSnapshotChars) || maxSnapshotChars < 1) {
    throw new Error('tool-browser: maxSnapshotChars must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxScreenshotBytes) || maxScreenshotBytes < 1) {
    throw new Error('tool-browser: maxScreenshotBytes must be a positive safe integer')
  }

  ctx.tools.register(defineTool({
    name: 'browser_open',
    description: 'Open and select a new tab in the current Session browser.',
    parameters: { url: { type: 'string', required: true, description: 'Absolute HTTP or HTTPS URL.' } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { browserId: { type: 'string', required: true }, tab: { ...TAB_SCHEMA, required: true } },
      },
      render: renderJson,
    },
    async execute(args, exec) {
      const owner = session(exec)
      const browserId = ctx.browsers.ensure(owner, 'playwright', exec.agent?.ctx)
      return { browserId, ...(await ctx.browsers.open(owner, browserId, args.url)) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_navigate',
    description: 'Navigate an existing browser tab to an absolute HTTP or HTTPS URL.',
    parameters: {
      browserId: { type: 'string', required: true },
      tabId: { type: 'string', required: true },
      url: { type: 'string', required: true },
    },
    output: { schema: ACTION_OUTPUT_SCHEMA, render: renderJson },
    execute: (args, exec) => ctx.browsers.navigate(
      session(exec), BrowserSessionId(args.browserId), BrowserTabId(args.tabId), args.url,
    ),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_tabs',
    description: 'Discover the current Session browser and list its committed tabs.',
    parameters: { browserId: { type: 'string', description: 'Known browser id; omit it to discover or create the current Session browser.' } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          browserId: { type: 'string', required: true },
          tabs: { type: 'array', required: true, items: TAB_SCHEMA },
        },
      },
      render: renderJson,
    },
    execute(args, exec) {
      const owner = session(exec)
      const browserId = args.browserId === undefined
        ? ctx.browsers.ensure(owner, 'playwright', exec.agent?.ctx)
        : BrowserSessionId(args.browserId)
      return Promise.resolve({ browserId, tabs: ctx.browsers.list(owner, browserId) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_select_tab',
    description: 'Select one existing browser tab.',
    parameters: {
      browserId: { type: 'string', required: true },
      tabId: { type: 'string', required: true },
    },
    output: { schema: ACTION_OUTPUT_SCHEMA, render: renderJson },
    execute(args, exec) {
      return Promise.resolve(ctx.browsers.select(
        session(exec), BrowserSessionId(args.browserId), BrowserTabId(args.tabId),
      ))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_click',
    description: 'Click an element selected by a Playwright selector in one browser tab.',
    parameters: {
      browserId: { type: 'string', required: true },
      tabId: { type: 'string', required: true },
      selector: { type: 'string', required: true },
    },
    output: { schema: ACTION_OUTPUT_SCHEMA, render: renderJson },
    execute: (args, exec) => ctx.browsers.action(
      session(exec), BrowserSessionId(args.browserId), BrowserTabId(args.tabId), 'click', args.selector,
    ),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_fill',
    description: 'Replace the value of an editable element in one browser tab.',
    parameters: {
      browserId: { type: 'string', required: true },
      tabId: { type: 'string', required: true },
      selector: { type: 'string', required: true },
      value: { type: 'string', required: true },
    },
    output: { schema: ACTION_OUTPUT_SCHEMA, render: renderJson },
    execute: (args, exec) => ctx.browsers.action(
      session(exec), BrowserSessionId(args.browserId), BrowserTabId(args.tabId), 'fill', args.selector, args.value,
    ),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_press',
    description: 'Press a Playwright key chord on an element in one browser tab.',
    parameters: {
      browserId: { type: 'string', required: true },
      tabId: { type: 'string', required: true },
      selector: { type: 'string', required: true },
      key: { type: 'string', required: true },
    },
    output: { schema: ACTION_OUTPUT_SCHEMA, render: renderJson },
    execute: (args, exec) => ctx.browsers.action(
      session(exec), BrowserSessionId(args.browserId), BrowserTabId(args.tabId), 'press', args.selector, args.key,
    ),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_snapshot',
    description: 'Read a bounded accessibility snapshot from one browser tab.',
    parameters: {
      browserId: { type: 'string', required: true },
      tabId: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: renderJson,
    },
    async execute(args, exec) {
      const text = await ctx.browsers.snapshot(
        session(exec), BrowserSessionId(args.browserId), BrowserTabId(args.tabId),
      )
      return text.length <= maxSnapshotChars
        ? { text, truncated: false }
        : { text: text.slice(0, maxSnapshotChars), truncated: true }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_screenshot',
    description: 'Capture a bounded PNG screenshot from one browser tab.',
    parameters: {
      browserId: { type: 'string', required: true },
      tabId: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mediaType: { type: 'string', required: true, const: 'image/png' },
          data: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
        },
      },
      render: renderJson,
    },
    async execute(args, exec) {
      const image = await ctx.browsers.screenshot(
        session(exec), BrowserSessionId(args.browserId), BrowserTabId(args.tabId),
      )
      if (image.byteLength > maxScreenshotBytes) {
        throw new Error(`browser screenshot exceeds configured ${maxScreenshotBytes}-byte limit`)
      }
      return { mediaType: 'image/png' as const, data: Buffer.from(image).toString('base64'), bytes: image.byteLength }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_close',
    description: 'Close the current Session browser context and every tab it owns.',
    parameters: { browserId: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { closed: { type: 'boolean', required: true, const: true } },
      },
      render: renderJson,
    },
    async execute(args, exec) {
      await ctx.browsers.close(session(exec), BrowserSessionId(args.browserId))
      return { closed: true as const }
    },
  }))
}
