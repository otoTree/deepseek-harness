// Thousand-Turn history exercises deferred rendering through the shipped Web profile.
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const EXPECTED = fileURLToPath(new URL('./expected/chat-lazy-history/', import.meta.url))

it.skipIf(MODE === 'record')('restores a thousand-Turn transcript with deferred history and complete explicit selection', async () => {
  const long = createChatScrollFixture({ markerPrefix: 'LAZY', title: 'Lazy thousand-Turn history', turns: 1_000 })
  const short = createChatScrollFixture({ markerPrefix: 'SHORT', title: 'Short comparison history', turns: 1 })
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    scaffold = await launchWebScaffold()
    await seedSession(scaffold, long.log, 'lazy-history-long')
    await seedSession(scaffold, short.log, 'lazy-history-short')
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    try {
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      const searchButton = page.getByRole('button', { name: 'Search sessions', exact: true })
      await searchButton.waitFor({ timeout: 30_000 })
      await searchButton.click()
      const search = page.getByRole('textbox', { name: 'Search sessions...', exact: true })
      const open = async (query: string): Promise<void> => {
        await search.fill(query)
        const row = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
        await expect.poll(() => row.count()).toBe(1)
        await row.click()
      }
      await open(long.markers.user(1))
      const column = page.locator('[data-chat-loaded-turns]')
      await expect.poll(() => column.getAttribute('data-chat-loaded-turns')).toBe('24')
      const rail = page.getByRole('navigation', { name: 'Turn navigation' })
      await rail.locator(':scope > div').first().evaluate((element) => { element.scrollTop = 0 })
      await page.getByRole('button', { name: 'Load and jump to turn 1', exact: true }).click()
      await expect.poll(() => column.getAttribute('data-chat-loaded-turns'), { timeout: 30_000 }).toBe('1000')
      const head = page.locator('[data-chat-flow-kind="user"][data-chat-turn="1"]')
      await head.waitFor({ state: 'visible' })
      const savedKey = await head.getAttribute('data-chat-anchor-key')
      const savedTop = await head.evaluate(element => element.getBoundingClientRect().top)
      await open(short.markers.user(1))
      await page.getByText(short.markers.assistant(1), { exact: false }).waitFor()
      await open(long.markers.user(1))
      await head.waitFor({ state: 'visible' })
      await expect.poll(() => head.evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(savedTop, 0)
      expect(await head.getAttribute('data-chat-anchor-key')).toBe(savedKey)
      expect(await page.locator('[data-chat-flow-key]').count()).toBeLessThan(150)
      expect(await page.locator('[data-chat-deferred]').count()).toBeGreaterThan(0)
      expect(await page.locator('[data-chat-deferred]').count()).toBeLessThan(10)
      await compareOrRefreshGolden(
        `${EXPECTED}head.expected.md`,
        await captureStableAria(page, '[data-chat-flow-kind="user"][data-chat-turn="1"]', scaffold.workspaceCwd), MODE,
      )

      // A native match requests its rich segment while keeping the matched container attached.
      const matching = page.locator('[data-chat-deferred] [hidden="until-found"]')
        .filter({ hasText: long.markers.assistant(500) }).first()
      await matching.evaluate((element) => { element.dispatchEvent(new Event('beforematch', { bubbles: true })) })
      await page.getByText(long.markers.assistant(500), { exact: false }).first().waitFor()
      await page.locator('[data-conversation-scroll]').click({ position: { x: 8, y: 8 } })
      await page.keyboard.press('ControlOrMeta+a')
      await expect.poll(() => page.locator('[data-chat-deferred]').count()).toBe(0)
      expect(await page.locator('[data-chat-flow-kind="turn-tail"]').count()).toBe(1_000)
      const selection = await page.evaluate(() => window.getSelection()?.toString() ?? '')
      expect(selection).toContain(long.markers.user(1))
      expect(selection).toContain(long.markers.assistant(1_000))
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    } catch (error) {
      await saveFailureShot(page, 'web-e2e-chat-lazy-history')
      throw error
    }
  } finally {
    await browser?.close()
    await scaffold?.close()
  }
}, 120_000)
