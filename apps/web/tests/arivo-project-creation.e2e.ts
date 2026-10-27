/** Packaged original shell, native credentials and real Worker; cloud fixture never generates media. */
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, webkit } from 'playwright'
import { expect, it } from 'vitest'
import { ArivoRuntime } from '../../electrobun/src/distribution/arivo-runtime.ts'

it.skipIf(!process.env.ARIVO_TEST_APPLICATION)('joins cloud project and native folder through creation, cancellation, existing-folder adoption and restart', async (context) => {
  const payload = join(process.env.ARIVO_TEST_APPLICATION!, 'Contents/Resources/app')
  const metadata = JSON.parse(await readFile(join(payload, '../version.json'), 'utf8')) as { hash: string; version: string }
  const temporary = await mkdtemp(join(tmpdir(), 'arivo-project-identity-'))
  const workspaceId = randomUUID(), existingId = randomUUID(), userId = randomUUID(), teamId = randomUUID()
  const adapterId = randomUUID(), textOnly = randomUUID()
  const existing = { id: existingId, workspaceId, name: 'Existing online film', summary: 'Existing story', status: 'active' }
  const created = new Map<string, typeof existing>(), failures: string[] = []
  const server = createServer((request, response) => { void (async () => {
    expect(request.headers.authorization).toBe('Bearer ' + 'a'.repeat(43))
    const url = new URL(request.url!, 'http://127.0.0.1')
    const send = (value: unknown) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)) }
    if (url.pathname === '/api/v1/auth/desktop/session') { send({ protocolVersion: 1, user: { id: userId, name: 'Unpaid creator', email: 'fixture@arivo.test', locale: 'zh-CN' } }); return }
    if (url.pathname === '/api/v1/team-accounts') { send({ items: [{ id: teamId, name: 'Film team', role: 'owner', status: 'active' }] }); return }
    if (url.pathname === '/api/v1/workspaces') { send({ items: [{ id: workspaceId, name: 'Studio', status: 'active', role: 'owner', teamAccount: { id: teamId, name: 'Film team', status: 'active' } }], nextCursor: null }); return }
    // Marketplace startup discovery is outside this project's unpaid fixture.
    if (['/api/v1/plugin-market/plugins/device-targets', '/api/v1/plugin-market/plugins/catalog', '/api/v1/plugin-market/plugins/installations'].includes(url.pathname)) { response.writeHead(503); response.end(); return }
    expect(request.headers['x-workspace-id'], url.pathname).toBe(workspaceId)
    if (url.pathname === '/api/v1/projects' && request.method === 'POST') {
      const parts: Buffer[] = []; for await (const part of request) parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part as string))
      const body = JSON.parse(Buffer.concat(parts).toString()) as { name: string; summary: string }, key = String(request.headers['idempotency-key'])
      if (!created.has(key)) created.set(key, { ...existing, id: randomUUID(), name: body.name, summary: body.summary })
      send({ project: created.get(key) }); return
    }
    if (url.pathname === '/api/v1/projects') { send({ items: [existing, ...created.values()], nextCursor: null }); return }
    if (url.pathname === '/api/v1/language-models') {
      const cloudProject = String(request.headers['x-project-id'])
      expect([existingId, ...[...created.values()].map(item => item.id)]).toContain(cloudProject)
      const item = (id: string, tools: boolean) => ({ id, key: id, displayName: tools ? 'Automatic project model' : 'Text-only model',
        model: 'fixture', configVersion: 1, protocolVersion: 1, tools, maxOutputTokens: 4096 })
      send(url.searchParams.has('cursor') ? { items: [item(adapterId, true)], nextCursor: null }
        : { items: [item(textOnly, false)], nextCursor: 'tools' }); return
    }

    if (url.pathname === `/api/v1/projects/${existingId}/dashboard`) { send({ project: existing }); return }
    throw new Error(`Unexpected route ${request.method} ${url.pathname}`)
  })().catch((error: unknown) => { failures.push(String(error)); response.destroy() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture did not listen')
  const origin = `http://127.0.0.1:${address.port}`
  const key = 'arivo-desktop-v1:' + createHash('sha256').update(`${origin}\0${origin}`).digest('hex')
  const credential = (operation: 'set' | 'delete', input = '') => new Promise<void>((resolve, reject) => {
    const child = spawn(join(payload, 'native/keychain'), [operation, key], { stdio: ['pipe', 'ignore', 'ignore'] })
    child.once('error', reject)
    child.once('close', (code) => { if (code === 0) resolve(); else reject(new Error('Fixture credential failed')) })
    child.stdin.end(input)
  })
  const config = { binary: join(payload, 'dsh'), installAnchor: join(payload, 'runtime/package.json'), home: join(temporary, 'home'),
    instanceHelper: join(payload, 'native/instance'), pluginDirectory: join(payload, 'plugins/arivo'), shellDirectory: join(payload, 'arivo-shell'),
    manifestSha256: metadata.hash, pluginVersion: metadata.version, target: 'darwin-arm64' as const, maxPluginBytes: 128 * 1024 * 1024,
    startupTimeoutMs: 30000, shutdownTimeoutMs: 5000, identity: { apiOrigin: origin, webOrigin: origin, keychainHelper: join(payload, 'native/keychain'),
      requestTimeoutMs: 10000, loginTimeoutMs: 10000 } }
  let runtime = new ArivoRuntime(config)
  const engine = process.env.ARIVO_TEST_BROWSER_ENGINE ?? 'chromium'
  const browser = engine === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ headless: true, channel: 'chrome' })
  context.onTestFinished(async () => {
    await browser.close(); await runtime.stop(); await credential('delete')
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    await rm(temporary, { recursive: true, force: true })
  })
  await credential('set', JSON.stringify({ format: 1, apiOrigin: origin, webOrigin: origin, phase: 'active', tokens: {
    protocolVersion: 1, tokenType: 'Bearer', accessToken: 'a'.repeat(43), refreshToken: 'b'.repeat(43), sessionId: randomUUID(),
    accessExpiresAt: new Date(Date.now() + 3600000).toISOString(), refreshExpiresAt: new Date(Date.now() + 7200000).toISOString(),
    user: { id: userId, name: 'Unpaid creator', email: 'fixture@arivo.test', locale: 'zh-CN' } } }))
  await runtime.start()
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
  const output = join(process.cwd(), 'output/playwright/arivo-project-creation', engine); await mkdir(output, { recursive: true })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const studio = page.frameLocator('iframe.arivo-pane:not(.arivo-workbench-pane)')
  const picker = page.getByRole('dialog', { name: '选择工作区目录', exact: true })
  const pick = async (path: string) => {
    await picker.getByRole('button', { name: '编辑路径', exact: true }).click()
    await picker.getByRole('textbox', { name: '编辑路径', exact: true }).fill(path)
    await picker.getByRole('textbox', { name: '编辑路径', exact: true }).press('Enter')
    await picker.getByRole('button', { name: '打开', exact: true }).click(); await picker.waitFor({ state: 'hidden' })
  }
  const choose = async (label: string, value: string) => {
    await studio.getByRole('combobox', { name: label, exact: true }).click()
    await studio.getByRole('listbox', { name: label, exact: true }).locator(`[data-value="${value}"]`).click()
  }
  try {
    await page.goto(await runtime.agentUrl())
    await studio.getByTestId('create-project').click()
    await studio.getByLabel('项目名称', { exact: true }).fill('Linked film')
    await studio.getByRole('button', { name: '创建项目', exact: true }).click()
    await picker.getByRole('button', { name: '取消', exact: true }).click()
    await studio.getByText('已取消选择，未创建项目。', { exact: false }).waitFor()
    expect(created.size).toBe(0)
    expect(await studio.locator('select,input[type=date]').count()).toBe(0)
    await page.screenshot({ path: join(output, 'cancelled.png') })
    await studio.getByRole('button', { name: '创建项目', exact: true }).click(); await pick(temporary)
    await studio.getByRole('heading', { name: 'Linked film', exact: true }).waitFor()
    const marker = JSON.parse(await readFile(join(temporary, 'Linked film/.arivo/cloud-project.json'), 'utf8')) as { cloudProjectId: string }
    expect(marker.cloudProjectId).toBe([...created.values()][0]!.id)
    expect(created.size).toBe(1)
    await page.screenshot({ path: join(output, 'created.png') })
    // No global or project model configuration: the folder's authorized model is selected automatically.
    await studio.getByRole('button', { name: '新建项目对话', exact: true }).click()
    await page.locator('[contenteditable="true"]').waitFor()
    await expect.poll(() => page.getByRole('button', { name: /Automatic project model/u }).count()).toBeGreaterThan(0)
    await page.locator('[contenteditable="true"]').fill('自动模型对话草稿，不发送。')
    expect(await page.getByRole('button', { name: '发送消息', exact: true }).isEnabled()).toBe(true)
    await page.screenshot({ path: join(output, 'automatic-project-conversation.png') })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    expect(await page.getByRole('button', { name: 'Arivo 模型', exact: true }).count()).toBe(0)
    await page.screenshot({ path: join(output, 'settings-no-global-models.png') })
    await page.getByRole('button', { name: 'Arivo 创作', exact: true }).and(page.locator('.arivo-rail-item')).click()
    await studio.getByRole('heading', { name: 'Linked film', exact: true }).waitFor()

    const folder = join(temporary, 'Existing folder'); await mkdir(folder); await writeFile(join(folder, 'story.txt'), 'User story')
    await studio.getByRole('button', { name: '从文件夹创建项目', exact: true }).click()
    await choose('线上项目', 'existing'); await choose('选择线上项目', existingId)
    await page.screenshot({ path: join(output, 'connect-existing.png') })
    await studio.getByRole('button', { name: '创建项目', exact: true }).click(); await pick(folder)
    await studio.getByRole('heading', { name: existing.name, exact: true }).waitFor()
    expect((JSON.parse(await readFile(join(folder, '.arivo/cloud-project.json'), 'utf8')) as { cloudProjectId: string }).cloudProjectId).toBe(existingId)
    expect(await readFile(join(folder, 'story.txt'), 'utf8')).toBe('User story')
    expect(created.size).toBe(1)
    await runtime.stop(); runtime = new ArivoRuntime(config); await runtime.start(); await page.goto(await runtime.agentUrl())
    await studio.getByRole('heading', { name: 'Linked film', exact: true }).waitFor()
    await studio.getByRole('heading', { name: existing.name, exact: true }).waitFor()
    expect(await studio.getByText('已关联线上', { exact: true }).count()).toBe(2)
    await page.screenshot({ path: join(output, 'reopened.png') })
    expect(errors).toEqual([]); expect(failures).toEqual([])
  } catch (error) {
    await page.screenshot({ path: join(output, 'failed.png') }); await writeFile(join(output, 'failed.txt'), await page.locator('body').ariaSnapshot())
    throw error
  }
}, 120000)
