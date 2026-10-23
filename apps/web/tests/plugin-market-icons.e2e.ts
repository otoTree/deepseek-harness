/** Recorded-session browser coverage for packaged enterprise marketplace icons. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { zipSync, strToU8 } from 'fflate'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { parsePluginPackage } from '../../api/src/plugin-package.ts'
import { compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode, type WebScaffold } from './scaffold.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const scenario = join(root, 'snapshots/web/plugin-market-icons')
const fixtures = join(root, 'packages/client/ui-enterprise/tests/fixtures')

it.skipIf(process.platform === 'win32')('loads packaged icons without network requests and refreshes the release image', async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-plugin-icons-'))
  // The Host credential fixture uses a POSIX executable, as the macOS desktop does.
  context.onTestFinished(() => rm(temporary, { recursive: true, force: true }))
  const organizationId = '00000000-0000-4000-8000-000000000001'
  const icon = async (name: string) => `data:image/png;base64,${(await readFile(join(fixtures, `${name}.png`))).toString('base64')}`
  const mailIcon = await icon('personal-mail')
  const clinicalIcon = await icon('clinical-learning')
  const entries = {
    'manifest.json': strToU8(JSON.stringify({
      schemaVersion: 2, pluginId: 'personal-mail', name: '个人邮箱', version: '1.0.0', icon: mailIcon,
      targets: [{ kind: 'host', entry: 'host/index.js', compatibility: '1', contributions: [] }],
      build: { runtime: 'node22', lockfileDigest: '0'.repeat(64) },
    })),
    'host/index.js': strToU8('export const name = "mail"'),
  }
  const archive = zipSync({ ...entries, 'integrity.json': strToU8(JSON.stringify(Object.fromEntries(
    Object.entries(entries).map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]),
  ))) })
  const packaged = parsePluginPackage(archive).manifest
  let currentIcon = packaged.icon
  const base = { version: '1.0.0', targets: ['host'], permissions: [], tools: [], publishedAt: '2026-10-21T00:00:00Z', policyRevision: 1 }
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    const path = request.url?.replace(`/v1/organizations/${organizationId}/`, '')
    const data = path === 'plugins/catalog' ? [
      { ...base, id: 'mail', pluginId: 'personal-mail', name: '个人邮箱', description: '管理个人邮件', icon: currentIcon },
      { ...base, id: 'clinical', pluginId: 'clinical-learning', name: '医学指南学习', description: '整理医学指南', icon: clinicalIcon },
      { ...base, id: 'legacy', pluginId: 'legacy-plugin', name: 'Legacy Plugin', description: 'A release without an icon' },
    ] : path === 'overview' ? {
      organization: { id: organizationId, name: 'Icon fixture', kind: 'team', status: 'active', policyRevision: 1 },
      subscription: { plan: 'Enterprise', seats: 5, runtimes: 5 }, roles: [],
    } : path?.startsWith('usage?') ? { items: [], nextCursor: null, range: {
      from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z', timeZone: 'UTC',
    } } : []
    response.end(JSON.stringify(data))
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
    const overlay = join(temporary, 'icons.yml')
    await writeFile(overlay, JSON.stringify([{ id: 'ui-settings-plugins', disabled: true }, { insert: [{ id: 'enterprise-client', name: '@deepseek-ai/dsh-enterprise-client', config: {
      apiUrl, organizationId, keychainHelper: helper, keychainAccount: account, triggerStatePath: join(temporary, 'triggers.json'),
    } }] }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(root, 'apps/electrobun/package.json')] })
    await seedSession(scaffold, await readFile(join(root, 'snapshots/web/lifecycle-chrome/session.v2.jsonl'), 'utf8'), 'icon-session')
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
    await page.getByRole('button', { name: '插件市场', exact: true }).waitFor({ timeout: 10_000 }).catch(async (error: unknown) => {
      await mkdir(join(root, '.playwright-mcp'), { recursive: true })
      await writeFile(join(root, '.playwright-mcp/plugin-market-icons-body.txt'), await page.locator('body').innerText())
      await page.screenshot({ path: join(root, '.playwright-mcp/plugin-market-icons-failed.png') })
      throw error
    })
    await page.getByRole('button', { name: '插件市场', exact: true }).click()
    await page.getByRole('heading', { name: '个人邮箱', exact: true }).waitFor({ timeout: 10_000 }).catch(async (error: unknown) => {
      await writeFile(join(root, '.playwright-mcp/plugin-market-icons-body.txt'), await page.locator('body').innerText())
      throw error
    })
    await expect.poll(() => page.locator('.dse-market-plugin-icon img').evaluateAll(images =>
      images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 128),
    )).toBe(true)
    const summary = await page.locator('.dse-market-row').evaluateAll(rows => rows.map((row) => {
      const image = row.querySelector('img')
      return {
        name: row.querySelector('h4')!.textContent,
        embedded: image?.src.startsWith('data:image/png;base64,') ?? false,
        loaded: image === null ? false : image.complete && image.naturalWidth > 0,
        initials: image === null ? row.querySelector('.dse-market-plugin-icon')!.textContent : null,
      }
    }))
    expect(summary.filter(item => item.loaded)).toHaveLength(2)
    await compareOrRefreshGolden(join(scenario, 'icons.expected.md'), JSON.stringify(summary, null, 2), webSnapshotMode())
    await mkdir(join(root, '.playwright-mcp'), { recursive: true })
    await page.screenshot({ path: join(root, '.playwright-mcp/plugin-market-icons.png') })
    currentIcon = clinicalIcon
    await page.getByRole('button', { name: '刷新插件目录', exact: true }).click()
    const mail = page.locator('.dse-market-row').filter({ has: page.getByRole('heading', { name: '个人邮箱' }) })
    await expect.poll(() => mail.locator('img').getAttribute('src')).toBe(clinicalIcon)
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
