import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecFileOptions } from 'node:child_process'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { apply, Config, inject } from '../src/index.ts'

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: execFileMock }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  execFileMock.mockReset()
})

it.each([
  { platform: 'win32', systemRoot: 'D:\\Windows', localAppData: 'D:\\Users\\测试 User\\AppData\\Local',
    env: { PATH: 'D:\\Windows\\System32', SystemRoot: 'D:\\Windows', LOCALAPPDATA: 'D:\\Users\\测试 User\\AppData\\Local' } },
  { platform: 'win32', systemRoot: undefined, localAppData: undefined,
    env: { PATH: 'C:\\Windows\\System32', SystemRoot: 'C:\\Windows' } },
  { platform: 'darwin', systemRoot: 'D:\\Windows', localAppData: 'unused', env: { PATH: '/usr/bin:/bin' } },
  { platform: 'linux', systemRoot: undefined, localAppData: undefined, env: { PATH: '/usr/bin:/bin' } },
] as const)('enterprise credentials use the platform environment: $platform / $systemRoot', async ({ platform, systemRoot, localAppData, env }) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-credential-env-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const apiUrl = 'https://credential-environment.example'
  const organizationId = randomUUID()
  const runtimeId = randomUUID()
  const token = 'fixture-runtime-token-12345678901234567890'
  const account = createHash('sha256').update(apiUrl).digest('hex') + ':' + organizationId + ':' + runtimeId
  const helper = join(root, platform === 'win32' ? 'keychain.exe' : 'keychain')
  const credential = JSON.stringify({ apiOrigin: apiUrl, organizationId, runtimeId, token, expiresAt: new Date(0).toISOString() })
  let unavailable = false
  execFileMock.mockImplementation((_helper: string, _args: string[], _options: ExecFileOptions,
    callback: (error: Error | null, stdout: string) => void) => {
    queueMicrotask(() => { callback(unavailable ? new Error('credential helper failed') : null, unavailable ? '' : credential) })
  })
  const request = vi.fn((url: URL, init: RequestInit) => {
    expect(url.origin).toBe(apiUrl)
    expect([
      `/v1/organizations/${organizationId}/plugins/catalog`,
      `/v1/organizations/${organizationId}/plugins/installations`,
      `/v1/organizations/${organizationId}/plugins/device-targets`,
    ]).toContain(url.pathname)
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${token}`)
    return Promise.resolve(Response.json([]))
  })
  vi.stubGlobal('fetch', request)
  vi.stubEnv('SystemRoot', systemRoot)
  vi.stubEnv('LOCALAPPDATA', localAppData)
  vi.stubEnv('DSH_CREDENTIAL_ENV_TEST_SECRET', 'must-not-be-inherited')
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)

  let handler: ConnectionRpcHandler | undefined
  const ctx = new Context()
  ctx.provide('connection', {
    rpc: { handle: (_channel: string, callback: ConnectionRpcHandler) => { handler = callback; return async () => {} } },
  } as HostConnectionHandle)
  const fiber = ctx.plugin({ inject: [...inject], apply }, Config.parse({
    apiUrl, organizationId, keychainHelper: helper, keychainAccount: account,
    triggerStatePath: join(root, 'triggers.json'),
  }))
  try {
    await fiber.await()
    expect(handler).toBeDefined()
    const signal = new AbortController().signal
    expect(await handler!('plugins', {}, signal)).toEqual({ ok: true, value: [] })
    expect(execFileMock).toHaveBeenCalledWith(helper, ['get', account], expect.objectContaining({ env }), expect.any(Function))
    const options = execFileMock.mock.calls.at(-1)![2] as ExecFileOptions
    expect(options.env).toEqual(env)
    expect(options.windowsHide).toBe(platform === 'win32')
    expect(options.signal).toBe(signal)

    unavailable = true
    const before = request.mock.calls.length
    expect(await handler!('plugins', {}, signal)).toEqual({ ok: false, error: {
      code: 'enterprise/request-failed', message: 'Enterprise device credential is unavailable', details: {},
    } })
    expect(request).toHaveBeenCalledTimes(before)
  } finally {
    await fiber.dispose()
  }
})
