/** DSH-native enterprise model provider; only the trusted native host reads runtime credentials. */
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmError, attributionHeaders, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { MediaAttachmentRef } from '@deepseek-ai/dsh-llm'
import { LlmFileAccountId, ProviderFileId } from '@deepseek-ai/dsh-llm-files'
import type { LlmFilesProvider, LlmFilesRuntime } from '@deepseek-ai/dsh-llm-files'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { desktopCredential, modelCatalog, runtimeHeartbeat } from '@deepseek-ai/dsh-enterprise-api/contracts'
import { modelEvents, responseModelEvents } from '@deepseek-ai/dsh-enterprise-api/model-stream'
import { z } from 'zod'
import { deploymentUrl } from './desktop-auth.ts'
import { DesktopKeychain } from './keychain.ts'
import { gatewayMessages, gatewayChunks, gatewayResponsesBody, gatewayResponseChunks } from './gateway-wire.ts'
import type { GatewayImageResolver, GatewayMediaResolver } from './gateway-wire.ts'

export const name = 'enterprise-gateway'
export const inject = ['llm', 'llmFiles', 'attachments']
export const Config = z.object({
  apiUrl: z.string().transform(value => deploymentUrl(value).origin),
  keychainHelper: z.string().refine(isAbsolute), keychainAccount: z.string().min(1),
  requestTimeoutMs: z.number().int().min(1).max(600000),
  fileProcessingPollMs: z.number().int().min(1).max(60000).default(2000),
  maxEventChars: z.number().int().min(1024).max(2097152),
  maxResponseChars: z.number().int().min(1024).max(16777216),
}).strict()
type Settings = z.infer<typeof Config>
const storedCredential = desktopCredential.extend({ apiOrigin: z.string() })
type Credential = z.infer<typeof storedCredential>
type Request = (url: URL, init: RequestInit) => Promise<Response>

// Profiles created before the platform publishes a model retain this sentinel.
// It is resolved against the live platform catalog so a running desktop does
// not require a restart after a model is enabled.
const UNCONFIGURED_MODEL = 'enterprise-unconfigured'

function mediaInputBytes(options: GenerateOptions): {
  total: number
  max: number
  nativeFiles: number
  modalities: Array<'text' | 'image' | 'video' | 'audio' | 'document'>
} {
  let total = 0
  let max = 0
  let nativeFiles = 0
  const modalities = new Set<'text' | 'image' | 'video' | 'audio' | 'document'>(['text'])
  const visit = (blocks: GenerateOptions['messages'][number]['content']): void => {
    for (const block of blocks) {
      if (block.type === 'image') {
        modalities.add('image')
        total += block.attachment.bytes
        max = Math.max(max, block.attachment.bytes)
      }
      else if (block.type === 'video' || block.type === 'audio' || block.type === 'document') {
        modalities.add(block.type)
        total += block.attachment.bytes
        max = Math.max(max, block.attachment.bytes)
        nativeFiles += 1
      } else if (block.type === 'tool-result') visit(block.content)
    }
  }
  for (const message of options.messages) visit(message.content)
  return { total, max, nativeFiles, modalities: [...modalities] }
}

interface UsedProviderFile {
  readonly providerId: typeof name
  readonly accountId: LlmFileAccountId
  readonly modelId: string
  readonly attachmentId: string
  readonly data: Uint8Array
  readonly fileId: ReturnType<typeof ProviderFileId>
}

function providerRejectedFileId(detail: string): boolean {
  if (/\bPROVIDER_FILE_REFERENCE_EXPIRED\b/u.test(detail)) return true
  const file = /\bfile(?:_| |-)?(?:id|reference)\b/iu.test(detail)
  const stale = /\b(?:expired|invalid|missing|not found|does not exist|do not exist)\b/iu.test(detail)
  return file && stale
}

function staleProviderFiles(files: readonly UsedProviderFile[], detail: string): readonly UsedProviderFile[] {
  const named = files.filter(file => detail.includes(file.fileId))
  return named.length > 0 ? named : files
}

function gatewayFailure(status: number, detail = ''): LlmError {
  if (status === 402 && /"error"\s*:\s*"INSUFFICIENT_TEAM_BALANCE"/u.test(detail)) {
    return new LlmError('The team CNY balance is insufficient', 'INSUFFICIENT_TEAM_BALANCE', { status })
  }
  if (status === 401 || status === 403) return new LlmError('Enterprise model authentication failed', 'AUTH', { status })
  if (status === 408 || status === 504) return new LlmError('Enterprise model request timed out', 'TIMEOUT', { status })
  if (status === 429) return new LlmError('Enterprise model rate limit exceeded', 'RATE_LIMIT', { status })
  if (status >= 500) return new LlmError('Enterprise model service failed', 'SERVER', { status })
  if (status === 400 || status === 404 || status === 413 || status === 422) {
    return new LlmError('Enterprise model rejected the request', 'INVALID_REQUEST', { status })
  }
  return new LlmError('Enterprise gateway refused the request', 'GATEWAY_REFUSED', { status })
}

/** Native I/O dependencies; the plugin binds these to Keychain and fetch, not model/tool input. */
export interface GatewayDependencies {
  readCredential: () => Promise<string | undefined>
  request: Request
  resolveImage?: (ref: ImageAttachmentRef, signal?: AbortSignal) => ReturnType<GatewayImageResolver>
  resolveMedia?: (ref: MediaAttachmentRef, signal?: AbortSignal) => ReturnType<GatewayMediaResolver>
  files?: Pick<LlmFilesRuntime, 'ensureUploaded' | 'invalidate'>
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

const providerFileReceipt = z.object({
  id: z.string().min(1).max(512),
  status: z.string().min(1).max(64),
}).passthrough()

type ProviderFileReceipt = z.infer<typeof providerFileReceipt>

function fileState(status: string): 'pending' | 'ready' | 'failed' {
  if (status === 'processing' || status === 'uploaded') return 'pending'
  if (status === 'active' || status === 'processed') return 'ready'
  if (status === 'failed' || status === 'error') return 'failed'
  throw new LlmError('Enterprise Files API returned an unknown file status', 'INVALID_RESPONSE')
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

/** Native LLM adapter with a platform model directory and no local credential fallback. */
export class EnterpriseGatewayAdapter extends LlmAdapter {
  private readonly settings: Settings
  private readonly staleFileIds = new Map<string, string>()
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

  private accountId(credential: Credential) {
    return LlmFileAccountId(`${this.settings.keychainAccount}:${credential.organizationId}`)
  }

  private staleFileKey(modelId: string, attachmentId: string): string {
    return `${modelId}\0${attachmentId}`
  }

  private async controlRequest(
    credential: Credential,
    path: string,
    signal: AbortSignal,
    body?: unknown,
    key?: string,
    acceptError = false,
  ) {
    const response = await this.io.request(new URL(`/v1/organizations/${credential.organizationId}/${path}`, this.settings.apiUrl), {
      method: body === undefined ? 'GET' : 'POST', signal, redirect: 'error',
      headers: { ...attributionHeaders(), Authorization: 'Bearer ' + credential.token, 'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok && !acceptError) {
      await response.body?.cancel()
      throw gatewayFailure(response.status)
    }
    return response
  }

  private async relayRequest(
    credential: Credential,
    path: '/responses' | '/chat/completions' | '/files',
    signal: AbortSignal,
    modelId: string,
    policyRevision: number,
    purpose: 'chat' | 'subagent' | 'compaction' | 'title' | 'plugin_review',
    body: BodyInit,
    contentType?: string,
    key?: string,
  ): Promise<Response> {
    return this.io.request(new URL('/model' + path, this.settings.apiUrl), {
      method: 'POST', signal, redirect: 'error', body,
      headers: {
        ...attributionHeaders(),
        Authorization: 'Bearer ' + credential.token,
        'X-DSH-Model': modelId,
        'X-DSH-Policy-Revision': String(policyRevision),
        'X-DSH-Purpose': purpose,
        ...(contentType === undefined ? {} : { 'Content-Type': contentType }),
        ...(key === undefined ? {} : { 'Idempotency-Key': key }),
      },
    })
  }

  private async fileStatusRequest(
    credential: Credential,
    fileId: string,
    signal: AbortSignal,
    modelId: string,
    policyRevision: number,
  ): Promise<Response> {
    return this.io.request(new URL('/model/files/' + encodeURIComponent(fileId), this.settings.apiUrl), {
      method: 'GET', signal, redirect: 'error',
      headers: {
        ...attributionHeaders(),
        Authorization: 'Bearer ' + credential.token,
        'X-DSH-Model': modelId,
        'X-DSH-Policy-Revision': String(policyRevision),
        'X-DSH-Purpose': 'chat',
      },
    })
  }

  private async readyFile(
    receipt: ProviderFileReceipt,
    credential: Credential,
    modelId: string,
    policyRevision: number,
    signal: AbortSignal,
  ): Promise<ProviderFileReceipt> {
    let current = receipt
    while (fileState(current.status) === 'pending') {
      await (this.io.wait ?? (async (milliseconds, waitSignal) => {
        await wait(milliseconds, undefined, { signal: waitSignal })
      }))(this.settings.fileProcessingPollMs, signal)
      const response = await this.fileStatusRequest(credential, current.id, signal, modelId, policyRevision)
      if (!response.ok) {
        const status = response.status
        await response.body?.cancel()
        throw gatewayFailure(status)
      }
      const next = providerFileReceipt.parse(await this.json(response))
      if (next.id !== current.id) {
        throw new LlmError('Enterprise Files API changed the file identity while processing', 'INVALID_RESPONSE')
      }
      current = next
    }
    if (fileState(current.status) === 'failed') {
      throw new LlmError('Enterprise Files API could not process the uploaded file', 'FILES_API')
    }
    return current
  }

  private async json(response: Response): Promise<unknown> {
    let size = 0
    const chunks: Uint8Array[] = []
    for await (const bytes of responseBytes(response)) {
      size += bytes.length
      if (size > this.settings.maxResponseChars) throw new LlmError('Gateway JSON response exceeds limit', 'GATEWAY_LIMIT')
      chunks.push(bytes)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown } catch {
      throw new LlmError('Gateway JSON response is invalid', 'GATEWAY_PROTOCOL')
    }
  }

  private async errorDetail(response: Response): Promise<string> {
    let size = 0
    const chunks: Uint8Array[] = []
    for await (const bytes of responseBytes(response)) {
      size += bytes.length
      if (size > this.settings.maxResponseChars) return ''
      chunks.push(bytes)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  private async directory(signal: AbortSignal) {
    const credential = await this.credential()
    signal.throwIfAborted()
    const lease = runtimeHeartbeat.parse(await this.json(await this.controlRequest(credential, `runtimes/${credential.runtimeId}/heartbeat`, signal, {})))
    if (Date.parse(lease.leaseUntil) <= Date.now()) throw new LlmError('Enterprise runtime lease expired', 'GATEWAY_AUTH')
    const models = modelCatalog.parse(await this.json(await this.controlRequest(credential, 'models', signal)))
    return { credential, lease, models }
  }

  private signal(signal?: AbortSignal, timeoutMs = this.settings.requestTimeoutMs): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  /** Files API provider registered by the plugin; credentials remain inside this native adapter. */
  filesProvider(): LlmFilesProvider {
    return {
      id: name,
      upload: async (input) => {
        const { credential, lease, models } = await this.directory(input.signal)
        if (input.accountId !== this.accountId(credential)) {
          throw new LlmError('Enterprise Files account does not match this deployment', 'GATEWAY_AUTH')
        }
        const policyRevision = z.number().int().positive().safeParse(input.providerOptions?.policyRevision)
        if (!policyRevision.success || policyRevision.data !== lease.policyRevision) {
          throw new LlmError('Enterprise Files upload requires a policy revision', 'INVALID_REQUEST')
        }
        const selected = models.find(model => model.id === input.modelId)
        if (!selected) throw new LlmError('Enterprise Files model is unavailable', 'GATEWAY_AUTH')
        const staleKey = this.staleFileKey(input.modelId, input.attachment.attachmentId)
        const replaceFileId = this.staleFileIds.get(staleKey)
        const form = new FormData()
        form.append('purpose', 'user_data')
        form.append('file', new Blob([Uint8Array.from(input.data).buffer], { type: input.attachment.mediaType }), input.attachment.name)
        const response = await this.relayRequest(
          credential, '/files', input.signal, input.modelId, policyRevision.data, 'chat', form,
        )
        if (!response.ok) {
          const status = response.status
          await response.body?.cancel()
          throw gatewayFailure(status)
        }
        const receipt = await this.readyFile(
          providerFileReceipt.parse(await this.json(response)),
          credential,
          input.modelId,
          policyRevision.data,
          input.signal,
        )
        if (replaceFileId !== undefined) this.staleFileIds.delete(staleKey)
        return {
          fileId: ProviderFileId(receipt.id),
          bytes: input.data.byteLength,
          expiresAt: Date.now() + selected.filesTtlSeconds * 1_000,
          uploaded: true,
        }
      },
    }
  }

  private async uploadFile(
    selected: z.infer<typeof modelCatalog>[number],
    credential: Credential,
    policyRevision: number,
    ref: MediaAttachmentRef | ImageAttachmentRef,
    data: Uint8Array,
    mediaType: string,
    signal: AbortSignal,
    usedFiles: UsedProviderFile[],
  ): Promise<{ fileId: string }> {
    if (this.io.files === undefined) throw new LlmError('Enterprise Files capability is unavailable', 'FILES_API')
    const attachment = { ...ref, mediaType,
      ...'name' in ref && ref.name ? { name: ref.name } : { name: 'image' } }
    const resolved = await this.io.files.ensureUploaded({
      providerId: name,
      accountId: this.accountId(credential),
      modelId: selected.id,
      attachment,
      data,
      providerOptions: { policyRevision },
      policy: {
        expiresAfterSeconds: selected.filesTtlSeconds,
        refreshMarginSeconds: selected.fileRefreshMarginSeconds,
        uploadTimeoutMs: selected.fileUploadTimeoutMs,
        maxRetries: selected.fileUploadMaxRetries,
        quotaCleanupBatch: selected.fileQuotaCleanupBatch,
      },
      signal,
    })
    usedFiles.push({
      providerId: name,
      accountId: this.accountId(credential),
      modelId: selected.id,
      attachmentId: String(attachment.attachmentId),
      data,
      fileId: ProviderFileId(resolved.fileId),
    })
    return { fileId: resolved.fileId }
  }

  private resolverFor(
    selected: z.infer<typeof modelCatalog>[number],
    credential: Credential,
    policyRevision: number,
    signal: AbortSignal,
    usedFiles: UsedProviderFile[],
  ): { image: GatewayImageResolver; media: GatewayMediaResolver } {
    const image: GatewayImageResolver = async (ref) => {
      if (this.io.resolveImage === undefined) throw new LlmError('Enterprise gateway cannot read image attachments', 'UNSUPPORTED_MODALITY')
      const resolved = await this.io.resolveImage(ref, signal)
      if ('fileId' in resolved || selected.fileInputPolicy !== 'provider-files') return resolved
      return this.uploadFile(selected, credential, policyRevision, ref, resolved.data, resolved.mediaType, signal, usedFiles)
    }
    const media: GatewayMediaResolver = async (ref) => {
      if (selected.fileInputPolicy === 'unsupported') {
        throw new LlmError('The selected model does not accept native file input', 'UNSUPPORTED_MODALITY')
      }
      if (this.io.resolveMedia === undefined) throw new LlmError('Enterprise gateway cannot read media attachments', 'UNSUPPORTED_MODALITY')
      const resolved = await this.io.resolveMedia(ref, signal)
      if ('fileId' in resolved || selected.fileInputPolicy === 'inline') return resolved
      return this.uploadFile(selected, credential, policyRevision, ref, resolved.data, resolved.mediaType, signal, usedFiles)
    }
    return { image, media }
  }

  private metadata(model: z.infer<typeof modelCatalog>[number], requestedId: string = model.id): LlmResolvedModelInfo {
    if (model.protocol === 'anthropic-messages') throw new LlmError('Anthropic enterprise models are not supported by this adapter', 'UNSUPPORTED_PROTOCOL')
    const { inputModalities } = model
    return { provider: 'enterprise', id: requestedId, name: model.name, inputModalities: inputModalities.length ? inputModalities : ['text'],
      videoAudioMode: model.videoAudioMode,
      protocol: model.protocol,
      fileInputPolicy: model.fileInputPolicy === 'provider-files' ? 'provider-files' : model.fileInputPolicy === 'inline' ? 'inline' : 'unsupported',
      context: { contextWindow: model.contextTokens }, defaultMaxTokens: model.maxOutputTokens }
  }

  override async listModels(provider: string) {
    if (provider !== 'enterprise') throw new LlmError('Unknown enterprise provider route', 'GATEWAY_AUTH')
    return (await this.directory(this.signal())).models
      .filter(model => model.protocol !== 'anthropic-messages')
      .map(model => this.metadata(model))
  }

  override async resolveModel(provider: string, id: string, signal?: AbortSignal) {
    if (provider !== 'enterprise') throw new LlmError('Unknown enterprise provider route', 'GATEWAY_AUTH')
    const { models } = await this.directory(this.signal(signal))
    const model = models.find(model => model.id === id)
      ?? (id === UNCONFIGURED_MODEL ? models[0] : undefined)
    if (!model) throw new LlmError('Model is not available on the platform', 'GATEWAY_AUTH')
    return this.metadata(model, id)
  }

  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    if (options.provider !== 'enterprise') throw new LlmError('Unknown enterprise provider route', 'GATEWAY_AUTH')
    const controller = new AbortController()
    const callerSignal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
    let signal = this.signal(callerSignal)
    try {
      const { credential, lease, models } = await this.directory(signal)
      const selected = models.find(model => model.id === options.model)
        ?? (options.model === UNCONFIGURED_MODEL ? models[0] : undefined)
      if (!selected) throw new LlmError('Model is not available on the platform', 'GATEWAY_AUTH')
      if (selected.protocol === 'anthropic-messages') throw new LlmError('Anthropic enterprise models are not supported by this adapter', 'UNSUPPORTED_PROTOCOL')
      signal = this.signal(callerSignal, selected.modelCallTimeoutMs + this.settings.requestTimeoutMs)
      const media = mediaInputBytes(options)
      if (media.total > selected.maxRequestBytes || media.max > selected.maxFileBytes) {
        throw new LlmError('Media input exceeds the selected model limit', 'GATEWAY_LIMIT')
      }
      if (media.nativeFiles > 0 && selected.fileInputPolicy === 'unsupported') {
        throw new LlmError('The selected model does not accept native file input', 'UNSUPPORTED_MODALITY')
      }
      const responses = selected.protocol === 'openai-responses'
      let response: Response | undefined
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const usedFiles: UsedProviderFile[] = []
        const resolver = this.resolverFor(selected, credential, lease.policyRevision, signal, usedFiles)
        const upstreamBody: unknown = responses
          ? { ...(await gatewayResponsesBody(options, resolver.image, resolver.media)), model: selected.id }
          : JSON.parse(JSON.stringify({
            model: selected.id,
            messages: await gatewayMessages(options, resolver.image, resolver.media),
            ...(options.tools ? { tools: options.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}),
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            stop: options.stop,
            ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
            stream: true,
            stream_options: { include_usage: true },
          }))
        const requestPurpose: string | undefined = options.purpose
        const purpose = requestPurpose === 'session-title' ? 'title'
          : requestPurpose === 'subagent' ? 'subagent'
            : requestPurpose === 'compaction' ? 'compaction' : 'chat'
        response = await this.relayRequest(
          credential,
          responses ? '/responses' : '/chat/completions',
          signal,
          selected.id,
          lease.policyRevision,
          purpose,
          JSON.stringify(upstreamBody),
          'application/json',
          randomUUID(),
        )
        if (response.ok) break
        const status = response.status
        const detail = await this.errorDetail(response)
        if (attempt === 0 && usedFiles.length > 0 && providerRejectedFileId(detail)) {
          for (const used of staleProviderFiles(usedFiles, detail)) {
            this.staleFileIds.set(this.staleFileKey(used.modelId, used.attachmentId), used.fileId)
            this.io.files?.invalidate(used, used.fileId)
          }
          response = undefined
          continue
        }
        throw gatewayFailure(status, detail)
      }
      if (response === undefined) throw new LlmError('Enterprise gateway did not return a response', 'GATEWAY_PROTOCOL')
      if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('text/event-stream')) {
        await response.body?.cancel()
        throw new LlmError('Gateway response is not an event stream', 'GATEWAY_PROTOCOL')
      }
      if (responses) {
        yield* gatewayResponseChunks(
          responseModelEvents(responseBytes(response), this.settings.maxEventChars),
          this.settings.maxResponseChars,
          { provider: options.provider, model: options.model },
        )
      }
      else yield* gatewayChunks(modelEvents(responseBytes(response), this.settings.maxEventChars), this.settings.maxResponseChars)
    } catch (error) {
      if (error instanceof LlmError) throw error
      throw new LlmError(signal.aborted ? 'Enterprise model call cancelled or timed out' : 'Enterprise model transport failed', 'GATEWAY_TRANSPORT')
    } finally { controller.abort() }
  }
}

/** Mount one enterprise-only model route with lifecycle-owned disposal.
 * @param ctx - Native DSH context with the LLM service.
 * @param config - Deployment origin, Keychain locator, file polling interval and explicit transport limits; never a secret.
 */
export function apply(ctx: Context, config: Settings): void {
  const settings = Config.parse(config)
  const keychain = new DesktopKeychain(settings.keychainHelper)
  const adapter = new EnterpriseGatewayAdapter(settings, {
    readCredential: () => keychain.get(settings.keychainAccount), request: fetch,
    files: ctx.llmFiles,
    resolveImage: async (ref, signal) => {
      const stored = await ctx.attachments.readImage(ref, signal)
      return { mediaType: stored.ref.mediaType, data: stored.data }
    },
    resolveMedia: async (ref, signal) => {
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of ctx.attachments.readFileStream(ref, signal)) {
        size += chunk.length
        if (size > settings.maxResponseChars) throw new LlmError('Media attachment exceeds gateway limit', 'GATEWAY_LIMIT')
        chunks.push(chunk)
      }
      return { mediaType: ref.mediaType, data: Buffer.concat(chunks) }
    },
  })
  ctx.effect(() => ctx.llmFiles.registerProvider(adapter.filesProvider()))
  ctx.effect(() => ctx.llm.registerAdapter(['enterprise'], adapter))
}
