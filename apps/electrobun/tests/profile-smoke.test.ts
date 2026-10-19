/** The shipped enterprise profile must boot the real Web bundle on loopback. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import { provisionEnterpriseProfile } from '../src/enterprise-profile.ts'
import { DesktopKeychain } from '../src/keychain.ts'

const packagedApp = process.env.DSH_DESKTOP_TEST_APP
const packagedResources = packagedApp
  ? join(packagedApp, process.platform === 'win32' ? 'Resources/app' : 'Contents/Resources/app')
  : undefined

for (const hasModels of [true, false]) {
  void test(`enterprise-desktop profile serves an authenticated Web UI with ${hasModels ? 'models' : 'no models'}`, {
    timeout: 45_000,
    skip: process.platform === 'win32' && !packagedResources,
  }, async (t) => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-enterprise-profile-'))
    t.after(() => rm(home, { recursive: true, force: true }))
    const require = createRequire(import.meta.url)
    let tsxLoader: string
    try { tsxLoader = require.resolve('tsx/esm') } catch {
      tsxLoader = join(fileURLToPath(new URL('../../..', import.meta.url)), 'node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/esm/index.mjs')
    }
    const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
    const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
    const organizationId = randomUUID()
    const runtimeId = randomUUID()
    const modelId = randomUUID()
    const token = 'profile-smoke-runtime-token-1234567890'
    const api = createServer((request, response) => {
      if (request.headers.authorization !== `Bearer ${token}`) return response.writeHead(401).end()
      response.setHeader('Content-Type', 'application/json')
      if (request.method === 'GET' && request.url === `/v1/organizations/${organizationId}/sessions`) return response.end('[]')
      if (request.method === 'GET' && request.url === `/v1/organizations/${organizationId}/models`) return response.end(JSON.stringify(hasModels ? [{ id: modelId, name: 'Enterprise model', images: false, contextTokens: 32768, maxOutputTokens: 4096 }] : []))
      return response.writeHead(404).end('{}')
    })
    api.listen(0, '127.0.0.1')
    await once(api, 'listening')
    t.after(async () => { api.close(); await once(api, 'close') })
    const address = api.address()
    assert.ok(address && typeof address !== 'string')
    const apiUrl = `http://127.0.0.1:${address.port}`
    const keychainAccount = createHash('sha256').update(apiUrl).digest('hex') + ':' + organizationId + ':' + runtimeId
    const keychain = packagedResources && process.platform === 'win32'
      ? join(packagedResources, 'native/keychain.exe')
      : join(home, 'keychain')
    const credential = JSON.stringify({
      apiOrigin: apiUrl, runtimeId, token, leaseUntil: new Date(Date.now() + 60_000).toISOString(), organizationId,
    })
    if (packagedResources && process.platform === 'win32') {
      const store = new DesktopKeychain(keychain)
      t.after(() => store.delete(keychainAccount))
      await store.set(keychainAccount, credential)
    } else {
      await writeFile(keychain, `#!/bin/sh\nif [ "$1" = get ]; then printf '%s' '${credential}'; else exit 44; fi\n`)
      await chmod(keychain, 0o700)
    }
    await provisionEnterpriseProfile({
      home,
      apiUrl,
      organizationId,
      keychainHelper: keychain,
      keychainAccount,
      defaultModel: hasModels ? modelId : 'enterprise-unconfigured',
      frontendIndex: packagedResources
        ? join(packagedResources, 'frontend/index.html')
        : join(repositoryRoot, 'apps', 'electrobun', 'build', 'frontend', 'index.html'),
      plugins: {
        llmFiles: packagedResources ? join(packagedResources, 'plugins/llm-files.js') : join(repositoryRoot, 'packages', 'llm', 'llm-files', 'src', 'index.ts'),
        gateway: packagedResources ? join(packagedResources, 'plugins/gateway-provider.js') : join(desktopRoot, 'src', 'gateway-provider.ts'),
        driveTools: packagedResources ? join(packagedResources, 'plugins/drive-tools.js') : join(desktopRoot, 'src', 'drive-tools.ts'),
        sessionPersistence: packagedResources ? join(packagedResources, 'plugins/session-provider.js') : join(desktopRoot, 'src', 'session-provider.ts'),
        enterpriseClient: packagedResources ? join(packagedResources, 'plugins/enterprise-client/lib/index.js') : join(repositoryRoot, 'packages', 'client', 'ui-enterprise', 'lib', 'index.js'),
      },
    })
    const { TSX_TSCONFIG_PATH: _tsxTsconfigPath, ...parentEnv } = process.env
    const packagedRuntime = packagedResources
      ? join(packagedResources, process.platform === 'win32' ? 'dsh.exe' : 'dsh')
      : undefined
    const child = spawn(packagedRuntime ?? process.execPath, [
      ...packagedResources ? [] : ['--import', tsxLoader, join(repositoryRoot, 'apps/cli/src/bin.ts')],
      '--profile', 'enterprise-desktop',
      '--no-open', '--host', '127.0.0.1', '--port', '0',
    ], {
      cwd: packagedResources ? home : repositoryRoot,
      env: {
        ...packagedResources ? (process.platform === 'win32' ? {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
          WINDIR: process.env.WINDIR ?? process.env.SystemRoot ?? 'C:\\Windows',
          USERPROFILE: process.env.USERPROFILE,
          LOCALAPPDATA: process.env.LOCALAPPDATA,
          APPDATA: process.env.APPDATA,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          PATHEXT: process.env.PATHEXT,
          COMSPEC: process.env.COMSPEC,
          DSH_DESKTOP_PARENT_PID: String(process.pid),
          DSH_INSTALL_ANCHOR: join(packagedResources, 'runtime/package.json'),
        } : {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          DSH_INSTALL_ANCHOR: join(packagedResources, 'runtime/package.json'),
        }) : parentEnv,
        DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const closed = once(child, 'close')
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await closed
    })
    let output = ''
    let errorOutput = ''
    child.stderr.on('data', (chunk: Buffer) => { errorOutput += chunk.toString() })
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() =>{  reject(new Error('enterprise profile did not announce a Web URL')) }, 30_000)
      t.after(() => { clearTimeout(timer) })
      const onData = (chunk: Buffer): void => {
        output += chunk.toString()
        const match = output.match(/dsh web:\s+(http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)/)
        if (match?.[1]) {
          clearTimeout(timer)
          resolve(match[1])
        }
      }
      child.stdout.on('data', onData)
      child.once('error', reject)
      child.once('exit', (code) => {
        if (code !== null && !output.includes('dsh web:')) {
          reject(new Error(`enterprise profile exited with code ${String(code)}: ${output.trim()}\n${errorOutput.trim()}`))
        }
      })
    })
    const response = await fetch(url, { redirect: 'manual' })
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('location'), '/')
    assert.match(response.headers.get('set-cookie') ?? '', /^dsh-auth-/)
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
    assert.ok(cookie)
    const page = await fetch(new URL('/', url), { headers: { Cookie: cookie } })
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.match(html, /<meta name="dsh-surface" content="enterprise-desktop"/)
    assert.match(html, /<div id="root"><\/div>/)
    child.kill('SIGTERM')
    await closed
  })
}
