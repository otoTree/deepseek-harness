/** Native bridge boundary fixtures over the real OS model runtime, loop, sessions and tools. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as pause } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, createAssistantMessage, ToolCallId, markAgentLoopRequest, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { ArivoLanguageAdapter } from '../src/distribution/arivo-shell/host/language-adapter.ts'
import { arivoLanguageChunk, arivoLanguageInput, arivoModelRoute, arivoStepCommand } from '../src/distribution/arivo-shell/host/language-mapping.ts'
import type { ArivoLanguageEvent, ArivoLanguageHost, ArivoLanguageStep } from '../src/distribution/arivo-shell/host/language-wire.ts'

const route = [randomUUID(), randomUUID(), randomUUID()].join('/')
const config = { defaultMaxOutputTokens: 64, maxCatalogPages: 3, catalogTimeoutMs: 10000 }
const signal = () => AbortSignal.timeout(10000)
const input = (): GenerateOptions => ({ provider: 'arivo', model: route, maxTokens: 64, messages: [createUserMessage({ content: [{ type: 'text', text: '中文🙂' }], source: { kind: 'user' } })] })
function envelope(callId: string, sequence: number, event: ArivoLanguageEvent['event']): ArivoLanguageEvent {
  return { protocolVersion: 1, callId, attemptId: 'attempt-fixture', sequence, event }
}
function textEvents(text = 'DONE'): ArivoLanguageEvent[] {
  const callId = randomUUID()
  return [envelope(callId, 1, { type: 'block-start', index: 0, kind: 'text' }), envelope(callId, 2, { type: 'text-delta', index: 0, text }),
    envelope(callId, 3, { type: 'block-end', index: 0, block: { type: 'text', text } }), envelope(callId, 4, { type: 'finish', reason: 'stop' })]
}
function fixtureHost(run: (step: ArivoLanguageStep, abort: AbortSignal) => AsyncIterable<ArivoLanguageEvent>) {
  const state = { opened: 0, disposed: 0, stopped: [] as string[] }
  const host: ArivoLanguageHost = { async languageSession() {
    state.opened++
    let closed = false
    return { protocolVersion: 1, dispose() { if (!closed) { closed = true; state.disposed++ } }, session: {
      async models() { return { items: [{ protocolVersion: 1, id: arivoModelRoute(route).adapterId, displayName: 'Arivo fixture', tools: true, maxOutputTokens: 128 }], nextCursor: null } },
      run, async stop(id) { state.stopped.push(id) },
    } }
  } }
  return { host, state }
}
async function harness(t: { after(fn: () => Promise<void>): void }, host: ArivoLanguageHost) {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { persona: 'Arivo native bridge fixture' } })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ArivoLanguageAdapter(host, ctx.sessions, config, () => {})
  ctx.effect(() => () => adapter.close(), 'test: close Arivo fixture subscriptions')
  ctx.llm.registerAdapter(['arivo'], adapter)
  return { ctx, adapter }
}
void test('structured tool history preserves IDs, parallel results, errors and text; unsupported options fail before native I/O', () => {
  const request = input(), id = ToolCallId('parallel-1'), second = ToolCallId('parallel-2')
  request.system = 'System 原文'
  request.messages.push(createAssistantMessage({ source: { provider: 'arivo', model: route }, content: [
    { type: 'reasoning', text: 'display-only' }, { type: 'tool-call', id, name: 'one', arguments: '{"x":1}' },
    { type: 'tool-call', id: second, name: 'two', arguments: '{}' },
  ] }))
  request.messages.push(createUserMessage({ source: { kind: 'tool', callId: id }, content: [{ type: 'tool-result', toolCallId: id, content: [{ type: 'text', text: 'first' }] }] }))
  request.messages.push(createUserMessage({ source: { kind: 'tool', callId: second }, content: [{ type: 'tool-result', toolCallId: second, isError: true, content: [{ type: 'text', text: 'failed' }] }] }))
  const parsed = arivoLanguageInput(request)
  assert.deepEqual(parsed.messages.map(value => value.role), ['system', 'user', 'assistant', 'tool', 'tool'])
  assert.deepEqual(parsed.messages[2], { role: 'assistant', content: [
    { type: 'tool-call', id, name: 'one', arguments: '{"x":1}' }, { type: 'tool-call', id: second, name: 'two', arguments: '{}' },
  ] })
  assert.deepEqual(parsed.messages[4], { role: 'tool', toolCallId: second, content: [{ type: 'text', text: '[tool_error]' }, { type: 'text', text: 'failed' }] })
  for (const stop of [[], ['END']]) assert.throws(() => arivoLanguageInput({ ...request, stop }), { code: 'UNSUPPORTED_OPTION' })
  assert.throws(() => arivoModelRoute('deepseek-official'), { code: 'ARIVO_MODEL_REQUIRED' })
})
void test('command IDs remain stable per durable step; call-owned tool IDs cannot collide and unknown usage is not fabricated', () => {
  const first = arivoStepCommand('session', 'step:10')
  assert.equal(first, arivoStepCommand('session', 'step:10')); assert.match(first, /^[0-9a-f-]{36}$/)
  assert.notEqual(first, arivoStepCommand('session', 'step:11'))
  const value = envelope('call-1', 1, { type: 'tool-call-delta', index: 0, id: 'reused', name: 'write_file', arguments: '{}' })
  const chunk = arivoLanguageChunk(value), other = arivoLanguageChunk({ ...value, callId: 'call-2' })
  assert.equal(chunk?.type, 'tool-call-delta'); assert.notDeepEqual(chunk, other)
  assert.equal(arivoLanguageChunk(envelope('call', 1, { type: 'usage', usage: { inputTokens: 1 } })), undefined)
  assert.deepEqual(arivoLanguageChunk(envelope('call', 1, { type: 'usage', usage: { inputTokens: 4, outputTokens: 2, cacheReadTokens: 3 } })),
    { type: 'usage', usage: { inputTokens: 4, outputTokens: 2, cacheReadTokens: 3 } })
})
void test('original Agent performs one real local tool operation and sends the correlated result through the Arivo adapter', { timeout: 15000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arivo-agent-loop-')); t.after(() => rm(root, { recursive: true, force: true }))
  const requests: ArivoLanguageStep[] = [], callId = randomUUID()
  const { host, state } = fixtureHost(async function* (step) {
    requests.push(step)
    if (requests.length === 1) {
      const events: ArivoLanguageEvent['event'][] = [
        { type: 'block-start', index: 0, kind: 'tool-call', id: 'provider-call', name: 'write_file' },
        { type: 'tool-call-delta', index: 0, id: 'provider-call', name: 'write_file', arguments: '{"text":"ARIVO_OK"}' },
        { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'provider-call', name: 'write_file', arguments: '{"text":"ARIVO_OK"}' } },
        { type: 'finish', reason: 'tool-calls' },
      ]
      for (let index = 0; index < events.length; index++) yield envelope(callId, index + 1, events[index]!)
    } else yield* textEvents()
  })
  const { ctx } = await harness(t, host)
  let executions = 0
  ctx.tools.register(defineContentToolFixture({ name: 'write_file', description: 'Write the fixture file', parameters: { text: { type: 'string' } },
    async execute(args) { executions++; await writeFile(join(root, 'result.txt'), String(args.text)); return [{ type: 'text', text: 'saved' }] } }))
  const agent = await ctx.agentLoop.create(SessionId(randomUUID()), { provider: 'arivo', model: route })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Write ARIVO_OK then reply DONE.' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  assert.equal(await readFile(join(root, 'result.txt'), 'utf8'), 'ARIVO_OK'); assert.equal(executions, 1); assert.equal(requests.length, 2)
  assert.notEqual(requests[0]!.commandId, requests[1]!.commandId)
  const tool = requests[1]!.input.messages.find(value => value.role === 'tool'); assert.ok(tool && tool.role === 'tool')
  assert.match(tool.toolCallId, /^arivo_[a-f0-9]{64}$/); assert.deepEqual(tool.content, [{ type: 'text', text: 'saved' }])
  const events = agent.session.snapshotEvents()
  assert.equal(events.filter(value => value.type === 'tool/call').length, 1)
  assert.equal(events.filter(value => value.type === 'tool/result').length, 1)
  assert.equal(events.filter(value => value.type === 'assistant/message').length, 2)
  assert.equal(state.opened, state.disposed); assert.equal(state.stopped.length, 0)
})
void test('changing model settings cannot mint another command for the same open durable step; automatic retries remain disabled', async (t) => {
  const requests: ArivoLanguageStep[] = []
  const { host, state } = fixtureHost(async function* (step) { requests.push(step); yield* textEvents() })
  const { ctx, adapter } = await harness(t, host), session = ctx.sessions.create(SessionId(randomUUID()))
  session.append('turn/start', { turn: 1 }); session.append('step/start', { turn: 1, step: 1 })
  const request = markAgentLoopRequest({ ...input(), sessionId: session.id, signal: signal() })
  for (const model of [route, [randomUUID(), randomUUID(), randomUUID()].join('/')]) for await (const _chunk of adapter.stream(markAgentLoopRequest({ ...request, model }))) { /* Drain the same logical call. */ }
  assert.equal(requests[0]!.commandId, requests[1]!.commandId)
  const policy = ctx.llm.providerRetryPolicy('arivo')
  assert.equal(policy.mode, 'normal')
  assert.equal(policy.mode === 'normal' && policy.maxRetries, 0)
  assert.equal(state.opened, state.disposed)
})
void test('an uncertain native call becomes one failed original Agent step, with no local tool execution or automatic retry', async (t) => {
  let requests = 0
  const { host } = fixtureHost(async function* () { requests++; yield textEvents('partial')[0]!; throw Object.assign(new Error('private diagnostics'), { code: 'LANGUAGE_RECOVERY_REQUIRED' }) })
  const { ctx } = await harness(t, host)
  const agent = await ctx.agentLoop.create(SessionId(randomUUID()), { provider: 'arivo', model: route })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const events = agent.session.snapshotEvents()
  assert.equal(requests, 1); assert.equal(events.filter(value => value.type === 'assistant/message' || value.type === 'tool/call').length, 0)
  assert.ok(events.some(value => value.type === 'turn/end' && value.data.reason.kind === 'error'))
  assert.doesNotMatch(JSON.stringify(events), /private diagnostics/)
})
void test('explicit stop cancels once; disposal closes subscriptions', async (t) => {
  const { host, state } = fixtureHost(async function* (_step, abort) {
    yield textEvents()[0]!
    await new Promise<void>((resolve) => { if (abort.aborted) resolve(); else abort.addEventListener('abort', () => { resolve() }, { once: true }) })
    abort.throwIfAborted()
  })
  const { ctx, adapter } = await harness(t, host), session = ctx.sessions.create(SessionId(randomUUID()))
  session.append('turn/start', { turn: 1 }); session.append('step/start', { turn: 1, step: 1 })
  const abort = new AbortController()
  const stream = adapter.stream(markAgentLoopRequest({ ...input(), sessionId: session.id, signal: abort.signal }))
  await stream.next(); abort.abort(); await assert.rejects(stream.next(), LlmError)
  assert.equal(state.stopped.length, 1)
  const other = adapter.stream(markAgentLoopRequest({ ...input(), sessionId: session.id, signal: signal() }))
  await other.next(); const pending = other.next(); const closing = adapter.close(); await assert.rejects(pending, LlmError); await closing
  assert.equal(state.stopped.length, 1); assert.equal(state.opened, state.disposed)
})

void test('hard crash preserves tool intent; native adapter receives unknown outcome after resume without replaying effects',
  { timeout: 30000, skip: process.platform === 'win32' }, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'arivo-tool-crash-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const cwd = fileURLToPath(new URL('../../../', import.meta.url))
    const fixture = fileURLToPath(new URL('./fixtures/arivo-tool-crash.ts', import.meta.url))
    const child = (mode: 'crash' | 'resume') => {
      const subprocess = spawn(process.execPath, ['--import', 'tsx/esm', fixture, mode, root], {
        cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let diagnostic = ''
      subprocess.stderr.on('data', (value: Buffer) => { diagnostic = (diagnostic + value.toString()).slice(-16384) })
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        subprocess.once('error', reject)
        subprocess.once('close', (code, signal) => { resolve({ code, signal }) })
      })
      return { process: subprocess, exited, diagnostic: () => diagnostic }
    }
    const crashed = child('crash')
    try {
      const deadline = Date.now() + 15000
      while (await readFile(join(root, 'ready'), 'utf8').catch(() => '') !== 'effect-without-result') {
        if (crashed.process.exitCode !== null || Date.now() > deadline) throw new Error(crashed.diagnostic() || 'Crash fixture did not reach its tool effect')
        await pause(20)
      }
      crashed.process.kill('SIGKILL')
      assert.deepEqual(await crashed.exited, { code: null, signal: 'SIGKILL' })
      assert.equal(await readFile(join(root, 'effect'), 'utf8'), 'once\n')
    } finally {
      if (crashed.process.exitCode === null && crashed.process.signalCode === null) crashed.process.kill('SIGKILL')
      await crashed.exited
    }
    const resumed = child('resume')
    const timer = setTimeout(() => resumed.process.kill('SIGKILL'), 10000)
    try {
      assert.deepEqual(await resumed.exited, { code: 0, signal: null }, resumed.diagnostic())
      assert.deepEqual(JSON.parse(await readFile(join(root, 'receipt.json'), 'utf8')), {
        outcome: 'TOOL_OUTCOME_UNKNOWN', toolsOnResume: 0, modelCallsBeforeFollowup: 0,
        modelCallsAfterFollowup: 1, originalToolCalls: 1, recoveryResults: 1,
      })
      const commands = (await readFile(join(root, 'commands'), 'utf8')).trim().split('\n')
      assert.equal(commands.length, 2); assert.notEqual(commands[0], commands[1])
      assert.equal(await readFile(join(root, 'effect'), 'utf8'), 'once\n')
    } finally { clearTimeout(timer); resumed.process.kill('SIGKILL'); await resumed.exited }
  })

void test('allowlisted billing rejection retains its code and points to account budgets without leaking remote text', async (t) => {
  const { host } = fixtureHost(async function* () {
    throw Object.assign(new Error('private provider diagnostic'), { code: 'BILLING_BUDGET_NOT_FOUND' })
  })
  const { ctx, adapter } = await harness(t, host), session = ctx.sessions.create(SessionId(randomUUID()))
  session.append('turn/start', { turn: 1 }); session.append('step/start', { turn: 1, step: 1 })
  await assert.rejects(async () => {
    const request = markAgentLoopRequest({ ...input(), sessionId: session.id, signal: signal() })
    for await (const _chunk of adapter.stream(request)) { /* Drain output. */ }
  }, error => error instanceof LlmError && error.code === 'BILLING_BUDGET_NOT_FOUND'
    && error.message.includes('项目预算') && !error.message.includes('private provider'))
})
