/** Enterprise OpenAI-compatible serialization and DSH block projection; unsupported content fails before dispatch. */
import { LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message, ReplayEnvelope, StreamChunk, TokenUsage, MediaAttachmentRef } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { parseResponsesUsage, type ModelEvent } from '@deepseek-ai/dsh-enterprise-api/model-stream'
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
type WireMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | readonly unknown[] | null
  tool_calls?: readonly unknown[]
  tool_call_id?: string
  reasoning_content?: string
  name?: string
}

interface GatewayResponsesReplayResponse {
  kind: 'enterprise-openai-responses'
  version: 1
  provider: string
  model: string
}

type GatewayResponsesReplayBlock =
  | { type: 'text' }
  | { type: 'reasoning'; item?: Record<string, unknown> }
  | { type: 'tool-call'; item: Record<string, unknown> }

interface GatewayResponsesRoute { provider: string; model: string }

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

async function responsesInputPart(
  block: Extract<ContentBlock, { type: 'image' | 'video' | 'audio' | 'document' }>,
  resolveImage?: GatewayImageResolver,
  resolveMedia?: GatewayMediaResolver,
): Promise<Record<string, unknown>> {
  if (block.type === 'image') {
    if (resolveImage === undefined) throw new LlmError('Enterprise gateway cannot resolve image attachments', 'UNSUPPORTED_MODALITY')
    const image = await resolveImage(block.attachment)
    return 'fileId' in image
      ? { type: 'input_image', file_id: image.fileId }
      : { type: 'input_image', image_url: dataUrl(image) }
  }
  if (resolveMedia === undefined) throw new LlmError('Enterprise gateway cannot resolve media attachments', 'UNSUPPORTED_MODALITY')
  const media = await resolveMedia(block.attachment)
  if ('fileId' in media) {
    return { type: block.type === 'video' ? 'input_video' : block.type === 'audio' ? 'input_audio' : 'input_file', file_id: media.fileId }
  }
  const data = dataUrl(media)
  if (block.type === 'video') return { type: 'input_video', video_url: data }
  if (block.type === 'audio') return { type: 'input_audio', audio_url: data }
  return { type: 'input_file', filename: block.attachment.name, file_data: data }
}

async function responsesToolOutput(
  blocks: readonly ContentBlock[],
  resolveImage?: GatewayImageResolver,
  resolveMedia?: GatewayMediaResolver,
): Promise<{ output: string; media: readonly Record<string, unknown>[] }> {
  let output = ''
  const media: Record<string, unknown>[] = []
  for (const block of blocks) {
    if (block.type === 'text') output += block.text
    else if (block.type === 'image' || block.type === 'video' || block.type === 'audio' || block.type === 'document') {
      media.push(await responsesInputPart(block, resolveImage, resolveMedia))
    } else {
      throw new LlmError('Enterprise gateway accepts only text and media in Responses tool output', 'UNSUPPORTED_MODALITY')
    }
  }
  return { output, media }
}

function responsesReplayBlocks(message: Message): readonly GatewayResponsesReplayBlock[] | undefined {
  const source = message.source
  if (message.role !== 'assistant' || source.kind !== 'model' || source.replayState === undefined) return undefined
  const state = source.replayState
  if (typeof state !== 'object' || state === null || Array.isArray(state)) return undefined
  const envelope = state as Record<string, unknown>
  const rawResponse = envelope.response
  if (typeof rawResponse !== 'object' || rawResponse === null || Array.isArray(rawResponse)) return undefined
  const response = rawResponse as Record<string, unknown>
  if (response.kind !== 'enterprise-openai-responses' || response.version !== 1
    || response.provider !== source.provider || response.model !== source.model) return undefined
  if (!Array.isArray(envelope.blocks) || envelope.blocks.length !== message.content.length) return undefined
  const blocks: GatewayResponsesReplayBlock[] = []
  for (const [index, rawBlock] of envelope.blocks.entries()) {
    const content = message.content[index]
    if (content === undefined || typeof rawBlock !== 'object' || rawBlock === null || Array.isArray(rawBlock)) return undefined
    const block = rawBlock as Record<string, unknown>
    if (block.type !== content.type) return undefined
    if (content.type === 'text') {
      blocks.push({ type: 'text' })
      continue
    }
    if (content.type === 'reasoning') {
      if (block.item === undefined) {
        blocks.push({ type: 'reasoning' })
        continue
      }
      const snapshot = snapshotJsonValue(block.item)
      if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return undefined
      const item = snapshot as Record<string, unknown>
      if (item.type !== 'reasoning' || typeof item.id !== 'string' || item.id.length === 0
        || typeof item.encrypted_content !== 'string' || item.encrypted_content.length === 0
        || !Array.isArray(item.content)
        || (item.summary !== undefined && !Array.isArray(item.summary))) return undefined
      blocks.push({ type: 'reasoning', item })
      continue
    }
    if (content.type === 'tool-call') {
      const snapshot = snapshotJsonValue(block.item)
      if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return undefined
      const item = snapshot as Record<string, unknown>
      if (item.type !== 'function_call' || item.call_id !== content.id
        || item.name !== content.name || item.arguments !== content.arguments
        || (item.id !== undefined && (typeof item.id !== 'string' || item.id.length === 0))
        || (item.status !== undefined && typeof item.status !== 'string')) return undefined
      blocks.push({ type: 'tool-call', item })
      continue
    }
    return undefined
  }
  return blocks
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

/** Build an OpenAI Responses request while retaining structured media input items and tool outputs. */
export async function gatewayResponsesBody(
  options: GenerateOptions,
  resolveImage?: GatewayImageResolver,
  resolveMedia?: GatewayMediaResolver,
): Promise<Record<string, unknown>> {
  const input: unknown[] = []
  for (const message of options.messages) {
    const replay = responsesReplayBlocks(message)
    const content: unknown[] = []
    const flush = () => {
      if (content.length) input.push({ role: message.role, content: content.splice(0) })
    }
    for (const [index, block] of message.content.entries()) {
      const replayBlock = replay?.[index]
      if (block.type === 'text') content.push({ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: block.text })
      else if (block.type === 'image' || block.type === 'video' || block.type === 'audio' || block.type === 'document') {
        content.push(await responsesInputPart(block, resolveImage, resolveMedia))
      } else if (block.type === 'reasoning') {
        if (replayBlock?.type === 'reasoning' && replayBlock.item !== undefined) {
          flush()
          input.push(replayBlock.item)
        } else content.push({ type: 'output_text', text: block.text })
      } else if (block.type === 'tool-result') {
        flush()
        const result = await responsesToolOutput(block.content, resolveImage, resolveMedia)
        input.push({ type: 'function_call_output', call_id: block.toolCallId, output: result.output })
        if (result.media.length) input.push({ role: 'user', content: result.media })
      } else if (block.type === 'tool-call') {
        flush()
        input.push(replayBlock?.type === 'tool-call'
          ? replayBlock.item
          : { type: 'function_call', call_id: block.id, name: block.name, arguments: block.arguments })
      } else {
        throw new LlmError('Enterprise gateway cannot replay this Responses content', 'UNSUPPORTED_OPTION')
      }
    }
    flush()
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
  route: GatewayResponsesRoute,
): AsyncGenerator<StreamChunk> {
  let textIndex: number | undefined
  let textValue = ''
  const reasoning = new Map<number, { index: number; text: string; item?: Record<string, unknown> }>()
  const tools = new Map<number, { index: number; id: string; name: string; arguments: string; item?: Record<string, unknown> }>()
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
  const reasoningItem = (event: Record<string, unknown>) => {
    const wireIndex = outputIndex(event)
    const item = reasoning.get(wireIndex)
    if (!item) throw new LlmError('Responses reasoning summary has no output item', 'GATEWAY_PROTOCOL')
    if (!Number.isSafeInteger(event.summary_index) || (event.summary_index as number) < 0) {
      throw new LlmError('Responses event has an invalid summary index', 'GATEWAY_PROTOCOL')
    }
    return item
  }
  const jsonItem = (value: unknown): Record<string, unknown> => {
    const snapshot = snapshotJsonValue(value)
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
      throw new LlmError('Responses output item is not lossless JSON', 'GATEWAY_PROTOCOL')
    }
    return snapshot as Record<string, unknown>
  }
  const reasoningReplayItem = (value: unknown): Record<string, unknown> | undefined => {
    const item = jsonItem(value)
    if (item.type !== 'reasoning') throw new LlmError('Responses reasoning item has an invalid type', 'GATEWAY_PROTOCOL')
    if (item.id !== undefined && (typeof item.id !== 'string' || item.id.length === 0)) {
      throw new LlmError('Responses reasoning item has an invalid id', 'GATEWAY_PROTOCOL')
    }
    if (item.encrypted_content !== undefined && typeof item.encrypted_content !== 'string') {
      throw new LlmError('Responses reasoning item has invalid encrypted content', 'GATEWAY_PROTOCOL')
    }
    if (item.content !== undefined && !Array.isArray(item.content)) {
      throw new LlmError('Responses reasoning item has invalid content', 'GATEWAY_PROTOCOL')
    }
    if (item.summary !== undefined && !Array.isArray(item.summary)) {
      throw new LlmError('Responses reasoning item has invalid summary', 'GATEWAY_PROTOCOL')
    }
    if (typeof item.id !== 'string' || typeof item.encrypted_content !== 'string'
      || item.encrypted_content.length === 0) return undefined
    return { ...item, content: item.content ?? [] }
  }
  const updateCompletedItem = (wireIndex: number, value: unknown): void => {
    const item = jsonItem(value)
    const reasoningBlock = reasoning.get(wireIndex)
    if (reasoningBlock && item.type === 'reasoning') {
      reasoningBlock.item = reasoningReplayItem(item) ?? reasoningBlock.item
      return
    }
    const call = tools.get(wireIndex)
    if (call && item.type === 'function_call') {
      const id = nonEmptyStringField(item, 'call_id')
      const name = nonEmptyStringField(item, 'name')
      const argumentsValue = stringField(item, 'arguments')
      if ((call.id && call.id !== id) || (call.name && call.name !== name)) {
        throw new LlmError('Model tool identity changed during streaming', 'GATEWAY_PROTOCOL')
      }
      call.id = id
      call.name = name
      call.arguments = argumentsValue
      call.item = item
    }
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
          name: nonEmptyStringField(item, 'name'),
          arguments: item.arguments === undefined ? '' : stringField(item, 'arguments') }
        if (tools.has(wireIndex)) throw new LlmError('Responses output item was added more than once', 'GATEWAY_PROTOCOL')
        tools.set(wireIndex, call)
        yield { type: 'block-start', index: call.index, blockType: 'tool-call' }
      } else if (item?.type === 'reasoning') {
        if (reasoning.has(wireIndex)) throw new LlmError('Responses reasoning item was added more than once', 'GATEWAY_PROTOCOL')
        const block = { index: nextIndex++, text: '', item: reasoningReplayItem(item) }
        reasoning.set(wireIndex, block)
        yield { type: 'block-start', index: block.index, blockType: 'reasoning' }
      } else if (item?.type !== 'message') {
        throw new LlmError('Responses output item type is unsupported', 'GATEWAY_PROTOCOL')
      }
    } else if (type === 'response.reasoning_summary_text.delta') {
      const item = reasoningItem(event)
      const delta = stringField(event, 'delta')
      item.text += delta
      yield { type: 'reasoning-delta', index: item.index, text: delta }
    } else if (type === 'response.reasoning_summary_part.added'
      || type === 'response.reasoning_summary_part.done'
      || type === 'response.reasoning_summary_text.done') {
      reasoningItem(event)
    } else if (type === 'response.function_call_arguments.delta') {
      const call = tools.get(outputIndex(event))
      if (!call) throw new LlmError('Model tool delta has no output item', 'GATEWAY_PROTOCOL')
      const delta = stringField(event, 'delta')
      call.arguments += delta
      yield { type: 'tool-call-delta', index: call.index, id: ToolCallId(call.id), ...(call.name ? { name: call.name } : {}), argumentsDelta: delta }
    } else if (type === 'response.output_item.done') {
      const wireIndex = outputIndex(event)
      const call = tools.get(wireIndex)
      const item = event.item && typeof event.item === 'object' ? event.item as Record<string, unknown> : undefined
      if (call && item?.type === 'function_call') {
        updateCompletedItem(wireIndex, item)
      } else if (item?.type === 'reasoning') {
        const block = reasoning.get(wireIndex)
        if (!block) {
          throw new LlmError('Responses reasoning completion has no output item', 'GATEWAY_PROTOCOL')
        }
        block.item = reasoningReplayItem(item) ?? block.item
      } else if (item?.type !== 'message') {
        throw new LlmError('Responses output completion does not match an output item', 'GATEWAY_PROTOCOL')
      }
    } else if (type === 'response.completed') {
      if (completed) throw new LlmError('Responses stream completed more than once', 'GATEWAY_PROTOCOL')
      completed = true
      const response = event.response
      const responseRecord = response && typeof response === 'object' && !Array.isArray(response)
        ? response as Record<string, unknown>
        : undefined
      const output = responseRecord?.output
      if (output !== undefined) {
        if (!Array.isArray(output)) throw new LlmError('Responses completion has invalid output items', 'GATEWAY_PROTOCOL')
        for (const [wireIndex, item] of output.entries()) {
          if (reasoning.has(wireIndex) || tools.has(wireIndex)) updateCompletedItem(wireIndex, item)
        }
      }
      const raw = responseRecord?.usage
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
    const reasoningBlock = [...reasoning.values()].find(candidate => candidate.index === index)
    if (reasoningBlock) {
      yield { type: 'block-end', index, block: { type: 'reasoning', text: reasoningBlock.text } }
      continue
    }
    const call = [...tools.values()].find(candidate => candidate.index === index)
    if (!call?.id || !call.name || call.item === undefined) throw new LlmError('Model tool identity is incomplete', 'GATEWAY_INCOMPLETE')
    yield { type: 'block-end', index: call.index, block: { type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: call.arguments } }
  }
  if (usage) yield { type: 'usage', usage }
  const blocks: GatewayResponsesReplayBlock[] = []
  for (let index = 0; index < nextIndex; index += 1) {
    if (textIndex === index) {
      blocks.push({ type: 'text' })
      continue
    }
    const reasoningBlock = [...reasoning.values()].find(candidate => candidate.index === index)
    if (reasoningBlock) {
      blocks.push({ type: 'reasoning', ...(reasoningBlock.item === undefined ? {} : { item: reasoningBlock.item }) })
      continue
    }
    const call = [...tools.values()].find(candidate => candidate.index === index)
    if (!call?.item) throw new LlmError('Model tool replay state is incomplete', 'GATEWAY_INCOMPLETE')
    blocks.push({ type: 'tool-call', item: call.item })
  }
  const response: GatewayResponsesReplayResponse = {
    kind: 'enterprise-openai-responses', version: 1, provider: route.provider, model: route.model,
  }
  const replayState: ReplayEnvelope = { response, blocks }
  yield { type: 'finish', reason: { kind: 'stop' }, replayState }
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
