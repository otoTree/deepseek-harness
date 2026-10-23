// Keyless browser regression for the details column's default visibility and Session ownership.
// The shipped composition starts closed after selection and reload, retains an explicitly opened width through
// unselected states, and closes it only when a different Session takes ownership.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  fixtureUserPrompts, launchWebScaffold, seedSession, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/details-session-lifecycle', import.meta.url))
const START_EXPECTED = fileURLToPath(new URL('./expected/workbench-start.expected.md', import.meta.url))
const HANDLES_EXPECTED = join(SNAPSHOT_DIR, 'handles.expected.md')
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v2.jsonl', import.meta.url))
const SEED_FIXTURE = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v2.jsonl', import.meta.url))
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'
const MODE = webSnapshotMode()

/** Last AppFrame grid track in CSS pixels. */
async function detailsTrack(page: Page): Promise<number> {
  return await appFrame(page).evaluate((element) => {
    const tracks = getComputedStyle(element).gridTemplateColumns.split(' ')
    return Number.parseFloat(tracks.at(-1) ?? 'NaN')
  })
}

/** Session-sidebar AppFrame grid track in CSS pixels, after the fixed rail. */
async function sidebarTrack(page: Page): Promise<number> {
  return await appFrame(page).evaluate((element) => {
    const tracks = getComputedStyle(element).gridTemplateColumns.split(' ')
    return Number.parseFloat(tracks[1] ?? 'NaN')
  })
}

/** Number of columns occupied by the first two Start entries. */
async function startColumns(page: Page): Promise<number> {
  return await page.locator('[data-workbench-start] button').evaluateAll((entries) => {
    const first = entries[0]!.getBoundingClientRect()
    const second = entries[1]!.getBoundingClientRect()
    return Math.abs(first.x - second.x) < 1 ? 1 : 2
  })
}

/** AppFrame is the only product element with an inline grid track template. */
function appFrame(page: Page) {
  return page.locator('[style*="grid-template-columns"]').first()
}

/** Render the two column-resize handles without platform-dependent coordinates. */
async function handleSnapshot(page: Page): Promise<string> {
  const handles = await page.locator('[class*="handle"]').evaluateAll(elements =>
    elements.map((element) => {
      const side = element.getAttribute('data-side')
      const column = element.parentElement!.querySelector(`[class*="${side === 'details' ? 'detailsCol' : 'sidebarCol'}"]`)!
      const border = column.getBoundingClientRect()
      const strip = element.getBoundingClientRect()
      return {
        side,
        cursor: getComputedStyle(element).cursor,
        pillGenerated: getComputedStyle(element, '::after').content !== 'none',
        borderAligned: Math.abs(strip.x + strip.width / 2 - (side === 'details' ? border.x : border.right)) <= 1,
      }
    }))
  return [
    '# AppFrame drag handles',
    '',
    ...handles.flatMap(handle => [
      `## ${handle.side}`,
      '',
      '- hit strip present: true',
      `- cursor: ${handle.cursor}`,
      `- pill generated: ${String(handle.pillGenerated)}`,
      `- border aligned: ${String(handle.borderAligned)}`,
      '',
    ]),
  ].join('\n').trimEnd()
}

describe.skipIf(MODE === 'record')('web e2e: details panel follows the current Session lifecycle', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    const fixture = await readFile(FIXTURE, 'utf8')
    expect(fixtureUserPrompts(fixture)).toEqual([PROMPT])
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 5, compareReplaySession: false })
    await seedSession(scaffold, await readFile(SEED_FIXTURE, 'utf8'), 'details-session-lifecycle-seed')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await appFrame(page).waitFor({ timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('starts and reloads closed, then stays closed across Session ownership changes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-details-session-lifecycle'))
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill(PROMPT)
    await input.press('Enter')
    await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })

    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)
    expect(await page.getByText('Details', { exact: true }).isVisible()).toBe(false)

    const sidebarBefore = await sidebarTrack(page)
    const sidebarHandle = page.locator('[data-side="sidebar"]')
    const sidebarBox = await sidebarHandle.boundingBox()
    expect(sidebarBox).not.toBeNull()
    const dragStartX = sidebarBox!.x + sidebarBox!.width / 2
    await page.mouse.move(dragStartX, sidebarBox!.y + 200)
    await page.mouse.down()
    await page.mouse.move(dragStartX + 70, sidebarBox!.y + 200, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => sidebarTrack(page), { timeout: 5_000 }).toBe(sidebarBefore + 70)

    await page.getByRole('button', { name: 'Workbench', exact: true }).click()
    await compareOrRefreshGolden(START_EXPECTED, await captureStableAria(page, '[data-workbench-start]', scaffold.workspaceCwd), MODE)
    const detailsHandle = page.locator('[data-side="details"]')
    await detailsHandle.waitFor({ state: 'visible' })
    await expect.poll(() => detailsTrack(page)).toBe(360)
    await expect.poll(() => startColumns(page)).toBe(1)
    await compareOrRefreshGolden(HANDLES_EXPECTED, await handleSnapshot(page), MODE)
    // Native hosts can resize the frame before ResizeObserver updates React.
    // Both boxes must share the border in that same layout pass.
    const resizeError = await appFrame(page).evaluate((element) => {
      const frame = element as HTMLElement
      const previous = frame.style.width
      try {
        frame.style.width = '1280px'
        const panel = frame.querySelector('[class*="detailsCol"]')!.getBoundingClientRect()
        const handle = frame.querySelector('[data-side="details"]')!.getBoundingClientRect()
        return Math.abs(handle.x + handle.width / 2 - panel.x)
      } finally { frame.style.width = previous }
    })
    expect(resizeError, 'Workbench handle stays on the panel border during container resize').toBeLessThanOrEqual(1)
    const detailsBox = await detailsHandle.boundingBox()
    expect(detailsBox).not.toBeNull()
    const detailsStart = detailsBox!.x + detailsBox!.width / 2
    await page.mouse.move(detailsStart, detailsBox!.y + 200)
    await page.mouse.down()
    await page.mouse.move(detailsStart - 360, detailsBox!.y + 200, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => startColumns(page)).toBe(2)
    const wideWidth = await detailsTrack(page)
    const wideHandle = await detailsHandle.boundingBox()
    const wideStart = wideHandle!.x + wideHandle!.width / 2
    await page.mouse.move(wideStart, wideHandle!.y + 200)
    await page.mouse.down()
    await page.mouse.move(wideStart + wideWidth - 460, wideHandle!.y + 200, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => detailsTrack(page)).toBe(460)

    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await appFrame(page).waitFor({ timeout: 30_000 })
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)
    expect(await page.getByText('Details', { exact: true }).isVisible()).toBe(false)

    await page.getByRole('button', { name: /^(?:New session|新.*会话)$/ }).last().click()
    await page.getByText('How can I help?', { exact: false }).waitFor({ timeout: 15_000 })
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)
    expect(await page.getByText('Details', { exact: true }).isVisible()).toBe(false)

    const original = page.locator('[role=treeitem]').filter({ hasText: 'Reply with the single word' }).first()
    await original.click()
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)
    expect(await page.getByText('Details', { exact: true }).isVisible()).toBe(false)

    const ungrouped = page.getByText('Ungrouped', { exact: true })
    const ungroupedRow = ungrouped.locator('..').locator('..')
    const ungroupedSection = ungroupedRow.locator('..')
    await expect.poll(async () => {
      if (await ungroupedRow.getAttribute('aria-expanded') !== 'true') {
        await ungrouped.click()
        await page.waitForTimeout(50)
      }
      return await ungroupedRow.getAttribute('aria-expanded')
    }, { timeout: 5_000 }).toBe('true')
    const seeded = ungroupedSection.locator('[role="treeitem"]').nth(1)
    await seeded.click()
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['handles.expected.md'])
  }, 90_000)
})
