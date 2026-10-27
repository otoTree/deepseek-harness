import { chooseThemedOption } from './support.ts'
/** Recorded-session browser coverage for explicit enterprise drive sharing. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode, type WebScaffold } from './scaffold.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const scenario = join(root, 'snapshots/web/drive-sharing')

it.skipIf(process.platform === 'win32')('saves explicit department audiences and opens shared folders in their original space', async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-drive-sharing-'))
  // The Host credential fixture uses a POSIX executable, as the macOS desktop does.
  context.onTestFinished(() => rm(temporary, { recursive: true, force: true }))
  const organizationId = '00000000-0000-4000-8000-000000000001'
  const personal = '00000000-0000-4000-8000-000000000003'
  const organization = '00000000-0000-4000-8000-000000000004'
  const department = '00000000-0000-4000-8000-000000000005'
  const fileId = '00000000-0000-4000-8000-000000000006'
  const sharedFolder = '00000000-0000-4000-8000-000000000007'
  let policy = { organizationId, scope: 'private', permission: 'viewer', memberIds: [] as string[], departments: [] as Array<{ id: string; includeDescendants: boolean }> }
  const saved: unknown[] = []
  const transfers: { path: string; body: Record<string, unknown> }[] = []
  let copyFails = true
  const destination = '00000000-0000-4000-8000-000000000008'
  const file = () => ({ id: fileId, spaceId: personal, parentId: null, name: 'Roadmap.pdf', kind: 'file', size: 1024, contentType: 'application/pdf', versionId: null, updatedAt: '2026-10-22T00:00:00Z', deletedAt: null, sharing: policy })
  const folder = { ...file(), id: sharedFolder, name: 'Design team', kind: 'folder', contentType: 'inode/directory', sharing: null }
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader('Content-Type', 'application/json')
      const url = new URL(request.url!, 'http://fixture')
      const path = url.pathname.replace(`/v1/organizations/${organizationId}/`, '')
      if (path === 'drive/imports' || (path === `drive/files/${fileId}` && request.method === 'PATCH')) {
        let body = ''
        for await (const chunk of request) body += String(chunk)
        transfers.push({ path, body: JSON.parse(body) as Record<string, unknown> })
        if (path === 'drive/imports' && copyFails) {
          copyFails = false; response.writeHead(409).end(JSON.stringify({ error: 'TEAM_STORAGE_EXHAUSTED' })); return
        }
        response.end('{}'); return
      }
      if (path === `drive/files/${fileId}/sharing` && request.method === 'PUT') {
        let body = ''
        request.setEncoding('utf8')
        for await (const chunk of request) {
          if (typeof chunk !== 'string') throw new Error('Fixture body must be UTF-8 text')
          body += chunk
        }
        policy = (JSON.parse(body) as { policy: typeof policy }).policy
        saved.push(policy)
      }
      const data = path === 'drive/spaces' ? [
        { id: personal, kind: 'personal', name: 'Personal', role: 'owner' },
        { id: organization, kind: 'organization', name: 'Acme', role: 'member' },
      ] : path === 'drive/directory' ? {
        organizationId, organizationName: 'Acme', members: [{ id: 'alice', name: 'Alice' }],
        departments: [{ id: department, parentId: null, name: 'Engineering' }], myDepartmentIds: [department],
      } : path === `drive/files/${fileId}/sharing` ? {
        policy, canManage: true, role: 'owner', inheritedFrom: null, audienceCount: policy.scope === 'private' ? 1 : 8,
      } : path === 'drive/files' || path === 'drive/search' ? {
        items: url.searchParams.get('parentId') ? [] : url.searchParams.get('shared') === 'true' ? [folder]
          : url.searchParams.get('spaceId') === organization ? [{ ...folder, id: destination, spaceId: organization, name: 'Reports' }] : [file()],
        nextCursor: null, summary: { spaceId: url.searchParams.get('spaceId'), parentId: url.searchParams.get('parentId'), totalKnown: null },
      } : path === 'overview' ? {
        organization: { id: organizationId, name: 'Acme', kind: 'team', status: 'active', policyRevision: 1 },
        subscription: { plan: 'Enterprise', seats: 10, runtimes: 10 }, roles: [],
      } : path.startsWith('usage') ? { items: [], nextCursor: null, range: { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z', timeZone: 'UTC' } } : []
      response.end(JSON.stringify(data))
    })().catch(() => { response.writeHead(500); response.end() })
  })
  let scaffold: WebScaffold | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Fixture server has no TCP address')
    const apiUrl = `http://127.0.0.1:${address.port}`
    const helper = join(temporary, 'keychain')
    const credential = { apiOrigin: apiUrl, organizationId, runtimeId: '00000000-0000-4000-8000-000000000002', token: 'fixture-token'.repeat(4), expiresAt: '2099-01-01T00:00:00Z' }
    const account = `${createHash('sha256').update(apiUrl).digest('hex')}:${organizationId}:${credential.runtimeId}`
    await writeFile(helper, `#!/bin/sh\nprintf '%s' '${JSON.stringify(credential)}'\n`)
    await chmod(helper, 0o700)
    const overlay = join(temporary, 'drive.yml')
    await writeFile(overlay, JSON.stringify([{ id: 'ui-settings-plugins', disabled: true }, { insert: [{ id: 'enterprise-client', name: '@deepseek-ai/dsh-enterprise-client', config: {
      apiUrl, organizationId, keychainHelper: helper, keychainAccount: account, triggerStatePath: join(temporary, 'triggers.json'),
    } }] }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(root, 'apps/electrobun/package.json')] })
    await seedSession(scaffold, await readFile(join(root, 'snapshots/web/lifecycle-chrome/session.v2.jsonl'), 'utf8'), 'drive-session')
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN' })
    const externalRequests: string[] = []
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
        externalRequests.push(url.origin)
        await route.abort()
      } else await route.continue()
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '云盘', exact: true }).click()
    await page.getByRole('button', { name: '查看“Roadmap.pdf”的详情', exact: true }).click()
    await page.getByRole('button', { name: '管理访问权限', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '管理访问权限', exact: true })
    await dialog.getByRole('radio', { name: '指定成员或部门', exact: true }).check()
    await expect.poll(() => dialog.getByRole('button', { name: '保存', exact: true }).isEnabled()).toBe(false)
    await dialog.getByRole('button', { name: '选择我的部门', exact: true }).click()
    await dialog.getByRole('checkbox', { name: '包含下级部门', exact: true }).check()
    const recipientSearch = dialog.getByRole('textbox', { name: '搜索部门或成员', exact: true })
    await recipientSearch.fill('engineer')
    await expect.poll(() => dialog.getByRole('checkbox', { name: 'Alice', exact: true }).count()).toBe(0)
    await recipientSearch.fill('no-such-person')
    await expect.poll(() => dialog.getByText('无匹配的部门或成员', { exact: true }).count()).toBe(2)
    await recipientSearch.fill('')
    expect(await dialog.getByRole('checkbox', { name: 'Engineering', exact: true }).isChecked()).toBe(true)
    expect(await dialog.getByRole('checkbox', { name: '包含下级部门', exact: true }).isChecked()).toBe(true)
    await chooseThemedOption(page, dialog.getByRole('combobox', { name: '接收者权限', exact: true }), 'viewer')
    await dialog.getByRole('heading', { name: '管理访问权限', exact: true }).click()
    await mkdir(join(root, '.playwright-mcp'), { recursive: true })
    await page.screenshot({ path: join(root, '.playwright-mcp/drive-sharing-editor.png') })
    await dialog.screenshot({ path: join(root, '.playwright-mcp/drive-sharing-dialog.png') })
    await compareOrRefreshGolden(join(scenario, 'sharing.expected.md'), await dialog.ariaSnapshot(), webSnapshotMode())
    await page.setViewportSize({ width: 390, height: 844 })
    const saveBounds = await dialog.getByRole('button', { name: '保存', exact: true }).boundingBox()
    expect(saveBounds).not.toBeNull()
    expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(844)
    const dialogBounds = await dialog.boundingBox()
    expect(dialogBounds!.x).toBeGreaterThanOrEqual(0)
    expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(390)
    await page.screenshot({ path: join(root, '.playwright-mcp/drive-sharing-narrow.png') })
    await page.setViewportSize({ width: 1440, height: 1100 })
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => saved.length).toBe(1)
    expect(saved[0]).toEqual({ organizationId, scope: 'selected', permission: 'viewer', memberIds: [], departments: [{ id: department, includeDescendants: true }] })
    const details = page.getByRole('complementary', { name: '文件详情', exact: true })
    await expect.poll(() => details.innerText()).toContain('Engineering · 包含下级部门')
    await expect.poll(() => details.innerText()).toContain('当前组织内 8 人可访问')
    await page.screenshot({ path: join(root, '.playwright-mcp/drive-sharing-details.png') })
    await details.getByRole('button', { name: '复制到', exact: true }).click()
    const copy = page.getByRole('dialog', { name: '复制到', exact: true })
    await chooseThemedOption(page, copy.getByRole('combobox'), organization)
    await copy.getByRole('button', { name: 'Reports', exact: true }).click()
    await expect.poll(() => copy.getByRole('listitem').count()).toBe(0)
    await compareOrRefreshGolden(join(scenario, 'copy-target.expected.md'), await copy.ariaSnapshot(), webSnapshotMode())
    await copy.getByRole('button', { name: '确认目标归属与分享并提交', exact: true }).click()
    await expect.poll(() => transfers.length).toBe(1)
    await expect.poll(() => copy.getByRole('button', { name: '确认目标归属与分享并提交', exact: true }).isEnabled()).toBe(true)
    expect(await copy.getByRole('combobox').getAttribute('value')).toBe(organization)
    await copy.getByRole('button', { name: '确认目标归属与分享并提交', exact: true }).click()
    await copy.waitFor({ state: 'hidden' })
    const firstCopy = transfers.at(0), retriedCopy = transfers.at(1)
    expect(firstCopy?.body).toEqual(retriedCopy?.body)
    expect(retriedCopy?.body).toMatchObject({ spaceId: organization, parentId: destination, source: { kind: 'file', nodeId: fileId } })
    await page.getByRole('button', { name: '查看“Roadmap.pdf”的详情', exact: true }).click()
    await details.getByRole('button', { name: '移动到', exact: true }).click()
    const move = page.getByRole('dialog', { name: '移动到', exact: true })
    await chooseThemedOption(page, move.getByRole('combobox'), organization)
    await move.getByRole('button', { name: '确认目标归属与分享并提交', exact: true }).click()
    await move.waitFor({ state: 'hidden' })
    expect(transfers[2]).toMatchObject({ path: `drive/files/${fileId}`, body: { spaceId: organization, parentId: null, confirmSharing: true, baseVersionId: null } })
    await page.getByRole('button', { name: '查看“Roadmap.pdf”的详情', exact: true }).click()
    await page.getByRole('button', { name: '关闭详情', exact: true }).last().click()
    await page.getByRole('tab', { name: '与我共享', exact: true }).click()
    await page.getByRole('button').filter({ hasText: 'Design team' }).click()
    await expect.poll(() => page.locator('.dse-drive-list').innerText()).toContain('此文件夹为空。')
    await page.getByRole('button', { name: '与我共享', exact: true }).click()
    await expect.poll(() => page.locator('.dse-drive-list').innerText()).toContain('Design team')
    await page.screenshot({ path: join(root, '.playwright-mcp/drive-sharing-shared.png') })
    expect(externalRequests).toEqual([])
  } finally {
    await browser?.close()
    await scaffold?.close()
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
    })
  }
}, 120_000)
