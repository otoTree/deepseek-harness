/** Deployment policy reaches the bundled native account page without exposing credentials. */
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { startAccountServer } from '../../electrobun/src/account-server.ts'
import { LocalAccount } from '../../electrobun/src/local-account.ts'
import { DesktopUpdates } from '../../electrobun/src/desktop-updates.ts'
import { updateMessages } from '../../electrobun/src/messages.ts'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { compareOrRefreshGolden, webSnapshotMode } from './scaffold.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))

it('uses the deployment policy for SaaS team creation and private-company entry', async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-account-policy-'))
  context.onTestFinished(() => rm(temporary, { recursive: true, force: true }))
  await build({ configFile: join(root, 'apps/electrobun/vite.config.ts'), logLevel: 'error', build: { outDir: temporary } })
  const browser = await chromium.launch()
  context.onTestFinished(() => browser.close())
  const screenshots = join(root, '.hutch/enterprise-account')
  await mkdir(screenshots, { recursive: true })
  for (const [mode, registration] of [['open', 'open'], ['private', 'invite_only'], ['private', 'disabled']] as const) {
    const requests: string[] = []
    const account = new LocalAccount({
      apiUrl: 'https://api.example.com',
      keychain: { set: async () => {}, delete: async () => {} },
      enter: async () => {}, logout: async () => {}, openExternal: async () => {},
      request: async (input) => {
        const path = (input instanceof Request ? new URL(input.url) : new URL(input)).pathname
        requests.push(path)
        if (path === '/auth/deployment') return Response.json({ mode, registration })
        if (path === '/auth/sso/providers' || path === '/v1/desktop/organizations') return Response.json([])
        if (path === '/v1/me') return Response.json({ email: 'member@example.com' })
        if (path === '/auth/sign-in/email') return Response.json({}, { headers: { 'Set-Cookie': 'session=private-native-cookie; HttpOnly' } })
        return Response.json({}, { status: 404 })
      },
    })
    const server = await startAccountServer(temporary, account)
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, locale: 'zh-CN', colorScheme: 'dark' })
    try {
      await page.goto(server.url)
      await page.getByRole('heading', { name: '欢迎回来', exact: true }).waitFor()
      expect(await page.getByRole('button', { name: '还没有账号？注册', exact: true }).count()).toBe(registration === 'disabled' ? 0 : 1)
      if (registration !== 'disabled') {
        await page.getByRole('button', { name: '还没有账号？注册', exact: true }).click()
        await page.getByText(mode === 'private' ? '使用公司邀请注册账号，再加入组织。' : '注册账号，然后加入或创建你的团队。', { exact: true }).waitFor()
        await page.getByRole('button', { name: '已有账号？登录', exact: true }).click()
      }
      await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('member@example.com')
      await page.getByLabel('密码', { exact: true }).fill('example-password')
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await page.getByRole('heading', { name: mode === 'private' ? '选择公司组织' : '选择你的团队', exact: true }).waitFor()
      expect(await page.getByText('创建团队', { exact: true }).count()).toBe(mode === 'open' ? 2 : 0)
      if (mode === 'private') await page.getByText('请联系管理员，获取公司组织的邀请。', { exact: true }).waitFor()
      expect(await page.getByText(mode === 'private' ? '加入公司组织' : '加入团队', { exact: true }).count()).toBeGreaterThan(0)
      expect(await page.locator('body').textContent()).not.toContain('private-native-cookie')
      const name = mode === 'open' ? 'saas' : registration === 'disabled' ? 'private-disabled' : 'private'
      await compareOrRefreshGolden(join(root, 'apps/web/tests/expected/enterprise-account', `${name}.expected.md`), await page.locator('main').ariaSnapshot(), webSnapshotMode())
      await page.screenshot({ path: join(screenshots, `${name}.png`) })
      expect(requests).toContain('/auth/deployment')
      expect(requests).not.toContain('/v1/organizations')
    } finally {
      await page.close()
      await server.close()
    }
  }
})

it('offers a closable startup update before sign-in and keeps installation available after a failed action', async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-account-update-'))
  context.onTestFinished(() => rm(temporary, { recursive: true, force: true }))
  await build({ configFile: join(root, 'apps/electrobun/vite.config.ts'), logLevel: 'error', build: { outDir: temporary } })
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const payload = Buffer.from(JSON.stringify({
    format: 1, identifier: 'ai.deepseek.harness.enterprise', version: '0.2.0', target: 'darwin-arm64',
    url: 'https://updates.example.test/installer.dmg', size: 1,
    sha256: createHash('sha256').update('x').digest('hex'), notes: 'Startup fixture',
  }))
  const signed = JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') })
  const updates = new DesktopUpdates({ url: 'https://updates.example.test/latest', publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') },
    '0.1.0', 'darwin-arm64', updateMessages.zh, {
      available: () => {}, dialog: async () => { throw new Error('Startup cannot open a dialog') },
      notify: () => { throw new Error('Startup cannot notify progress') },
      prepare: async () => { throw new Error('Startup cannot download') }, install: async () => { throw new Error('Startup cannot install') },
    }, async () => new Response(signed))
  context.onTestFinished(() => updates.stop())
  let attempts = 0
  const server = await startAccountServer(temporary, {
    state: async () => ({ deployment: { mode: 'open', registration: 'open' }, user: null, organizations: [], ssoProviders: [] }),
    run: async () => { throw new Error('Update does not require sign-in') },
  }, {
    getVersion: () => updates.availableVersion,
    dismiss: () => { updates.dismissNotification() },
    install: () => { if (++attempts === 1) throw new Error('Fixture update action failed'); updates.dismissNotification() },
  })
  context.onTestFinished(() => server.close())
  const browser = await chromium.launch()
  context.onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, locale: 'zh-CN', colorScheme: 'dark' })
  await page.goto(server.url)
  await page.getByRole('heading', { name: '欢迎回来', exact: true }).waitFor()
  expect(await page.getByRole('region', { name: '发现新版本', exact: true }).count()).toBe(0)
  await updates.checkAtStartup()
  await page.evaluate(() => window.dispatchEvent(new Event('dsh-desktop-update-available')))
  const notification = page.getByRole('region', { name: '发现新版本', exact: true })
  await notification.getByRole('button', { name: '安装更新', exact: true }).waitFor()
  const expectations = join(root, 'apps/web/tests/expected/enterprise-account')
  await compareOrRefreshGolden(join(expectations, 'startup-update-zh.expected.md'), await notification.ariaSnapshot(), webSnapshotMode())
  const screenshots = join(root, 'output/playwright/enterprise-account-updates')
  await mkdir(screenshots, { recursive: true })
  await page.screenshot({ path: join(screenshots, 'startup.png') })
  await page.setViewportSize({ width: 390, height: 800 })
  expect(await notification.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: join(screenshots, 'startup-390.png') })
  await notification.getByRole('button', { name: '安装更新', exact: true }).click()
  await notification.getByRole('alert').waitFor()
  await compareOrRefreshGolden(join(expectations, 'startup-update-failed.expected.md'), await notification.ariaSnapshot(), webSnapshotMode())
  await notification.getByRole('button', { name: '安装更新', exact: true }).click()
  await notification.waitFor({ state: 'detached' })
  expect(attempts).toBe(2)
  await page.reload()
  await page.getByRole('heading', { name: '欢迎回来', exact: true }).waitFor()
  expect(await notification.count()).toBe(0)
})
