/** Enterprise chat serialization and DSH block projection; unsupported content fails before dispatch. */
import { LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ModelEvent } from '@deepseek-ai/dsh-enterprise-api/model-stream'
type WireMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | readonly unknown[] | null
  tool_calls?: readonly unknown[]
  tool_call_id?: string
  reasoning_content?: string
  name?: string
}

function text(blocks: readonly ContentBlock[]): string {
  return blocks.map((block) => {
    if (block.type !== 'text') throw new LlmError('Enterprise gateway accepts only text in this message', 'UNSUPPORTED_OPTION')
    return block.text
  }).join('')
}

/** Preserve message order and raw tool argument strings; do not silently discard modalities.
 * @param options - DSH assembled request with files already projected by LlmRuntime.
 * @returns OpenAI-compatible messages without routing or credential fields.
 */
export function gatewayMessages(options: GenerateOptions): WireMessage[] {
  const messages: WireMessage[] = []
  if (options.system !== undefined) messages.push({ role: 'system', content: options.system })
  for (const message of options.messages) {
    if (message.role === 'system') {
      messages.push({ role: 'system', content: text(message.content) })
    } else if (message.role === 'assistant') {
      const calls = []
      let content = ''
      let reasoning = ''
      for (const block of message.content) {
        switch (block.type) {
          case 'text': content += block.text; break
          case 'reasoning': reasoning += block.text; break
          case 'tool-call': calls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: block.arguments } }); break
          default: throw new LlmError('Enterprise gateway cannot replay this assistant content', 'UNSUPPORTED_OPTION')
        }
      }
      messages.push({ role: 'assistant', content, ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(calls.length ? { tool_calls: calls } : {}) })
    } else {
      let plain: ContentBlock[] = []
      const flush = () => {
        if (plain.length) messages.push({ role: 'user', content: text(plain) })
        plain = []
      }
      for (const block of message.content) {
        if (block.type === 'tool-result') {
          flush()
          messages.push({ role: 'tool', tool_call_id: block.toolCallId, content: text(block.content) })
        } else plain.push(block)
      }
      flush()
    }
  }
  return messages
}

/** Project a validated SSE stream into DSH chunks; incomplete identities never become executable tools.
 * @param events - validated gateway records, with a mandatory completion marker.
 * @param maxResponseChars - upper bound on accumulated response records.
 * @returns Ordered deltas, complete blocks, usage, then exactly one terminal finish.
 */
export async function* gatewayChunks(events: AsyncIterable<ModelEvent>, maxResponseChars: number): AsyncGenerator<StreamChunk> {
  const blocks: { kind: 'text' | 'reasoning' | 'tool-call'; text: string; id?: string; name?: string }[] = []
  const tools = new Map<number, number>()
  let textIndex: number | undefined
  let reasoningIndex: number | undefined
  let finish: string | undefined
  let usage: TokenUsage | undefined
  let size = 0
  for await (const event of events) {
    if (event === '[DONE]') {
      if (!finish) throw new LlmError('Model completion is incomplete', 'GATEWAY_INCOMPLETE')
      if (finish !== 'stop' && finish !== 'tool_calls' && finish !== 'length') {
        throw new LlmError('Model completion was refused', 'GATEWAY_REFUSED')
      }
      for (const [index, block] of blocks.entries()) {
        if (block.kind === 'tool-call') {
          if (!block.id || !block.name) throw new LlmError('Model tool identity is incomplete', 'GATEWAY_INCOMPLETE')
          yield { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(block.id), name: block.name, arguments: block.text } }
        } else yield { type: 'block-end', index, block: { type: block.kind, text: block.text } }
      }
      if (usage) yield { type: 'usage', usage }
      yield { type: 'finish', reason: { kind: finish === 'tool_calls' ? 'tool-calls' : finish === 'length' ? 'max-tokens' : 'stop' } }
      return
    }
    size += JSON.stringify(event).length
    if (size > maxResponseChars) throw new LlmError('Model response exceeds limit', 'GATEWAY_LIMIT')
    for (const choice of event.choices) {
      for (const kind of ['reasoning', 'text'] as const) {
        const delta = kind === 'text' ? choice.delta?.content : choice.delta?.reasoning_content
        if (!delta) continue
        let index = kind === 'text' ? textIndex : reasoningIndex
        if (index === undefined) {
          index = blocks.length
          blocks.push({ kind, text: '' })
          if (kind === 'text') textIndex = index
          else reasoningIndex = index
          yield { type: 'block-start', index, blockType: kind }
        }
        const block = blocks[index]
        if (!block) throw new Error('Gateway block index is not registered')
        block.text += delta
        yield { type: kind === 'text' ? 'text-delta' : 'reasoning-delta', index, text: delta }
      }
      for (const call of choice.delta?.tool_calls ?? []) {
        let index = tools.get(call.index)
        if (index === undefined) {
          index = blocks.length
          tools.set(call.index, index)
          blocks.push({ kind: 'tool-call', text: '' })
          yield { type: 'block-start', index, blockType: 'tool-call' }
        }
        const block = blocks[index]
        if (!block) throw new Error('Gateway tool index is not registered')
        if ((call.id && block.id && call.id !== block.id) || (call.function?.name && block.name && call.function.name !== block.name)) {
          throw new LlmError('Model tool identity changed during streaming', 'GATEWAY_PROTOCOL')
        }
        if (call.id) block.id = call.id
        if (call.function?.name) block.name = call.function.name
        const delta = call.function?.arguments ?? ''
        block.text += delta
        yield { type: 'tool-call-delta', index, id: ToolCallId(block.id ?? ''), ...(block.name ? { name: block.name } : {}), argumentsDelta: delta }
      }
      if (choice.finish_reason) finish = choice.finish_reason
    }
    if (event.usage) {
      const raw = event.usage
      const cached = raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens ?? 0
      if (cached > raw.prompt_tokens) throw new LlmError('Model usage counters are inconsistent', 'GATEWAY_PROTOCOL')
      usage = { inputTokens: raw.prompt_tokens - cached, cacheReadTokens: cached, outputTokens: raw.completion_tokens,
        totalTokens: raw.prompt_tokens + raw.completion_tokens,
        ...(raw.completion_tokens_details?.reasoning_tokens === undefined
          ? {} : { reasoningTokens: raw.completion_tokens_details.reasoning_tokens }) }
    }
  }
  throw new LlmError('Model stream ended without completion', 'GATEWAY_INCOMPLETE')
}
