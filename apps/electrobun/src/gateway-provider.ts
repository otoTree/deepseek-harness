/** DSH-native enterprise model provider; only the trusted native host reads runtime credentials. */
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmError, attributionHeaders, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { desktopCredential, modelCall, modelCatalog, runtimeHeartbeat } from '@deepseek-ai/dsh-enterprise-api/contracts'
import { modelEvents } from '@deepseek-ai/dsh-enterprise-api/model-stream'
import { z } from 'zod'
import { deploymentUrl } from './desktop-auth.ts'
import { DesktopKeychain } from './keychain.ts'
import { gatewayMessages, gatewayChunks } from './gateway-wire.ts'

export const name = 'enterprise-gateway'
export const inject = ['llm']
export const Config = z.object({
  apiUrl: z.string().transform(value => deploymentUrl(value).origin),
  keychainHelper: z.string().refine(isAbsolute), keychainAccount: z.string().min(1),
  requestTimeoutMs: z.number().int().min(1).max(600000),
  maxEventChars: z.number().int().min(1024).max(2097152),
  maxResponseChars: z.number().int().min(1024).max(16777216),
}).strict()
type Settings = z.infer<typeof Config>
const storedCredential = desktopCredential.extend({ apiOrigin: z.string() })
type Credential = z.infer<typeof storedCredential>
type Request = (url: URL, init: RequestInit) => Promise<Response>

// Profiles created before an organization receives its first grant retain this
// sentinel. It is resolved against the live organization catalog so a running
// desktop does not require a restart after an administrator authorizes a model.
const UNCONFIGURED_MODEL = 'enterprise-unconfigured'

/** Native I/O dependencies; the plugin binds these to Keychain and fetch, not model/tool input. */
export interface GatewayDependencies {
  readCredential: () => Promise<string | undefined>
  request: Request
}

async function* responseBytes(response: Response): AsyncGenerator<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) throw new LlmError('Gateway response has no body', 'GATEWAY_PROTOCOL')
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) return
      yield item.value
    }
  } finally { await reader.cancel(); reader.releaseLock() }
}

/** Native LLM adapter with a server-authorized directory and no local credential fallback. */
export class EnterpriseGatewayAdapter extends LlmAdapter {
  private readonly settings: Settings
  constructor(settings: Settings, private readonly io: GatewayDependencies) {
    super()
    this.settings = Config.parse(settings)
  }

  override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'enterprise.retryPolicy') }

  private async credential(): Promise<Credential> {
    let credential: Credential
    try { credential = storedCredential.parse(JSON.parse(await this.io.readCredential() ?? 'null')) } catch {
      throw new LlmError('Enterprise device credential is unavailable', 'GATEWAY_AUTH')
    }
    const account = createHash('sha256').update(this.settings.apiUrl).digest('hex') + ':' + credential.organizationId + ':' + credential.runtimeId
    if (credential.apiOrigin !== this.settings.apiUrl || account !== this.settings.keychainAccount) {
      throw new LlmError('Enterprise device credential does not match this deployment', 'GATEWAY_AUTH')
    }
    return credential
  }

  private async request(credential: Credential, path: string, signal: AbortSignal, body?: unknown, key?: string) {
    const response = await this.io.request(new URL(`/v1/organizations/${credential.organizationId}/${path}`, this.settings.apiUrl), {
      method: body === undefined ? 'GET' : 'POST', signal, redirect: 'error',
      headers: { ...attributionHeaders(), Authorization: 'Bearer ' + credential.token, 'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new LlmError('Enterprise gateway refused the request', 'GATEWAY_REFUSED', { status: response.status })
    }
    return response
  }

  private async json(response: Response): Promise<unknown> {
    let size = 0
    const chunks: Uint8Array[] = []
    for await (const bytes of responseBytes(response)) {
      size += bytes.length
      if (size > this.settings.maxResponseChars) throw new LlmError('Gateway directory exceeds limit', 'GATEWAY_LIMIT')
      chunks.push(bytes)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown } catch {
      throw new LlmError('Gateway directory is invalid', 'GATEWAY_PROTOCOL')
    }
  }

  private async directory(signal: AbortSignal) {
    const credential = await this.credential()
    signal.throwIfAborted()
    const lease = runtimeHeartbeat.parse(await this.json(await this.request(credential, `runtimes/${credential.runtimeId}/heartbeat`, signal, {})))
    if (Date.parse(lease.leaseUntil) <= Date.now()) throw new LlmError('Enterprise runtime lease expired', 'GATEWAY_AUTH')
    const models = modelCatalog.parse(await this.json(await this.request(credential, 'models', signal)))
    return { credential, lease, models }
  }

  private signal(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.settings.requestTimeoutMs)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private metadata(model: z.infer<typeof modelCatalog>[number], requestedId: string = model.id): LlmResolvedModelInfo {
    return { provider: 'enterprise', id: requestedId, name: model.name, inputModalities: ['text'],
      context: { contextWindow: model.contextTokens }, defaultMaxTokens: model.maxOutputTokens }
  }

  override async listModels(provider: string) {
    if (provider !== 'enterprise') throw new LlmError('Unknown enterprise provider route', 'GATEWAY_AUTH')
    return (await this.directory(this.signal())).models.map(model => this.metadata(model))
  }

  override async resolveModel(provider: string, id: string, signal?: AbortSignal) {
    if (provider !== 'enterprise') throw new LlmError('Unknown enterprise provider route', 'GATEWAY_AUTH')
    const { models } = await this.directory(this.signal(signal))
    const model = models.find(model => model.id === id)
      ?? (id === UNCONFIGURED_MODEL ? models[0] : undefined)
    if (!model) throw new LlmError('Model is not authorized for this device', 'GATEWAY_AUTH')
    return this.metadata(model, id)
  }

  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    if (options.provider !== 'enterprise') throw new LlmError('Unknown enterprise provider route', 'GATEWAY_AUTH')
    if (options.reasoningEffort !== undefined) throw new LlmError('Enterprise reasoning controls are not configured', 'UNSUPPORTED_OPTION')
    const messages = gatewayMessages(options)
    const controller = new AbortController()
    const signal = this.signal(options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal)
    try {
      const { credential, lease, models } = await this.directory(signal)
      const selected = models.find(model => model.id === options.model)
        ?? (options.model === UNCONFIGURED_MODEL ? models[0] : undefined)
      if (!selected) throw new LlmError('Model is not authorized for this device', 'GATEWAY_AUTH')
      const body = modelCall.parse({ model: selected.id, runtimeId: credential.runtimeId, policyRevision: lease.policyRevision,
        messages, ...(options.tools ? { tools: options.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}),
        temperature: options.temperature, max_tokens: options.maxTokens, stop: options.stop,
        purpose: options.purpose === 'session-title' ? 'title' : options.purpose ?? 'chat',
      })
      const response = await this.request(credential, 'model-call', signal, body, randomUUID())
      if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('text/event-stream')) {
        await response.body?.cancel()
        throw new LlmError('Gateway response is not an event stream', 'GATEWAY_PROTOCOL')
      }
      yield* gatewayChunks(modelEvents(responseBytes(response), this.settings.maxEventChars), this.settings.maxResponseChars)
    } catch (error) {
      if (error instanceof LlmError) throw error
      throw new LlmError(signal.aborted ? 'Enterprise model call cancelled or timed out' : 'Enterprise model transport failed', 'GATEWAY_TRANSPORT')
    } finally { controller.abort() }
  }
}

/** Mount one enterprise-only model route with lifecycle-owned disposal.
 * @param ctx - Native DSH context with the LLM service.
 * @param config - Deployment origin, Keychain locator and explicit transport limits; never a secret.
 */
export function apply(ctx: Context, config: Settings): void {
  const settings = Config.parse(config)
  const keychain = new DesktopKeychain(settings.keychainHelper)
  const adapter = new EnterpriseGatewayAdapter(settings, { readCredential: () => keychain.get(settings.keychainAccount), request: fetch })
  ctx.effect(() => ctx.llm.registerAdapter(['enterprise'], adapter))
}
