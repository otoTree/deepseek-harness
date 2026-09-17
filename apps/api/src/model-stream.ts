/** Bounded SSE framing shared by the gateway meter and native runtime adapter. */
import { createParser } from 'eventsource-parser'
import { modelStreamChunk } from './contracts.ts'
import { z } from 'zod'

/** Validated model delta or the explicit stream-completion marker. */
export type ModelEvent = z.infer<typeof modelStreamChunk> | '[DONE]'
/** OpenAI Responses event retained after bounded JSON validation. */
export type ResponsesModelEvent = Record<string, unknown>

/** Token totals observed without consuming or rewriting the upstream response. */
export interface ObservedModelUsage {
  promptTokens: number
  cachedPromptTokens: number
  completionTokens: number
  reasoningTokens?: number
}

function tokenCount(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Invalid Responses ${name}`)
  }
  return value as number
}

/** Validate one Responses API usage object and preserve its cache and reasoning subdivisions.
 * @param value - untrusted `response.usage` value.
 * @returns normalized aggregate token counts.
 */
export function parseResponsesUsage(value: unknown): ObservedModelUsage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Responses usage')
  }
  const usage = value as Record<string, unknown>
  const promptTokens = tokenCount(usage.input_tokens, 'input token count')
  const completionTokens = tokenCount(usage.output_tokens, 'output token count')
  const inputDetails = usage.input_tokens_details
  const outputDetails = usage.output_tokens_details
  const cachedPromptTokens = inputDetails === undefined
    ? 0
    : inputDetails !== null && typeof inputDetails === 'object' && !Array.isArray(inputDetails)
      ? tokenCount((inputDetails as Record<string, unknown>).cached_tokens ?? 0, 'cached input token count')
      : tokenCount(undefined, 'cached input token count')
  const reasoningTokens = outputDetails === undefined
    ? undefined
    : outputDetails !== null && typeof outputDetails === 'object' && !Array.isArray(outputDetails)
      ? tokenCount((outputDetails as Record<string, unknown>).reasoning_tokens ?? 0, 'reasoning token count')
      : tokenCount(undefined, 'reasoning token count')
  if (cachedPromptTokens > promptTokens || (reasoningTokens !== undefined && reasoningTokens > completionTokens)) {
    throw new Error('Responses usage subdivisions exceed their token totals')
  }
  if (usage.total_tokens !== undefined
    && tokenCount(usage.total_tokens, 'total token count') !== promptTokens + completionTokens) {
    throw new Error('Responses total token count is inconsistent')
  }
  return {
    promptTokens,
    cachedPromptTokens,
    completionTokens,
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  }
}

const RESPONSES_EVENTS = new Set([
  'response.created', 'response.in_progress',
  'response.output_item.added', 'response.output_item.done',
  'response.content_part.added', 'response.content_part.done',
  'response.output_text.delta', 'response.output_text.done',
  'response.reasoning_summary_part.added', 'response.reasoning_summary_part.done',
  'response.reasoning_summary_text.delta', 'response.reasoning_summary_text.done',
  'response.function_call_arguments.delta', 'response.function_call_arguments.done',
  'response.completed', 'response.failed', 'response.incomplete', 'response.cancelled',
])

function knownResponsesEvent(type: string): boolean {
  return RESPONSES_EVENTS.has(type) || type === 'error'
}

/** Incremental SSE meter whose parse failures never affect response forwarding. */
export interface ModelUsageObserver {
  /** Observe another unmodified response fragment.
   * @param bytes - response bytes to inspect.
   * @returns the final token totals when this fragment contains the completion marker.
   */
  feed(bytes: Uint8Array): ObservedModelUsage | undefined
  /** Return usage only after a valid completion marker.
   * @returns the final reported token totals, or `undefined` for an incomplete or invalid stream.
   */
  finish(): ObservedModelUsage | undefined
}

/**
 * Observe OpenAI-compatible usage without owning the response byte stream.
 *
 * @param maxEventChars - maximum buffered SSE record characters.
 * @returns an observer that reports only a valid, completed stream.
 */
export function createModelUsageObserver(maxEventChars: number): ModelUsageObserver {
  let invalid = false
  let done = false
  let finalized = false
  let result: ObservedModelUsage | undefined
  let usage: ObservedModelUsage | undefined
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const parser = createParser({
    maxBufferSize: maxEventChars,
    onEvent: (event) => {
      if (done) return
      if (event.data.length > maxEventChars) {
        invalid = true
        return
      }
      if (event.data === '[DONE]') {
        done = true
        result = invalid ? undefined : usage
        return
      }
      try {
        const raw = JSON.parse(event.data) as unknown
        const chunk = modelStreamChunk.safeParse(raw)
        if (!chunk.success) {
          const response = z.looseObject({ type: z.string() }).safeParse(raw)
          if (!response.success || !knownResponsesEvent(response.data.type)) { invalid = true; return }
          const body = response.data.response
          const responseUsage = body && typeof body === 'object' && 'usage' in body ? (body as Record<string, unknown>).usage : undefined
          if (responseUsage !== undefined) usage = parseResponsesUsage(responseUsage)
          if (response.data.type === 'response.failed' || response.data.type === 'response.incomplete'
            || response.data.type === 'response.cancelled' || response.data.type === 'error') {
            invalid = true
            done = true
            result = undefined
          } else if (response.data.type === 'response.completed') {
            done = true
            result = invalid ? undefined : usage
          }
          return
        }
        const parsed = chunk.data
        if (parsed.usage) {
          const cachedPromptTokens = parsed.usage.prompt_tokens_details?.cached_tokens
            ?? parsed.usage.prompt_cache_hit_tokens
            ?? 0
          if (cachedPromptTokens > parsed.usage.prompt_tokens) {
            invalid = true
            return
          }
          const reasoningTokens = parsed.usage.completion_tokens_details?.reasoning_tokens
          if (reasoningTokens !== undefined && reasoningTokens > parsed.usage.completion_tokens) {
            invalid = true
            return
          }
          usage = {
            promptTokens: parsed.usage.prompt_tokens,
            cachedPromptTokens,
            completionTokens: parsed.usage.completion_tokens,
            ...(reasoningTokens === undefined
              ? {}
              : { reasoningTokens }),
          }
        }
      } catch {
        invalid = true
      }
    },
    onError: () => { if (!done) invalid = true },
  })
  return {
    feed(bytes) {
      if (invalid || finalized) return undefined
      if (done) return undefined
      try {
        parser.feed(decoder.decode(bytes, { stream: true }))
      } catch {
        invalid = true
      }
      return result
    },
    finish() {
      if (finalized) return result
      finalized = true
      if (!invalid && !done) {
        try {
          parser.feed(decoder.decode())
        } catch {
          invalid = true
        }
      }
      if (!done) result = undefined
      return result
    },
  }
}

/** Decode complete SSE records without exposing malformed upstream text in errors.
 * @param bytes - owned response byte iterator; early completion closes it.
 * @param maxEventChars - maximum buffered SSE record characters.
 * @returns Validated events ending at the mandatory completion marker.
 */
export async function* modelEvents(bytes: AsyncIterable<Uint8Array>, maxEventChars: number): AsyncGenerator<ModelEvent> {
  const pending: string[] = []
  const parser = createParser({
    maxBufferSize: maxEventChars,
    onEvent: (event) => { pending.push(event.data) },
    onError: () => { throw new Error('Invalid model event framing') },
  })
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for await (const chunk of bytes) {
    parser.feed(decoder.decode(chunk, { stream: true }))
    for (const data of pending.splice(0)) {
      if (data.length > maxEventChars) throw new Error('Model event exceeds limit')
      if (data === '[DONE]') { yield data; return }
      let event: ModelEvent
      try { event = modelStreamChunk.parse(JSON.parse(data)) } catch {
        throw new Error('Invalid model event fields')
      }
      yield event
    }
  }
  throw new Error('Model stream ended without completion')
}

/** Decode OpenAI Responses SSE records with bounded framing and no payload reflection. */
export async function* responseModelEvents(bytes: AsyncIterable<Uint8Array>, maxEventChars: number): AsyncGenerator<ResponsesModelEvent> {
  const pending: string[] = []
  const parser = createParser({
    maxBufferSize: maxEventChars,
    onEvent: event => pending.push(event.data),
    onError: () => { throw new Error('Invalid model event framing') },
  })
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for await (const chunk of bytes) {
    parser.feed(decoder.decode(chunk, { stream: true }))
    for (const data of pending.splice(0)) {
      if (data.length > maxEventChars) throw new Error('Model event exceeds limit')
      let value: unknown
      try { value = JSON.parse(data) } catch { throw new Error('Invalid model event fields') }
      const event = z.looseObject({ type: z.string().min(1) }).safeParse(value)
      if (!event.success || !knownResponsesEvent(event.data.type)) throw new Error('Invalid model event fields')
      yield event.data
      if (event.data.type === 'response.completed' || event.data.type === 'response.failed'
        || event.data.type === 'response.incomplete' || event.data.type === 'response.cancelled'
        || event.data.type === 'error') return
    }
  }
  throw new Error('Model stream ended without completion')
}
