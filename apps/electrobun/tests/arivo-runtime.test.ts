/** Verify the actual built plugin through a named, supervised DSH profile. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ArivoRuntime, arivoWorkbenchUrl } from '../src/distribution/arivo-runtime.ts'

const desktop = fileURLToPath(new URL('..', import.meta.url))

void test('Arivo native bootstrap refuses remote origins and ambiguous authorization', () => {
  const token = 'a'.repeat(43)
  assert.equal(arivoWorkbenchUrl(`http://127.0.0.1:12345/?token=${token}`), `http://127.0.0.1:12345/?token=${token}`)
  for (const value of [
    `https://arivo.example/?token=${token}`, `http://localhost:12345/?token=${token}`,
    `http://127.0.0.1:12345/?token=${token}&token=${token}`, `http://127.0.0.1:12345/?token=${token}&other=x`,
    `http://127.0.0.1:12345/?token=${token}#x`, 'http://127.0.0.1:12345/?token=short',
  ]) assert.throws(() => arivoWorkbenchUrl(value))
})

void test('packaged Arivo plugin boots offline and preserves authenticated Host and resource isolation', {
  skip: !process.env.ARIVO_TEST_PLUGIN_RELEASE && 'Set ARIVO_TEST_PLUGIN_RELEASE to a built plugin release', timeout: 60000,
}, async (t) => {
  const source = process.env.ARIVO_TEST_PLUGIN_RELEASE
  assert.ok(source)
  const inputs = resolve(desktop, 'build/distributions/arivo/local-installer/inputs')
  const temporary = await mkdtemp(join(tmpdir(), 'arivo-profile-test-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const application = join(temporary, 'app')
  const pluginDirectory = join(application, 'plugins', 'arivo')
  await mkdir(join(application, 'plugins'), { recursive: true })
  await cp(source, pluginDirectory, { recursive: true })
  await symlink(join(inputs, 'runtime-tree/node_modules'), join(application, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir')
  for (const entry of ['runtime', process.platform === 'win32' ? 'dsh.exe' : 'dsh', process.platform === 'win32' ? 'node.exe' : 'node']) {
    await cp(join(inputs, entry), join(application, entry), { recursive: true })
  }
  await cp(join(desktop, 'build/distributions/arivo/arivo-shell'), join(application, 'arivo-shell'), { recursive: true })
  const manifest = await readFile(join(pluginDirectory, 'manifest.json'))
  const config = {
    binary: join(application, process.platform === 'win32' ? 'dsh.exe' : 'dsh'),
    installAnchor: join(application, 'runtime/package.json'), home: join(temporary, 'home'), pluginDirectory, shellDirectory: join(application, 'arivo-shell'),
    instanceHelper: join(desktop, 'build/distributions/arivo/native', process.platform === 'win32' ? 'instance.exe' : 'instance'),
    manifestSha256: createHash('sha256').update(manifest).digest('hex'), pluginVersion: '0.1.0',
    target: process.platform === 'win32' ? 'win32-x64' as const : 'darwin-arm64' as const,
    maxPluginBytes: 128 * 1024 * 1024, startupTimeoutMs: 30000, shutdownTimeoutMs: 5000,
  }
  const runtime = new ArivoRuntime(config)
  t.after(() => runtime.stop())
  const starting = runtime.start()
  assert.equal(starting, runtime.start())
  const url = await starting
  const agentUrl = await runtime.agentUrl()
  assert.notEqual(new URL(agentUrl).origin, new URL(url).origin)
  const agentBoot = await fetch(agentUrl, { redirect: 'manual' })
  assert.equal(agentBoot.status, 303)
  assert.ok(agentBoot.headers.get('set-cookie'))
  await agentBoot.body?.cancel()
  const bootstrap = await fetch(url, { redirect: 'manual' })
  assert.equal(bootstrap.status, 303)
  assert.equal(bootstrap.headers.get('location'), '/')
  const cookie = bootstrap.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  assert.match(bootstrap.headers.get('set-cookie') ?? '', /HttpOnly; SameSite=Strict/u)
  await bootstrap.body?.cancel()
  const origin = new URL(url).origin
  const request = async (path: string, headers?: Record<string, string>) =>
    fetch(origin + path, { headers, signal: AbortSignal.timeout(5000) })
  const unauthorized = await request('/api/runtime')
  assert.equal(unauthorized.status, 401)
  await unauthorized.body?.cancel()
  const response = await request('/api/runtime', { Cookie: cookie })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    protocolVersion: 1, product: 'com.arivo.studio', plugin: 'arivo.studio.core', version: '0.1.0', target: config.target,
    local: true, services: [{ id: 'host', state: 'ready' }, { id: 'client', state: 'ready' }, { id: 'agent', state: 'ready' }],
    cloud: 'not-connected',
  })
  const duplicate = new ArivoRuntime(config)
  t.after(() => duplicate.stop())
  await assert.rejects(duplicate.start(), /exited before/u)
  await duplicate.stop()
  const surviving = await request('/api/runtime', { Cookie: cookie })
  assert.equal(surviving.status, 200)
  await surviving.body?.cancel()
  const foreign = await request('/api/runtime', { Cookie: cookie, Origin: 'https://foreign.example' })
  assert.equal(foreign.status, 403); await foreign.body?.cancel()
  const page = await request('/', { Cookie: cookie })
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/u)
  assert.match(await page.text(), /<title>Arivo<\/title>/u)
  const script = await request('/client.js', { Cookie: cookie })
  assert.equal(script.status, 200)
  assert.match(script.headers.get('content-type') ?? '', /javascript/u)
  assert.ok((await script.text()).length > 100)
  const closing = runtime.stop()
  assert.equal(closing, runtime.stop())
  await closing
  await assert.rejects(request('/api/runtime', { Cookie: cookie }))
  const reopened = new ArivoRuntime(config)
  t.after(() => reopened.stop())
  assert.ok(await reopened.start())
  await reopened.stop()
  const cancelled = new ArivoRuntime(config)
  const cancelledStartup = cancelled.start()
  const rejection = assert.rejects(cancelledStartup)
  await cancelled.stop()
  await rejection
  const withIdentity = new ArivoRuntime({ ...config, identity: {
    apiOrigin: `https://acceptance-${randomUUID()}.example`, webOrigin: 'https://arivo-acceptance.example',
    requestTimeoutMs: 1000, loginTimeoutMs: 1000,
    keychainHelper: join(desktop, 'build/distributions/arivo/native', process.platform === 'win32' ? 'keychain.exe' : 'keychain'),
  } })
  t.after(() => withIdentity.stop())
  const configuredUrl = await withIdentity.start()
  const configuredBoot = await fetch(configuredUrl, { redirect: 'manual' })
  const configuredCookie = configuredBoot.headers.get('set-cookie')?.split(';')[0]
  assert.ok(configuredCookie); await configuredBoot.body?.cancel()
  const account = await fetch(new URL('/api/account', configuredUrl), { headers: { Cookie: configuredCookie } })
  assert.equal(account.status, 200)
  assert.deepEqual(await account.json(), { available: true, state: 'signed-out', user: null, signingIn: false, error: null, verifiedAt: null })
  const workbenchPage = await fetch(new URL('/', configuredUrl), { headers: { Cookie: configuredCookie } })
  assert.equal(workbenchPage.status, 200)
  assert.doesNotMatch(await workbenchPage.text(), /"id":"@deepseek-ai\/dsh-client-ui-trajectory"/)
  const profiles = await import('node:fs/promises').then(fs => fs.readdir(join(config.home, 'profiles')))
  const profileManifest = JSON.parse(await readFile(join(config.home, 'profiles', profiles[0]!, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
  assert.deepEqual(profileManifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  const profile = await readFile(join(config.home, 'profiles', profiles[0]!, 'cordis.patch.yml'), 'utf8')
  const rows = JSON.parse(profile) as { id?: string; disabled?: boolean }[]
  assert.equal(rows.find(row => row.id === 'ui-trajectory')?.disabled, true)
  assert.match(profile, /keychainHelper/u)
  assert.doesNotMatch(profile, /accessToken|refreshToken|codeVerifier/u)
  await withIdentity.stop()

  if (process.platform !== 'darwin') return // Native credential-fixture launcher; Windows acceptance remains native-only.
  const credentialFile = join(temporary, 'test-credential.json')
  const helper = join(temporary, 'test-credential-helper.mjs')
  await writeFile(helper, `#!${process.execPath}
import { readFile, writeFile, unlink } from 'node:fs/promises';
const path = ${JSON.stringify(credentialFile)};
try {
  if (process.argv[2] === 'get') process.stdout.write(await readFile(path, 'utf8'));
  else if (process.argv[2] === 'delete') await unlink(path);
  else { let value=''; for await (const chunk of process.stdin) value+=chunk; await writeFile(path,value,{mode:0o600}); }
} catch (error) { process.exit(error.code === 'ENOENT' ? 44 : 1); }
`, { mode: 0o700 })
  const identity = { apiOrigin: 'http://127.0.0.1:1', webOrigin: 'http://127.0.0.1:1', requestTimeoutMs: 1000, loginTimeoutMs: 1000, keychainHelper: helper }
  const a = randomUUID(); const b = randomUUID()
  const scope = (id: string) => createHash('sha256').update(`arivo:${identity.apiOrigin}:${id}`).digest('hex')
  const seed = (id: string) => writeFile(credentialFile, JSON.stringify({ format: 1,
    apiOrigin: identity.apiOrigin, webOrigin: identity.webOrigin,
    phase: 'active', tokens: { protocolVersion: 1, tokenType: 'Bearer', accessToken: 'a'.repeat(43), refreshToken: 'r'.repeat(43),
      accessExpiresAt: new Date(Date.now() + 900000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      sessionId: randomUUID(), user: { id, email: 'fixture@example.test', name: 'Fixture', locale: 'en' } } }), { mode: 0o600 })
  const authorize = async (value: string) => {
    const response = await fetch(value, { redirect: 'manual' })
    assert.equal(response.status, 303)
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!
    await response.body?.cancel()
    return cookie
  }
  const rpc = async (value: string, cookie: string, method: string, args: unknown) => {
    const origin = new URL(value).origin
    const response = await fetch(`${origin}/api/${method}`, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args } }) })
    assert.equal(response.status, 200)
    const body = await response.json() as { result: { ok: boolean; value: unknown } }
    assert.equal(body.result.ok, true, JSON.stringify(body))
    return body.result.value
  }
  await seed(a)
  const changed = Promise.withResolvers<string>()
  const events: string[] = []
  const accountRuntime = new ArivoRuntime({ ...config, identity }, {
    switching: () => { events.push('switching') },
    ready: (next) => { events.push('ready'); changed.resolve(next) },
  })
  t.after(() => accountRuntime.stop())
  const accountStudio = await accountRuntime.start()
  const oldAgent = await accountRuntime.agentUrl()
  const oldAgentCookie = await authorize(oldAgent)
  const workspacePath = join(config.home, 'accounts', scope(a), 'agent/workspace')
  await writeFile(join(workspacePath, 'private-a.txt'), 'Account A local file', { mode: 0o600 })
  const workspace = await rpc(oldAgent, oldAgentCookie, 'workspace/create', { request: { path: workspacePath } }) as { workspace: { workspaceId: string } }
  assert.ok(workspace.workspace.workspaceId)
  const sessionId = `session-${randomUUID()}`
  await rpc(oldAgent, oldAgentCookie, 'session/create', { request: { sessionId, workspaceId: workspace.workspace.workspaceId } })
  const renamed = await rpc(oldAgent, oldAgentCookie, 'session/rename', { request: { sessionId, title: 'Account A private conversation' } }) as { title: string }
  assert.equal(renamed.title, 'Account A private conversation')
  const listed = await rpc(oldAgent, oldAgentCookie, 'session/list', { _request: {} }) as { items: { sessionId: string; cwd: string; projections?: { values: { title?: string } } }[] }
  assert.equal(listed.items.find(item => item.sessionId === sessionId)?.cwd, await realpath(workspacePath))
  assert.equal(listed.items.find(item => item.sessionId === sessionId)?.projections?.values.title, renamed.title)
  const privatePreset = `account-a-${randomUUID()}`
  await rpc(oldAgent, oldAgentCookie, 'agentPresets/copy', { from: 'standard', id: privatePreset, name: 'Private account A preset' })
  await rpc(oldAgent, oldAgentCookie, 'settings/update', { ns: 'agent-presets', patch: { default: 'minimal' } })
  const permissions = await rpc(oldAgent, oldAgentCookie, 'commands/execute', { agentId: sessionId, line: '/permission read-only', submittedAttachments: [] })
  assert.match(JSON.stringify(permissions), /"kind":"success"/u)
  assert.match(JSON.stringify(await rpc(oldAgent, oldAgentCookie, 'session/list', { _request: {} })), /Account A private conversation/u)
  const oldStudioCookie = await authorize(accountStudio)
  const logout = Promise.allSettled([fetch(new URL('/api/account/sign-out', accountStudio), { method: 'POST', headers: {
    Cookie: oldStudioCookie, Origin: new URL(accountStudio).origin, 'Content-Type': 'application/json',
  }, body: '{}' })])
  const newAgent = await Promise.race([changed.promise, new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('Account switch did not finish')) }, 20000); timer.unref()
  })])
  // Shutdown may close the initiating HTTP connection; the durable signed-out record owns recovery.
  const logoutResult = await logout
  if (logoutResult[0].status === 'fulfilled') await logoutResult[0].value.body?.cancel()
  assert.deepEqual(events, ['switching', 'ready'])
  await assert.rejects(fetch(oldAgent, { signal: AbortSignal.timeout(1000) }))
  const deviceCookie = await authorize(newAgent)
  assert.equal(JSON.stringify(await rpc(newAgent, deviceCookie, 'session/list', { _request: {} })).includes(sessionId), false)
  await accountRuntime.stop()
  await accountRuntime.waitForExit()
  const revoked = JSON.parse(await readFile(credentialFile, 'utf8')) as { phase: string }
  assert.equal(revoked.phase, 'signed-out-pending-revoke')

  await seed(b)
  const secondAccount = new ArivoRuntime({ ...config, identity })
  t.after(() => secondAccount.stop())
  await secondAccount.start()
  const secondAgent = await secondAccount.agentUrl()
  const secondCookie = await authorize(secondAgent)
  assert.equal(JSON.stringify(await rpc(secondAgent, secondCookie, 'session/list', { _request: {} })).includes(sessionId), false)
  assert.equal(JSON.stringify(await rpc(secondAgent, secondCookie, 'agentPresets/list', {})).includes(privatePreset), false)
  const secondSettings = await rpc(secondAgent, secondCookie, 'settings/describe', {}) as { namespaces: { ns: string; value: unknown }[] }
  assert.deepEqual(secondSettings.namespaces.find(item => item.ns === 'agent-presets')?.value, { default: 'cordis' })
  const secondSessionId = `session-${randomUUID()}`
  await rpc(secondAgent, secondCookie, 'session/create', { request: { sessionId: secondSessionId } })
  const secondPermissions = await rpc(secondAgent, secondCookie, 'commands/execute', { agentId: secondSessionId, line: '/permission', submittedAttachments: [] })
  assert.match(JSON.stringify(secondPermissions), /current preset workspace-write/u)
  await assert.rejects(readFile(join(config.home, 'accounts', scope(b), 'agent/workspace', 'private-a.txt')))
  await secondAccount.stop()

  await seed(a)
  const restoredAccount = new ArivoRuntime({ ...config, identity })
  t.after(() => restoredAccount.stop())
  await restoredAccount.start()
  const restoredAgent = await restoredAccount.agentUrl()
  const restoredCookie = await authorize(restoredAgent)
  assert.match(JSON.stringify(await rpc(restoredAgent, restoredCookie, 'session/list', { _request: {} })), /Account A private conversation/u)
  assert.ok(JSON.stringify(await rpc(restoredAgent, restoredCookie, 'agentPresets/list', {})).includes(privatePreset))
  const restoredSettings = await rpc(restoredAgent, restoredCookie, 'settings/describe', {}) as { namespaces: { ns: string; value: unknown }[] }
  assert.deepEqual(restoredSettings.namespaces.find(item => item.ns === 'agent-presets')?.value, { default: 'minimal' })
  await rpc(restoredAgent, restoredCookie, 'session/create', { request: { sessionId, workspaceId: workspace.workspace.workspaceId } })
  const restoredPermissions = await rpc(restoredAgent, restoredCookie, 'commands/execute', { agentId: sessionId, line: '/permission', submittedAttachments: [] })
  assert.match(JSON.stringify(restoredPermissions), /current preset read-only/u)
  assert.equal(await readFile(join(workspacePath, 'private-a.txt'), 'utf8'), 'Account A local file')
  await restoredAccount.stop()
})
