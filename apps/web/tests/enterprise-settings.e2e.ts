/** Enterprise settings hierarchy and failure recovery through the shipped Web composition. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode, type WebScaffold } from './scaffold.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const scenario = join(root, 'snapshots/web/enterprise-settings')

it.skipIf(process.platform === 'win32')('groups enterprise settings and retains page context while retrying a failed read', async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-enterprise-settings-'))
  context.onTestFinished(() => rm(temporary, { recursive: true, force: true }))
  const organizationId = '00000000-0000-4000-8000-000000000001'
  const cloudId = SessionId('cloud-import-fixture')
  const cloudHeader = { id: cloudId, version: 2, createdAt: 1788240457450, isSeeded: false, delegationDepth: 0 }
  const cloudMetadata = { id: cloudId, header: cloudHeader, inheritedEventCount: 0, nextSeq: 0 }
  const archives = new Map<string, { id: string; header: unknown; inheritedEventCount: number; nextSeq: number; events: unknown[] }>([
    [cloudId, { ...cloudMetadata, events: [] }],
  ])
  let importUnavailable = true
  const archiveMethods: string[] = []
  let unavailable = true
  let overviewReads = 0
  const usageReads: URLSearchParams[] = []
  const rootUnit = '00000000-0000-4000-8000-000000000003'
  const departmentUnit = '00000000-0000-4000-8000-000000000004'
  let units = [{ id: rootUnit, parentId: null as string | null, name: '示例团队', unitType: 'root' }]
  let assignments = [{ membershipId: 'member-1', unitId: rootUnit }]
  const departmentWrites: unknown[] = []
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader('Content-Type', 'application/json')
      const path = request.url?.replace(`/v1/organizations/${organizationId}/`, '')
      if (path === 'sessions' || path?.startsWith('sessions/')) {
        archiveMethods.push(request.method ?? '')
        if (importUnavailable) { response.writeHead(503).end('{}'); return }
        if (path === 'sessions') {
          const sessions = [...archives.values()].sort((a, b) => a.id.localeCompare(b.id))
          response.end(JSON.stringify(sessions.map(({ events: _events, ...metadata }) => metadata)))
          return
        }
        const url = new URL(path, 'http://fixture')
        const id = url.pathname.split('/')[2]!
        if (request.method === 'POST' && url.pathname.endsWith('/archive')) {
          let body = ''
          for await (const chunk of request) body += String(chunk)
          const input = JSON.parse(body) as { header: unknown; inheritedEventCount: number; offset: number; events: unknown[] }
          const record = archives.get(id) ?? {
            id, header: input.header, inheritedEventCount: input.inheritedEventCount, nextSeq: 0, events: [],
          }
          record.events.push(...input.events.slice(Math.max(0, record.nextSeq - input.offset)))
          record.nextSeq = record.events.length
          archives.set(id, record)
          response.end(JSON.stringify({ nextSeq: record.nextSeq }))
          return
        }
        const record = archives.get(id)
        if (!record) { response.writeHead(404).end('{}'); return }
        const offset = Number(url.searchParams.get('offset'))
        response.end(JSON.stringify({ ...record, events: record.events.slice(offset, offset + 500) }))
        return
      }
      if (path === 'units' && request.method === 'POST') {
        let body = ''
        for await (const chunk of request) body += String(chunk)
        const input = JSON.parse(body) as { name: string; parentId: string; unitType: string }
        departmentWrites.push(input)
        units = [...units, { id: departmentUnit, ...input }]
        response.writeHead(201).end(JSON.stringify({ id: departmentUnit }))
        return
      }
      if (path === 'members/member-1/units' && request.method === 'PUT') {
        let body = ''
        for await (const chunk of request) body += String(chunk)
        const input = JSON.parse(body) as { unitIds: string[] }
        assignments = input.unitIds.map(unitId => ({ membershipId: 'member-1', unitId }))
        response.end(JSON.stringify({ id: 'member-1' }))
        return
      }
      if (path === 'units') { response.end(JSON.stringify(units)); return }
      if (path === 'members') { response.end(JSON.stringify({ assignments })); return }
      if (path === 'overview') overviewReads++
      if (path === 'overview' && unavailable) {
        response.writeHead(503)
        response.end('{}')
        return
      }
      const query = new URL(request.url ?? '/', 'http://fixture').searchParams
      if (path?.startsWith('usage?')) usageReads.push(query)
      const value = path === 'overview' ? {
        organization: { id: organizationId, name: '示例团队', kind: 'team', status: 'active', policyRevision: 1 },
        subscription: { plan: 'Enterprise', seats: 5 }, roles: [{ role: 'owner', unitId: null }],
      } : path === 'models' ? [{
        id: '4742b2b5-7389-4e02-8aa6-9d1645855b8a', name: 'deepseek-flash', images: false,
        contextTokens: 1_000_000, maxOutputTokens: 384_000,
      }] : path === 'runtimes' ? [{
        id: '00000000-0000-4000-8000-000000000002', name: 'macOS desktop', type: 'desktop',
        version: '0.1.0', expiresAt: '2099-01-01T00:00:00Z', revokedAt: null,
      }] : path === 'wallet' ? {
        organizationId, balanceMicrosCny: 999_307956, updatedAt: '2026-10-22T06:06:59Z', version: 1,
      } : path === 'wallet/ledger' ? {
        currency: 'CNY', nextCursor: null, items: [{
          id: 'ledger-1', amountMicrosCny: -31416, kind: 'model_usage_debit', usageId: 'usage-1',
          redemptionCodeId: null, accountId: 'account-1', runtimeId: null,
          balanceAfterMicrosCny: 999_307956, createdAt: '2026-10-22T06:06:59Z',
        }],
      } : path?.startsWith('members/usage-summary') ? {
        items: [{
          membershipId: 'member-1', accountId: 'account-1', name: 'Team Owner',
          email: 'team-owner@example.com', status: 'active', roles: ['owner'], calls: 64,
          inputTokens: 2_000_000, outputTokens: 43079, totalTokens: 2_043_079,
          settledCostMicrosCny: 692044, lastActivityAt: '2026-10-22T06:06:59Z',
        }], range: { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z', timeZone: 'UTC' },
      } : path?.startsWith('usage?') ? { items: [{
        id: 'usage-1', accountId: 'account-1', runtimeId: '00000000-0000-4000-8000-000000000002',
        modelId: 'deepseek-flash', purpose: 'conversation', status: 'settled', protocol: 'openai-completions',
        inputModalities: ['text'], inputTokens: 2000000, outputTokens: 43079, totalTokens: 2043079,
        totalCostMicrosCny: 692044, currency: 'CNY', occurredAt: '2026-10-22T06:06:59Z',
      }], nextCursor: null, range: {
        from: query.get('from') ?? '2026-10-01T00:00:00Z', to: query.get('to') ?? '2026-11-01T00:00:00Z', timeZone: 'UTC',
      } } : []
      response.end(JSON.stringify(value))
    })().catch((error: unknown) => { response.destroy(error instanceof Error ? error : new Error('Fixture request failed')) })
  })
  let scaffold: WebScaffold | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let rejectUpdate: ((error: Error) => void) | undefined
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Fixture server has no TCP address')
    const apiUrl = `http://127.0.0.1:${address.port}`
    const helper = join(temporary, 'keychain')
    const credential = { accountId: 'account-1', apiOrigin: apiUrl, organizationId, runtimeId: '00000000-0000-4000-8000-000000000002', token: 'fixture-token'.repeat(4), expiresAt: '2099-01-01T00:00:00Z' }
    const account = `${createHash('sha256').update(apiUrl).digest('hex')}:${organizationId}:${credential.runtimeId}`
    await writeFile(helper, `#!/bin/sh\nprintf '%s' '${JSON.stringify(credential)}'\n`)
    await chmod(helper, 0o700)
    const overlay = join(temporary, 'settings.yml')
    await writeFile(overlay, JSON.stringify([
      { id: 'agent-default-model', config: { provider: 'enterprise', model: '4742b2b5-7389-4e02-8aa6-9d1645855b8a' } },
      { id: 'ui-settings-models', disabled: true }, { id: 'ui-settings-plugins', disabled: true },
      { insert: [{ id: 'enterprise-client', name: '@deepseek-ai/dsh-enterprise-client', config: {
        apiUrl, organizationId, keychainHelper: helper, keychainAccount: account, triggerStatePath: join(temporary, 'triggers.json'),
      } }] },
    ]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(root, 'apps/electrobun/package.json')] })
    await seedSession(scaffold, await readFile(join(root, 'snapshots/web/lifecycle-chrome/session.v2.jsonl'), 'utf8'), 'settings-session')
    browser = await chromium.launch()
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', colorScheme: 'dark', reducedMotion: 'reduce',
    })
    await page.clock.setFixedTime(new Date('2026-10-22T06:07:00Z'))
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const sidebar = page.locator('[class*="sidebarCol"]')
    await page.getByRole('button', { name: '收起侧边栏', exact: true }).waitFor()
    await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(0)
    const sidebarWidth = await sidebar.evaluate(element => element.getBoundingClientRect().width)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('region', { name: '设置', exact: true })
    await expect.poll(() => dialog.evaluate(element => element.getBoundingClientRect().left)).toBe(56)
    expect(await sidebar.isVisible()).toBe(false)
    await expect.poll(() => page.getByRole('button', { name: '打开侧边栏', exact: true }).count()).toBe(0)
    const labels = (name: string) => dialog.getByRole('group', { name, exact: true }).getByRole('button').allTextContents()
    expect(await labels('偏好设置')).toEqual(['通用设置', '模型', 'Agent 预设'])
    expect(await labels('企业与账户')).toEqual(['企业账户', '通讯录', '账单'])
    expect(await labels('扩展')).toEqual(['企业插件'])
    await dialog.getByRole('button', { name: '通用设置', exact: true }).click()
    expect(await dialog.getByRole('button', { name: '检查更新', exact: true }).count()).toBe(0)
    let checks = 0
    let availableUpdateVersion: string | null = null
    let dismissedUpdates = 0
    await page.exposeFunction('fixtureCheckForUpdates', () => {
      checks++
      return checks === 1 ? new Promise<void>((_resolve, reject) => { rejectUpdate = reject }) : Promise.resolve()
    })
    await page.exposeFunction('fixtureAvailableUpdateVersion', () => availableUpdateVersion)
    await page.exposeFunction('fixtureDismissUpdate', () => { dismissedUpdates++; availableUpdateVersion = null })
    // The native RPC transport is external to the browser; availability arrives after page boot on desktop.
    await page.evaluate(() => {
      const target = window as unknown as {
        fixtureCheckForUpdates(): Promise<void>
        fixtureAvailableUpdateVersion(): Promise<string | null>
        fixtureDismissUpdate(): Promise<void>
      }
      Object.defineProperty(window, '__dshNative', { value: {
        checkForUpdates: () => target.fixtureCheckForUpdates(),
        getAvailableUpdateVersion: () => target.fixtureAvailableUpdateVersion(),
        dismissUpdateNotification: () => target.fixtureDismissUpdate(),
      }, configurable: true })
      window.dispatchEvent(new Event('dsh-native-bridge-ready'))
    })
    await dialog.getByRole('button', { name: '检查更新', exact: true }).waitFor()
    await compareOrRefreshGolden(join(scenario, 'desktop-updates.expected.md'), await captureStableAria(page, '[role="region"][aria-labelledby]', scaffold.workspaceCwd), webSnapshotMode())
    const updateScreenshots = join(root, 'output/playwright/enterprise-settings')
    await mkdir(updateScreenshots, { recursive: true })
    await page.screenshot({ path: join(updateScreenshots, 'desktop-updates.png') })
    await page.setViewportSize({ width: 480, height: 800 })
    await dialog.getByRole('button', { name: '检查更新', exact: true }).scrollIntoViewIfNeeded()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await dialog.locator('.dse-desktop-update-row').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: join(updateScreenshots, 'desktop-updates-480.png') })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await dialog.getByRole('button', { name: '检查更新', exact: true }).click()
    const updateButton = dialog.getByRole('button', { name: '正在检查更新…', exact: true })
    await expect.poll(() => checks).toBe(1)
    expect(await updateButton.isDisabled()).toBe(true)
    await compareOrRefreshGolden(join(scenario, 'desktop-updates-checking.expected.md'), await captureStableAria(page, '[role="region"][aria-labelledby]', scaffold.workspaceCwd), webSnapshotMode())
    rejectUpdate!(new Error('Native RPC unavailable'))
    await dialog.getByRole('alert').filter({ hasText: '无法检查更新，请重试。' }).waitFor()
    await compareOrRefreshGolden(join(scenario, 'desktop-updates-failed.expected.md'), await captureStableAria(page, '[role="region"][aria-labelledby]', scaffold.workspaceCwd), webSnapshotMode())
    await dialog.getByRole('button', { name: '检查更新', exact: true }).click()
    await expect.poll(() => checks).toBe(2)
    await expect.poll(() => dialog.getByRole('button', { name: '检查更新', exact: true }).isEnabled()).toBe(true)
    expect(await dialog.getByRole('alert').count()).toBe(0)
    availableUpdateVersion = '0.2.0'
    await page.evaluate(() => window.dispatchEvent(new Event('dsh-desktop-update-available')))
    const updateNotification = page.getByRole('region', { name: '发现新版本', exact: true })
    await updateNotification.getByText('新版本 0.2.0 已发布，可以安装更新。', { exact: true }).waitFor()
    await compareOrRefreshGolden(join(scenario, 'startup-update-notification.expected.md'), await updateNotification.ariaSnapshot(), webSnapshotMode())
    await page.screenshot({ path: join(updateScreenshots, 'startup-update-notification.png') })
    await page.setViewportSize({ width: 480, height: 800 })
    expect(await updateNotification.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: join(updateScreenshots, 'startup-update-notification-480.png') })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: /^(会话|Sessions)$/, exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    expect(await updateNotification.isVisible()).toBe(true)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await dialog.waitFor()
    expect(await updateNotification.isVisible()).toBe(true)
    await updateNotification.getByRole('button', { name: '关闭更新通知', exact: true }).click()
    await updateNotification.waitFor({ state: 'detached' })
    expect(dismissedUpdates).toBe(1)
    expect(availableUpdateVersion).toBeNull()
    await dialog.getByRole('button', { name: '企业账户', exact: true }).click()
    await dialog.getByRole('alert').waitFor()
    expect(await dialog.getByRole('heading', { name: '企业账户', exact: true }).count()).toBe(1)
    await compareOrRefreshGolden(join(scenario, 'unavailable.expected.md'), await captureStableAria(page, '[role="region"][aria-labelledby]', scaffold.workspaceCwd), webSnapshotMode())
    const screenshots = join(root, 'output/playwright/enterprise-settings')
    await mkdir(screenshots, { recursive: true })
    await page.screenshot({ path: join(screenshots, 'unavailable.png') })
    const previousReads = overviewReads
    unavailable = false
    await dialog.getByRole('button', { name: '重试', exact: true }).click()
    await dialog.getByRole('heading', { name: '示例团队', exact: true }).waitFor()
    expect(await dialog.getByRole('heading', { name: 'Platform', exact: true }).count()).toBe(0)
    expect(await dialog.getByText('team · active', { exact: true }).count()).toBe(1)
    expect(overviewReads).toBeGreaterThan(previousReads)
    expect(await dialog.getByRole('alert').count()).toBe(0)
    await compareOrRefreshGolden(join(scenario, 'account.expected.md'), await captureStableAria(page, '[role="region"][aria-labelledby]', scaffold.workspaceCwd), webSnapshotMode())
    await page.screenshot({ path: join(screenshots, 'account.png') })
    for (const [name, ready, file] of [
      ['企业账户', '示例团队', 'account'],
      ['模型', '可用模型', 'models'], ['通讯录', '通讯录', 'directory'], ['账单', '团队人民币余额', 'billing'],
    ] as const) {
      await dialog.getByRole('button', { name, exact: true }).click()
      await dialog.getByRole('heading', { name: ready, exact: true }).waitFor()
      if (file === 'directory') await dialog.getByRole('button', { name: /Team Owner/ }).waitFor()
      if (file === 'billing') await dialog.getByText('2,043,079', { exact: true }).waitFor()
      await compareOrRefreshGolden(join(scenario, `${file}.expected.md`), await captureStableAria(page, '[role="region"][aria-labelledby]', scaffold.workspaceCwd), webSnapshotMode())
      await page.screenshot({ path: join(screenshots, `${file}.png`) })
      for (const width of [640, 480]) {
        await page.setViewportSize({ width, height: 800 })
        await expect.poll(() => dialog.evaluate(element => [...element.querySelectorAll('.dse-section, .dse-card, .dse-inline-form')]
          .filter(item => item.scrollWidth > item.clientWidth).map(item => ({
            className: item.className, scroll: item.scrollWidth, width: item.clientWidth,
          })))).toEqual([])
        await page.locator('[data-sidebar-collapsed]').waitFor()
        await page.screenshot({ path: join(screenshots, `${file}-${width}.png`) })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await dialog.getByRole('button', { name: '企业账户', exact: true }).click()
    await dialog.getByRole('heading', { name: '对话云端同步', exact: true }).waitFor()
    expect(await dialog.getByText(/运行时.*限额|设备限额/).count()).toBe(0)
    expect(archiveMethods).toEqual([])
    await dialog.getByRole('button', { name: '下载云端对话', exact: true }).click()
    await dialog.getByRole('alert').waitFor()
    expect(await scaffold.ctx.sessionPersistence.stat(cloudId)).toBeUndefined()
    importUnavailable = false
    await dialog.getByRole('button', { name: '下载云端对话', exact: true }).click()
    await dialog.getByRole('status').filter({ hasText: '1' }).waitFor()
    const imported = await scaffold.ctx.sessionPersistence.open(cloudId, 'read')
    try { expect(await imported.read()).toEqual([]) } finally { await imported.close() }
    expect(archiveMethods.every(method => method === 'GET')).toBe(true)
    await compareOrRefreshGolden(join(scenario, 'imported.expected.md'), await captureStableAria(page, '[role="region"][aria-labelledby]', scaffold.workspaceCwd), webSnapshotMode())
    await page.screenshot({ path: join(screenshots, 'imported.png') })
    await dialog.getByRole('button', { name: '上传本地对话', exact: true }).click()
    await dialog.getByRole('status').filter({ hasText: '已上传对话数： 2' }).waitFor()
    const uploaded = await scaffold.ctx.sessionPersistence.open(SessionId('settings-session'), 'read')
    try { expect(archives.get('settings-session')?.events).toEqual(await uploaded.read()) } finally { await uploaded.close() }
    expect(archives.get('settings-session')!.events.length).toBeGreaterThan(0)
    expect(archiveMethods.filter(method => method === 'POST')).toHaveLength(2)
    await compareOrRefreshGolden(join(scenario, 'uploaded.expected.md'), await captureStableAria(page, '[role="region"][aria-labelledby]', scaffold.workspaceCwd), webSnapshotMode())
    await page.screenshot({ path: join(screenshots, 'uploaded.png') })
    const workspaceCwd = scaffold.workspaceCwd
    const capture = async (file: string): Promise<void> => {
      await compareOrRefreshGolden(join(scenario, `${file}.expected.md`), await captureStableAria(page, '[role="region"][aria-labelledby]', workspaceCwd), webSnapshotMode())
      await page.screenshot({ path: join(screenshots, `${file}.png`) })
    }
    await dialog.getByRole('button', { name: '通讯录', exact: true }).click()
    await dialog.getByRole('tab', { name: '部门', exact: true }).click()
    await dialog.getByRole('button', { name: '新建下级部门', exact: true }).click()
    await page.getByRole('textbox', { name: '部门名称', exact: true }).fill('研发部')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await dialog.getByText('示例团队 / 研发部', { exact: true }).waitFor()
    expect(departmentWrites).toEqual([{ name: '研发部', parentId: rootUnit, unitType: 'department' }])
    await capture('departments')
    for (const width of [640, 480]) {
      await page.setViewportSize({ width, height: 800 })
      await expect.poll(() => dialog.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
      await page.screenshot({ path: join(screenshots, `departments-${width}.png`) })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await dialog.getByRole('button', { name: '调整部门', exact: true }).click()
    await page.getByRole('checkbox', { name: '示例团队', exact: true }).uncheck()
    await page.getByRole('checkbox', { name: '示例团队 / 研发部', exact: true }).check()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => assignments).toEqual([{ membershipId: 'member-1', unitId: departmentUnit }])
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await expect.poll(() => dialog.getByRole('listitem').filter({ hasText: 'Team Owner' }).textContent()).toContain('示例团队 / 研发部')
    await capture('departments-assigned')
    await dialog.getByRole('button', { name: '账单', exact: true }).click()
    await dialog.getByText('2,043,079', { exact: true }).waitFor()
    for (const days of [3, 7, 30]) {
      await dialog.getByRole('combobox', { name: '统计周期', exact: true }).selectOption(String(days))
      await expect.poll(() => {
        const query = usageReads.at(-1)
        return query ? Date.parse(query.get('to') ?? '') - Date.parse(query.get('from') ?? '') : 0
      }).toBe(days * 86_400_000)
      await dialog.getByText('2,043,079', { exact: true }).waitFor()
    }
    await dialog.getByRole('combobox', { name: '统计周期', exact: true }).selectOption('custom')
    await dialog.getByLabel('开始日期', { exact: true }).fill('2026-10-01')
    await dialog.getByLabel('结束日期', { exact: true }).fill('2026-10-20')
    await dialog.getByRole('button', { name: '查询', exact: true }).click()
    await expect.poll(() => usageReads.at(-1)?.get('from')).toBe('2026-10-01T00:00:00.000Z')
    await expect.poll(() => usageReads.at(-1)?.get('to')).toBe('2026-10-21T00:00:00.000Z')
    await dialog.getByText('2026/10/1 – 2026/10/20', { exact: true }).waitFor()
    await dialog.getByRole('combobox', { name: '统计周期', exact: true }).selectOption('30')
    await dialog.getByText('2,043,079', { exact: true }).waitFor()
    await dialog.getByRole('tab', { name: '调用记录', exact: true }).click()
    await dialog.getByText('deepseek-flash', { exact: true }).waitFor()
    await capture('billing-records')
    await dialog.getByRole('tab', { name: '钱包流水', exact: true }).click()
    await dialog.getByText('模型用量扣款', { exact: true }).waitFor()
    await capture('billing-ledger')
    await dialog.getByRole('button', { name: '兑换码', exact: true }).click()
    await page.getByRole('dialog', { name: '兑换码', exact: true }).waitFor()
    expect(await page.getByRole('dialog').count()).toBe(1)
    await page.screenshot({ path: join(screenshots, 'redeem.png') })
    await page.keyboard.press('Escape')
    expect(await dialog.count()).toBe(1)
    expect(await page.getByRole('dialog', { name: '兑换码', exact: true }).count()).toBe(0)
    await dialog.getByRole('button', { name: '通讯录', exact: true }).click()
    await dialog.getByRole('button', { name: /Team Owner/ }).click()
    await capture('member-details')
    await dialog.getByRole('tab', { name: '调用记录', exact: true }).click()
    await dialog.getByText('deepseek-flash', { exact: true }).waitFor()
    await capture('member-records')
    await dialog.getByRole('button', { name: '返回成员列表', exact: true }).click()
    await dialog.getByRole('button', { name: '邀请成员', exact: true }).click()
    const invite = page.getByRole('dialog', { name: '邀请成员', exact: true })
    await invite.waitFor()
    expect(await page.getByRole('dialog').count()).toBe(1)
    expect(await invite.getByRole('textbox', { name: '成员邮箱', exact: true }).evaluate(element => element === document.activeElement)).toBe(true)
    await page.screenshot({ path: join(screenshots, 'invite.png') })
    await page.setViewportSize({ width: 480, height: 800 })
    await page.screenshot({ path: join(screenshots, 'invite-480.png') })
    expect(await invite.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.keyboard.press('Escape')
    expect(await invite.count()).toBe(0)
    expect(await dialog.count()).toBe(1)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await dialog.getByRole('button', { name: '通用设置', exact: true }).click()
    await dialog.getByRole('button', { name: '浅色', exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(false)
    await dialog.getByRole('button', { name: '账单', exact: true }).click()
    await dialog.getByRole('heading', { name: '团队人民币余额', exact: true }).waitFor()
    await page.screenshot({ path: join(screenshots, 'billing-light.png') })

    await page.getByRole('button', { name: /^(会话|Sessions)$/, exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(sidebarWidth)
    await expect.poll(() => sidebar.isVisible()).toBe(true)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await dialog.getByRole('heading', { name: '团队人民币余额', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    expect(await dialog.count()).toBe(1)
    expect(await page.getByRole('dialog').count()).toBe(0)
    await dialog.getByRole('button', { name: '企业插件', exact: true }).click()
    await dialog.getByRole('button', { name: '打开插件市场', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.getByRole('heading', { name: '插件市场', exact: true }).waitFor()
    await page.getByRole('button', { name: '云盘', exact: true }).click()
    await page.getByRole('heading', { name: '云盘', exact: true }).waitFor()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await dialog.getByRole('heading', { name: '企业插件', exact: true }).waitFor()

  } finally {
    rejectUpdate?.(new Error('Update fixture closed'))
    await browser?.close()
    await scaffold?.close()
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
    })
  }
}, 120_000)
