/** Enterprise OpenAI-compatible serialization and DSH block projection; unsupported content fails before dispatch. */
import { LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, StreamChunk, TokenUsage, MediaAttachmentRef } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { parseResponsesUsage, type ModelEvent } from '@deepseek-ai/dsh-enterprise-api/model-stream'
type WireMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | readonly unknown[] | null
  tool_calls?: readonly unknown[]
  tool_call_id?: string
  reasoning_content?: string
  name?: string
}

/** Resolve one durable image into bytes for a provider's inline image field. */
export type GatewayResolvedMedia = { mediaType: string; data: Uint8Array } | { fileId: string }
/** Resolve one durable image into inline bytes or an ephemeral provider file id. */
export type GatewayImageResolver = (ref: ImageAttachmentRef) => Promise<GatewayResolvedMedia>
/** Resolve any durable media reference for a provider-native request. */
export type GatewayMediaResolver = (ref: MediaAttachmentRef) => Promise<GatewayResolvedMedia>

function dataUrl(media: GatewayResolvedMedia): string {
  if ('fileId' in media) throw new LlmError('Chat Completions cannot inline a provider file id for this media part', 'UNSUPPORTED_FILE_POLICY')
  return `data:${media.mediaType};base64,${Buffer.from(media.data).toString('base64')}`
}

function fileId(media: GatewayResolvedMedia): string | undefined {
  return 'fileId' in media ? media.fileId : undefined
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
export async function gatewayMessages(
  options: GenerateOptions,
  resolveImage?: GatewayImageResolver,
  resolveMedia?: GatewayMediaResolver,
): Promise<WireMessage[]> {
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
      const flush = async () => {
        if (plain.length) {
          const content: unknown[] = []
          for (const block of plain) {
            if (block.type === 'text') content.push({ type: 'text', text: block.text })
            else if (block.type === 'image') {
              if (resolveImage === undefined) throw new LlmError('Enterprise gateway cannot resolve image attachments', 'UNSUPPORTED_MODALITY')
              const image = await resolveImage(block.attachment)
              const uploaded = fileId(image)
              content.push({ type: 'image_url', image_url: uploaded === undefined ? { url: dataUrl(image) } : { file_id: uploaded } })
            } else if (block.type === 'video' || block.type === 'audio' || block.type === 'document') {
              if (resolveMedia === undefined) throw new LlmError('Enterprise gateway cannot resolve media attachments', 'UNSUPPORTED_MODALITY')
              const media = await resolveMedia(block.attachment)
              if ('fileId' in media) {
                if (block.type === 'video') content.push({ type: 'video_url', video_url: { file_id: media.fileId } })
                else if (block.type === 'audio') content.push({ type: 'input_audio', input_audio: { file_id: media.fileId } })
                else throw new LlmError('Chat Completions does not accept document file ids on this route', 'UNSUPPORTED_MODALITY')
              }
              else {
                const data = dataUrl(media)
                if (block.type === 'video') content.push({ type: 'video_url', video_url: { url: data } })
                else if (block.type === 'audio') content.push({ type: 'input_audio', input_audio: { data: Buffer.from(media.data).toString('base64'), format: media.mediaType.split('/')[1] ?? 'wav' } })
                else content.push({ type: 'file', file: { filename: block.attachment.name, file_data: data } })
              }
            } else throw new LlmError('Enterprise gateway accepts only text and media in this message', 'UNSUPPORTED_MODALITY')
          }
          messages.push({ role: 'user', content: content.length === 1 && (content[0] as { type?: string }).type === 'text' ? text(plain) : content })
        }
        plain = []
      }
      for (const block of message.content) {
        if (block.type === 'tool-result') {
          await flush()
          messages.push({ role: 'tool', tool_call_id: block.toolCallId, content: text(block.content) })
        } else plain.push(block)
      }
      await flush()
    }
  }
  return messages
}

/** Build an OpenAI Responses request while retaining structured media input items. */
export async function gatewayResponsesBody(
  options: GenerateOptions,
  resolveImage?: GatewayImageResolver,
  resolveMedia?: GatewayMediaResolver,
): Promise<Record<string, unknown>> {
  const input: unknown[] = []
  for (const message of options.messages) {
    const content: unknown[] = []
    for (const block of message.content) {
      if (block.type === 'text') content.push({ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: block.text })
      else if (block.type === 'image') {
        if (resolveImage === undefined) throw new LlmError('Enterprise gateway cannot resolve image attachments', 'UNSUPPORTED_MODALITY')
        const image = await resolveImage(block.attachment)
        content.push('fileId' in image
          ? { type: 'input_image', file_id: image.fileId }
          : { type: 'input_image', image_url: dataUrl(image) })
      } else if (block.type === 'video' || block.type === 'audio' || block.type === 'document') {
        if (resolveMedia === undefined) throw new LlmError('Enterprise gateway cannot resolve media attachments', 'UNSUPPORTED_MODALITY')
        const media = await resolveMedia(block.attachment)
        if ('fileId' in media) content.push({ type: block.type === 'video' ? 'input_video' : block.type === 'audio' ? 'input_audio' : 'input_file', file_id: media.fileId })
        else {
          const data = dataUrl(media)
          if (block.type === 'video') content.push({ type: 'input_video', video_url: data })
          else if (block.type === 'audio') content.push({ type: 'input_audio', audio_url: data })
          else content.push({ type: 'input_file', filename: block.attachment.name, file_data: data })
        }
      } else if (block.type === 'reasoning') {
        content.push({ type: 'output_text', text: block.text })
      } else if (block.type === 'tool-result') {
        input.push({ type: 'function_call_output', call_id: block.toolCallId, output: text(block.content) })
      } else if (block.type === 'tool-call') {
        input.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: block.arguments })
      } else {
        throw new LlmError('Enterprise gateway cannot replay this Responses content', 'UNSUPPORTED_OPTION')
      }
    }
    if (content.length) input.push({ role: message.role, content })
  }
  return {
    model: options.model,
    input,
    ...(options.system === undefined ? {} : { instructions: options.system }),
    ...(options.tools ? { tools: options.tools.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters })) } : {}),
    ...(options.maxTokens === undefined ? {} : { max_output_tokens: options.maxTokens }),
    ...(options.reasoningEffort === undefined ? {} : { reasoning: { effort: options.reasoningEffort } }),
    stream: true,
  }
}

/** Translate OpenAI Responses SSE records into DSH stream chunks. */
export async function* gatewayResponseChunks(
  events: AsyncIterable<Record<string, unknown>>,
  maxResponseChars: number,
): AsyncGenerator<StreamChunk> {
  let textIndex: number | undefined
  let textValue = ''
  const tools = new Map<number, { index: number; id: string; name: string; arguments: string }>()
  let nextIndex = 0
  let size = 0
  let usage: TokenUsage | undefined
  let completed = false
  const outputIndex = (event: Record<string, unknown>): number => {
    if (!Number.isSafeInteger(event.output_index) || (event.output_index as number) < 0) {
      throw new LlmError('Responses event has an invalid output index', 'GATEWAY_PROTOCOL')
    }
    return event.output_index as number
  }
  const stringField = (event: Record<string, unknown>, field: string): string => {
    const value = event[field]
    if (typeof value !== 'string') throw new LlmError(`Responses event has an invalid ${field} field`, 'GATEWAY_PROTOCOL')
    return value
  }
  const nonEmptyStringField = (event: Record<string, unknown>, field: string): string => {
    const value = stringField(event, field)
    if (value.length === 0) throw new LlmError(`Responses event has an empty ${field} field`, 'GATEWAY_PROTOCOL')
    return value
  }
  for await (const event of events) {
    size += JSON.stringify(event).length
    if (size > maxResponseChars) throw new LlmError('Model response exceeds limit', 'GATEWAY_LIMIT')
    const type = typeof event.type === 'string' ? event.type : ''
    if (type === 'response.output_text.delta') {
      const delta = stringField(event, 'delta')
      if (textIndex === undefined) { textIndex = nextIndex++; yield { type: 'block-start', index: textIndex, blockType: 'text' } }
      textValue += delta
      yield { type: 'text-delta', index: textIndex, text: delta }
    } else if (type === 'response.output_item.added') {
      const wireIndex = outputIndex(event)
      const item = event.item && typeof event.item === 'object' ? event.item as Record<string, unknown> : undefined
      if (item?.type === 'function_call') {
        const call = { index: nextIndex++, id: nonEmptyStringField(item, 'call_id'),
          name: nonEmptyStringField(item, 'name'), arguments: stringField(item, 'arguments') }
        if (tools.has(wireIndex)) throw new LlmError('Responses output item was added more than once', 'GATEWAY_PROTOCOL')
        tools.set(wireIndex, call)
        yield { type: 'block-start', index: call.index, blockType: 'tool-call' }
      } else if (item?.type !== 'message' && item?.type !== 'reasoning') {
        throw new LlmError('Responses output item type is unsupported', 'GATEWAY_PROTOCOL')
      }
    } else if (type === 'response.function_call_arguments.delta') {
      const call = tools.get(outputIndex(event))
      if (!call) throw new LlmError('Model tool delta has no output item', 'GATEWAY_PROTOCOL')
      const delta = stringField(event, 'delta')
      call.arguments += delta
      yield { type: 'tool-call-delta', index: call.index, id: ToolCallId(call.id), ...(call.name ? { name: call.name } : {}), argumentsDelta: delta }
    } else if (type === 'response.output_item.done') {
      const call = tools.get(outputIndex(event))
      const item = event.item && typeof event.item === 'object' ? event.item as Record<string, unknown> : undefined
      if (call && item?.type === 'function_call') {
        const id = nonEmptyStringField(item, 'call_id')
        const name = nonEmptyStringField(item, 'name')
        const argumentsValue = stringField(item, 'arguments')
        if ((call.id && call.id !== id) || (call.name && call.name !== name)) {
          throw new LlmError('Model tool identity changed during streaming', 'GATEWAY_PROTOCOL')
        }
        call.id = id
        call.name = name
        call.arguments = argumentsValue
      } else if (item?.type !== 'message' && item?.type !== 'reasoning') {
        throw new LlmError('Responses output completion does not match an output item', 'GATEWAY_PROTOCOL')
      }
    } else if (type === 'response.completed') {
      if (completed) throw new LlmError('Responses stream completed more than once', 'GATEWAY_PROTOCOL')
      completed = true
      const response = event.response
      const raw = response && typeof response === 'object' ? (response as Record<string, unknown>).usage : undefined
      if (raw !== undefined) {
        try {
          const value = parseResponsesUsage(raw)
          usage = {
            inputTokens: value.promptTokens - value.cachedPromptTokens,
            cacheReadTokens: value.cachedPromptTokens,
            outputTokens: value.completionTokens,
            totalTokens: value.promptTokens + value.completionTokens,
            ...(value.reasoningTokens === undefined ? {} : { reasoningTokens: value.reasoningTokens }),
          }
        } catch {
          throw new LlmError('Responses completion has invalid usage fields', 'GATEWAY_PROTOCOL')
        }
      }
    } else if (type === 'response.failed' || type === 'response.cancelled' || type === 'error') {
      throw new LlmError('Enterprise Responses request failed', 'GATEWAY_REFUSED')
    } else if (type === 'response.incomplete') {
      throw new LlmError('Enterprise Responses request is incomplete', 'GATEWAY_INCOMPLETE')
    } else if (![
      'response.created', 'response.in_progress',
      'response.content_part.added', 'response.content_part.done',
      'response.output_text.done', 'response.function_call_arguments.done',
    ].includes(type)) {
      throw new LlmError('Enterprise Responses stream contains an unsupported event', 'GATEWAY_PROTOCOL')
    }
  }
  if (!completed) throw new LlmError('Model completion is incomplete', 'GATEWAY_INCOMPLETE')
  for (let index = 0; index < nextIndex; index += 1) {
    if (textIndex === index) {
      yield { type: 'block-end', index, block: { type: 'text', text: textValue } }
      continue
    }
    const call = [...tools.values()].find(candidate => candidate.index === index)
    if (!call?.id || !call.name) throw new LlmError('Model tool identity is incomplete', 'GATEWAY_INCOMPLETE')
    yield { type: 'block-end', index: call.index, block: { type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: call.arguments } }
  }
  if (usage) yield { type: 'usage', usage }
  yield { type: 'finish', reason: { kind: 'stop' } }
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
