/** Keyless page output and revision-preserving management interactions. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { test, type TestContext } from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import AdminShell from '../app/admin-shell'
import AccountPage from '../app/account/page'
import { pageFixture, teamId } from './page-fixtures'

async function mountPage(t: TestContext, path: string, overrides: Record<string, unknown> = {}) {
  const url = new URL(path, 'http://admin.example.test')
  const dom = new JSDOM('<html><head><meta name="enterprise-api-url" content="http://api.example.test"></head><body></body></html>', { url: url.href })
  const originals = new Map<string, PropertyDescriptor | undefined>()
  const globals = { window: dom.window, document: dom.window.document, FormData: dom.window.FormData,
    HTMLInputElement: dom.window.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true }
  for (const [key, value] of Object.entries(globals)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  const calls: Array<{ path: string; method: string; body: unknown }> = []
  const unexpected: string[] = []
  globalThis.fetch = async (input, init) => {
    const requested = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ path: requested.pathname, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
    if (path.startsWith('/account?') && requested.pathname === '/v1/me') return Response.json({ message: 'Login required' }, { status: 401 })
    if (init?.method && init.method !== 'GET') return Response.json({ message: 'Revision conflict' }, { status: 409 })
    const value = Object.hasOwn(overrides, requested.pathname)
      ? overrides[requested.pathname] : pageFixture(requested.pathname, requested.search)
    if (value === undefined) { unexpected.push(requested.pathname); return Response.json({ message: 'Missing fixture' }, { status: 404 }) }
    return Response.json(value)
  }
  const container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
  const root = createRoot(container)
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    try { await act(async () =>{  root.unmount() }) }
    finally {
      dom.window.close()
      if (fetchDescriptor) Object.defineProperty(globalThis, 'fetch', fetchDescriptor)
      else Reflect.deleteProperty(globalThis, 'fetch')
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  }
  t.after(close)
  await act(async () =>{  root.render(path.startsWith('/account?') ? createElement(AccountPage) : createElement(AdminShell, { segments: url.pathname.split('/').filter(Boolean) })) })
  return { container, dom, calls, unexpected, close }
}

const paths = ['/overview', '/platform/health', '/organizations/directory', `/organizations/directory/${teamId}`, '/accounts', '/accounts/acceptance-admin', '/platform/plans', '/models/catalog', '/models/providers', '/models/providers?view=tasks', '/models/adapters', '/models/runtimes', '/models/runtimes/runtime-fixture', '/platform/plugins', '/platform/desktop-releases', '/platform/usage', '/platform/usage?view=ranking', '/platform/usage?view=reconciliation', '/permissions/audit', '/platform/settings', '/platform/redemptions', '/permissions/roles', ...['/identity/providers', '/identity/providers/33333333-3333-4333-8333-333333333333/mapping', '/identity/login-failures', '/sync/scripts', '/sync/runs', '/sync/diffs', '/sync/history'].map(path => path + '?organizationId=' + teamId)]

void test('Admin page headings, navigation and actions match the owner-local snapshot', async (t) => {
  const sections: string[] = ['# Admin pages\n']
  for (const path of paths) {
    const fixture = await mountPage(t, path)
    try {
      assert.deepEqual(fixture.unexpected, [], path)
      assert.equal(fixture.container.querySelectorAll('h1').length, 1, path)
      assert.equal(fixture.container.querySelectorAll('.nav-group').length, 4, path)
      const main = fixture.container.querySelector('.admin-page-content')!
      const visible = (element: Element) => !element.closest('[hidden]')
      const headings = Array.from(main.querySelectorAll('h1, h2')).filter(visible).map(node => node.textContent?.trim()).join(' / ')
      const columns = Array.from(main.querySelectorAll('th')).filter(visible).map(node => node.textContent?.trim()).join(' · ')
      const tabs = Array.from(main.querySelectorAll('[role="tablist"] a, [role="tablist"] button')).map(node => `${node.classList.contains('selected') ? '*' : ''}${node.textContent?.trim()}`).join(' · ')
      sections.push(`## ${path}\n\n${headings}\n\n${columns || '—'}\n\n${tabs || '—'}\n`)
    } finally { await fixture.close() }
  }
  const output = sections.join('\n')
  const expected = new URL('./admin-pages.expected.md', import.meta.url)
  if (process.env.UPDATE_ADMIN_PAGES === '1') await writeFile(expected, output)
  assert.equal(output, await readFile(expected, 'utf8'))
})

void test('account directory reaches account endpoints and exposes email verification as a status', async (t) => {
  const { container, calls, unexpected } = await mountPage(t, '/accounts')
  assert.deepEqual(unexpected, [])
  assert.ok(calls.some(call => call.path === '/v1/platform/accounts'))
  assert.ok(!calls.some(call => call.path === '/v1/platform/organizations'))
  assert.equal(container.querySelector('tbody .status-badge')?.textContent, '已验证')
  assert.equal(container.querySelector('tbody tr')?.getAttribute('tabindex'), '0')
})

void test('failed team mutation retains reason and submits the displayed governance revision', async (t) => {
  const { container, dom, calls } = await mountPage(t, `/organizations/directory/${teamId}`)
  const manage = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '管理团队')!
  await act(async () =>{  manage.click() })
  const form = container.querySelector<HTMLFormElement>('.governance-operation form')!
  const amount = form.querySelector<HTMLInputElement>('[name="amount"]')!
  const reason = form.querySelector<HTMLInputElement>('[name="reason"]')!
  amount.value = '1.25'; reason.value = '验收额度修订'
  await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  const mutation = calls.find(call => call.method === 'POST')!
  assert.deepEqual(mutation.body, { expectedVersion: 7, reason: '验收额度修订', change: { action: 'credit', amountMicrosCny: 1250000 } })
  assert.equal(container.querySelector('[name="reason"]'), reason)
  assert.equal(reason.value, '验收额度修订')
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /Revision conflict/)
})

void test('public recovery switches form fields without requiring a signed-in session', async (t) => {
  const { container } = await mountPage(t, '/account?flow=acceptance')
  const recover = Array.from(container.querySelectorAll<HTMLButtonElement>('.actions button')).find(button => button.textContent === '找回密码')!
  await act(async () =>{  recover.click() })
  assert.ok(container.querySelector('input[type="email"]'))
  assert.equal(container.querySelector('input[type="password"]'), null)
})

void test('team create dialog contains keyboard focus and restores the invoking control', async (t) => {
  const { container, dom } = await mountPage(t, '/organizations/directory')
  const open = container.querySelector<HTMLButtonElement>('.page-header .primary')!
  open.focus()
  await act(async () =>{  open.click() })
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
  assert.ok(dialog.contains(dom.window.document.activeElement))
  const submit = dialog.querySelector<HTMLButtonElement>('.governance-form > button')!
  submit.focus()
  await act(async () => submit.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
  assert.ok(dom.window.document.activeElement === dialog.querySelector('[data-dialog-close]'), dom.window.document.activeElement?.outerHTML)
  await act(async () => dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  assert.ok(dialog.closest('[hidden]'))
  assert.ok(dom.window.document.activeElement === open, dom.window.document.activeElement?.outerHTML)
})

void test('team capacity uses GiB in the form and integer bytes in the versioned request', async (t) => {
  const { container, dom, calls } = await mountPage(t, `/organizations/directory/${teamId}`)
  const manage = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '管理团队')!
  await act(async () => { manage.click() })
  const form = container.querySelector<HTMLInputElement>('.team-operation-panel [name="storage"]')!.form!
  const storage = form.querySelector<HTMLInputElement>('[name="storage"]')!
  assert.equal(storage.value, '10')
  storage.value = '1.5'
  form.querySelector<HTMLInputElement>('[name="reason"]')!.value = '验收容量调整'
  await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) })
  assert.deepEqual(calls.find(call => call.method === 'POST')?.body, {
    expectedVersion: 7, reason: '验收容量调整', change: { action: 'resources', policy: {
      defaultBudget: { mode: 'limited', amountMicrosCny: 100000000 }, timeZone: 'Asia/Shanghai',
      storageBytes: 1610612736, personalStorageBytes: 1073741824,
    } },
  })
  assert.equal(storage.value, '1.5')
})

void test('enterprise configuration requires Admin identity and never renders for an ordinary member', async (t) => {
  const { container, calls } = await mountPage(t, '/identity/providers', { '/v1/me': { platformAdmin: false } })
  assert.match(container.textContent ?? '', /平台管理员/)
  assert.ok(!calls.some(call => call.path === '/v1/platform/policy' || call.path === '/v1/organizations'))
  assert.equal(container.querySelector('.enterprise-workspace'), null)
})

void test('enterprise configuration is separate from SaaS and does not implicitly select the first team', async (t) => {
  const saas = await mountPage(t, '/sync/scripts', { '/v1/platform/policy': { mode: 'open' } })
  assert.match(saas.container.textContent ?? '', /SaaS/)
  assert.ok(!saas.calls.some(call => call.path.startsWith('/v1/organizations')))
  await saas.close()
  const enterprise = await mountPage(t, '/identity/providers')
  assert.equal(enterprise.container.querySelector<HTMLSelectElement>('.enterprise-scope select')?.value, '')
  assert.ok(!enterprise.calls.some(call => call.path.endsWith('/capabilities') || call.path.endsWith('/identity-providers')))
})

void test('an unknown team or missing enterprise capability cannot fetch identity connections', async (t) => {
  const unknown = await mountPage(t, '/identity/providers?organizationId=not-a-member')
  assert.ok(!unknown.calls.some(call => call.path.endsWith('/capabilities')))
  await unknown.close()
  const denied = await mountPage(t, '/identity/providers?organizationId=' + teamId, {
    [`/v1/organizations/${teamId}/capabilities`]: { permissions: [] },
  })
  assert.match(denied.container.textContent ?? '', /没有.*配置权限/)
  assert.ok(!denied.calls.some(call => call.path.endsWith('/identity-providers')))
})

void test('enterprise identity changes preserve the displayed version and never render stored secrets', async (t) => {
  const { container, dom, calls } = await mountPage(t, '/identity/providers?organizationId=' + teamId)
  assert.ok(!container.innerHTML.includes('fixture-secret-never-render'))
  const toggle = Array.from(container.querySelectorAll<HTMLButtonElement>('tbody button')).at(-1)!
  await act(async () => { toggle.click() })
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
  const checkbox = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!
  await act(async () => { checkbox.click() })
  await act(async () => { dialog.querySelector<HTMLButtonElement>('.modal-actions .primary')!.click() })
  assert.deepEqual(calls.find(call => call.method === 'PATCH')?.body, { expectedVersion: 5, enabled: false })
  assert.equal(calls.find(call => call.method === 'PATCH')?.path, `/v1/organizations/${teamId}/identity-providers/33333333-3333-4333-8333-333333333333`)
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /Revision conflict/)
  await act(async () => { dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
})

void test('enterprise directory approvals require explicit confirmation and send the displayed diff version', async (t) => {
  const { container, calls } = await mountPage(t, '/sync/diffs?organizationId=' + teamId)
  const approve = Array.from(container.querySelectorAll<HTMLButtonElement>('tbody button')).find(button => button.textContent === '批准变更')!
  await act(async () => { approve.click() })
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
  const submit = dialog.querySelector<HTMLButtonElement>('.modal-actions .primary')!
  assert.equal(submit.disabled, true)
  assert.equal(calls.filter(call => call.method !== 'GET').length, 0)
  await act(async () => { dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click() })
  await act(async () => { submit.click() })
  assert.deepEqual(calls.find(call => call.method === 'PATCH')?.body, { decision: 'approved', version: 4 })
  assert.equal(calls.find(call => call.method === 'PATCH')?.path, `/v1/organizations/${teamId}/sync-diffs/66666666-6666-4666-8666-666666666666`)
})

void test('identity editing leaves stored secrets blank and retains them in the versioned update', async (t) => {
  const { container, dom, calls } = await mountPage(t, '/identity/providers?organizationId=' + teamId)
  const edit = Array.from(container.querySelectorAll<HTMLButtonElement>('tbody button')).find(button => button.textContent === '编辑')!
  await act(async () => { edit.click() })
  const form = container.querySelector<HTMLFormElement>('[role="dialog"] form')!
  assert.equal(form.querySelector<HTMLInputElement>('input[type="password"]')!.value, '')
  assert.ok(!form.innerHTML.includes('fixture-secret-never-render'))
  await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) })
  assert.deepEqual(calls.find(call => call.method === 'PATCH')?.body, {
    name: 'Enterprise OIDC', protocol: 'oidc', issuer: 'https://identity.example.test', expectedVersion: 5,
    config: { clientId: 'fixture-client', clientSecret: 'fixture-secret-never-render', scopes: 'openid profile email' },
  })
  assert.equal(container.querySelector('[role="dialog"] form'), form)
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /Revision conflict/)
})

void test('field mapping saves keep row revisions and preserve the form after a conflict', async (t) => {
  const { container, dom, calls } = await mountPage(t, '/identity/providers/33333333-3333-4333-8333-333333333333/mapping?organizationId=' + teamId)
  const form = container.querySelector<HTMLFormElement>('.enterprise-form')!
  await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) })
  assert.deepEqual(calls.find(call => call.method === 'PUT')?.body, [{ sourceField: 'email', targetField: 'email', transform: 'lowercase', required: true, version: 2 }])
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /Revision conflict/)
  assert.equal(container.querySelector<HTMLInputElement>('.enterprise-mapping-row input')?.value, 'email')
})
