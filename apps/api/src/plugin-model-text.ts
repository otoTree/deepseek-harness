/** Text plugin projection over the metered relay and its durable usage records. */
import { and, eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import type { Hono } from 'hono'
import { createParser } from 'eventsource-parser'
import { z } from 'zod'
import * as s from './schema.ts'
import { resourceId } from './contracts.ts'
import { selectOrganization } from './database.ts'
import type { ApiEnv, Services } from './application.ts'
import type { InternalRelayAuthority, InternalRelayRuntime } from './internal-relay.ts'

const textInput = z.object({ modelId: resourceId,
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(128_000) }).strict()).min(1).max(256),
  idempotencyKey: z.string().min(16).max(128),
}).strict()

/** Invoke the selected text protocol and expose platform accounting after consumption.
 * @param app Metered relay application.
 * @param services Database and configured stream limits.
 * @param relay One-use internal authorization.
 * @param runtime Verified installation identity.
 * @param raw Untrusted plugin input.
 * @param streaming Whether to return canonical SSE deltas.
 * @param signal Caller cancellation.
 * @returns Text or canonical SSE with the durable usage projection.
 */
export async function executePluginText(app: Hono<ApiEnv>, services: Services, relay: InternalRelayAuthority,
  runtime: InternalRelayRuntime, raw: unknown, streaming: boolean, signal: AbortSignal): Promise<Response> {
  const installationId = runtime.pluginInstallationId
  if (!installationId) throw new Error('Plugin text requires an installation')
  const input = textInput.parse(raw)
  const protocol = await services.db.transaction(async (tx) => {
    await selectOrganization(tx, runtime.organizationId)
    const [model] = await tx.select().from(s.models).where(and(eq(s.models.id, input.modelId), eq(s.models.enabled, true)))
    if (!model || !model.operations.includes('text.generate')) throw new HTTPException(409, { message: 'plugin/model-unavailable' })
    if (model.protocol !== 'openai-completions' && model.protocol !== 'openai-responses') {
      throw new HTTPException(409, { message: 'plugin/model-protocol-unsupported' })
    }
    return model.protocol
  })
  const accounting = () => services.db.transaction(async (tx) => {
    await selectOrganization(tx, runtime.organizationId)
    const [usage] = await tx.select().from(s.usage).where(and(eq(s.usage.organizationId, runtime.organizationId),
      eq(s.usage.accountId, runtime.accountId), eq(s.usage.pluginInstallationId, installationId),
      eq(s.usage.idempotencyKey, input.idempotencyKey)))
    if (!usage) throw new Error('Plugin model usage record is unavailable')
    return { callId: usage.id, status: usage.status, inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens, totalCostMicrosCny: usage.totalCostMicrosCny }
  })
  const grant = relay.issue({ ...runtime, pluginCallId: input.idempotencyKey })
  let response: Response
  try {
    response = await app.request(new URL(protocol === 'openai-responses' ? '/model/responses' : '/model/chat/completions',
      services.config.apiUrl), {
      method: 'POST', signal, headers: { ...grant.headers, 'Content-Type': 'application/json', 'X-DSH-Model': input.modelId,
        'X-DSH-Purpose': 'plugin_model', 'Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify(protocol === 'openai-responses'
        ? { model: input.modelId, input: input.messages.map(message => ({ role: message.role, content: message.content })),
          stream: streaming }
        : { model: input.modelId, messages: input.messages, stream: streaming,
          ...(streaming ? { stream_options: { include_usage: true } } : {}) }),
    })
  } finally { grant.revoke() }
  if (!response.ok) { await response.body?.cancel(); throw new HTTPException(409, { message: 'plugin/model-failed' }) }
  if (!streaming) {
    const value = z.record(z.string(), z.unknown()).parse(await response.json())
    const text = protocol === 'openai-responses'
      ? z.object({ output: z.array(z.object({ content: z.array(z.object({ type: z.string(),
        text: z.string().optional() })).optional() })).optional() }).parse(value)
        .output?.flatMap(item => item.content ?? []).filter(item => item.type === 'output_text').map(item => item.text ?? '').join('') ?? ''
      : z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })) }).parse(value).choices[0]?.message.content ?? ''
    return Response.json({ text, usage: await accounting() })
  }
  if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
    await response.body?.cancel()
    throw new HTTPException(409, { message: 'plugin/model-stream-invalid' })
  }
  const reader = response.body.getReader()
  const events = async function* () {
    const state = { terminal: false, failed: false }
    const pending: string[] = []
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const parser = createParser({ maxBufferSize: services.config.modelUsageMaxEventChars,
      onError: () => { throw new Error('Invalid plugin model stream') },
      onEvent: (event) => {
        if (state.terminal) return
        if (event.data === '[DONE]') { state.terminal = true; return }
        const value = z.record(z.string(), z.unknown()).parse(JSON.parse(event.data))
        if (protocol === 'openai-responses') {
          if (value.type === 'response.output_text.delta') pending.push(z.string().parse(value.delta))
          if (value.type === 'response.completed') state.terminal = true
          if (['response.failed', 'response.cancelled', 'response.incomplete',
            'error'].includes(String(value.type))) { state.failed = true; state.terminal = true }
        } else {
          const chunk = z.object({ choices: z.array(z.object({
            delta: z.object({ content: z.string().nullable().optional() }).optional(),
          })).optional() }).parse(value)
          const content = chunk.choices?.[0]?.delta?.content
          if (content) pending.push(content)
        }
      } })
    const encode = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)
    try {
      while (true) {
        const chunk = await reader.read()
        parser.feed(decoder.decode(chunk.value, { stream: !chunk.done }))
        for (const text of pending.splice(0)) yield encode({ text, done: false })
        if (chunk.done) break
      }
      if (!state.terminal || state.failed) throw new Error('Plugin model stream did not complete')
      yield encode({ text: '', done: true, usage: await accounting() })
    } catch {
      yield encode({ error: { code: 'plugin/model-stream-failed' } })
    } finally { await reader.cancel(); reader.releaseLock() }
  }
  const iterator = events()
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) { const item = await iterator.next(); if (item.done) controller.close(); else controller.enqueue(item.value) },
    async cancel() { await reader.cancel(); await iterator.return(undefined) },
  }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}
