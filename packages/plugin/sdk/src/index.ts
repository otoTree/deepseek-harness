/** Author-facing SDK facade backed by an installation-scoped capability transport. */
import type {
  PluginCache, PluginCapabilityTransport, PluginDatabase, PluginIdentity, PluginModelDescriptor,
  PluginModelId, PluginObjects, PluginSdk, PluginTextMessage, PluginTextResult, PluginUsage,
  PluginErrorCode,
} from '@deepseek-ai/dsh-plugin-protocol'
export type * from '@deepseek-ai/dsh-plugin-protocol'

/** Stable error returned by an installation-scoped capability call. */
export class PluginSdkError extends Error {
  /** Stable platform error code. */
  readonly code: PluginErrorCode
  /** HTTP status returned by the capability endpoint. */
  readonly status: number

  constructor(code: PluginErrorCode, message: string, status: number) {
    super(message)
    this.name = 'PluginSdkError'
    this.code = code
    this.status = status
  }
}

/** Create the standard HTTP transport used by Host bridges and browser-side test clients.
 * @param options Activation URL, credential, and optional fetch implementation.
 * @returns A capability transport that maps failed responses to `PluginSdkError`.
 */
export function createHttpPluginTransport(options: {
  readonly baseUrl: string
  readonly activationId: string
  readonly token: string
  readonly fetch?: typeof globalThis.fetch
}): PluginCapabilityTransport {
  const request = options.fetch ?? globalThis.fetch
  const call = async <T>(operation: string, input: unknown, signal?: AbortSignal): Promise<T> => {
    const response = await request(`${options.baseUrl.replace(/\/$/u, '')}/v1/plugin-runtime/${encodeURIComponent(options.activationId)}/${encodeURIComponent(operation)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      let message = detail || `plugin request failed (${response.status})`
      let code: PluginErrorCode = response.status === 401 || response.status === 403 ? 'plugin/unauthorized' : 'plugin/internal'
      try {
        const parsed = JSON.parse(detail) as { error?: { code?: unknown; message?: unknown }; message?: unknown }
        const candidate = parsed.error?.code ?? parsed.message
        if (typeof candidate === 'string' && candidate.startsWith('plugin/')) code = candidate as PluginErrorCode
        if (typeof parsed.error?.message === 'string') message = parsed.error.message
        else if (typeof parsed.message === 'string') message = parsed.message
      } catch { /* The response may be plain text from a proxy. */ }
      throw new PluginSdkError(code, message, response.status)
    }
    return await response.json() as T
  }
  const stream = <T>(operation: string, input: unknown, signal?: AbortSignal): AsyncIterable<T> => ({
    async *[Symbol.asyncIterator]() {
      const response = await request(`${options.baseUrl.replace(/\/$/u, '')}/v1/plugin-runtime/${encodeURIComponent(options.activationId)}/${encodeURIComponent(operation)}`, {
        method: 'POST', headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), ...(signal === undefined ? {} : { signal }),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new PluginSdkError(response.status === 401 || response.status === 403 ? 'plugin/unauthorized' : 'plugin/internal', detail || `plugin request failed (${response.status})`, response.status)
      }
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      if (!contentType.startsWith('text/event-stream') || response.body === null) { yield await response.json() as T; return }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const chunk = await reader.read()
        buffer += decoder.decode(chunk.value, { stream: !chunk.done })
        const lines = buffer.split(/\r?\n/u)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const value = line.slice(5).trim()
          if (value === '[DONE]') { yield { done: true } as T; return }
          try {
            const parsed = JSON.parse(value) as {
              choices?: readonly { delta?: { content?: unknown }; message?: { content?: unknown } }[]
              usage?: PluginUsage
            }
            const choice = parsed.choices?.[0]
            const text = typeof choice?.delta?.content === 'string' ? choice.delta.content : typeof choice?.message?.content === 'string' ? choice.message.content : ''
            yield { text, done: false, ...(parsed.usage === undefined ? {} : { usage: parsed.usage }) } as T
          } catch { /* Ignore provider keep-alive and malformed event lines. */ }
        }
        if (chunk.done) break
      }
      yield { done: true } as T
    },
  })
  return { call, stream }
}

function encodeBytes(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

/** Create one installation-scoped SDK. The transport owns authentication and revocation checks.
 * @param transport Installation-scoped capability transport.
 * @returns Author-facing identity, model, object, database, and cache facades.
 */
export function createPluginSdk(transport: PluginCapabilityTransport): PluginSdk {
  const identity = {
    current: (signal?: AbortSignal) => transport.call<PluginIdentity>('identity.current', {}, signal),
  }
  const models = {
    list: (signal?: AbortSignal) => transport.call<readonly PluginModelDescriptor[]>('models.list', {}, signal),
    text: (input: {
      readonly modelId: PluginModelId
      readonly messages: readonly PluginTextMessage[]
      readonly idempotencyKey: string
    }, signal?: AbortSignal) =>
      transport.call<PluginTextResult>('models.text', input, signal),
    textStream: (input: {
      readonly modelId: PluginModelId
      readonly messages: readonly PluginTextMessage[]
      readonly idempotencyKey: string
    }, signal?: AbortSignal) =>
      transport.stream<{ readonly text: string; readonly done: boolean; readonly usage?: PluginUsage }>('models.text.stream', input, signal),
  }
  const objects: PluginObjects = {
    put: (input, signal) => transport.call('objects.put', {
      ...input,
      content: encodeBytes(input.content),
    }, signal),
    read: async (objectId, options, signal) => {
      const result = await transport.call<{ readonly bytes?: string; readonly content?: number[] }>('objects.read', { objectId, ...options }, signal)
      if (result.bytes !== undefined) return decodeBytes(result.bytes)
      return Uint8Array.from(result.content ?? [])
    },
    listVersions: (objectId, signal) => transport.call('objects.listVersions', { objectId }, signal),
    delete: (objectId, options, signal) => transport.call('objects.delete', { objectId, ...options }, signal),
  }
  const database: PluginDatabase = {
    query: (sql, params, signal) => transport.call('database.query', { sql, params }, signal),
    transaction: (statements, signal) => transport.call('database.transaction', { statements }, signal),
  }
  const cache: PluginCache = {
    get: (key, signal) => transport.call('cache.get', { key }, signal),
    set: (key, value, options, signal) => transport.call('cache.set', { key, value, ...options }, signal),
    delete: (key, signal) => transport.call('cache.delete', { key }, signal),
    increment: (key, amount, options, signal) => transport.call('cache.increment', { key, amount, ...options }, signal),
  }
  return { identity, models, objects, database, cache }
}
