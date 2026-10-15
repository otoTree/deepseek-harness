/** Installation secrets persist through the native provider and require a current Host lease. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import type { PluginCapabilityTransport } from '@deepseek-ai/dsh-plugin-protocol'
import { withHostCredentials } from '../src/plugin-credentials.ts'

void test('Host credentials survive restart, isolate installations, and reject revoked or ungranted access', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'market-credentials-'))
  t.after(() => rm(home, { recursive:true,force:true }))
  let active = true
  let checks = 0
  const remote: PluginCapabilityTransport = {
    async call<T>(operation: string): Promise<T> {
      assert.equal(operation, 'activation.check')
      checks++
      if (!active) throw new Error('plugin/activation-revoked')
      return { active:true } as T
    },
    async *stream<T>() { yield {} as T },
  }
  const scope = { organizationId:'org-a',installationId:'installation-a' }
  const grants = ['credentials.read','credentials.write']
  const start = async () => {
    const ctx = new Context()
    await ctx.plugin(LocalCredentialProvider, { path:join(home,'.credentials.yaml'),watch:false })
    return ctx
  }
  let ctx = await start()
  t.after(() => ctx.fiber.dispose())
  const first = withHostCredentials(ctx, remote, scope, grants)
  await first.call('credentials.set',{ name:'api-key',value:'PRIVATE_TEST_SECRET' })
  assert.equal((await stat(join(home,'.credentials.yaml'))).mode & 0o777, 0o600)
  assert.equal(await first.call('credentials.get',{ name:'api-key' }),'PRIVATE_TEST_SECRET')
  const listed = await first.call('credentials.list',{})
  assert.deepEqual(listed,[{ name:'api-key',kind:'secret',configured:true }])
  assert.ok(!JSON.stringify(listed).includes('PRIVATE_TEST_SECRET'))
  const other = withHostCredentials(ctx, remote, { ...scope,installationId:'installation-b' },grants)
  assert.equal(await other.call('credentials.get',{ name:'api-key' }),undefined)
  const otherOrg = withHostCredentials(ctx, remote, { ...scope,organizationId:'org-b' },grants)
  assert.deepEqual(await otherOrg.call('credentials.list',{}),[])
  const denied = withHostCredentials(ctx, remote, scope, [])
  const before = checks
  await assert.rejects(denied.call('credentials.get',{ name:'api-key' }),/unsupported-capability/u)
  assert.equal(checks,before)
  await ctx.fiber.dispose()
  ctx = await start()
  const restored = withHostCredentials(ctx, remote, scope, grants)
  assert.equal(await restored.call('credentials.get',{ name:'api-key' }),'PRIVATE_TEST_SECRET')
  active = false
  await assert.rejects(restored.call('credentials.get',{ name:'api-key' }),/activation-revoked/u)
  await assert.rejects(restored.call('credentials.set',{ name:'api-key',value:'REPLACEMENT' }),/activation-revoked/u)
  active = true
  assert.equal(await restored.call('credentials.get',{ name:'api-key' }),'PRIVATE_TEST_SECRET')
  const aborted = AbortSignal.abort(new Error('cancelled'))
  await assert.rejects(restored.call('credentials.delete',{ name:'api-key' },aborted),/cancelled/u)
  await restored.call('credentials.delete',{ name:'api-key' })
  assert.equal(await restored.call('credentials.get',{ name:'api-key' }),undefined)
})
