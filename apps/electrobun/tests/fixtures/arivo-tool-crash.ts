/** Source subprocess fixture: crash after a checkpointed tool effect, then resume through the Arivo adapter. */
import assert from 'node:assert/strict'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as CheckpointPolicy from '@deepseek-ai/dsh-session-checkpoint-policy'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, TOOL_OUTCOME_UNKNOWN } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { ArivoLanguageAdapter } from '../../src/distribution/arivo-shell/host/language-adapter.ts'
import type { ArivoLanguageHost, ArivoLanguageEvent } from '../../src/distribution/arivo-shell/host/language-wire.ts'

const [mode, root] = process.argv.slice(2)
if ((mode !== 'crash' && mode !== 'resume') || root === undefined) throw new Error('Explicit fixture mode and directory required')
const directory = root, sessionId = SessionId('arivo-tool-hard-crash')
const route = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333'
let requests = 0, effects = 0
const host: ArivoLanguageHost = { async languageSession() {
  return { protocolVersion: 1, dispose() {}, session: {
    async models() { return { items: [{ protocolVersion: 1, id: route.split('/')[2]!, displayName: 'Crash fixture', tools: true, maxOutputTokens: 64 }], nextCursor: null } },
    async *run(step) {
      requests++
      await appendFile(join(directory, 'commands'), step.commandId + '\n')
      let events: ArivoLanguageEvent['event'][]
      if (mode === 'crash') {
        events = [
          { type: 'block-start', index: 0, kind: 'tool-call', id: 'write-effect', name: 'write_once' },
          { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'write-effect', name: 'write_once', arguments: '{}' } },
          { type: 'finish', reason: 'tool-calls' },
        ]
      } else {
        const prior = step.input.messages.find(message => message.role === 'tool')
        assert.ok(prior && prior.role === 'tool')
        assert.match(prior.toolCallId, /^arivo_[a-f0-9]{64}$/)
        assert.ok(prior.content.some(block => block.text.includes('Do not retry blindly.')))
        events = [
          { type: 'block-start', index: 0, kind: 'text' },
          { type: 'text-delta', index: 0, text: 'VERIFY_EXTERNAL_STATE' },
          { type: 'block-end', index: 0, block: { type: 'text', text: 'VERIFY_EXTERNAL_STATE' } },
          { type: 'finish', reason: 'stop' },
        ]
      }
      for (let i = 0; i < events.length; i++) yield { protocolVersion: 1, callId: 'original-crash-call', attemptId: 'original-crash-attempt', sequence: i + 1, event: events[i]! }
    },
    async stop() { throw new Error('Recovery must not cancel or resubmit the previous fixture call') },
  } }
} }

const ctx = new Context()
try {
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(JsonlSessionPersistence, { root: join(directory, 'sessions'), compression: 'none' })
  await ctx.plugin(CheckpointPolicy)
  const adapter = new ArivoLanguageAdapter(host, ctx.sessions,
    { defaultMaxOutputTokens: 64, maxCatalogPages: 1, catalogTimeoutMs: 1000 }, () => { throw new Error('Unexpected stop') })
  ctx.effect(() => () => adapter.close(), 'test: release Arivo crash adapter')
  ctx.llm.registerAdapter(['arivo'], adapter)
  ctx.tools.register(defineContentToolFixture({ name: 'write_once', description: 'Record one local side effect', parameters: {},
    async execute() {
      effects++
      await appendFile(join(directory, 'effect'), 'once\n')
      await writeFile(join(directory, 'ready'), 'effect-without-result')
      if (mode === 'crash') await new Promise<never>(() => { setInterval(() => {}, 60_000) })
      return [{ type: 'text', text: 'saved' }]
    } }))
  if (mode === 'crash') {
    const handle = await ctx.agents.create({ sessionId, agentOptions: { provider: 'arivo', model: route } })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Write once.' }], source: { kind: 'user' } }))
    await new Promise<never>(() => { setInterval(() => {}, 60_000) })
  } else {
    const handle = await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: { provider: 'arivo', model: route } })
    await handle.agent.whenIdle()
    assert.equal(requests, 0); assert.equal(effects, 0)
    const result = handle.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    assert.ok(result && result.type === 'tool/result')
    assert.equal(result.data.error?.code, TOOL_OUTCOME_UNKNOWN)
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Report the unknown outcome without repeating the operation.' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    assert.equal(requests, 1); assert.equal(effects, 0)
    assert.equal(await readFile(join(directory, 'effect'), 'utf8'), 'once\n')
    const events = handle.agent.session.snapshotEvents()
    assert.equal(events.filter(event => event.type === 'tool/call').length, 1)
    assert.equal(events.filter(event => event.type === 'tool/result').length, 1)
    assert.ok(events.some(event => event.type === 'assistant/message'
      && event.data.message.content.some(block => block.type === 'text' && block.text === 'VERIFY_EXTERNAL_STATE')))
    await ctx.sessions.flush(handle.agent.session)
    await writeFile(join(directory, 'receipt.json'), JSON.stringify({ outcome: TOOL_OUTCOME_UNKNOWN,
      toolsOnResume: effects, modelCallsBeforeFollowup: 0, modelCallsAfterFollowup: requests, originalToolCalls: 1, recoveryResults: 1 }) + '\n')
  }
} finally { await ctx.fiber.dispose() }
