/** Creative tools use the original registry, policy, stable Session identity and effect lifecycle. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { registerStudioTools, type ArivoStudioToolHost } from '../src/distribution/arivo-shell/host/studio-tools.ts'

void test('normal Harness tools retain command identity across replay, reject anonymous callers and release native handles', async (t) => {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const requests: unknown[] = []; let disposed = 0; let unavailable = false
  const host: ArivoStudioToolHost = { async studioSession() { return { protocolVersion: 1,
    async request(value, signal) { signal.throwIfAborted(); if (unavailable) throw Object.assign(new Error('private storage diagnostic'), { code: 'REVISION_CONFLICT' }); requests.push(value); return { saved: true } }, dispose() { disposed++ } } } }
  const fiber = await ctx.plugin({ name: 'test-arivo-tools', inject: ['tools'], apply(child: Context) { registerStudioTools(child, host) } })
  const agent = await ctx.agentLoop.create(SessionId(randomUUID()), { provider: 'unconfigured', model: '' })
  const call = { name: 'arivo_create_episode', callId: ToolCallId(randomUUID()), arguments: { projectId: randomUUID(), title: '第 1 集' }, agent, signal: AbortSignal.timeout(10000) }
  const first = await ctx.tools.execute(call), replay = await ctx.tools.execute(call)
  assert.notEqual(first.isError, true); assert.deepEqual(first.value, { saved: true }); assert.deepEqual(replay.value, first.value)
  assert.deepEqual(requests[0], requests[1]); assert.equal(disposed, 2)
  assert.equal((await ctx.tools.execute({ ...call, agent: undefined })).isError, true); assert.equal(disposed, 2)
  unavailable = true
  const conflict = await ctx.tools.execute(call)
  assert.equal(conflict.isError, true); assert.match(JSON.stringify(conflict.content), /REVISION_CONFLICT/)
  assert.doesNotMatch(JSON.stringify(conflict), /private storage diagnostic/); assert.equal(disposed, 3)
  await fiber.dispose()
  assert.equal((await ctx.tools.execute(call)).isError, true)
})

void test('native creative tools derive project authority from the Session header and sanitize acquisition failures', async (t) => {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  let requests = 0, disposed = 0, unavailable = false
  const host: ArivoStudioToolHost = {
    async studioSession() { throw new Error('unscoped authority must not be used') },
    async studioSessionForFolder(path) {
      assert.equal(path, '/projects/Film')
      if (unavailable) throw new Error('private path /projects/Film')
      return { protocolVersion: 1, async request() { requests++; return { projects: [] } }, dispose() { disposed++ } }
    },
  }
  await ctx.plugin({ name: 'folder-tools', inject: ['tools'], apply(child: Context) { registerStudioTools(child, host) } })
  const agent = await ctx.agentLoop.create(SessionId(randomUUID()), { provider: 'unconfigured', model: '' }, { cwd: '/projects/Film' })
  const call = { name: 'arivo_list_projects', callId: ToolCallId(randomUUID()), arguments: {}, agent, signal: AbortSignal.timeout(10000) }
  assert.notEqual((await ctx.tools.execute(call)).isError, true)
  assert.equal(requests, 1); assert.equal(disposed, 1)
  unavailable = true
  const rejected = await ctx.tools.execute(call)
  assert.equal(rejected.isError, true)
  assert.doesNotMatch(JSON.stringify(rejected), /private path|\/projects\/Film/u)
  const anonymous = await ctx.agentLoop.create(SessionId(randomUUID()), { provider: 'unconfigured', model: '' })
  assert.equal((await ctx.tools.execute({ ...call, agent: anonymous })).isError, true)
  assert.equal(requests, 1)
})

void test('canvas tools preserve exact arguments and Session mutation identity through the folder-scoped native handle', async (t) => {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const requests: unknown[] = []; let disposed = 0
  const host: ArivoStudioToolHost = {
    async studioSession() { throw new Error('Unscoped authority forbidden') },
    async studioSessionForFolder(path) {
      assert.equal(path, '/projects/Current film')
      return { protocolVersion: 1, async request(value) { requests.push(value); return { persistState: 'synced' } }, dispose() { disposed++ } }
    },
  }
  const fiber = await ctx.plugin({ name: 'canvas-tools', inject: ['tools'], apply(child: Context) { registerStudioTools(child, host) } })
  const agent = await ctx.agentLoop.create(SessionId(randomUUID()), { provider: 'unconfigured', model: '' }, { cwd: '/projects/Current film' })
  const target = { projectId: randomUUID(), canvasId: randomUUID() }, nodeId = randomUUID()
  const cases: { name: string; action: string; args: Record<string, unknown>; write?: boolean }[] = [
    { name: 'arivo_list_canvases', action: 'list', args: { projectId: target.projectId } },
    { name: 'arivo_read_canvas', action: 'manifest', args: target },
    { name: 'arivo_read_canvas_page', action: 'page', args: { ...target, runtimeVersion: 4, kind: 'edges' } },
    { name: 'arivo_read_canvas_node', action: 'node', args: { ...target, runtimeVersion: 4, nodeId } },
    { name: 'arivo_create_canvas', action: 'create', args: { projectId: target.projectId, title: 'Film' }, write: true },
    { name: 'arivo_create_canvas_node', action: 'createNode', args: { ...target, baseRuntimeVersion: 4, nodeType: 'video', title: 'Rain', promptInput: 'A train in rain', positionX: 50, positionY: 80 }, write: true },
    { name: 'arivo_edit_canvas_node', action: 'editNode', args: { ...target, baseRuntimeVersion: 4, nodeId, title: 'Night rain', promptInput: 'Preserve the complete prompt' }, write: true },
    { name: 'arivo_connect_canvas_nodes', action: 'connect', args: { ...target, baseRuntimeVersion: 4, sourceNodeId: nodeId, targetNodeId: randomUUID() }, write: true },
    { name: 'arivo_canvas_history', action: 'history', args: { ...target, baseRuntimeVersion: 4, direction: 'undo' }, write: true },
  ]
  for (const item of cases) {
    const call = { name: item.name, callId: ToolCallId(randomUUID()), arguments: item.args, agent, signal: AbortSignal.timeout(10000) }
    const first = await ctx.tools.execute(call), replay = await ctx.tools.execute(call)
    assert.notEqual(first.isError, true); assert.deepEqual(replay.value, first.value)
    assert.deepEqual(requests.at(-1), requests.at(-2))
    const input = requests.at(-1) as { type: string; input: Record<string, unknown> }
    assert.equal(input.type, 'canvas'); assert.equal(input.input.action, item.action)
    const { action: _action, mutationId, ...args } = input.input
    assert.deepEqual(args, item.args)
    if (item.write) assert.match(String(mutationId), /^[a-f0-9-]{36}$/)
    else assert.equal(mutationId, undefined)
  }
  assert.equal(disposed, cases.length * 2)
  await fiber.dispose()
  assert.equal((await ctx.tools.execute({ name: 'arivo_read_canvas', callId: ToolCallId(randomUUID()), arguments: target, agent, signal: AbortSignal.timeout(10000) })).isError, true)
})
