/** Opt-in real cloud image path through the complete packaged OS. Private fixture credentials stay native. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { chromium } from 'playwright'
import type { FrameLocator, Response } from 'playwright'
import { expect, it } from 'vitest'
import { ArivoRuntime } from '../../electrobun/src/distribution/arivo-runtime.ts'

interface Fixture {
  apiOrigin: string
  tokens: unknown
  workspaceId: string
  projectId: string
  adapterId: string
  receipt: string
  offlineMarker: string
  maxCredits: number
  quoteOnly: boolean
  pollOnlyRecovery: boolean
  reference: { sourcePath: string; bytes: number; sha256: string }
}
interface Command {
  record: {
    phase: string
    request: { commandId: string; input: { referenceAssets: { assetVersionId: string }[] } }
    quote: { estimatedCredits: string }
    call: null | { callId: string; status: string; billingState: string }
  }
  downloads: { assetVersionId: string; original: { name: string; bytes: number; sha256: string } }[]
}

it.skipIf(!process.env.ARIVO_TEST_IMAGE_FIXTURE || !process.env.ARIVO_TEST_APPLICATION || process.platform !== 'darwin')('real image in packaged Studio survives lost acceptance, download failure and offline Host restart', async (context) => {
  const fixturePath = process.env.ARIVO_TEST_IMAGE_FIXTURE!
  expect((await stat(fixturePath)).mode & 0o077).toBe(0)
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture
  expect(new URL(fixture.apiOrigin).origin).toBe(fixture.apiOrigin)
  expect(new URL(fixture.apiOrigin).hostname).toBe('127.0.0.1')
  expect(fixture.maxCredits).toBeGreaterThan(0); expect(fixture.maxCredits).toBeLessThanOrEqual(2)
  const payload = join(process.env.ARIVO_TEST_APPLICATION!, 'Contents/Resources/app')
  const metadata = JSON.parse(await readFile(join(payload, '../version.json'), 'utf8')) as { hash: string; version: string }
  const directory = await mkdtemp(join(tmpdir(), 'arivo-real-image-product-')), home = join(directory, 'home')
  const helper = join(payload, 'native/keychain')
  const key = `arivo-desktop-v1:${createHash('sha256').update(`${fixture.apiOrigin}\0${fixture.apiOrigin}`).digest('hex')}`
  const credential = (operation: 'get' | 'set' | 'delete', input = '') => new Promise<number>((resolve, reject) => {
    const child = spawn(helper, [operation, key], { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'ignore', 'ignore'] })
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Native credential helper timed out')) }, 10000)
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('close', (code) => { clearTimeout(timeout); resolve(code ?? -1) })
    child.stdin.on('error', () => { /* Helper exit reports failure without exposing private input. */ }); child.stdin.end(input)
  })
  const config = { binary: join(payload, 'dsh'), installAnchor: join(payload, 'runtime/package.json'), home,
    instanceHelper: join(payload, 'native/instance'), pluginDirectory: join(payload, 'plugins/arivo'),
    shellDirectory: join(payload, 'arivo-shell'), manifestSha256: metadata.hash, pluginVersion: metadata.version,
    target: 'darwin-arm64' as const, maxPluginBytes: 128 * 1024 * 1024, startupTimeoutMs: 30000, shutdownTimeoutMs: 5000,
    identity: { apiOrigin: fixture.apiOrigin, webOrigin: fixture.apiOrigin, keychainHelper: helper,
      requestTimeoutMs: 10000, loginTimeoutMs: 30000 } }
  let runtime = new ArivoRuntime(config), credentialOwned = false
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  context.onTestFinished(async () => {
    try { await browser.close() } finally {
      try { await runtime.stop() } finally {
        try { if (credentialOwned) await credential('delete') } finally { await rm(directory, { recursive: true, force: true }) }
      }
    }
  })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
  const errors: string[] = [], snapshots = join(process.cwd(), 'output/playwright/arivo-real-images')
  await mkdir(snapshots, { recursive: true })
  page.on('pageerror', error => errors.push(error.message))
  const localResponse = (route: string) => page.waitForResponse(response => new URL(response.url()).pathname.endsWith(route)
    && response.request().method() === 'POST' && response.url().includes('/api/media/projects/'))
  const openProject = async (): Promise<FrameLocator> => {
    await page.getByRole('button', { name: /Arivo (创作|Studio)/u }).click()
    const studio = page.frameLocator('iframe.arivo-pane')
    await studio.getByRole('button', { name: '打开项目', exact: true }).click()
    await studio.getByRole('button', { name: '图片制作', exact: true }).click()
    await studio.getByRole('button', { name: '选择云端计费项目', exact: true }).waitFor()
    return studio
  }
  const reopen = async () => {
    await page.goto('about:blank'); await runtime.stop()
    runtime = new ArivoRuntime(config); await runtime.start(); await page.goto(await runtime.agentUrl())
    expect(await page.getByRole('button', { name: '设置', exact: true }).count()).toBe(1)
    return openProject()
  }
  const clickCommand = async (studio: FrameLocator, label: string, route: string): Promise<Response> => {
    const pending = localResponse(route)
    await studio.getByRole('button', { name: label, exact: true }).click()
    const response = await pending
    await studio.getByRole('status').filter({ hasText: /^(操作已保存。|操作未完成)/u }).waitFor()
    return response
  }
  try {
    expect(await credential('get')).toBe(44); credentialOwned = true
    expect(await credential('set', JSON.stringify({ format: 1, apiOrigin: fixture.apiOrigin, webOrigin: fixture.apiOrigin,
      phase: 'active', tokens: fixture.tokens }))).toBe(0)
    await runtime.start(); await page.goto(await runtime.agentUrl())
    await page.getByRole('navigation', { name: '会话', exact: true }).waitFor()
    await page.getByRole('button', { name: /Arivo (创作|Studio)/u }).click()
    let studio = page.frameLocator('iframe.arivo-pane')
    await studio.getByTestId('create-project').click()
    await studio.getByLabel('项目名称', { exact: true }).fill('真实图片完整产品验收')
    await studio.getByRole('button', { name: '创建项目', exact: true }).click()
    await studio.getByRole('button', { name: '打开项目', exact: true }).click()
    await studio.locator('input[type="file"]').setInputFiles(fixture.reference.sourcePath)
    await studio.getByText('原图已保存到本机。', { exact: true }).waitFor()
    await studio.getByRole('button', { name: '图片制作', exact: true }).click()
    await studio.getByRole('button', { name: '选择云端计费项目', exact: true }).click()
    await studio.getByLabel('计费空间', { exact: true }).selectOption(fixture.workspaceId)
    await studio.getByLabel('计费项目', { exact: true }).selectOption(fixture.projectId)
    await studio.getByRole('button', { name: '加载图片模型', exact: true }).click()
    await studio.getByLabel('图片模型', { exact: true }).selectOption(fixture.adapterId)
    const uploadResponse = await clickCommand(studio, '上传参考图', '/upload')
    expect(uploadResponse.ok()).toBe(true)
    const upload = await uploadResponse.json() as { remoteOriginal: { assetVersionId: string; fileSize: number; checksumSha256: string } }
    expect(upload.remoteOriginal.fileSize).toBe(fixture.reference.bytes)
    expect(upload.remoteOriginal.checksumSha256).toBe(fixture.reference.sha256)
    await studio.getByLabel(basename(fixture.reference.sourcePath), { exact: true }).check()
    await studio.getByLabel('提示词', { exact: true }).fill('Use the reference image composition. Create a blue ceramic sphere on the left and a red ceramic pyramid on the right, on a plain warm gray table. Preserve the two colors and left-right arrangement, soft studio light, no text, no logo.')
    const quoted = await clickCommand(studio, '获取报价', '/quote')
    expect(quoted.ok()).toBe(true)
    const quote = await quoted.json() as Command, credits = Number(quote.record.quote.estimatedCredits)
    expect(credits).toBeGreaterThan(0); expect(credits).toBeLessThanOrEqual(fixture.maxCredits)
    expect(quote.record.request.input.referenceAssets).toEqual([{ assetVersionId: upload.remoteOriginal.assetVersionId,
      kind: 'image', role: 'reference_image' }])
    const reference = { assetVersionId: upload.remoteOriginal.assetVersionId,
      bytes: fixture.reference.bytes, sha256: fixture.reference.sha256 }
    const uploads = { intents: 1, completions: 1 }
    if (fixture.quoteOnly) {
      await writeFile(fixture.receipt, JSON.stringify({ acceptance: 'real-image-quote-only', estimatedCredits: String(credits),
        quotes: 1, creates: 0, paidCalls: 0, reference, uploads, packagedProduct: true }) + '\n', { mode: 0o600, flag: 'wx' })
    } else {
      expect((await clickCommand(studio, '确认报价并生成', '/approve')).ok()).toBe(false)
      await studio.getByRole('button', { name: '恢复原任务状态', exact: true }).waitFor()
      studio = await reopen()
      await studio.getByRole('button', { name: '查看命令', exact: true }).click()
      let view: Command, reads = 0
      const deadline = Date.now() + 420000
      do {
        const response = await clickCommand(studio, '恢复原任务状态', '/refresh')
        expect(response.ok()).toBe(true); view = await response.json() as Command; reads++
        expect(view.record.request.commandId).toBe(quote.record.request.commandId)
        if (view.record.call?.status === 'succeeded' && view.record.call.billingState === 'settled') break
        expect(['failed', 'cancelled']).not.toContain(view.record.call?.status)
        await new Promise<void>(resolve => setTimeout(resolve, 1000))
      } while (Date.now() < deadline)
      expect(view.record.call).toMatchObject({ status: 'succeeded', billingState: 'settled' })
      expect((await clickCommand(studio, '保存原图到本机', '/download')).ok()).toBe(false)
      studio = await reopen(); await studio.getByRole('button', { name: '查看命令', exact: true }).click()
      const imageResponse = page.waitForResponse(response => response.url().includes('/api/images/') && response.ok())
      const downloaded = await clickCommand(studio, '保存原图到本机', '/download')
      expect(downloaded.ok()).toBe(true); const saved = (await downloaded.json() as Command).downloads
      expect(saved).toHaveLength(1)
      const dimensions = (await imageResponse).headers(), original = { bytes: saved[0]!.original.bytes, sha256: saved[0]!.original.sha256,
        width: Number(dimensions['x-arivo-image-width']), height: Number(dimensions['x-arivo-image-height']) }
      expect(original.width).toBeGreaterThan(1); expect(original.height).toBeGreaterThan(1)
      await studio.getByRole('button', { name: `查看图片: ${saved[0]!.original.name}`, exact: true }).scrollIntoViewIfNeeded()
      await expect.poll(() => studio.locator('.image-result img').evaluateAll(images => images.some(image =>
        image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
      await writeFile(fixture.offlineMarker, 'offline', { mode: 0o600, flag: 'wx' })
      studio = await reopen(); await studio.getByRole('button', { name: '查看命令', exact: true }).click()
      await studio.getByText(`已保存到本机: ${saved[0]!.original.name}`, { exact: true }).waitFor()
      await studio.getByRole('button', { name: `查看图片: ${saved[0]!.original.name}`, exact: true }).scrollIntoViewIfNeeded()
      await expect.poll(() => studio.locator('.image-result img').evaluateAll(images => images.some(image =>
        image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
      await writeFile(join(snapshots, 'offline-ui.txt'), await page.locator('body').ariaSnapshot() + '\n' + await studio.locator('body').ariaSnapshot())
      await page.getByRole('button', { name: '备份与恢复', exact: true }).click()
      const backupResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/backups'
        && response.request().method() === 'POST')
      await page.frameLocator('iframe.arivo-pane').getByTestId('create-backup').click()
      const backup = await (await backupResponse).json() as { schemaVersion: number }
      expect(backup.schemaVersion).toBeGreaterThanOrEqual(7)
      await page.frameLocator('iframe.arivo-pane').getByRole('button', { name: '恢复', exact: true }).click()
      await page.frameLocator('iframe.arivo-pane').getByRole('button', { name: '确认恢复', exact: true }).click()
      await page.frameLocator('iframe.arivo-pane').getByText('备份已恢复，当前内容已保留恢复副本。', { exact: true }).waitFor()
      studio = await openProject(); await studio.getByRole('button', { name: '查看命令', exact: true }).click()
      await studio.getByText(`已保存到本机: ${saved[0]!.original.name}`, { exact: true }).waitFor()
      await studio.getByRole('button', { name: `查看图片: ${saved[0]!.original.name}`, exact: true }).scrollIntoViewIfNeeded()
      await expect.poll(() => studio.locator('.image-result img').evaluateAll(images => images.some(image =>
        image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
      await writeFile(join(snapshots, 'restored-ui.txt'), await page.locator('body').ariaSnapshot() + '\n' + await studio.locator('body').ariaSnapshot())
      await writeFile(fixture.receipt, JSON.stringify({ acceptance: 'real-native-image', callId: view.record.call!.callId,
        assetVersionId: saved[0]!.assetVersionId, original, counts: { quotes: 1, creates: 1, reads, manifests: 2 },
        lostCreateRecovered: true, downloadRecovery: true, offlineWorkerRestart: true, backupRestore: true,
        localDerivatives: true, schemaVersion: backup.schemaVersion, realReferenceGeneration: !fixture.pollOnlyRecovery, reference, uploads,
        packagedProduct: true, bundledManifestSha256: metadata.hash, nativeWindow: 'pending' }) + '\n', { mode: 0o600, flag: 'wx' })
    }
    expect(errors).toEqual([])
    await page.goto('about:blank'); await runtime.stop()
    expect(await credential('delete')).toBe(0); credentialOwned = false; expect(await credential('get')).toBe(44)
  } catch (error) {
    await writeFile(join(snapshots, 'failed-ui.txt'), await page.locator('body').ariaSnapshot() + '\n'
      + await page.frameLocator('iframe.arivo-pane').locator('body').ariaSnapshot().catch(() => 'Studio unavailable'))
    throw error
  }
}, 480000)
