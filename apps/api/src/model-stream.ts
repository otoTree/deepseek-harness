/** Bounded SSE framing shared by the gateway meter and native runtime adapter. */
import { createParser } from 'eventsource-parser'
import { modelStreamChunk } from './contracts.ts'
import type { z } from 'zod'

/** Validated model delta or the explicit stream-completion marker. */
export type ModelEvent = z.infer<typeof modelStreamChunk> | '[DONE]'

/** Token totals observed without consuming or rewriting the upstream response. */
export interface ObservedModelUsage {
  promptTokens: number
  cachedPromptTokens: number
  completionTokens: number
  reasoningTokens?: number
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
        const chunk = modelStreamChunk.parse(JSON.parse(event.data))
        if (chunk.usage) {
          const cachedPromptTokens = chunk.usage.prompt_tokens_details?.cached_tokens
            ?? chunk.usage.prompt_cache_hit_tokens
            ?? 0
          if (cachedPromptTokens > chunk.usage.prompt_tokens) {
            invalid = true
            return
          }
          const reasoningTokens = chunk.usage.completion_tokens_details?.reasoning_tokens
          if (reasoningTokens !== undefined && reasoningTokens > chunk.usage.completion_tokens) {
            invalid = true
            return
          }
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            cachedPromptTokens,
            completionTokens: chunk.usage.completion_tokens,
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
