// Recorded read-tool history exercises shared Chat lazy disclosures.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, realizeSeedFixture,
  seedSession, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { expandOwningTurnProcess, newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v2.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/chat-core-upgrade/', import.meta.url))

it.skipIf(MODE === 'record').each([true, false])('replays lazy tool details with Trajectory enabled: %s', async (trajectoryEnabled) => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-trajectory-replay-'))
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const overlay = join(temporary, 'cordis.patch.yml')
    await writeFile(overlay, JSON.stringify(trajectoryEnabled ? [] : [{ id: 'ui-trajectory', disabled: true }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
    const expectedPrefix = trajectoryEnabled ? '' : 'without-trajectory-'
    const sessionId = 'chat-core-upgrade-e2e'
    await seedSession(scaffold, realizeSeedFixture(scaffold, await readFile(FIXTURE, 'utf8'), sessionId), sessionId)
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    try {
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      const group = page.getByRole('treeitem').first()
      await group.waitFor({ timeout: 30_000 })
      if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
      await page.locator('[role="treeitem"][aria-selected]').first().click()
      await page.getByText('DONE', { exact: true }).waitFor({ timeout: 30_000 })
      expect(await page.getByRole('navigation', { name: 'Turn navigation' }).count()).toBe(0)

      const tool = page.locator('[data-chat-call-id]').filter({ hasText: 'a.txt' }).first()
      await expandOwningTurnProcess(page, tool)
      const disclosure = tool.locator('[data-disclosure-row][aria-expanded]').first()
      await disclosure.waitFor()
      expect(await disclosure.getAttribute('aria-expanded')).toBe('false')
      expect(await tool.getByText('alpha', { exact: false }).count()).toBe(0)
      await compareOrRefreshGolden(
        `${EXPECTED}${expectedPrefix}tool-collapsed.expected.md`,
        await captureStableAria(page, '[data-chat-call-id]', scaffold.workspaceCwd), MODE,
      )
      await disclosure.click()
      await expect.poll(() => disclosure.getAttribute('aria-expanded')).toBe('true')
      await tool.getByText('alpha', { exact: false }).first().waitFor()
      expect(await tool.getByRole('button', { name: 'Inspect', exact: true }).count()).toBe(trajectoryEnabled ? 1 : 0)
      await compareOrRefreshGolden(
        `${EXPECTED}${expectedPrefix}tool-expanded.expected.md`,
        await captureStableAria(page, '[data-chat-call-id]', scaffold.workspaceCwd), MODE,
      )
      await disclosure.click()
      expect(await tool.getByText('alpha', { exact: false }).count()).toBe(0)
      await disclosure.click()
      await tool.getByText('alpha', { exact: false }).first().waitFor()
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    } catch (error) {
      await saveFailureShot(page, 'web-e2e-chat-core-upgrade')
      throw error
    }
  } finally {
    await browser?.close()
    await scaffold?.close()
    await rm(temporary, { recursive: true, force: true })
  }
})
