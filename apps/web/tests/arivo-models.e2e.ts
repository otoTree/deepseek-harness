/** Packaged product controls against an isolated Platform API; paid Agent roundtrip requires a private opt-in fixture. */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { prepareCreativeProject, runCreativeTask, verifyCreativeProduct } from './arivo-studio-acceptance.ts'
import { ArivoRuntime } from '../../electrobun/src/distribution/arivo-runtime.ts'

interface CloudFixture {
  apiOrigin: string
  webOrigin: string
  tokens: unknown
  workspaceId: string
  projectIds: [string, string]
  adapterId: string
  receipt: string
  agentToolRoundtrip?: boolean
  creativeRoundtrip?: boolean
}

it.skipIf(!process.env.ARIVO_TEST_MODELS_FIXTURE || !process.env.ARIVO_TEST_APPLICATION)('preserves explicit Session model selections on full Host restart without global model settings', async (context) => {
  const fixture = JSON.parse(await readFile(process.env.ARIVO_TEST_MODELS_FIXTURE!, 'utf8')) as CloudFixture
  expect(new URL(fixture.apiOrigin).hostname).toBe('127.0.0.1')
  expect(fixture.apiOrigin).toBe(fixture.webOrigin)
  const payload = join(process.env.ARIVO_TEST_APPLICATION!, 'Contents/Resources/app')
  const metadata = JSON.parse(await readFile(join(payload, '../version.json'), 'utf8')) as { hash: string; version: string }
  const helper = join(payload, 'native/keychain')
  const key = `arivo-desktop-v1:${createHash('sha256').update(`${fixture.apiOrigin}\0${fixture.webOrigin}`).digest('hex')}`
  async function credential(operation: 'get' | 'set' | 'delete', input = '') {
    return new Promise<number>((resolve, reject) => {
      const child = spawn(helper, [operation, key], { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'ignore', 'ignore'] })
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Native credential helper timed out')) }, 30000)
      child.once('error', reject)
      child.once('close', (code) => { clearTimeout(timeout); resolve(code ?? -1) })
      child.stdin.on('error', () => { /* Helper completion reports errors without exposing credential input. */ })
      child.stdin.end(input)
    })
  }
  expect(await credential('get')).toBe(44)
  const temporary = await mkdtemp(join(tmpdir(), 'arivo-models-product-'))
  const home = join(temporary, 'home'), workspace = join(temporary, 'workspace')
  await mkdir(workspace, { mode: 0o700 })
  const output = join(process.cwd(), fixture.creativeRoundtrip ? 'output/playwright/arivo-creative-agent' : fixture.agentToolRoundtrip ? 'output/playwright/arivo-live-agent' : 'output/playwright/arivo-models')
  await mkdir(output, { recursive: true })
  if (fixture.creativeRoundtrip) await mkdir(join(output, 'reopened'), { recursive: true })
  const config = { binary: join(payload, 'dsh'), installAnchor: join(payload, 'runtime/package.json'), home,
    instanceHelper: join(payload, 'native/instance'), pluginDirectory: join(payload, 'plugins/arivo'),
    shellDirectory: join(payload, 'arivo-shell'),
    manifestSha256: metadata.hash, pluginVersion: metadata.version, target: 'darwin-arm64' as const,
    maxPluginBytes: 128 * 1024 * 1024, startupTimeoutMs: 30000, shutdownTimeoutMs: 5000,
    identity: { apiOrigin: fixture.apiOrigin, webOrigin: fixture.webOrigin, requestTimeoutMs: 10000,
      loginTimeoutMs: 30000, keychainHelper: helper } }
  let runtime = new ArivoRuntime(config)
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const browserContext = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
  const page = await browserContext.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  context.onTestFinished(async () => {
    await browser.close(); await runtime.stop(); await credential('delete'); await rm(temporary, { recursive: true, force: true })
  })
  expect(await credential('set', JSON.stringify({ format: 1, apiOrigin: fixture.apiOrigin, webOrigin: fixture.webOrigin,
    phase: 'active', tokens: fixture.tokens }))).toBe(0)
  async function rpc<T>(method: string, args: object): Promise<T> {
    const origin = new URL(page.url()).origin
    const response = await browserContext.request.post(`${origin}/api/${method}`, { headers: { Origin: origin }, data: {
      type: 'client-request', rpcId: randomUUID(), method, payload: { args },
    } })
    expect(response.status()).toBe(200)
    const body = await response.json() as { result: { ok: boolean; value: T } }
    expect(body.result.ok).toBe(true)
    return body.result.value
  }
  async function select(project: string) {
    const session = await rpc<{ sessionId: string }>('session/create', { request: { cwd: workspace } })
    await rpc('session/selectModel', { request: { sessionId: session.sessionId, provider: 'arivo', model: `${fixture.workspaceId}/${project}/${fixture.adapterId}` } })
  }
  const firstRoute = `${fixture.workspaceId}/${fixture.projectIds[0]}/${fixture.adapterId}`
  const secondRoute = `${fixture.workspaceId}/${fixture.projectIds[1]}/${fixture.adapterId}`
  let toolWriteTime: number | undefined
  let toolReceipt: { toolCalls: number; toolResults: number; durableFinalAnswer: boolean } | undefined
  type Catalog = { default: { provider: string; model: string }; groups: { id: string; models: { id: string }[] }[]; failures: unknown[] }
  try {
    await runtime.start(); await page.goto(await runtime.agentUrl())
    await page.getByRole('button', { name: '设置', exact: true }).click()
    expect(await page.getByRole('button', { name: 'Arivo 模型', exact: true }).count()).toBe(0)
    await select(fixture.projectIds[0])
    const catalog = await rpc<Catalog>('session/modelCatalog', {})
    expect(catalog.default).toMatchObject({ provider: 'arivo', model: firstRoute })
    expect(catalog.groups.find(item => item.id === 'arivo')?.models.map(item => item.id)).toContain(firstRoute)
    expect(catalog.failures).toEqual([])
    const session = await rpc<{ sessionId: string }>('session/create', { request: { cwd: workspace } })
    await rpc('session/selectModel', { request: { sessionId: session.sessionId, provider: 'arivo', model: firstRoute } })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await select(fixture.projectIds[1])
    expect((await rpc<Catalog>('session/modelCatalog', {})).default.model).toBe(secondRoute)
    await writeFile(join(output, 'settings-ui.txt'), await page.locator('body').ariaSnapshot())
    await page.screenshot({ animations: 'disabled', path: join(output, 'settings.png') })
    await page.getByRole('button', { name: '会话', exact: true }).click()
    await page.getByRole('button', { name: '添加工作区', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择工作区目录', exact: true })
    await picker.getByRole('button', { name: '编辑路径', exact: true }).click()
    await picker.getByRole('textbox', { name: '编辑路径', exact: true }).fill(workspace)
    await picker.getByRole('textbox', { name: '编辑路径', exact: true }).press('Enter')
    await picker.getByRole('button', { name: '打开', exact: true }).click()
    await picker.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: /^选择模型/u }).click()
    await page.getByRole('menuitem', { name: /^模型/u }).click()
    await page.getByRole('menuitemradio', { name: /Arivo tool model/u }).waitFor()
    await writeFile(join(output, 'original-menu-ui.txt'), await page.locator('body').ariaSnapshot())
    await page.screenshot({ animations: 'disabled', path: join(output, 'original-model-menu.png') })
    if (fixture.agentToolRoundtrip) {
      await page.keyboard.press('Escape')
      if (fixture.creativeRoundtrip) {
        await prepareCreativeProject(page, workspace); await runCreativeTask(page, output)
      } else {
        const expected = 'Arivo native tool 中文🙂\n'
        await page.locator('[contenteditable="true"]').fill(
          'Use the write tool exactly once to create arivo-acceptance.txt in the current workspace. '
          + 'Its exact UTF-8 content must be ' + JSON.stringify(expected) + '. Do not call other tools. '
          + 'After the tool succeeds, reply with exactly ARIVO_NATIVE_OK.',
        )
        await page.getByRole('button', { name: '发送消息', exact: true }).click()
        await expect.poll(() => readFile(join(workspace, 'arivo-acceptance.txt'), 'utf8').catch(() => ''),
          { timeout: 90000, interval: 500 }).toBe(expected)
        await page.getByText('ARIVO_NATIVE_OK', { exact: true }).last().waitFor({ timeout: 60000 })
        await page.getByRole('button', { name: '发送消息', exact: true }).waitFor()
        toolWriteTime = (await stat(join(workspace, 'arivo-acceptance.txt'))).mtimeMs
        await writeFile(join(output, 'agent-ui.txt'), await page.locator('body').ariaSnapshot())
        await page.screenshot({ animations: 'disabled', path: join(output, 'agent-tool-roundtrip.png') })
      }
    }
    await page.goto('about:blank'); await runtime.stop()
    // The default write must not replace this Session's durable model selection.
    const accounts = await readdir(join(home, 'accounts'))
    expect(accounts).toHaveLength(1)
    const reader = new Context()
    try {
      await reader.plugin(JsonlSessionPersistence, { root: join(home, 'accounts', accounts[0]!, 'agent/sessions') })
      const handle = await reader.sessionPersistence.open(SessionId(session.sessionId), 'read')
      try {
        const selections = (await handle.read()).filter(event => event.type === 'model/selection')
        expect(selections).toHaveLength(1)
        expect(selections[0]?.data).toMatchObject({ provider: 'arivo', model: firstRoute })
      } finally { await handle.close() }
      if (fixture.agentToolRoundtrip) {
        const logs = (await reader.sessionPersistence.list()).filter(item => item.header.id !== SessionId(session.sessionId))
        const matching = []
        for (const log of logs) {
          const handle = await reader.sessionPersistence.open(log.header.id, 'read')
          try {
            const events = await handle.read()
            if (events.some(event => event.type === 'tool/call' && event.data.name === (fixture.creativeRoundtrip ? 'arivo_create_episode' : 'write'))) matching.push(log)
          } finally { await handle.close() }
        }
        expect(matching).toHaveLength(1)
        const agentLog = await reader.sessionPersistence.open(matching[0]!.header.id, 'read')
        try {
          const events = await agentLog.read()
          const calls = events.filter(event => event.type === 'tool/call')
          const results = events.filter(event => event.type === 'tool/result')
          if (fixture.creativeRoundtrip) {
            expect(calls.length).toBeGreaterThanOrEqual(6)
            expect(results).toHaveLength(calls.length)
            expect(calls.every(event => event.type === 'tool/call' && event.data.name.startsWith('arivo_'))).toBe(true)
            for (const name of ['arivo_list_projects', 'arivo_create_episode', 'arivo_write_script', 'arivo_save_script_version', 'arivo_bind_storyboard', 'arivo_create_shot']) {
              expect(calls.some(event => event.type === 'tool/call' && event.data.name === name)).toBe(true)
            }
            expect(results.every(event => event.type === 'tool/result' && !event.data.error)).toBe(true)
          } else { expect(calls).toHaveLength(1); expect(results).toHaveLength(1) }
          expect(results[0]?.type === 'tool/result' && results[0].data.error).toBeUndefined()
          const durableFinalAnswer = events.some(event => event.type === 'assistant/message'
            && event.data.message.content.some(block => block.type === 'text' && block.text === (fixture.creativeRoundtrip ? 'ARIVO_STUDIO_OK' : 'ARIVO_NATIVE_OK')))
          expect(durableFinalAnswer).toBe(true)
          toolReceipt = { toolCalls: calls.length, toolResults: results.length, durableFinalAnswer }
        } finally { await agentLog.close() }
      }
    } finally { await reader.fiber.dispose() }
    runtime = new ArivoRuntime(config); await runtime.start(); await page.goto(await runtime.agentUrl())
    expect((await rpc<Catalog>('session/modelCatalog', {})).default.model).toBe(secondRoute)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    expect(await page.getByRole('button', { name: 'Arivo 模型', exact: true }).count()).toBe(0)
    if (fixture.creativeRoundtrip) {
      await verifyCreativeProduct(page, join(output, 'reopened'))
    } else if (fixture.agentToolRoundtrip) {
      expect((await stat(join(workspace, 'arivo-acceptance.txt'))).mtimeMs).toBe(toolWriteTime)
      expect(await readFile(join(workspace, 'arivo-acceptance.txt'), 'utf8')).toBe('Arivo native tool 中文🙂\n')
    }
    expect(errors).toEqual([])
    await page.goto('about:blank'); await runtime.stop()
    expect(await credential('delete')).toBe(0); expect(await credential('get')).toBe(44)
    const receipt = { protocolVersion: 1, realCloudCatalog: true, originalModelMenu: true,
      existingSessionScopePreserved: true, persistedAfterRestart: true, nativeCredentialRemoved: true,
      ...(fixture.agentToolRoundtrip ? { agentToolRoundtrip: true, ...toolReceipt,
        ...(fixture.creativeRoundtrip
          ? { creativeRoundtrip: true, workbenchReadback: true, creativeDataAfterRestart: true }
          : { restartDidNotRewriteToolFile: true }) } : {}), errors }
    await writeFile(fixture.receipt, JSON.stringify(receipt) + '\n', { mode: 0o600, flag: 'wx' })
    await writeFile(join(output, 'acceptance.json'), JSON.stringify(receipt, null, 2) + '\n')
  } catch (error) {
    await writeFile(join(output, 'failed-ui.txt'), await page.locator('body').ariaSnapshot())
    await page.screenshot({ animations: 'disabled', path: join(output, 'failed.png') })
    throw error
  }
}, 300000)
