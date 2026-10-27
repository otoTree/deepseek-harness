/** Built-profile creative entry acceptance; isolated account/project fixtures and no model commands. */
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, webkit } from 'playwright'
import { expect, it } from 'vitest'
import { seedSession, type WebScaffold, captureStableAria, compareOrRefreshGolden, webSnapshotMode } from './scaffold.ts'
import { ArivoRuntime } from '../../electrobun/src/distribution/arivo-runtime.ts'

it.skipIf(!process.env.ARIVO_TEST_APPLICATION)('opens six creative views directly from Start in the exact Session project and retains dirty input', async (context) => {
  const payload = join(process.env.ARIVO_TEST_APPLICATION!, 'Contents/Resources/app')
  const metadata = JSON.parse(await readFile(join(payload, '../version.json'), 'utf8')) as { hash: string; version: string }
  const temporary = await mkdtemp(join(tmpdir(), 'arivo-direct-panels-'))
  const home = join(temporary, 'home'), workspace = join(temporary, 'workspace')
  await mkdir(workspace, { recursive: true })
  const workspaceId = randomUUID(), projectId = randomUUID(), errors: string[] = [], fixtureErrors: string[] = []
  const server = createServer((request, response) => {
    try {
      expect(request.headers.authorization).toBe('Bearer ' + 'a'.repeat(43))
      const json = (value: unknown) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)) }
      if (request.method === 'GET' && request.url?.startsWith('/api/v1/plugin-market/')) { response.writeHead(503); response.end(); return }
      if (request.url === '/api/v1/team-accounts') { json({ items: [] }); return }
      if (request.url?.startsWith('/api/v1/workspaces')) { json({ items: [{ id: workspaceId, name: 'Entry fixture space', status: 'active' }], nextCursor: null }); return }
      if (request.url === '/api/v1/projects' && request.method === 'POST') { request.resume(); json({ project: { id: projectId, workspaceId, name: '创作直达验收', summary: '', status: 'active' } }); return }
      if (request.url?.startsWith('/api/v1/projects')) { json({ items: [{ id: projectId, workspaceId, name: '创作直达验收', status: 'active' }], nextCursor: null }); return }
      if(request.url?.startsWith('/api/v1/language-models')){json({ items:[{ id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',key:'fixture-language',displayName:'Fixture conversation',model:'fixture',configVersion:1,protocolVersion:1,tools:true,maxOutputTokens:4096 }],nextCursor:null });return}
      if(request.url==='/api/v1/language-calls/quote' && request.method==='POST'){request.resume();json({ inputHash:'e'.repeat(64),adapterConfigVersion:1,estimatedCredits:'0.0000' });return}
      if(request.url?.startsWith('/api/v1/desktop-media/models')){json({ items:[],nextCursor:null });return}
      throw new Error(`Unexpected fixture request: ${request.method} ${request.url}`)
    } catch (error) { fixtureErrors.push(String(error)); response.writeHead(500); response.end() }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture did not listen')
  const origin = `http://127.0.0.1:${address.port}`, helper = join(payload, 'native/keychain')
  const credentialKey = `arivo-desktop-v1:${createHash('sha256').update(`${origin}\0${origin}`).digest('hex')}`
  const credential = (operation: string, input = '') => new Promise<number>((resolve, reject) => {
    const child = spawn(helper, [operation, credentialKey], { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'ignore', 'ignore'] })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Credential helper timed out')) }, 10000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) }); child.once('close', (code) => { clearTimeout(timer); resolve(code ?? -1) })
    child.stdin.on('error', () => { /* The exit status reports failure without exposing the fixture credential. */ }); child.stdin.end(input)
  })
  const runtime = new ArivoRuntime({ binary: join(payload, 'dsh'), installAnchor: join(payload, 'runtime/package.json'), home,
    instanceHelper: join(payload, 'native/instance'), pluginDirectory: join(payload, 'plugins/arivo'), shellDirectory: join(payload, 'arivo-shell'),
    manifestSha256: metadata.hash, pluginVersion: metadata.version, target: 'darwin-arm64', maxPluginBytes: 128 * 1024 * 1024,
    startupTimeoutMs: 30000, shutdownTimeoutMs: 5000,
    identity: { apiOrigin: origin, webOrigin: origin, keychainHelper: helper, requestTimeoutMs: 10000, loginTimeoutMs: 30000 } })
  const browser = await (process.env.ARIVO_TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true })
  context.onTestFinished(async () => {
    try { await browser.close() } finally { try { await runtime.stop() } finally {
      await credential('delete'); server.closeAllConnections(); await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
      await rm(temporary, { recursive: true, force: true })
    } }
  })
  expect(await credential('set', JSON.stringify({ format: 1, apiOrigin: origin, webOrigin: origin, phase: 'active', tokens: {
    protocolVersion: 1, tokenType: 'Bearer', accessToken: 'a'.repeat(43), refreshToken: 'b'.repeat(43), sessionId: randomUUID(),
    accessExpiresAt: new Date(Date.now() + 3600000).toISOString(), refreshExpiresAt: new Date(Date.now() + 7200000).toISOString(),
    user: { id: randomUUID(), name: 'Entry fixture', email: 'entry@arivo.test', locale: 'zh-CN' },
  } }))).toBe(0)
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1540, height: 1100 }, reducedMotion: 'reduce', recordVideo: { dir: join(process.cwd(), `output/playwright/arivo-direct-${process.env.ARIVO_TEST_BROWSER_ENGINE ?? 'chromium'}/video`), size: { width: 1540, height: 1100 } } })
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
  const alerts: string[] = []; page.on('dialog', async (dialog) => { alerts.push(dialog.message()); await dialog.accept() })
  const output = join(process.cwd(), `output/playwright/arivo-direct-${process.env.ARIVO_TEST_BROWSER_ENGINE ?? 'chromium'}`); await mkdir(output, { recursive: true })
  try {
    await runtime.start(); await page.goto(await runtime.agentUrl())
    const studio = page.frameLocator('iframe.arivo-pane:not(.arivo-workbench-pane)')
    await studio.getByTestId('create-project').click(); await studio.getByLabel('项目名称', { exact: true }).fill('创作直达验收')
    await studio.getByRole('button', { name: '创建项目', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择工作区目录', exact: true })
    await picker.getByRole('button', { name: '编辑路径', exact: true }).click()
    await picker.getByRole('textbox', { name: '编辑路径', exact: true }).fill(workspace)
    await picker.getByRole('textbox', { name: '编辑路径', exact: true }).press('Enter')
    await picker.getByRole('button', { name: '打开', exact: true }).click(); await picker.waitFor({ state: 'hidden' })
    await studio.getByRole('button',{ name:'新建项目对话',exact:true }).waitFor()
    const cwd=await realpath(join(workspace,'创作直达验收'))
    const accounts=await readdir(join(home,'accounts'));expect(accounts).toHaveLength(1)
    const harnessHome=join(home,'accounts',accounts[0]!,'agent')
    // Borrow the canonical settled recording; the original JSONL provider materializes it in this built profile.
    await seedSession({ workspaceCwd:cwd,harnessHome,persistenceRoot:join(harnessHome,'sessions') } as WebScaffold,
      (await readFile(join(process.cwd(),'snapshots/web/seeded-history/session.v2.jsonl'),'utf8')).replace(/"createdAt":\d+/u,'"createdAt":0'),'arivo-script-workspace-history')
    const osOrigin=new URL(page.url()).origin
    const registered=await page.context().request.post(`${osOrigin}/api/workspace/create`,{ headers:{ Origin:osOrigin },data:{
      type:'client-request',rpcId:randomUUID(),method:'workspace/create',payload:{ args:{ request:{ path:cwd } } },
    } })
    const registry=await registered.json() as { result:{ ok:boolean;value:{ workspace:{ workspaceId:string } } } }
    expect(registry.result.ok).toBe(true)
    const adopted=await page.context().request.post(`${osOrigin}/api/session/create`,{ headers:{ Origin:osOrigin },data:{
      type:'client-request',rpcId:randomUUID(),method:'session/create',payload:{ args:{ request:{ sessionId:'arivo-script-workspace-history',workspaceId:registry.result.value.workspace.workspaceId } } },
    } })
    expect((await adopted.json() as { result:{ ok:boolean } }).result.ok).toBe(true)
    await studio.getByRole('button', { name: '新建项目对话', exact: true }).click()
    await page.reload()
    // Wait for startup navigation to settle before selecting the conversation surface.
    await studio.getByRole('button',{ name:'打开项目',exact:true }).waitFor()
    await page.getByRole('button',{ name:'会话',exact:true }).click()
    await page.getByRole('tree',{ name:'会话',exact:true }).getByText('Use the read tool twice',{ exact:true }).click()
    await page.locator('[data-chat-flow-key]').first().waitFor()

    const toggle = page.getByRole('button', { name: '工作台', exact: true })
    if (await toggle.getAttribute('aria-pressed') === 'false') await toggle.click()
    const workbench = page.locator('[data-workbench]'), start = workbench.locator('[data-workbench-tab="start"] button').first()
    const choices = workbench.locator('[data-workbench-part=panel-choice]')
    await workbench.getByRole('button', { name: '通用生成', exact: true }).and(choices).waitFor()
    expect(await workbench.locator('[data-workbench-tab^="arivo.creative."]').count()).toBe(0)
    const icons = [], projects = []
    await page.screenshot({ animations: 'disabled', path: join(output, 'start-dark.png') })
    for (const [label, view, selector] of [
      ['通用生成', 'generation', '[data-generation-workbench]'], ['剧本', 'script', '.studio-content--script'],
      ['设定集', 'settings', '.studio-content--settings'], ['分镜', 'storyboard', '.studio-content--production'],
      ['画布', 'canvas', '.studio-content--canvas'], ['资产库', 'assets', '[data-testid=asset-center]'],
    ] as const) {
      const card = workbench.getByRole('button', { name: label, exact: true }).and(choices)
      expect(await card.locator(`[data-creative-icon="${view}"]`).getAttribute('viewBox')).toBe('0 0 32 32')
      icons.push(await card.locator('svg path').first().getAttribute('d')); await card.click()
      const frame = page.frameLocator('iframe.arivo-workbench-pane'); await frame.locator(selector).waitFor()
      const url = new URL((await page.locator('iframe.arivo-workbench-pane').getAttribute('src'))!)
      expect(url.searchParams.get('view')).toBe(view); projects.push(url.searchParams.get('project'))
      expect(await frame.locator('html').getAttribute('data-project')).toBe(projects[0])
      if (view === 'assets') await frame.getByRole('heading', { name: '没有匹配的资产', exact: true }).waitFor()
      if (view === 'canvas') await expect.poll(() => page.getByRole('region', { name: '画布', exact: true }).getByRole('button', { name: '新建画布', exact: true }).isDisabled()).toBe(false)
      await page.screenshot({ animations: 'disabled', path: join(output, `${view}.png`) }); await start.click()
      await workbench.getByRole('button', { name: '剧本', exact: true }).and(choices).waitFor()
    }
    expect(new Set(icons).size).toBe(6); expect(new Set(projects).size).toBe(1); expect(projects[0]).toBeTruthy()
    await workbench.getByRole('button', { name: '剧本', exact: true }).and(choices).click()
    const script = page.frameLocator('iframe.arivo-workbench-pane')
    await script.getByRole('button', { name: '新建分集', exact: true }).first().click()
    await script.getByLabel('集标题', { exact: true }).fill('未提交的输入需要保留')
    await start.click(); await expect.poll(() => alerts.length).toBe(1)
    expect(await script.getByLabel('集标题', { exact: true }).inputValue()).toBe('未提交的输入需要保留')
    await script.getByRole('dialog').getByRole('button', { name: '关闭弹窗', exact: true }).click()
    await workbench.locator('[data-workbench-tab="arivo.creative.script"] [data-workbench-part=close]').click()
    await start.click(); await workbench.getByRole('button', { name: '剧本', exact: true }).and(choices).click()
    await script.getByRole('heading', { name: '还没有分集', exact: true }).waitFor()
    const rail=page.getByRole('region',{ name:'分集',exact:true })
    await rail.waitFor()
    expect(await script.getByRole('button',{ name:'返回项目',exact:true }).count()).toBe(0)
    expect(await script.locator('.script-editor__episodes').isVisible()).toBe(false)
    expect(await script.locator('#local-script-history').isVisible()).toBe(false)
    await rail.getByRole('button',{ name:'新建分集',exact:true }).click()
    await script.getByLabel('集标题',{ exact:true }).fill('第一封信')
    await script.getByRole('button',{ name:'创建并开始写',exact:true }).click()
    await script.getByRole('dialog').waitFor({ state:'detached' })
    const text=script.getByRole('textbox',{ name:'剧本正文',exact:true })
    await text.fill('海风吹动信纸。')
    await script.getByRole('button',{ name:'保存版本',exact:true }).click()
    await script.getByText('版本 1',{ exact:true }).waitFor()
    const history=script.getByRole('button',{ name:'版本历史',exact:true })
    expect(await history.getAttribute('aria-expanded')).toBe('false')
    await history.click(); await script.getByRole('button',{ name:'查看版本 1',exact:true }).click()
    expect(await script.getByRole('dialog').locator('pre').innerText()).toBe('海风吹动信纸。')
    await script.getByRole('dialog').getByRole('button',{ name:'关闭',exact:true }).click();await history.click()
    // Lose committed metadata replies; the explicit retry must use the same command.
    const commands:Record<string,string[]>={ rename:[],delete:[] }
    await page.route('**/api/story/episode',async (route)=>{
      const input=route.request().postDataJSON() as { action:'rename'|'delete';commandId:string };commands[input.action]!.push(input.commandId)
      if(commands[input.action]!.length===1){await route.fetch();await route.abort()}else await route.continue()
    })
    await rail.getByRole('button',{ name:'改名 第一封信',exact:true }).click()
    await script.getByLabel('集标题',{ exact:true }).fill('灯塔来信')
    await script.getByRole('button',{ name:'保存名称',exact:true }).click()
    const retry=script.getByRole('dialog').getByRole('button',{ name:'重试原操作',exact:true })
    await retry.waitFor();expect(await script.getByRole('dialog').getByRole('button',{ name:'取消',exact:true }).isDisabled()).toBe(true)
    await start.click();await expect.poll(()=>alerts.length).toBe(2)
    await retry.click();await script.getByRole('dialog').waitFor({ state:'detached' })
    await script.getByRole('heading',{ name:'第 1 集 · 灯塔来信',exact:true }).waitFor()
    expect(commands.rename![0]).toBe(commands.rename![1])
    expect(await text.inputValue()).toBe('海风吹动信纸。')
    expect(await rail.ariaSnapshot()).toMatchSnapshot('script episode slot')
    const recordedUI=await captureStableAria(page,'[data-chat-flow-kind=user]',cwd)+'\n'+await captureStableAria(page,'[data-turn-process-answer]',cwd)
    // WebKit includes the collapsed reasoning row in this answer's accessibility tree.
    const conversationGolden=process.env.ARIVO_TEST_BROWSER_ENGINE==='webkit'?'conversation.webkit.expected.md':'conversation.expected.md'
    await compareOrRefreshGolden(join(process.cwd(),'snapshots/web/arivo-script-workspace',conversationGolden),recordedUI,webSnapshotMode())
    await compareOrRefreshGolden(join(process.cwd(),'snapshots/web/arivo-script-workspace/episodes.expected.md'),await rail.ariaSnapshot(),webSnapshotMode())
    await page.screenshot({ animations:'disabled',path:join(output,'script-slot.png') })
    await rail.getByRole('button',{ name:'新建分集',exact:true }).click()
    await script.getByLabel('集标题',{ exact:true }).fill('第二封信')
    await script.getByRole('button',{ name:'创建并开始写',exact:true }).click();await script.getByRole('dialog').waitFor({ state:'detached' })
    await text.fill('切集前输入仍需保存。')
    await rail.getByRole('button',{ name:'灯塔来信 第 1 集',exact:true }).click()
    await script.getByRole('heading',{ name:'第 1 集 · 灯塔来信',exact:true }).waitFor()
    await rail.getByRole('button',{ name:'第二封信 第 2 集',exact:true }).click()
    await script.getByRole('heading',{ name:'第 2 集 · 第二封信',exact:true }).waitFor()
    expect(await text.inputValue()).toBe('切集前输入仍需保存。')
    await rail.getByRole('button',{ name:'删除剧本 灯塔来信',exact:true }).click()
    await script.getByRole('button',{ name:'取消',exact:true }).click()
    expect(await rail.getByRole('button',{ name:'灯塔来信 第 1 集',exact:true }).count()).toBe(1)
    await rail.getByRole('button',{ name:'删除剧本 灯塔来信',exact:true }).click()
    await script.getByRole('button',{ name:'确认删除',exact:true }).click();await retry.waitFor();await retry.click()
    await script.getByRole('dialog').waitFor({ state:'detached' })
    expect(commands.delete![0]).toBe(commands.delete![1])
    expect(await rail.getByRole('button',{ name:'灯塔来信 第 1 集',exact:true }).count()).toBe(0)
    await start.click();await rail.waitFor({ state:'detached' })
    await workbench.getByRole('button',{ name:'剧本',exact:true }).and(choices).click()
    await script.getByRole('heading',{ name:'第 2 集 · 第二封信',exact:true }).waitFor()
    expect(await text.inputValue()).toBe('切集前输入仍需保存。')
    expect(await script.locator('#local-script-history').isVisible()).toBe(false)
    await rail.getByRole('button',{ name:'删除剧本 第二封信',exact:true }).click()
    await script.getByRole('button',{ name:'确认删除',exact:true }).click();await script.getByRole('dialog').waitFor({ state:'detached' })
    await script.getByRole('heading',{ name:'还没有分集',exact:true }).waitFor()
    await start.click()

    await workbench.getByRole('button',{ name:'分镜',exact:true }).and(choices).click()
    const board=page.frameLocator('iframe.arivo-workbench-pane')
    await board.getByRole('heading',{ name:'还没有分集',exact:true }).waitFor();await rail.waitFor()
    expect(await board.getByRole('button',{ name:'返回项目',exact:true }).count()).toBe(0)
    expect(await board.getByRole('button',{ name:'制作总览',exact:true }).count()).toBe(0)
    expect(await board.getByRole('button',{ name:'绑定剧本版本',exact:true }).count()).toBe(0)
    expect(await board.getByRole('searchbox',{ name:'搜索分集',exact:true }).count()).toBe(0)
    const boardCreates:string[]=[]
    await page.route('**/api/storyboard/episodes',async (route)=>{
      boardCreates.push((route.request().postDataJSON() as { commandId:string }).commandId)
      if(boardCreates.length===1){await route.fetch();await route.abort()}else await route.continue()
    })
    await rail.getByRole('button',{ name:'新建分集',exact:true }).click()
    await board.getByLabel('集标题',{ exact:true }).fill('先画分镜')
    await board.getByRole('button',{ name:'创建并开始分镜',exact:true }).click()
    const boardRetry=board.getByRole('button',{ name:'重试原操作',exact:true })
    await boardRetry.waitFor();expect(await board.getByRole('button',{ name:'取消',exact:true }).isDisabled()).toBe(true)
    const alertsBefore=alerts.length;await start.click();await expect.poll(()=>alerts.length).toBe(alertsBefore+1)
    await boardRetry.click();await board.getByRole('dialog').waitFor({ state:'detached' })
    expect(boardCreates).toHaveLength(2);expect(boardCreates[0]).toBe(boardCreates[1])
    await board.getByRole('heading',{ name:'第 3 集 · 先画分镜',exact:true }).waitFor()
    await rail.getByRole('button',{ name:'绑定剧本版本',exact:true }).waitFor()
    await board.getByRole('button',{ name:'新增镜头',exact:true }).click()
    await board.getByLabel('镜头标题',{ exact:true }).fill('无剧本首镜')
    await board.getByLabel('画面与动作描述',{ exact:true }).fill('一束晨光落在桌面。')
    await board.getByRole('button',{ name:'保存到本机',exact:true }).click();await board.getByRole('dialog').waitFor({ state:'detached' })
    const shotTitle=board.getByRole('textbox',{ name:'分镜标题',exact:true })
    await shotTitle.waitFor();expect(await shotTitle.inputValue()).toBe('无剧本首镜')
    await shotTitle.fill('保留未保存的首镜')
    expect(await rail.getByRole('button',{ name:'新建分集',exact:true }).isDisabled()).toBe(true)
    expect(await rail.getByRole('button',{ name:'删除剧本 先画分镜',exact:true }).isDisabled()).toBe(true)
    await board.getByRole('button',{ name:'保存分镜',exact:true }).click()
    await board.getByRole('heading',{ name:'保留未保存的首镜',exact:true }).waitFor()
    await rail.getByRole('button',{ name:'改名 先画分镜',exact:true }).click()
    await board.getByLabel('集标题',{ exact:true }).fill('晨光分镜')
    await board.getByRole('button',{ name:'保存名称',exact:true }).click();await board.getByRole('dialog').waitFor({ state:'detached' })
    await board.getByRole('heading',{ name:'第 3 集 · 晨光分镜',exact:true }).waitFor()
    const boardGolden=process.env.ARIVO_TEST_BROWSER_ENGINE==='webkit'?'storyboard.webkit.expected.md':'storyboard.expected.md'
    const boardUI=await rail.ariaSnapshot()+'\n'+await board.locator('.arivo-local-storyboard').ariaSnapshot()
    await compareOrRefreshGolden(join(process.cwd(),'snapshots/web/arivo-script-workspace',boardGolden),boardUI,webSnapshotMode())
    await page.screenshot({ animations:'disabled',path:join(output,'storyboard-slot.png') })
    await start.click();await rail.waitFor({ state:'detached' })
    await workbench.getByRole('button',{ name:'剧本',exact:true }).and(choices).click()
    await script.getByRole('heading',{ name:'第 3 集 · 晨光分镜',exact:true }).waitFor()
    expect(await script.getByRole('textbox',{ name:'剧本正文',exact:true }).inputValue()).toBe('')
    await start.click();await workbench.getByRole('button',{ name:'分镜',exact:true }).and(choices).click()
    await board.getByRole('heading',{ name:'保留未保存的首镜',exact:true }).waitFor()
    await rail.getByRole('button',{ name:'新建分集',exact:true }).click()
    await board.getByLabel('集标题',{ exact:true }).fill('另一个分镜分集')
    await board.getByRole('button',{ name:'创建并开始分镜',exact:true }).click();await board.getByRole('dialog').waitFor({ state:'detached' })
    await board.getByRole('heading',{ name:'第 4 集 · 另一个分镜分集',exact:true }).waitFor()
    await rail.getByRole('button',{ name:'晨光分镜 第 3 集',exact:true }).click()
    await board.getByRole('heading',{ name:'保留未保存的首镜',exact:true }).waitFor()
    await rail.getByRole('button',{ name:'删除剧本 晨光分镜',exact:true }).click()
    await board.getByRole('button',{ name:'确认删除',exact:true }).click();await board.getByRole('dialog').waitFor({ state:'detached' })
    await board.getByRole('heading',{ name:'第 4 集 · 另一个分镜分集',exact:true }).waitFor()
    expect(await rail.getByRole('button',{ name:'晨光分镜 第 3 集',exact:true }).count()).toBe(0)
    await rail.getByRole('button',{ name:'删除剧本 另一个分镜分集',exact:true }).click()
    await board.getByRole('button',{ name:'确认删除',exact:true }).click();await board.getByRole('dialog').waitFor({ state:'detached' })
    await board.getByRole('heading',{ name:'还没有分集',exact:true }).waitFor()
    await start.click();await rail.waitFor({ state:'detached' })

    await workbench.getByRole('button', { name: '画布', exact: true }).and(choices).click()
    const canvas = page.frameLocator('iframe.arivo-workbench-pane'), canvasRail = page.getByRole('region', { name: '画布', exact: true })
    await canvasRail.waitFor(); await canvasRail.getByText('还没有画布', { exact: true }).waitFor()
    expect(await canvas.getByRole('button', { name: '返回项目', exact: true }).count()).toBe(0)
    expect(await canvas.locator('.arivo-canvas-library').isVisible()).toBe(false)
    const canvasCommands: string[] = []
    await page.route('**/api/canvas/create', async (route) => {
      canvasCommands.push((route.request().postDataJSON() as { mutationId: string }).mutationId)
      if (canvasCommands.length === 1) { await route.fetch(); await route.abort() } else await route.continue()
    })
    const canvasDialog = canvas.getByRole('dialog', { name: '新建画布', exact: true })
    await canvasRail.getByRole('button', { name: '新建画布', exact: true }).click()
    await canvasDialog.getByLabel('画布名称', { exact: true }).fill('取消的画布')
    await page.screenshot({ animations: 'disabled', path: join(output, 'canvas-create-slot.png') })
    await canvasDialog.getByRole('button', { name: '取消新建', exact: true }).click()
    await canvasDialog.waitFor({ state: 'hidden' }); expect(canvasCommands).toHaveLength(0)
    await canvasRail.getByRole('button', { name: '新建画布', exact: true }).click()
    await canvasDialog.getByLabel('画布名称', { exact: true }).fill('海岸画布')
    await canvasDialog.getByRole('button', { name: '新建画布', exact: true }).click()
    await canvasDialog.getByRole('button', { name: '重试原操作', exact: true }).waitFor()
    expect(await canvasDialog.getByRole('button', { name: '取消新建', exact: true }).isDisabled()).toBe(true)
    expect(await canvasRail.getByRole('button', { name: '新建画布', exact: true }).isDisabled()).toBe(true)
    const canvasAlerts = alerts.length; await start.click(); await expect.poll(() => alerts.length).toBe(canvasAlerts + 1)
    await canvasDialog.getByRole('button', { name: '重试原操作', exact: true }).click(); await canvasDialog.waitFor({ state: 'hidden' })
    await canvasRail.getByRole('button', { name: '海岸画布', exact: true }).waitFor()
    expect(canvasCommands).toHaveLength(2); expect(canvasCommands[0]).toBe(canvasCommands[1])
    expect(await canvas.getByRole('button', { name: '画布列表', exact: true }).count()).toBe(0)
    expect(await canvas.locator('.arivo-canvas-tools').count()).toBe(0)
    await canvas.locator('[data-canvas-empty-state]').getByRole('button', { name: '文本生成', exact: true }).waitFor()
    await page.screenshot({ animations: 'disabled', path: join(output, 'canvas-empty-web-parity.png') })
    await canvas.getByLabel('画布编辑区', { exact: true }).click({ button: 'right', position: { x: 30, y: 110 } })
    await canvas.getByRole('button', { name: '添加文本节点', exact: true }).waitFor()
    await page.screenshot({ animations: 'disabled', path: join(output, 'canvas-context-menu.png') })
    await canvas.getByRole('button', { name: '打开项目资产', exact: true }).click()
    await canvas.getByRole('complementary', { name: '画布资产库', exact: true }).waitFor()
    await canvas.getByRole('button', { name: '返回添加节点', exact: true }).click()
    await canvas.getByRole('button', { name: '操作历史', exact: true }).click()
    await canvas.getByRole('button', { name: '重新读取', exact: true }).waitFor()
    await canvas.getByRole('button', { name: '返回添加节点', exact: true }).click()
    await canvas.getByRole('button', { name: '添加文本节点', exact: true }).click()
    await canvas.getByText('画布已保存到本机。', { exact: true }).waitFor()
    await canvas.getByRole('button', { name: '选择节点 文本 1', exact: true }).click()
    const canvasPrompt = canvas.getByRole('textbox', { name: '创作描述', exact: true })
    await canvasPrompt.dispatchEvent('compositionstart'); await canvasPrompt.fill('中文输入保留在原画布。')
    await expect.poll(() => canvasRail.getByRole('button', { name: '新建画布', exact: true }).isDisabled()).toBe(true)
    await page.waitForTimeout(850)
    expect(await canvasRail.getByRole('button', { name: '海岸画布', exact: true }).isDisabled()).toBe(true)
    await canvasPrompt.dispatchEvent('compositionend')
    await expect.poll(() => canvasRail.getByRole('button', { name: '新建画布', exact: true }).isDisabled()).toBe(false)
    await canvas.getByRole('button', { name: '放大编辑提示词', exact: true }).click()
    await expect.poll(() => canvasRail.getByRole('button', { name: '新建画布', exact: true }).isDisabled()).toBe(true)
    const expandedAlerts = alerts.length; await start.click(); await expect.poll(() => alerts.length).toBe(expandedAlerts + 1)
    await canvas.getByRole('button', { name: '退出放大编辑', exact: true }).click()
    await canvasPrompt.waitFor({ state: 'visible' })
    await expect.poll(() => canvasRail.getByRole('button', { name: '新建画布', exact: true }).isDisabled()).toBe(false)
    const canvasGolden = process.env.ARIVO_TEST_BROWSER_ENGINE === 'webkit' ? 'canvas.webkit.expected.md' : 'canvas.expected.md'
    const canvasUI = await canvasRail.ariaSnapshot() + '\n' + await canvas.locator('.studio-content--canvas').ariaSnapshot()
    await compareOrRefreshGolden(join(process.cwd(), 'snapshots/web/arivo-script-workspace', canvasGolden), canvasUI, webSnapshotMode())
    await canvasRail.getByRole('button', { name: '新建画布', exact: true }).click()
    await canvasDialog.getByLabel('画布名称', { exact: true }).fill('山谷画布')
    await canvasDialog.getByRole('button', { name: '新建画布', exact: true }).click(); await canvasDialog.waitFor({ state: 'hidden' })
    await canvasRail.getByRole('button', { name: '山谷画布', exact: true }).waitFor()
    await canvasRail.getByRole('button', { name: '海岸画布', exact: true }).click()
    await canvas.getByRole('button', { name: '选择节点 文本 1', exact: true }).click()
    expect(await canvasPrompt.inputValue()).toBe('中文输入保留在原画布。')
    await page.screenshot({ animations: 'disabled', path: join(output, 'canvas-slot.png') })
    await start.click(); await canvasRail.waitFor({ state: 'detached' })
    await workbench.getByRole('button', { name: '画布', exact: true }).and(choices).click()
    await canvasRail.getByRole('button', { name: '海岸画布', exact: true }).click()
    await canvas.getByRole('button', { name: '选择节点 文本 1', exact: true }).click()
    expect(await canvasPrompt.inputValue()).toBe('中文输入保留在原画布。')
    const managed: Record<string, string[]> = { rename: [], delete: [] }
    await page.route('**/api/canvas/manage', async (route) => {
      const data = route.request().postDataJSON() as { kind: string; mutationId: string }
      managed[data.kind]!.push(data.mutationId)
      const response = await route.fetch(); expect(response.status()).toBe(200)
      if (managed[data.kind]!.length === 1) await route.abort(); else await route.fulfill({ response })
    })
    await canvasRail.getByRole('button', { name: '重命名画布 海岸画布', exact: true }).click()
    const renameCanvas = canvas.getByRole('dialog', { name: '重命名画布', exact: true })
    await renameCanvas.getByLabel('新画布名称', { exact: true }).fill('灯塔画布')
    await renameCanvas.getByRole('button', { name: '确认', exact: true }).click()
    await renameCanvas.getByRole('button', { name: '重试原操作', exact: true }).waitFor()
    expect(await renameCanvas.getByRole('button', { name: '取消', exact: true }).isDisabled()).toBe(true)
    expect(await canvasRail.getByRole('button', { name: '新建画布', exact: true }).isDisabled()).toBe(true)
    await renameCanvas.getByRole('button', { name: '重试原操作', exact: true }).click(); await renameCanvas.waitFor({ state: 'detached' })
    expect(managed.rename).toHaveLength(2); expect(managed.rename![0]).toBe(managed.rename![1])
    await canvasRail.getByRole('button', { name: '灯塔画布', exact: true }).waitFor()
    await canvasRail.getByRole('button', { name: '删除画布 山谷画布', exact: true }).click()
    const deleteCanvas = canvas.getByRole('dialog', { name: '删除画布', exact: true })
    await deleteCanvas.getByRole('button', { name: '取消', exact: true }).click()
    expect(managed.delete).toHaveLength(0)
    await canvasRail.getByRole('button', { name: '删除画布 山谷画布', exact: true }).click()
    await deleteCanvas.getByRole('button', { name: '确认', exact: true }).click()
    await deleteCanvas.getByRole('button', { name: '重试原操作', exact: true }).waitFor()
    await deleteCanvas.getByRole('button', { name: '重试原操作', exact: true }).click(); await deleteCanvas.waitFor({ state: 'detached' })
    expect(managed.delete).toHaveLength(2); expect(managed.delete![0]).toBe(managed.delete![1])
    expect(await canvasRail.getByRole('button', { name: '山谷画布', exact: true }).count()).toBe(0)
    expect(await canvasPrompt.inputValue()).toBe('中文输入保留在原画布。')
    await page.screenshot({ animations: 'disabled', path: join(output, 'canvas-slot-management.png') })
    await workbench.locator('[data-workbench-tab="arivo.creative.canvas"] [data-workbench-part=close]').click()
    await canvasRail.waitFor({ state: 'detached' }); await start.click()

    await page.setViewportSize({ width: 860, height: 900 }); await page.screenshot({ animations: 'disabled', path: join(output, 'start-narrow.png') })
    expect(errors).toEqual([]); expect(fixtureErrors).toEqual([])
    await writeFile(join(output, 'acceptance.json'), JSON.stringify({ sixDirectViews: true, exactSessionProject: projects[0], distinctIcons: true,
      noAutomaticTabs: true, closeAndReopen: true, dirtyDialogRetained: true, canvasRenameDeleteOriginalRetry: true, providerCalls: 0,
      errors, fixtureErrors }, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(output, 'failed.png') }); await writeFile(join(output, 'failed-ui.txt'), await page.locator('body').ariaSnapshot())
    const failedFrames = await Promise.all(page.frames().filter(frame => frame !== page.mainFrame())
      .map(frame => frame.locator('body').ariaSnapshot().catch(() => '')))
    await writeFile(join(output, 'failed-frames.txt'), failedFrames.join('\n'))
    await writeFile(join(output, 'errors.json'), JSON.stringify({ errors, fixtureErrors })); throw error
  }
}, 120000)
