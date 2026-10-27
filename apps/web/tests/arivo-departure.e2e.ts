/** Normal installed Arivo shell, real SQLite Worker and UI departure regression; no Provider calls. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, webkit, type FrameLocator, type Route } from 'playwright'
import { expect, it } from 'vitest'

it.skipIf(!process.env.ARIVO_TEST_APPLICATION)('preserves script input across Rail and Workbench departure, refuses uncertain saves and dirty dialogs', async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), 'arivo-shell-departure-'))
  const child = spawn(process.execPath, ['--import', 'tsx/esm',
    fileURLToPath(new URL('../../electrobun/tests/fixtures/arivo-browser-profile.ts', import.meta.url)),
    process.env.ARIVO_TEST_APPLICATION!, join(temporary, 'home')], { stdio: ['ignore', 'pipe', 'pipe'] })
  const done = new Promise<void>((resolve) => { child.once('close', () => { resolve() }) })
  child.stderr.resume()
  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('Installed profile did not become ready')) }, 40000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', () => { clearTimeout(timer); reject(new Error('Installed profile exited before readiness')) })
    let buffer = ''
    child.stdout.on('data', (part) => {
      buffer += String(part)
      const match = buffer.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]{43}/u)
      if (match) { clearTimeout(timer); resolve(match[0]) }
      if (buffer.length > 65536) { clearTimeout(timer); reject(new Error('Installed profile readiness exceeded its byte limit')) }
    })
  })
  const browser = await (process.env.ARIVO_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true })
  context.onTestFinished(async () => {
    await browser.close()
    child.kill('SIGTERM')
    let killed = false
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL') }, 10000)
    try { await done } finally { clearTimeout(timer); await rm(temporary, { recursive: true, force: true }) }
    expect(killed).toBe(false); expect(child.exitCode).toBe(0)
  })
  const browserContext = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1540, height: 1100 } })
  const page = await browserContext.newPage(), errors: string[] = [], alerts: string[] = []
  page.on('pageerror', (error) => { errors.push(error.message) })
  page.on('dialog', async (dialog) => { alerts.push(dialog.message()); await dialog.accept() })
  page.setDefaultTimeout(15000)
  const output = join('output/playwright/arivo-departure'); await mkdir(output, { recursive: true })
  let held: Route | undefined, failSave = false
  const commands: string[] = []
  await page.route('**/api/story/draft', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    const command = JSON.parse(route.request().postData()!) as { commandId: string }
    commands.push(command.commandId)
    if (failSave) { await route.fetch(); await route.abort(); return }
    held = route
  })
  const releaseSave = async () => {
    await expect.poll(() => !!held).toBe(true)
    const route = held!; held = undefined
    await route.continue()
  }
  const enterScript = async (frame: FrameLocator, boundProject = false) => {
    if (!boundProject) {
      await frame.getByRole('button', { name: '打开项目', exact: true }).click()
    }
    await frame.getByRole('button', { name: '剧本', exact: true }).click()
    await frame.getByRole('textbox', { name: '剧本正文', exact: true }).waitFor()
  }
  try {
    await page.goto(await ready)
    await page.getByRole('button', { name: 'Arivo 创作', exact: true }).first().click()
    let frame = page.frameLocator('iframe.arivo-pane:not(.arivo-workbench-pane)')
    await frame.getByTestId('create-project').click()
    await frame.getByLabel('项目名称', { exact: true }).fill('离页输入保护')
    await frame.getByRole('button', { name: '创建项目', exact: true }).click()
    const projectFolder = join(temporary, 'creative-project')
    await mkdir(projectFolder, { mode: 0o700 })
    const folderPicker = page.getByRole('dialog', { name: '选择工作区目录', exact: true })
    await folderPicker.getByRole('button', { name: '编辑路径', exact: true }).click()
    await folderPicker.getByRole('textbox', { name: '编辑路径', exact: true }).fill(projectFolder)
    await folderPicker.getByRole('textbox', { name: '编辑路径', exact: true }).press('Enter')
    await folderPicker.getByRole('button', { name: '打开', exact: true }).click()
    await folderPicker.waitFor({ state: 'hidden' })
    await frame.getByRole('button', { name: '新建项目对话', exact: true }).click()
    await page.locator('[data-arivo-pane]').waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Arivo 创作', exact: true }).and(page.locator('.arivo-rail-item')).click()
    await frame.getByRole('button', { name: '打开项目', exact: true }).click()
    await frame.getByRole('button', { name: '剧本', exact: true }).click()
    await frame.getByRole('heading', { name: '还没有分集', exact: true }).waitFor()
    await frame.getByRole('button', { name: '新建分集', exact: true }).first().click()
    await frame.getByLabel('集标题', { exact: true }).fill('切换前保存')
    await frame.getByRole('button', { name: '创建并开始写', exact: true }).click()
    await frame.getByRole('dialog').waitFor({ state: 'detached' })
    const original = '外景 · 码头 · 黎明\n离页前确认这份正文已经保存。'
    await frame.getByRole('textbox', { name: '剧本正文', exact: true }).fill(original)
    await page.getByRole('button', { name: 'Arivo 账号', exact: true }).click()
    await expect.poll(() => frame.locator('#app').evaluate(node => (node as HTMLElement).inert)).toBe(true)
    await page.screenshot({ path: join(output, '01-rail-waits-for-local-save.png'), fullPage: true })
    await releaseSave()
    await page.locator('iframe[title="Arivo 账号"]').waitFor()
    await page.getByRole('button', { name: 'Arivo 创作', exact: true }).first().click()
    await enterScript(frame)
    expect(await frame.getByRole('textbox', { name: '剧本正文', exact: true }).inputValue()).toBe(original)
    // The mutation is durable but its reply is lost. Departure must retain the original editor.
    failSave = true
    await frame.getByRole('textbox', { name: '剧本正文', exact: true }).fill(original + '\n丢响应后保留输入。')
    await page.getByRole('button', { name: 'Arivo 账号', exact: true }).click()
    await expect.poll(() => alerts.length).toBe(1)
    expect(await frame.getByRole('textbox', { name: '剧本正文', exact: true }).inputValue()).toBe(original + '\n丢响应后保留输入。')
    expect(await frame.locator('#app').evaluate(node => (node as HTMLElement).inert)).toBe(false)
    const uncertain = commands.at(-1)
    failSave = false
    await frame.getByRole('button', { name: '重试原操作', exact: true }).click()
    await releaseSave()
    await frame.getByText('草稿已保存到本机', { exact: true }).waitFor()
    expect(commands.at(-1)).toBe(uncertain)
    await page.screenshot({ path: join(output, '02-original-command-recovered.png'), fullPage: true })
    await frame.getByRole('button', { name: '新建分集', exact: true }).first().click()
    await frame.getByLabel('集标题', { exact: true }).fill('尚未提交的第二集')
    await page.getByRole('button', { name: 'Arivo 账号', exact: true }).click()
    await expect.poll(() => alerts.length).toBe(2)
    expect(await frame.getByLabel('集标题', { exact: true }).inputValue()).toBe('尚未提交的第二集')
    await page.screenshot({ path: join(output, '03-dirty-dialog-retained.png'), fullPage: true })
    await frame.getByRole('dialog').getByRole('button', { name: '关闭弹窗', exact: true }).click()
    await page.getByRole('button', { name: '会话', exact: true }).click()
    await page.getByRole('button', { name: '工作台', exact: true }).click()
    await page.locator('.arivo-workbench-open').click()
    frame = page.frameLocator('iframe.arivo-workbench-pane')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.locator('iframe.arivo-workbench-pane').waitFor()
    await writeFile(join(output, 'workbench-geometry.json'), JSON.stringify(await page.locator('iframe.arivo-workbench-pane').evaluate((node) => {
      const ancestors = []
      for (let current: Element | null = node; current; current = current.parentElement) {
        const box = current.getBoundingClientRect(), style = getComputedStyle(current)
        ancestors.push({ tag: current.tagName, class: current.className, width: box.width, height: box.height, x: box.x, y: box.y,
          display: style.display, grid: style.gridTemplateColumns, overflow: style.overflow, minWidth: style.minWidth })
      }
      return { viewport: window.innerWidth, document: document.documentElement.scrollWidth, ancestors }
    }), null, 2))
    await expect.poll(async () => {
      const box = await page.locator('iframe.arivo-workbench-pane').boundingBox()
      return box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1281
        && box.y + box.height <= 901 && box.width >= 299 && box.height > 400
    }).toBe(true)
    expect(await page.locator('.arivo-topbar').evaluate((header) => {
      let frame: HTMLElement | null = header.parentElement
      while (frame && getComputedStyle(frame).display !== 'grid') frame = frame.parentElement
      return frame ? getComputedStyle(frame).transitionProperty : undefined
    })).toBe('none')
    // Native acceptance exposed an open preference with no visible panel. Keep geometry
    // checks on ordinary toggles and the narrow overlay, before any editor mutation.
    const expectVisibleWorkbench = async () => {
      await expect.poll(async () => {
        const box = await page.locator('iframe.arivo-workbench-pane').boundingBox()
        const viewport = page.viewportSize()!
        return box !== null && box.x >= 0 && box.y >= 0 && box.width >= 299 && box.height > 400
          && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1
      }).toBe(true)
    }
    await page.getByRole('button', { name: '收起侧栏', exact: true }).first().click()
    await expectVisibleWorkbench()
    await page.getByRole('button', { name: '展开侧栏', exact: true }).first().click()
    await expectVisibleWorkbench()
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.getByRole('button', { name: '工作台', exact: true }).click()
      await expect.poll(() => page.getByRole('button', { name: '工作台', exact: true }).getAttribute('aria-pressed')).toBe('false')
      await page.getByRole('button', { name: '工作台', exact: true }).click()
      await expectVisibleWorkbench()
    }
    await page.setViewportSize({ width: 860, height: 900 })
    await expectVisibleWorkbench()
    await page.setViewportSize({ width: 1280, height: 900 })
    await expectVisibleWorkbench()
    await page.screenshot({ path: join(output, '04a-workbench-toggle-and-resize.png'), fullPage: true })
    await enterScript(frame, true)
    const workbenchText = original + '\nWorkbench 换标签也要保存。'
    await frame.getByRole('textbox', { name: '剧本正文', exact: true }).fill(workbenchText)
    await page.locator('[data-workbench-tab="start"] button').first().click()
    await expect.poll(() => frame.locator('#app').evaluate(node => (node as HTMLElement).inert)).toBe(true)
    await releaseSave()
    await page.locator('iframe.arivo-workbench-pane').waitFor({ state: 'detached' })
    await page.locator('.arivo-workbench-open').click(); await enterScript(frame, true)
    expect(await frame.getByRole('textbox', { name: '剧本正文', exact: true }).inputValue()).toBe(workbenchText)
    const closingText = original + '\nWorkbench 关闭标签也要保存。'
    await frame.getByRole('textbox', { name: '剧本正文', exact: true }).fill(closingText)
    await page.locator('[data-workbench-tab="arivo.studio"] button').nth(1).click()
    await expect.poll(() => frame.locator('#app').evaluate(node => (node as HTMLElement).inert)).toBe(true)
    await releaseSave(); await page.locator('iframe.arivo-workbench-pane').waitFor({ state: 'detached' })
    await page.locator('.arivo-workbench-open').click(); await enterScript(frame, true)
    expect(await frame.getByRole('textbox', { name: '剧本正文', exact: true }).inputValue()).toBe(closingText)
    await page.screenshot({ path: join(output, '04-workbench-reopened-script.png'), fullPage: true })
    // Real sandboxed-page fetch to the native one-use callback server; no direct grant stub.
    const native = spawn(process.execPath, ['--import', 'tsx/esm',
      fileURLToPath(new URL('../../electrobun/tests/fixtures/arivo-native-departure-browser.ts', import.meta.url)),
      new URL(page.url()).origin], { stdio: ['pipe', 'pipe', 'pipe'] })
    const nativeDone = new Promise<void>((resolve) => { native.once('close', () => { resolve() }) })
    const nativeEvents: { granted?: boolean; released?: boolean }[] = [], nativeErrors: string[] = []
    let nativeBuffer = ''
    native.stderr.on('data', (part) => { nativeErrors.push(String(part)) })
    native.stdout.on('data', (part) => {
      nativeBuffer += String(part)
      let newline: number
      while ((newline = nativeBuffer.indexOf('\n')) >= 0) {
        const event = JSON.parse(nativeBuffer.slice(0, newline)) as { script?: string; granted?: boolean; released?: boolean }
        nativeBuffer = nativeBuffer.slice(newline + 1)
        if (event.script) void page.evaluate(event.script).catch((error: unknown) => { nativeErrors.push(String(error)) })
        else nativeEvents.push(event)
      }
    })
    try {
      native.stdin.write('prepare\n')
      await expect.poll(() => nativeEvents.length).toBe(1)
      expect(nativeEvents[0]).toEqual({ granted: true })
      expect(await page.evaluate(() => document.documentElement.inert)).toBe(true)
      expect(await frame.locator('#app').evaluate(node => (node as HTMLElement).inert)).toBe(true)
      await page.getByRole('button', { name: 'Arivo 账号', exact: true }).evaluate((node) => { (node as HTMLButtonElement).click() })
      expect(await page.locator('iframe.arivo-workbench-pane').count()).toBe(1)
      expect(await page.locator('iframe[title="Arivo 账号"]').count()).toBe(0)
      await page.screenshot({ path: join(output, '05-native-acknowledgement-holds-editors.png'), fullPage: true })
      native.stdin.write('release\n')
      await expect.poll(() => nativeEvents.length).toBe(2)
      expect(nativeEvents[1]).toEqual({ released: true })
      expect(await page.evaluate(() => document.documentElement.inert)).toBe(false)
      await expect.poll(() => frame.locator('#app').evaluate(node => (node as HTMLElement).inert)).toBe(false)
      await frame.getByRole('button', { name: '新建分集', exact: true }).first().click()
      await frame.getByLabel('集标题', { exact: true }).fill('原生退出不得丢失的输入')
      native.stdin.write('prepare\n')
      await expect.poll(() => nativeEvents.length).toBe(3)
      expect(nativeEvents[2]).toEqual({ granted: false })
      expect(await frame.getByLabel('集标题', { exact: true }).inputValue()).toBe('原生退出不得丢失的输入')
      await page.screenshot({ path: join(output, '06-native-dirty-dialog-refused.png'), fullPage: true })
      await frame.getByRole('dialog').getByRole('button', { name: '关闭弹窗', exact: true }).click()
      const versionText = closingText + '\n保存版本期间也不能退出。'
      await frame.getByRole('textbox', { name: '剧本正文', exact: true }).fill(versionText)
      await frame.getByRole('button', { name: '保存版本', exact: true }).click()
      await expect.poll(() => !!held).toBe(true)
      expect(await frame.getByRole('textbox', { name: '剧本正文', exact: true }).isDisabled()).toBe(true)
      native.stdin.write('prepare\n')
      await expect.poll(() => nativeEvents.length).toBe(4)
      expect(nativeEvents[3]).toEqual({ granted: false })
      expect(await page.evaluate(() => document.documentElement.inert)).toBe(false)
      await page.screenshot({ path: join(output, '07-native-version-intent-refused.png'), fullPage: true })
      await releaseSave()
      await frame.getByRole('button', { name: '查看版本 1', exact: true }).waitFor()
      native.stdin.write('prepare\n')
      await expect.poll(() => nativeEvents.length).toBe(5)
      expect(nativeEvents[4]).toEqual({ granted: true })
      native.stdin.write('release\n')
      await expect.poll(() => nativeEvents.length).toBe(6)
      expect(nativeEvents[5]).toEqual({ released: true })
      expect(await frame.getByRole('textbox', { name: '剧本正文', exact: true }).inputValue()).toBe(versionText)
    } finally { native.stdin.end(); await nativeDone }
    expect(native.exitCode).toBe(0); expect(nativeErrors).toEqual([])
    await writeFile(join(output, 'product-ui.txt'), await page.locator('body').ariaSnapshot())
    expect(errors).toEqual([])
  } catch (error) {
    await page.screenshot({ path: join(output, 'failed-product.png'), fullPage: true })
    await writeFile(join(output, 'failed-ui.txt'), await page.locator('body').ariaSnapshot())
    throw error
  }
})
