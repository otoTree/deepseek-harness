/** Bounded SSE framing shared by the gateway meter and native runtime adapter. */
import { createParser } from 'eventsource-parser'
import { modelStreamChunk } from './contracts.ts'
import type { z } from 'zod'

/** Validated model delta or the explicit stream-completion marker. */
export type ModelEvent = z.infer<typeof modelStreamChunk> | '[DONE]'

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
