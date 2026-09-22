import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { PluginSdk } from '@deepseek-ai/dsh-plugin-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, inject } from '../src/host.ts'

let ctx: Context | undefined

class AcceptanceAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override resolveModel(provider: string, model: string): Promise<{ provider: string; id: string; name: string }> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length === 1) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('acceptance-call'), name: 'enterprise_plugin_acceptance', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function acceptanceSdk(): PluginSdk {
  const bytes = new TextEncoder().encode('enterprise-plugin-acceptance')
  return {
    identity: { current: async () => ({ userId: 'user-1' as never, name: 'Ada', avatarUrl: null, email: 'ada@example.test', organizationId: 'org-1' as never, owner: { kind: 'personal', accountId: 'user-1' as never } }) },
    models: {
      list: async () => [{ id: 'text-model' as never, name: 'Text model', inputModalities: ['text'], maxOutputTokens: 1024 }],
      text: async () => ({ text: 'PLUGIN_MODEL_RESULT', usage: { callId: 'usage-1', status: 'settled', inputTokens: 2, outputTokens: 3 } }),
      textStream: async function * () { yield { text: 'PLUGIN_MODEL_RESULT', done: true } },
    },
    objects: {
      put: async () => ({ objectId: 'object-1', version: 'version-1', size: bytes.length, contentType: 'text/plain', createdAt: '2026-09-21T00:00:00.000Z' }),
      read: async () => bytes,
      listVersions: async () => [],
      delete: async () => {},
    },
    database: {
      query: async () => ({ rows: [], rowCount: 0 }),
      transaction: async statements => statements.map(() => ({ rows: [], rowCount: 0 })),
    },
    cache: {
      get: async <T>() => ({ identity: 'user-1' }) as T,
      set: async () => ({ version: 'cache-version-1' }),
      delete: async () => {},
      increment: async () => 1,
    },
  }
}

function waitForIdle(context: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = context.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      dispose()
      resolve()
    })
  })
}

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('enterprise plugin acceptance Host target', () => {
  it('registers and disposes its Agent tool with the Cordis plugin fiber', async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('pluginSdk', {} as never)

    const fiber = ctx.plugin({ name: 'enterprise-plugin-acceptance', inject, apply })
    await fiber.await()
    expect(ctx.tools.schemas().map(tool => tool.name)).toContain('enterprise_plugin_acceptance')

    await fiber.dispose()
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('enterprise_plugin_acceptance')
  })

  it('records SDK model output in the existing tool/result Session event', async () => {
    const adapter = new AcceptanceAdapter()
    ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], adapter)
    ctx.provide('pluginSdk', acceptanceSdk())
    await ctx.plugin({ name: 'enterprise-plugin-acceptance', inject, apply })
    const agent = await ctx.agentLoop.create(SessionId('plugin-acceptance-session'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run the acceptance plugin' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const result = agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    expect(result?.type).toBe('tool/result')
    const text = result?.type === 'tool/result'
      ? result.data.message.content[0].content.find(block => block.type === 'text')?.text
      : undefined
    expect(text).toContain('PLUGIN_MODEL_RESULT')
    expect(agent.session.deriveMessages()).toContainEqual(result?.type === 'tool/result' ? result.data.message : undefined)
    const replayed = adapter.requests[1]?.messages.flatMap(message => message.content)
      .find(block => block.type === 'tool-result')
    expect(replayed?.type === 'tool-result'
      ? replayed.content.find(block => block.type === 'text')?.text
      : undefined).toContain('PLUGIN_MODEL_RESULT')
  })
})
