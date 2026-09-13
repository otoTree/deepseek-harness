import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { EnterpriseSandboxProvider } from '../src/enterprise-sandbox.ts'

void test('enterprise sandbox refuses unavailable Seatbelt instead of returning raw argv', async () => {
  const ctx = new Context()
  const provider = new EnterpriseSandboxProvider(ctx, { defaultMode: 'read-only', probeTimeoutMs: 100 })
  provider.internals = { platform: 'darwin', chain: ['seatbelt', 'landlock'], probeSeatbelt: () => false, probeLandlock: () => 'unusable' }
  assert.throws(() => provider.confine(['/bin/echo', 'ok'], { mode: 'read-only', workspaceRoot: '/tmp' }), /no sandbox backend is usable/)
  await ctx.fiber.dispose()
})

void test('enterprise sandbox uses the kernel Seatbelt profile for workspace writes', async () => {
  const ctx = new Context()
  const provider = new EnterpriseSandboxProvider(ctx, { defaultMode: 'workspace-write', probeTimeoutMs: 100 })
  provider.internals = { platform: 'darwin', chain: ['seatbelt'], probeSeatbelt: () => true, seatbeltExec: '/usr/bin/sandbox-exec' }
  const result = provider.confine(['/bin/echo', 'ok'], { mode: 'workspace-write', workspaceRoot: '/tmp/work' })
  assert.equal(result.enforcement, 'full')
  assert.equal(result.argv[0], '/usr/bin/sandbox-exec')
  assert.ok(result.argv.includes('/bin/echo'))
  await ctx.fiber.dispose()
})
