/** Translate structured OS messages and committed Arivo events without changing the Agent loop. */
import { createHash } from 'node:crypto'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ArivoLanguageInput, ArivoLanguageEvent } from './language-wire.ts'

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const routePattern = new RegExp(`^(${uuid})/(${uuid})/(${uuid})$`, 'i')

/** Parse an explicit workspace/project/adapter model route from persisted OS settings.
 * @param model - Account-owned route selected through Arivo controls.
 * @returns Separate cloud identifiers for native authorization and billing.
 */
export function arivoModelRoute(model: string): { cloudWorkspaceId: string; cloudProjectId: string; adapterId: string } {
  const match = routePattern.exec(model)
  const [, workspace, project, adapter] = match ?? []
  if (!workspace || !project || !adapter) throw new LlmError('Select an Arivo project and language model.', 'ARIVO_MODEL_REQUIRED')
  return { cloudWorkspaceId: workspace.toLowerCase(), cloudProjectId: project.toLowerCase(), adapterId: adapter.toLowerCase() }
}

/** Derive one UUID from a persisted logical step rather than minting a new submission on retry.
 * @param sessionId - Durable OS Session identity.
 * @param stepId - Durable step or auxiliary-call identity within that Session.
 * @returns A stable version-eight UUID accepted by the native command API.
 */
export function arivoStepCommand(sessionId: string, stepId: string): string {
  const bytes = createHash('sha256').update(JSON.stringify(['arivo-agent-step-v1', sessionId, stepId])).digest().subarray(0, 16)
  bytes.writeUInt8((bytes.readUInt8(6) & 15) | 128, 6)
  bytes.writeUInt8((bytes.readUInt8(8) & 63) | 128, 8)
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function text(blocks: ContentBlock[]): { type: 'text'; text: string }[] {
  return blocks.map((block) => {
    if (block.type !== 'text') throw new LlmError('This Arivo model accepts text and function tools.', 'UNSUPPORTED_OPTION')
    return { type: 'text', text: block.text }
  })
}

/** Preserve message order, parallel tool correlation and raw argument JSON. Reasoning is display-only.
 * @param options - Frozen model request assembled and logged by the original OS.
 * @returns Strict v1 text/function input; unsupported media or options fail before admission.
 */
export function arivoLanguageInput(options: GenerateOptions): ArivoLanguageInput {
  if (options.stop !== undefined || options.reasoningEffort !== undefined || options.maxTokens === undefined) {
    throw new LlmError('Unsupported Arivo language request option.', 'UNSUPPORTED_OPTION')
  }
  const messages: ArivoLanguageInput['messages'] = []
  if (options.system !== undefined && options.system !== '') messages.push({ role: 'system', content: [{ type: 'text', text: options.system }] })
  for (const message of options.messages) {
    if (message.role === 'assistant') {
      const content = message.content.filter(block => block.type !== 'reasoning').map((block) => {
        if (block.type === 'text') return { type: 'text' as const, text: block.text }
        if (block.type === 'tool-call') return { type: 'tool-call' as const, id: String(block.id), name: block.name, arguments: block.arguments }
        throw new LlmError('Unsupported Arivo assistant content.', 'UNSUPPORTED_OPTION')
      })
      if (content.length) messages.push({ role: 'assistant', content })
    } else if (message.role === 'system') messages.push({ role: 'system', content: text(message.content) })
    else {
      // A message may mix user text and tool results; keep each correlated result in its original position.
      let pending: { type: 'text'; text: string }[] = []
      const flush = () => { if (pending.length) { messages.push({ role: 'user', content: pending }); pending = [] } }
      for (const block of message.content) {
        if (block.type === 'text') pending.push({ type: 'text', text: block.text })
        else if (block.type === 'tool-result') {
          flush()
          const content = text(block.content)
          if (block.isError) content.unshift({ type: 'text', text: '[tool_error]' })
          messages.push({ role: 'tool', toolCallId: String(block.toolCallId), content: content.length ? content : [{ type: 'text', text: '' }] })
        } else throw new LlmError('Unsupported Arivo user content.', 'UNSUPPORTED_OPTION')
      }
      flush()
    }
  }
  return { protocolVersion: 1, messages, tools: options.tools ?? [], maxOutputTokens: options.maxTokens,
    ...options.temperature === undefined ? {} : { temperature: options.temperature } }
}

function toolId(callId: string, id: string) {
  return ToolCallId(`arivo_${createHash('sha256').update(JSON.stringify([callId, id])).digest('hex')}`)
}

/** Project one validated event. Tool IDs are namespaced per cloud call to survive provider ID reuse.
 * @param value - Event persisted and gated by the account-owned native plugin.
 * @returns OS stream chunk, or undefined when an incomplete usage snapshot cannot be represented.
 */
export function arivoLanguageChunk(value: ArivoLanguageEvent): StreamChunk | undefined {
  const event = value.event
  switch (event.type) {
    case 'block-start': return { type: 'block-start', index: event.index, blockType: event.kind }
    case 'text-delta': case 'reasoning-delta': return { ...event }
    case 'tool-call-delta': return { type: 'tool-call-delta', index: event.index, id: toolId(value.callId, event.id), name: event.name, argumentsDelta: event.arguments }
    case 'block-end': return { type: 'block-end', index: event.index, block: event.block.type === 'tool-call'
      ? { ...event.block, id: toolId(value.callId, event.block.id) } : event.block }
    case 'usage': {
      const { inputTokens, outputTokens } = event.usage
      if (inputTokens === undefined || outputTokens === undefined) return undefined
      return { type: 'usage', usage: { ...event.usage, inputTokens, outputTokens } }
    }
    case 'finish': return { type: 'finish', reason: event.reason === 'error' || event.reason === 'aborted'
      ? { kind: event.reason, failure: { code: 'ARIVO_MODEL_' + event.reason.toUpperCase(), message: 'Arivo model execution did not complete.' } }
      : { kind: event.reason } }
    default: return assertNever(event, 'Arivo language event')
  }
}
