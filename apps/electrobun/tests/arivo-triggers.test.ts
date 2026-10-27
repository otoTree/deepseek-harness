/** Native trigger RPC retains account authority and the project-selected model. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { registerArivoTriggers } from '../src/distribution/arivo-shell/host/triggers.ts'

void test('persists native project rules, preserves models, and refuses cloud sources and expired accounts', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arivo-triggers-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'project')
  await mkdir(workspace)
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  let accountController = new AbortController()
  let rpc!: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<{ ok: boolean; value?: unknown }>
  let disposals = 0
  ctx.reflect.provide('connection', { rpc: { handle: (_path: string, handler: typeof rpc) => { rpc = handler; return () => {} } } })
  ctx.reflect.provide('sessionController', { inspect: async () => ({}) })
  ctx.reflect.provide('permissionPresets', { resolve: () => ({}) })
  ctx.reflect.provide('sessions', { get: () => ({ header: { cwd: workspace } }) })
  ctx.reflect.provide('arivoStudio', {
    marketSession: async () => ({ protocolVersion: 1, scopeId: 'native-account', signal: accountController.signal, dispose: () => { disposals++ } }),
    projectFolderSession: async () => ({ resolve: async (path: string) => path === workspace ? { projectId: 'project' } : null,
      conversationModel: async () => ({ provider: 'arivo', model: 'project-model' }), dispose: () => {} }),
  })
  registerArivoTriggers(ctx, join(root, 'triggers.json'))
  await ctx.fiber.await()
  const request = (endpoint: string, args: unknown) => rpc(endpoint, { args }, new AbortController().signal)
  const input = { name: 'Project timer', enabled: false,
    source: { kind: 'timer', schedule: { kind: 'every', everySeconds: 3600, anchorAt: new Date(Date.now() + 3600000).toISOString() } },
    delivery: { kind: 'queue-each' }, target: { kind: 'new-session', workspacePath: workspace, agentPreset: 'standard', permissionPreset: 'workspace-write', titleTemplate: '{{rule.name}}', model: { provider: 'other', model: 'forged' } },
    instructionTemplate: { version: 1, text: 'Summarize project files.' } }
  const saved = await request('trigger-save', input)
  assert.equal(saved.ok, true)
  const rule = saved.value as { id: string; createdBy: string; target: { model: unknown } }
  assert.deepEqual(rule.target.model, { provider: 'arivo', model: 'project-model' })
  assert.equal(rule.createdBy, 'native-account')
  assert.equal((await request('trigger-enable', { ruleId: rule.id, enabled: true })).ok, true)
  assert.equal((await request('trigger-enable', { ruleId: rule.id, enabled: false })).ok, true)
  assert.equal((await request('trigger-save', { ...input, source: { kind: 'cloud-file', spaceId: 'enterprise' } })).ok, false)
  assert.equal((await request('trigger-save', { ...input, target: { ...input.target, workspacePath: root } })).ok, false)
  const match = await request('trigger-test-match', { path: 'report.md', includes: ['**/*'], excludes: [] })
  assert.deepEqual(match.value, { matched: true })
  accountController.abort()
  assert.equal((await request('trigger-snapshot', {})).ok, false)
  accountController = new AbortController()
  assert.equal((await request('trigger-snapshot', {})).ok, true)
  assert.equal((await request('trigger-remove', { ruleId: rule.id })).ok, true)
  const empty = await request('trigger-snapshot', {})
  assert.deepEqual((empty.value as { rules: unknown[] }).rules, [])
  assert.ok(disposals >= 9)
})
