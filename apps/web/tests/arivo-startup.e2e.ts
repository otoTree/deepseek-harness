/** Real packaged OS plus startup plugin; no external model requests or enterprise services. */
import { mkdtemp, readFile, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import { ArivoRuntime } from '../../electrobun/src/distribution/arivo-runtime.ts'

it.skipIf(!process.env.ARIVO_TEST_APPLICATION)('restores a renamed conversation and its history in the normal product after Host restart', async (context) => {
  const payload = join(process.env.ARIVO_TEST_APPLICATION!, 'Contents/Resources/app')
  const metadata = JSON.parse(await readFile(join(payload, '../version.json'), 'utf8')) as { hash: string; version: string }
  const temporary = await mkdtemp(join(tmpdir(), 'arivo-history-browser-'))
  context.onTestFinished(() => rm(temporary, { recursive: true, force: true }))
  const home = join(temporary, 'home')
  const workspace = join(home, 'workspace')
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  const cwd = await realpath(workspace)
  const sessionId = SessionId(`session-${randomUUID()}`)
  const time = Date.now() - 60_000
  // A settled local history fixture; no provider or billing request is made.
  const events: SessionEvent[] = [
    { type: 'turn/start', seq: SessionSeq(0), time, data: { turn: 1 } },
    { type: 'user/message', seq: SessionSeq(1), time: time + 1, surfaceOp: 'append', data: createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '恢复验收：这段会话历史必须保留。' }],
    }) },
    { type: 'session/title', seq: SessionSeq(2), time: time + 2, data: { title: '恢复验收初始标题', messageSeqs: [], source: { kind: 'user' } } },
    { type: 'turn/end', seq: SessionSeq(3), time: time + 3, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const seeder = new Context()
  try {
    await seeder.plugin(JsonlSessionPersistence, { root: join(home, 'sessions') })
    const handle = await seeder.sessionPersistence.create({ version: SESSION_FORMAT_VERSION,
      id: sessionId, createdAt: time, isSeeded: false, cwd })
    await handle.append(events)
    await handle.close()
  } finally { await seeder.fiber.dispose() }
  const config = { binary: join(payload, 'dsh'), installAnchor: join(payload, 'runtime/package.json'), home,
    instanceHelper: join(payload, 'native/instance'), pluginDirectory: join(payload, 'plugins/arivo'),
    shellDirectory: join(payload, 'arivo-shell'), manifestSha256: metadata.hash, pluginVersion: metadata.version,
    target: 'darwin-arm64' as const, maxPluginBytes: 128 * 1024 * 1024, startupTimeoutMs: 30000, shutdownTimeoutMs: 5000 }
  const runtime = new ArivoRuntime(config)
  context.onTestFinished(() => runtime.stop())
  await runtime.start()
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  context.onTestFinished(() => browser.close())
  const browserContext = await browser.newContext({ locale: 'zh-CN', reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } })
  const page = await browserContext.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()) })
  const output = join(process.cwd(), 'output/playwright/arivo-history')
  await mkdir(output, { recursive: true })
  try {
    await page.goto(await runtime.agentUrl())
    const origin = new URL(page.url()).origin
    const adopted = await browserContext.request.post(`${origin}/api/session/create`, { headers: { Origin: origin }, data: {
      type: 'client-request', rpcId: randomUUID(), method: 'session/create', payload: { args: { request: { sessionId, cwd } } },
    } })
    const receipt = await adopted.json() as { result: { ok: boolean } }
    expect(receipt.result.ok).toBe(true)
    await page.getByRole('button', { name: '添加工作区', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择工作区目录', exact: true })
    await picker.getByRole('button', { name: '编辑路径', exact: true }).click()
    await picker.getByRole('textbox', { name: '编辑路径', exact: true }).fill(workspace)
    await picker.getByRole('textbox', { name: '编辑路径', exact: true }).press('Enter')
    await picker.getByRole('button', { name: '打开', exact: true }).click()
    await picker.waitFor({ state: 'hidden' })
    const tree = page.getByRole('tree', { name: '会话', exact: true })
    // A cold uncached title is resolved when its ordinary Session opens.
    await writeFile(join(output, 'before-open.txt'), await page.locator('body').ariaSnapshot())
    await tree.getByText('恢复验收初始标题', { exact: true }).click()
    await page.getByText('恢复验收：这段会话历史必须保留。', { exact: true }).waitFor()
    await writeFile(join(output, 'opened-ui.txt'), await page.locator('body').ariaSnapshot())
    await page.screenshot({ animations: 'disabled', path: join(output, 'opened.png') })
    await tree.getByRole('treeitem', { name: /^恢复验收初始标题/u }).hover()
    await page.getByRole('button', { name: '会话“恢复验收初始标题”的操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox').fill('Arivo 重开后的持久会话')
    await dialog.getByRole('button', { name: '重命名', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await tree.getByText('Arivo 重开后的持久会话', { exact: true }).waitFor()
    await page.screenshot({ animations: 'disabled', path: join(output, 'renamed.png') })
    await page.goto('about:blank')
    await runtime.stop()
    const reopened = new ArivoRuntime(config)
    context.onTestFinished(() => reopened.stop())
    await reopened.start()
    await page.goto(await reopened.agentUrl())
    await page.getByRole('tree', { name: '会话', exact: true }).getByText('Arivo 重开后的持久会话', { exact: true }).click()
    await page.getByText('恢复验收：这段会话历史必须保留。', { exact: true }).waitFor()
    await page.screenshot({ animations: 'disabled', path: join(output, 'restored.png') })
    await writeFile(join(output, 'restored-ui.txt'), await page.locator('body').ariaSnapshot())
    expect(errors).toEqual([])
    await writeFile(join(output, 'acceptance.json'), JSON.stringify({ persistedRename: true, fullHostRestart: true, originalHistoryRestored: true,
      providerCalls: 0, nativeGui: 'pending', realAccount: 'pending', errors }, null, 2) + '\n')
  } catch (error) {
    await writeFile(join(output, 'errors.json'), JSON.stringify(errors))
    await writeFile(join(output, 'failed.html'), await page.content())
    await writeFile(join(output, 'failed-ui.txt'), await page.locator('body').ariaSnapshot())
    await page.screenshot({ animations: 'disabled', path: join(output, 'failed.png') })
    throw error
  }
}, 90000)

it.skipIf(!process.env.ARIVO_TEST_APPLICATION)('keeps original Agent UI while mounting the startup creative plugin in the same shell', async (context) => {
  const app = process.env.ARIVO_TEST_APPLICATION!
  const resources = join(app, 'Contents/Resources')
  const payload = join(resources, 'app')
  const metadata = JSON.parse(await readFile(join(resources, 'version.json'), 'utf8')) as { hash: string; version: string }
  const temporary = await mkdtemp(join(tmpdir(), 'arivo-shell-browser-'))
  context.onTestFinished(() => rm(temporary, { recursive: true, force: true }))
  const runtime = new ArivoRuntime({ binary: join(payload, 'dsh'), installAnchor: join(payload, 'runtime/package.json'),
    home: join(temporary, 'home'), instanceHelper: join(payload, 'native/instance'), pluginDirectory: join(payload, 'plugins/arivo'),
    shellDirectory: join(payload, 'arivo-shell'), manifestSha256: metadata.hash, pluginVersion: metadata.version,
    target: 'darwin-arm64', maxPluginBytes: 128 * 1024 * 1024, startupTimeoutMs: 30000, shutdownTimeoutMs: 5000 })
  context.onTestFinished(() => runtime.stop())
  await runtime.start()
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  context.onTestFinished(() => browser.close())
  const browserContext = await browser.newContext({ locale: 'zh-CN', reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } })
  const page = await browserContext.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const initialDocument = await page.goto(await runtime.agentUrl())
  expect(await initialDocument!.text()).toContain('<title>Arivo</title>')
  expect(await initialDocument!.text()).toContain('data-dsh-product-title="Arivo"')
  const output = join(process.cwd(), 'output/playwright/arivo-startup')
  await mkdir(output, { recursive: true })
  try {
    await page.getByRole('button', { name: /Arivo (创作|Studio)/ }).waitFor({ timeout: 20000 })
    expect(await page.getByRole('dialog', { name: '内测声明', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: '稍后配置', exact: true }).count()).toBe(0)
    await expect.poll(() => page.locator('body').evaluate(body => getComputedStyle(body).getPropertyValue('--dsw-alias-bg-base').trim())).toBe('#050505')
    expect(await page.getByRole('button', { name: '会话', exact: true }).evaluate(button => getComputedStyle(button).backgroundColor)).toBe('rgb(42, 42, 42)')
    expect(await page.getByRole('button', { name: 'Arivo 创作', exact: true }).locator('img').getAttribute('src')).toMatch(/^data:image\/png;base64,/u)
    expect(await page.locator('body').evaluate(body => getComputedStyle(body).backgroundColor)).toBe('rgb(5, 5, 5)')
    expect(await page.locator('body').evaluate(body => getComputedStyle(body).fontFamily)).toContain('Noto Sans SC Variable')
    await page.screenshot({ animations: 'disabled', path: join(output, 'agent-default.png') })
    await writeFile(join(output, 'initial-ui.txt'), await page.locator('body').ariaSnapshot())
    expect(await page.title()).toMatch(/^Arivo/u)
    const document = await browserContext.request.get(page.url())
    const markup = await document.text()
    expect(markup).toContain('<title>Arivo</title>')
    expect(markup).toContain('data-dsh-product-title="Arivo"')
    expect(markup).toContain('data:image/png;base64,')
    await page.getByRole('button', { name: '添加工作区', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择工作区目录', exact: true })
    await picker.getByRole('button', { name: '编辑路径', exact: true }).click()
    await picker.getByRole('textbox', { name: '编辑路径', exact: true }).fill(join(temporary, 'home/workspace'))
    await picker.getByRole('textbox', { name: '编辑路径', exact: true }).press('Enter')
    await picker.getByRole('button', { name: '打开', exact: true }).click()
    await picker.waitFor({ state: 'hidden' })
    const unavailableComposer = page.getByRole('textbox', { name: /^(当前模型不可用，请先选择模型|This model is unavailable — select one to continue)$/u })
    expect(await unavailableComposer.isDisabled()).toBe(true)
    const osOrigin = new URL(page.url()).origin
    await page.getByRole('button', { name: /Arivo (创作|Studio)/ }).click()
    const studio = page.frameLocator('iframe.arivo-pane')
    await studio.getByRole('heading', { name: /^(项目|Projects)$/ }).waitFor({ timeout: 15000 })
    expect(new URL(page.url()).origin).toBe(osOrigin)
    expect(await page.locator('iframe').count()).toBe(1)
    const embedded = page.frames().find(frame => new URL(frame.url()).pathname === '/embedded')
    expect(embedded).toBeDefined()
    const framedPage = await browserContext.request.get(embedded!.url())
    expect(framedPage.headers()['content-security-policy']).toContain(`frame-ancestors ${osOrigin};`)
    const foreignOrigin = await browserContext.request.get(embedded!.url(), { headers: { Origin: 'https://foreign.example' } })
    expect(foreignOrigin.status()).toBe(403)
    expect(new URL(embedded!.url()).searchParams.get('page')).toBe('projects')
    expect(new URL(embedded!.url()).searchParams.has('token')).toBe(false)
    for (const suffix of ['&page=account', '&workspace_id=foreign']) {
      expect((await browserContext.request.get(embedded!.url() + suffix)).status()).toBe(400)
    }
    expect(await studio.locator('.sidebar').isVisible()).toBe(false)
    await page.waitForFunction(() => {
      const frame = window.document.querySelector<HTMLIFrameElement>('iframe.arivo-pane')
      return frame !== null && frame.getBoundingClientRect().left <= 60
    }, undefined, { timeout: 5000 })
    expect((await page.locator('iframe.arivo-pane').boundingBox())!.width).toBeGreaterThan(1000)
    await studio.getByTestId('create-project').click()
    await studio.getByLabel('项目名称', { exact: true }).fill('同窗启动插件验收')
    await studio.getByLabel('故事梗概', { exact: true }).fill('原始 Agent 与本地创作共用完整 OS 底座。')
    await studio.getByRole('button', { name: '创建项目', exact: true }).click()
    await studio.getByRole('heading', { name: '同窗启动插件验收', exact: true }).waitFor()
    await page.screenshot({ animations: 'disabled', path: join(output, 'studio-in-os.png') })
    await page.getByRole('button', { name: /^(会话|Sessions)$/ }).click()
    expect(await unavailableComposer.isDisabled()).toBe(true)
    await page.screenshot({ animations: 'disabled', path: join(output, 'agent-returned.png') })
    await page.getByRole('button', { name: /Arivo (创作|Studio)/ }).click()
    await studio.getByRole('heading', { name: '同窗启动插件验收', exact: true }).waitFor()
    await page.getByRole('button', { name: '备份与恢复', exact: true }).click()
    await studio.getByRole('heading', { name: '备份与恢复', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Arivo 账号', exact: true }).click()
    await studio.getByRole('heading', { name: 'Arivo 账号', exact: true }).waitFor()
    await studio.getByRole('status').filter({ hasText: '此安装版本尚未配置账号连接。' }).waitFor()
    await page.screenshot({ animations: 'disabled', path: join(output, 'account-in-os.png') })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    // Await the settings surface before choosing its account section over the rail entry.
    await page.getByRole('button', { name: '通用设置', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Arivo 账号', exact: true }).last().click()
    await studio.getByRole('heading', { name: 'Arivo 账号', exact: true }).waitFor()
    await page.screenshot({ animations: 'disabled', path: join(output, 'account-in-settings.png') })
    await page.getByRole('button', { name: '通用设置', exact: true }).click()
    await page.getByRole('button', { name: '浅色', exact: true }).click()
    await expect.poll(() => page.locator('body').evaluate(body => getComputedStyle(body).getPropertyValue('--dsw-alias-bg-base').trim())).toBe('#f7f7f7')
    await page.getByRole('button', { name: 'Arivo 创作', exact: true }).click()
    await studio.getByRole('heading', { name: '同窗启动插件验收', exact: true }).waitFor()
    expect(await studio.locator('html').getAttribute('data-scheme')).toBe('light')
    expect(await page.locator('body').evaluate(body => getComputedStyle(body).backgroundColor)).toBe('rgb(247, 247, 247)')
    expect(await studio.locator('body').evaluate(body => getComputedStyle(body).backgroundColor)).toBe('rgb(247, 247, 247)')
    const lightTitle = studio.getByRole('heading', { name: '同窗启动插件验收', exact: true })
    await lightTitle.waitFor()
    expect(await lightTitle.evaluate(element => getComputedStyle(element).color)).toBe('rgb(10, 10, 10)')
    await page.screenshot({ animations: 'disabled', path: join(output, 'studio-light-in-os.png') })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '通用设置', exact: true }).click()
    await page.getByRole('button', { name: '深色', exact: true }).click()
    await expect.poll(() => page.locator('body').evaluate(body => getComputedStyle(body).getPropertyValue('--dsw-alias-bg-base').trim())).toBe('#050505')
    await page.getByRole('button', { name: '中文', exact: true }).click()
    await page.screenshot({ animations: 'disabled', path: join(output, 'locale-menu-in-os.png') })
    await page.getByRole('menuitem', { name: 'English', exact: true }).click()
    await page.getByRole('button', { name: 'Arivo account', exact: true }).first().click()
    await studio.getByRole('heading', { name: 'Arivo account', exact: true }).waitFor()
    expect(await studio.locator('html').getAttribute('data-language')).toBe('en')
    await page.screenshot({ animations: 'disabled', path: join(output, 'account-english-in-os.png') })
    await page.getByRole('button', { name: /^(会话|Sessions)$/ }).click()
    expect(await unavailableComposer.isDisabled()).toBe(true)
    expect(errors).toEqual([])
    await writeFile(join(output, 'acceptance.json'), JSON.stringify({ originalOsDefault: true, startupPlugin: true, arivoGlobalTheme: true, realRailPages: true, lightDarkShellAndFrame: true, osLocalePropagatesToFrame: true, accountInOsSettings: true, noDeepSeekKeyOnboarding: true,
      sameWindow: true, exactOwnerFramePolicy: true, foreignOriginRejected: true,
      originalWorkspaceCreated: true, unconfiguredAgentComposerDisabled: true,
      localProjectCreated: true, paneReopenPreservesProject: true,
      actualModelDialogue: 'pending', nativeGui: 'pending', accountSessionIsolation: 'pending', errors }, null, 2) + '\n')
  } catch (error) {
    await writeFile(join(output, 'failed-ui.txt'), await page.locator('body').ariaSnapshot())
    await page.screenshot({ animations: 'disabled', path: join(output, 'failed.png') })
    throw error
  }
}, 90000)

it.skipIf(!process.env.ARIVO_TEST_APPLICATION)('recovers one image command through the bundled Studio rail without replacing the original Agent', async (context) => {
  const payload = join(process.env.ARIVO_TEST_APPLICATION!, 'Contents/Resources/app')
  const metadata = JSON.parse(await readFile(join(payload, '../version.json'), 'utf8')) as { hash: string; version: string }
  const temporary = await mkdtemp(join(tmpdir(), 'arivo-images-in-os-'))
  const home = join(temporary, 'home'), workspace = join(temporary, 'workspace')
  await mkdir(workspace, { mode: 0o700 })
  const workspaceId = randomUUID(), projectId = randomUUID(), adapterId = randomUUID(), versionId = randomUUID()
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63706838f01f00050402803c9e03800000000049454e44ae426082', 'hex')
  const digest = createHash('sha256').update(png).digest('hex'), now = new Date().toISOString()
  const call = { protocolVersion: 1, processingPolicy: 'desktop-original-v1', callId: randomUUID(), taskId: randomUUID(), attemptId: randomUUID(),
    status: 'processing', billingState: 'reserved', estimatedCredits: '0.1', actualCredits: null as string | null, errorCode: 'MEDIA_PROVIDER_RECONCILIATION_REQUIRED' as string | null,
    createdAt: now, updatedAt: now, results: [] as unknown[] }
  const counts = { catalogs: 0, languageCatalogs: 0, quotes: 0, creates: 0, reconciles: 0, reads: 0, downloads: 0 }
  const keys: string[] = [], fixtureErrors: string[] = []
  let offline = false, lostReply = true, offlineCatalogReads = 0
  const server = createServer((req, res) => { void (async () => {
    if (offline) {
      expect(req.method).toBe('GET')
      expect(req.url).toMatch(/^\/api\/v1\/(?:language-models|desktop-media\/models)\?/u)
      expect(req.headers.authorization).toBe('Bearer ' + 'a'.repeat(43))
      expect(req.headers.cookie).toBeUndefined(); expect(req.headers.origin).toBeUndefined()
      expect(req.headers['x-workspace-id']).toBe(workspaceId); expect(req.headers['x-project-id']).toBe(projectId)
      offlineCatalogReads++; res.writeHead(503); res.end(); return
    }
    const json = (value: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
    const chunks: Buffer[] = []; for await (const part of req as AsyncIterable<Buffer>) chunks.push(part)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as unknown : undefined
    if (req.url === '/object') {
      expect(req.headers.authorization).toBeUndefined(); counts.downloads++
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length }); res.end(png); return
    }
    expect(req.headers.authorization).toBe('Bearer ' + 'a'.repeat(43))
    expect(req.headers.cookie).toBeUndefined(); expect(req.headers.origin).toBeUndefined()
    if (req.url?.startsWith('/api/v1/workspaces')) { counts.catalogs++; json({ items: [{ id: workspaceId, name: 'Fixture billing space', status: 'active' }], nextCursor: null }); return }
    if (req.url?.startsWith('/api/v1/projects')) { counts.catalogs++; json({ items: [{ id: projectId, workspaceId, name: 'Fixture billing project', status: 'active' }], nextCursor: null }); return }
    expect(req.headers['x-workspace-id']).toBe(workspaceId); expect(req.headers['x-project-id']).toBe(projectId)
    if (req.url?.startsWith('/api/v1/language-models')) {
      counts.languageCatalogs++; json({ items: [{ id: adapterId, key: 'fixture-language', displayName: 'Unpaid language catalog', model: 'fixture',
        configVersion: 1, protocolVersion: 1, tools: true, maxOutputTokens: 4096 }], nextCursor: null }); return
    }
    if (req.url?.startsWith('/api/v1/desktop-media/models')) {
      counts.catalogs++; json({ items: [{ protocolVersion: 1, id: adapterId, key: 'fixture', displayName: 'Fixture image model', model: 'fixture', configVersion: 1,
        imageReferences: { min: 0, max: 0 }, parameters: [] }], nextCursor: null }); return
    }
    if (req.url?.endsWith('/quote')) { counts.quotes++; json({ protocolVersion: 1, inputHash: 'a'.repeat(64), adapterConfigVersion: 1, estimatedCredits: '0.1' }); return }
    if (req.url === '/api/v1/desktop-media/calls' && req.method === 'POST') { counts.creates++; json(call); return }
    if (req.url?.endsWith('/reconcile')) {
      expect(body).toEqual({}); counts.reconciles++; keys.push(String(req.headers['idempotency-key']))
      expect(keys.at(-1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
      expect(req.url).toBe(`/api/v1/desktop-media/calls/${call.callId}/reconcile`)
      if (lostReply) { lostReply = false; res.destroy(); return }
      json({ protocolVersion: 1, callId: call.callId, outcome: 'scheduled' }); return
    }
    if (req.url?.endsWith('/manifest')) {
      json({ protocolVersion: 1, original: { assetId: randomUUID(), assetVersionId: versionId, name: 'bundled-result.png', mimeType: 'image/png', fileSize: png.length, checksumSha256: digest },
        download: { method: 'GET', url: origin + '/object', expiresAt: new Date(Date.now() + 60000).toISOString() } }); return
    }
    if (req.url === `/api/v1/desktop-media/calls/${call.callId}`) {
      counts.reads++; call.status = 'succeeded'; call.billingState = 'settled'; call.actualCredits = '0.08'; call.errorCode = null
      call.results = [{ id: randomUUID(), index: 0, assetVersionId: versionId, ingestStatus: 'ready', contentSafetyStatus: 'passed' }]
      json(call); return
    }
    throw new Error('Unexpected cloud route in bundled product regression')
  })().catch((error: unknown) => { fixtureErrors.push(error instanceof Error ? error.message : 'Fixture failure'); res.destroy() }) })
  let runtime: ArivoRuntime | undefined
  const owned: { browser?: Browser; removeCredential?: () => Promise<number> } = {}
  context.onTestFinished(async () => {
    try { await owned.browser?.close() } finally {
      try { await runtime?.stop() } finally {
        try { await owned.removeCredential?.() } finally {
          server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => { resolve() }))
          await rm(temporary, { recursive: true, force: true })
        }
      }
    }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture did not listen')
  const origin = `http://127.0.0.1:${address.port}`, helper = join(payload, 'native/keychain')
  const credentialKey = `arivo-desktop-v1:${createHash('sha256').update(`${origin}\0${origin}`).digest('hex')}`
  const credential = (operation: 'set' | 'get' | 'delete', input = '') => new Promise<number>((resolve, reject) => {
    const child = spawn(helper, [operation, credentialKey], { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'ignore', 'ignore'] })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Credential helper timed out')) }, 10000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code) => { clearTimeout(timer); resolve(code ?? -1) })
    child.stdin.on('error', () => { /* Exit reports credential failure without exposing input. */ }); child.stdin.end(input)
  })
  const config = { binary: join(payload, 'dsh'), installAnchor: join(payload, 'runtime/package.json'), home,
    instanceHelper: join(payload, 'native/instance'), pluginDirectory: join(payload, 'plugins/arivo'), shellDirectory: join(payload, 'arivo-shell'),
    manifestSha256: metadata.hash, pluginVersion: metadata.version, target: 'darwin-arm64' as const,
    maxPluginBytes: 128 * 1024 * 1024, startupTimeoutMs: 30000, shutdownTimeoutMs: 5000,
    identity: { apiOrigin: origin, webOrigin: origin, keychainHelper: helper, requestTimeoutMs: 10000, loginTimeoutMs: 30000 } }
  owned.removeCredential = () => credential('delete')
  runtime = new ArivoRuntime(config)
  const browser = owned.browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const browserContext = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
  const page = await browserContext.newPage(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const output = join(process.cwd(), 'output/playwright/arivo-bundled-images'); await mkdir(output, { recursive: true })
  try {
    expect(await credential('get')).toBe(44)
    expect(await credential('set', JSON.stringify({ format: 1, apiOrigin: origin, webOrigin: origin, phase: 'active', tokens: {
      protocolVersion: 1, tokenType: 'Bearer', accessToken: 'a'.repeat(43), refreshToken: 'b'.repeat(43), sessionId: randomUUID(),
      accessExpiresAt: new Date(Date.now() + 3600000).toISOString(), refreshExpiresAt: new Date(Date.now() + 7200000).toISOString(),
      user: { id: randomUUID(), name: 'Fixture user', email: 'fixture@arivo.test', locale: 'zh-CN' },
    } }))).toBe(0)
    await runtime.start(); await page.goto(await runtime.agentUrl())
    await page.getByRole('button', { name: 'Arivo 模型', exact: true }).click()
    await page.getByLabel('工作空间', { exact: true }).selectOption(workspaceId)
    await page.getByLabel('计费项目', { exact: true }).selectOption(projectId)
    await page.getByLabel('语言模型', { exact: true }).selectOption(adapterId)
    await page.getByRole('button', { name: '设为默认模型', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '默认模型已保存。' }).waitFor()
    await page.getByRole('button', { name: '会话', exact: true }).click()
    const beforeImages = { ...counts }
    await page.getByRole('button', { name: '添加工作区', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择工作区目录', exact: true })
    await picker.getByRole('button', { name: '编辑路径', exact: true }).click()
    await picker.getByRole('textbox', { name: '编辑路径', exact: true }).fill(workspace)
    await picker.getByRole('textbox', { name: '编辑路径', exact: true }).press('Enter')
    await picker.getByRole('button', { name: '打开', exact: true }).click(); await picker.waitFor({ state: 'hidden' })
    await page.locator('[contenteditable="true"]').fill('保留原 Agent 草稿，不调用语言模型。')
    const osOrigin = new URL(page.url()).origin
    const openStudio = async () => {
      await page.getByRole('button', { name: /Arivo (创作|Studio)/ }).click()
      expect(new URL(page.url()).origin).toBe(osOrigin)
      await page.locator('iframe.arivo-pane').waitFor()
      expect(await page.locator('iframe').count()).toBe(1)
      return page.frameLocator('iframe.arivo-pane')
    }
    let studio = await openStudio()
    await studio.getByTestId('create-project').click(); await studio.getByLabel('项目名称', { exact: true }).fill('完整 OS 内图片恢复')
    await studio.getByRole('button', { name: '创建项目', exact: true }).click()
    await studio.getByRole('button', { name: '打开项目', exact: true }).click()
    await studio.getByRole('button', { name: '图片制作', exact: true }).click()
    await studio.getByText('已读取本地制作记录。', { exact: true }).waitFor(); expect(counts).toEqual(beforeImages)
    await studio.getByRole('button', { name: '项目设置', exact: true }).click()
    const binding = studio.getByRole('dialog', { name: '项目设置', exact: true })
    await binding.getByLabel('计费空间', { exact: true }).locator(`option[value="${workspaceId}"]`).waitFor({ state: 'attached' })
    await binding.getByLabel('计费空间', { exact: true }).selectOption(workspaceId)
    await binding.getByLabel('计费项目', { exact: true }).locator(`option[value="${projectId}"]`).waitFor({ state: 'attached' })
    await binding.getByLabel('计费项目', { exact: true }).selectOption(projectId)
    await binding.getByRole('button', { name: '确认云端归属', exact: true }).click()
    await binding.waitFor({ state: 'detached' })
    expect(counts.creates).toBe(0); expect(counts.quotes).toBe(0)
    await studio.getByLabel('图片模型', { exact: true }).selectOption(adapterId)
    await studio.getByLabel('提示词', { exact: true }).fill('Unpaid packaged product fixture')
    await studio.getByRole('button', { name: '获取报价', exact: true }).click()
    await studio.getByText('预估积分: 0.1 积分', { exact: true }).waitFor(); expect(counts.creates).toBe(0)
    await studio.getByRole('button', { name: '确认报价并生成', exact: true }).click()
    await studio.getByRole('button', { name: '核对原任务结果', exact: true }).click()
    await studio.getByRole('button', { name: '恢复核对请求', exact: true }).waitFor()
    expect(counts.creates).toBe(1); expect(counts.reconciles).toBe(1)
    await page.getByRole('button', { name: '会话', exact: true }).click()
    expect(await page.locator('[contenteditable="true"]').innerText()).toBe('保留原 Agent 草稿，不调用语言模型。')
    await page.goto('about:blank'); await runtime.stop()
    offline = true; const beforeReopen = { ...counts }
    runtime = new ArivoRuntime(config); await runtime.start(); await page.goto(await runtime.agentUrl())
    // A full Host restart intentionally has a new owning loopback origin.
    await page.getByRole('button', { name: /Arivo (创作|Studio)/ }).click()
    studio = page.frameLocator('iframe.arivo-pane')
    await studio.getByRole('button', { name: '打开项目', exact: true }).click()
    await studio.getByRole('button', { name: '图片制作', exact: true }).click()
    await studio.getByRole('button', { name: '查看命令', exact: true }).click()
    await studio.getByRole('button', { name: '恢复核对请求', exact: true }).waitFor(); expect(counts).toEqual(beforeReopen)
    offline = false
    await studio.getByRole('button', { name: '恢复核对请求', exact: true }).click()
    await studio.getByText('已安排原任务查询，请恢复原任务状态查看结果。', { exact: true }).waitFor()
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1])
    await studio.getByRole('button', { name: '恢复原任务状态', exact: true }).click()
    await studio.getByRole('button', { name: '保存原图到本机', exact: true }).click()
    await studio.getByText('已保存到本机: bundled-result.png', { exact: true }).waitFor()
    await studio.getByRole('button', { name: '查看图片: bundled-result.png', exact: true }).scrollIntoViewIfNeeded()
    await expect.poll(() => studio.locator('.image-result img').evaluateAll(images => images.some(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
    expect(counts.creates).toBe(1); expect(counts.quotes).toBe(1)
    await page.getByRole('button', { name: '会话', exact: true }).click()
    await page.locator('[contenteditable="true"]').waitFor()
    expect(await page.getByRole('button', { name: '设置', exact: true }).count()).toBe(1)
    expect(errors).toEqual([]); expect(fixtureErrors).toEqual([])
    await writeFile(join(output, 'acceptance.json'), JSON.stringify({ protocolVersion: 1, kind: 'unpaid-cloud-fixture', nativeWindow: false,
      bundledManifestSha256: metadata.hash, originalOsAgent: true, sameWindowRail: true, draftPreserved: true, fullHostRestart: true,
      offlinePageRead: true, stableReconciliationKey: true, originalDownload: true, decodedLocalResult: true, offlineCatalogReads, counts, errors, fixtureErrors }, null, 2) + '\n')
  } catch (error) {
    await writeFile(join(output, 'failed-ui.txt'), await page.locator('body').ariaSnapshot())
    await writeFile(join(output, 'failed-counts.json'), JSON.stringify({ offlineCatalogReads, counts, errors, fixtureErrors }, null, 2) + '\n')
    throw error
  }
}, 90000)
