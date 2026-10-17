/** Author-facing SDK facade backed by an installation-scoped capability transport. */
import type {
  PluginCache, PluginCapabilityTransport, PluginDatabase, PluginIdentity, PluginModelDescriptor,
  PluginModelId, PluginModelTask, PluginModelTaskPreview, PluginObjects, PluginSdk, PluginTextMessage, PluginTextResult, PluginUsage,
  PluginErrorCode, PluginCredentialDescriptor, PluginMcpServer, PluginMcpTool, PluginSkill, PluginHttpResponse,
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
      const decoder = new TextDecoder('utf-8', { fatal: true })
      let buffer = ''
      let data: string[] = []
      let eventChars = 0
      let completed = false
      try {
        while (true) {
          const chunk = await reader.read()
          buffer += decoder.decode(chunk.value, { stream: !chunk.done })
          if (buffer.length > 1_048_576) throw new PluginSdkError('plugin/internal', 'Plugin stream event exceeds limit', 502)
          const lines = buffer.split(/\r?\n/u)
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            eventChars += line.length
            if (eventChars > 1_048_576) throw new PluginSdkError('plugin/internal', 'Plugin stream event exceeds limit', 502)
            if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
            if (line !== '') continue
            eventChars = 0
            if (!data.length) continue
            const value: unknown = JSON.parse(data.join('\n'))
            data = []
            if (!value || typeof value !== 'object') throw new PluginSdkError('plugin/internal', 'Invalid plugin stream event', 502)
            if ('error' in value) throw new PluginSdkError('plugin/internal', 'Plugin model stream failed', 502)
            if (!('text' in value) || typeof value.text !== 'string' || !('done' in value) || typeof value.done !== 'boolean') {
              throw new PluginSdkError('plugin/internal', 'Invalid plugin stream event', 502)
            }
            completed = value.done
            yield value as T
            if (completed) return
          }
          if (chunk.done) break
        }
        throw new PluginSdkError('plugin/internal', 'Plugin stream ended without completion', 502)
      } finally { await reader.cancel(); reader.releaseLock() }
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
    list: (options: Parameters<PluginSdk['models']['list']>[0] = {}, signal?: AbortSignal) => transport.call<readonly PluginModelDescriptor[]>('models.list', options, signal),
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
    previewTask: (input: Parameters<PluginSdk['models']['previewTask']>[0], signal?: AbortSignal) =>
      transport.call<PluginModelTaskPreview>('models.task.preview', input, signal),
    uploadAsset: (input: Parameters<PluginSdk['models']['uploadAsset']>[0], signal?: AbortSignal) =>
      transport.call<Awaited<ReturnType<PluginSdk['models']['uploadAsset']>>>('models.asset.upload', { ...input, content: encodeBytes(input.content) }, signal),
    assetAccess: (input: Parameters<PluginSdk['models']['assetAccess']>[0], signal?: AbortSignal) =>
      transport.call<Awaited<ReturnType<PluginSdk['models']['assetAccess']>>>('models.asset.access', input, signal),
    createTask: (input: Parameters<PluginSdk['models']['createTask']>[0], signal?: AbortSignal) =>
      transport.call<PluginModelTask>('models.task.create', input, signal),
    queryTask: (input: Parameters<PluginSdk['models']['queryTask']>[0], signal?: AbortSignal) =>
      transport.call<PluginModelTask>('models.task.query', input, signal),
    listTasks: (signal?: AbortSignal) =>
      transport.call<readonly PluginModelTask[]>('models.task.list', {}, signal),
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
  const network = {
    request: (input: {
      readonly url: string
      readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
      readonly headers?: Readonly<Record<string, string>>
      readonly body?: string
      readonly timeoutMs?: number
      readonly maxResponseBytes?: number
    }, signal?: AbortSignal) => transport.call<PluginHttpResponse>('network.http', input, signal),
  }
  const credentials = {
    get: (name: string, signal?: AbortSignal) => transport.call<string | undefined>('credentials.get', { name }, signal),
    set: (name: string, value: string, signal?: AbortSignal) => transport.call<void>('credentials.set', { name, value }, signal),
    delete: (name: string, signal?: AbortSignal) => transport.call<void>('credentials.delete', { name }, signal),
    list: (signal?: AbortSignal) => transport.call<readonly PluginCredentialDescriptor[]>('credentials.list', {}, signal),
  }
  const authorization = {
    begin: (input: { readonly kind: 'oauth' | 'api-key' | 'device-code'; readonly provider: string; readonly scopes?: readonly string[]; readonly metadata?: Readonly<Record<string, string>> }, signal?: AbortSignal) =>
      transport.call<{ readonly authorizationId: string; readonly url?: string; readonly userCode?: string }>('authorization.begin', input, signal),
    complete: (authorizationId: string, input?: Readonly<Record<string, string>>, signal?: AbortSignal) =>
      transport.call<{ readonly completed: boolean }>('authorization.complete', { authorizationId, input }, signal),
  }
  const mcp = {
    connect: (input: { readonly id: string; readonly url: string; readonly transport?: 'streamable-http' | 'sse' }, signal?: AbortSignal) =>
      transport.call<PluginMcpServer>('mcp.connect', input, signal),
    disconnect: (id: string, signal?: AbortSignal) => transport.call<void>('mcp.disconnect', { id }, signal),
    listTools: (id: string, signal?: AbortSignal) => transport.call<readonly PluginMcpTool[]>('mcp.listTools', { id }, signal),
    call: (input: { readonly serverId: string; readonly tool: string; readonly arguments: Readonly<Record<string, unknown>> },
      signal?: AbortSignal) =>
      transport.call<unknown>('mcp.call', input, signal),
  }
  const skills = {
    register: (skill: PluginSkill, signal?: AbortSignal) => transport.call<void>('skills.register', skill, signal),
    unregister: (id: string, signal?: AbortSignal) => transport.call<void>('skills.unregister', { id }, signal),
    list: (signal?: AbortSignal) => transport.call<readonly PluginSkill[]>('skills.list', {}, signal),
  }
  const config = {
    get: <T = unknown>(key: string, signal?: AbortSignal) => transport.call<T | undefined>('config.get', { key }, signal),
    set: <T = unknown>(key: string, value: T, signal?: AbortSignal) => transport.call<void>('config.set', { key, value }, signal),
    delete: (key: string, signal?: AbortSignal) => transport.call<void>('config.delete', { key }, signal),
  }
  return { identity, models, objects, database, cache, network, credentials, authorization, mcp, skills, config }
}
