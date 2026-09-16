/** Shared Files API upload coordination for LLM adapters. @module @deepseek-ai/dsh-llm-files */

import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type {
  LlmFileAccountId,
  LlmFileMetrics,
  LlmFilePolicy,
  LlmFileReference,
  LlmFileRequest,
  LlmFilesProvider,
  ProviderFileId,
} from './types.ts'

export {
  LlmFileAccountId,
  ProviderFileId,
} from './types.ts'
export type {
  LlmFileMetrics,
  LlmFilePolicy,
  LlmFileReference,
  LlmFileRequest,
  LlmFilesProvider,
  LlmFileUpload,
  LlmFileUploadResult,
  ProviderFileId as ProviderFileIdType,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    llmFiles: LlmFilesRuntime
  }
}

interface CacheEntry {
  readonly providerId: string
  readonly accountId: LlmFileAccountId
  readonly key: string
  readonly fileId: ProviderFileId
  readonly bytes: number
  readonly expiresAt: number
}

interface SharedUpload {
  readonly controller: AbortController
  promise: Promise<LlmFileReference>
  waiters: number
  settled: boolean
  uploadedClaimed: boolean
}

function failure(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('LLM file upload failed with a non-Error reason.', { cause: error })
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('LLM file upload cancelled with a non-Error reason.', { cause: signal.reason })
}

function waitForUpload(shared: SharedUpload, signal?: AbortSignal): Promise<LlmFileReference> {
  signal?.throwIfAborted()
  shared.waiters += 1
  let released = false
  const release = (reason?: Error): void => {
    if (released) return
    released = true
    shared.waiters -= 1
    if (reason !== undefined && shared.waiters === 0 && !shared.settled) shared.controller.abort(reason)
  }
  const resultForWaiter = (result: LlmFileReference): LlmFileReference => {
    if (!result.uploaded || shared.uploadedClaimed) return { ...result, uploaded: false }
    shared.uploadedClaimed = true
    return result
  }
  if (signal === undefined) return shared.promise.then(resultForWaiter).finally(release)
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      const reason = abortReason(signal)
      release(reason)
      reject(reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    void shared.promise.then((result) => {
      if (released) return
      signal.removeEventListener('abort', abort)
      release()
      resolve(resultForWaiter(result))
    }, (error: unknown) => {
      signal.removeEventListener('abort', abort)
      release()
      reject(failure(error))
    })
  })
}

function validatePolicy(policy: LlmFilePolicy): void {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new LlmError(`LLM file policy ${name} must be a non-negative safe integer.`, 'INVALID_REQUEST')
    }
  }
  if (policy.expiresAfterSeconds === 0 || policy.uploadTimeoutMs === 0) {
    throw new LlmError('LLM file expiry and upload timeout must be positive.', 'INVALID_REQUEST')
  }
  if (policy.refreshMarginSeconds >= policy.expiresAfterSeconds) {
    throw new LlmError('LLM file refresh margin must be shorter than its lifetime.', 'INVALID_REQUEST')
  }
}

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Runtime registry and upload coordinator shared by model adapters. Cache data
 * is process-local and never enters Session state, logs, or diagnostics.
 */
export class LlmFilesRuntime extends Service {
  private readonly providers = new Map<string, LlmFilesProvider>()
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, SharedUpload>()
  private metricsValue: LlmFileMetrics = {
    uploads: 0,
    uploadedBytes: 0,
    failures: 0,
    refreshes: 0,
    rejectedBytes: 0,
  }

  /** @param ctx - composition context that owns provider effects. */
  constructor(ctx: Context) {
    super(ctx, 'llmFiles')
  }

  /** @returns Current Unix time in milliseconds for cache expiry decisions. */
  protected currentTime(): number {
    return Date.now()
  }

  /**
   * Register one uniquely named Files API provider for the calling plugin lifetime.
   * @param provider - Provider-owned upload, cleanup, and quota operations.
   * @returns Disposer that removes this exact provider registration.
   */
  registerProvider(provider: LlmFilesProvider): () => void {
    if (provider.id.length === 0) throw new LlmError('LLM Files provider id is empty.', 'INVALID_REQUEST')
    if (this.providers.has(provider.id)) {
      throw new LlmError(`LLM Files provider "${provider.id}" is already registered.`, 'INVALID_REQUEST')
    }
    const providers = this.providers
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, 'llmFiles.registerProvider()')
    return () => void dispose()
  }

  /**
   * Snapshot upload lifecycle counters without exposing upstream file identifiers.
   * @returns Aggregate runtime counters without upstream file identifiers.
   */
  metrics(): LlmFileMetrics {
    return { ...this.metricsValue }
  }

  /**
   * Resolve a reusable file identifier or share one in-flight upload with independent caller cancellation.
   * @param request - Verified attachment bytes, cache identity, lifecycle policy, and optional caller signal.
   * @returns Ephemeral provider reference and whether this waiter owns the physical upload count.
   */
  ensureUploaded(request: LlmFileRequest): Promise<LlmFileReference> {
    request.signal?.throwIfAborted()
    validatePolicy(request.policy)
    if (request.data.byteLength !== request.attachment.bytes) {
      this.metricsValue = { ...this.metricsValue, rejectedBytes: this.metricsValue.rejectedBytes + request.data.byteLength }
      throw new LlmError('LLM file bytes do not match the attachment metadata.', 'INVALID_REQUEST')
    }
    const contentDigest = digest(request.data)
    const key = JSON.stringify([request.providerId, request.accountId, request.modelId, contentDigest])
    const now = this.currentTime()
    const margin = request.policy.refreshMarginSeconds * 1_000
    const cached = this.cache.get(key)
    if (cached !== undefined && cached.expiresAt - now > margin) {
      return Promise.resolve({ fileId: cached.fileId, expiresAt: cached.expiresAt, uploaded: false })
    }
    if (cached !== undefined) {
      this.cache.delete(key)
      this.metricsValue = { ...this.metricsValue, refreshes: this.metricsValue.refreshes + 1 }
    }
    let shared = this.inflight.get(key)
    if (shared?.controller.signal.aborted) {
      this.inflight.delete(key)
      shared = undefined
    }
    if (shared !== undefined) return waitForUpload(shared, request.signal)

    const controller = new AbortController()
    const active: SharedUpload = {
      controller,
      waiters: 0,
      settled: false,
      uploadedClaimed: false,
      promise: undefined as never,
    }
    active.promise = this.upload(key, contentDigest, request, controller.signal).then((result) => {
      active.settled = true
      return result
    }, (error: unknown) => {
      active.settled = true
      this.metricsValue = { ...this.metricsValue, failures: this.metricsValue.failures + 1 }
      throw failure(error)
    })
    this.inflight.set(key, active)
    void active.promise.finally(() => {
      if (this.inflight.get(key) === active) this.inflight.delete(key)
    }).catch(() => {})
    return waitForUpload(active, request.signal)
  }

  private async upload(
    key: string,
    _contentDigest: string,
    request: LlmFileRequest,
    sharedSignal: AbortSignal,
  ): Promise<LlmFileReference> {
    const provider = this.providers.get(request.providerId)
    if (provider === undefined) {
      throw new LlmError(`LLM Files provider "${request.providerId}" is not registered.`, 'FILES_API')
    }
    let quotaRecoveryUsed = false
    let lastError: unknown
    for (let attempt = 0; attempt <= request.policy.maxRetries; attempt += 1) {
      sharedSignal.throwIfAborted()
      const timeout = AbortSignal.timeout(request.policy.uploadTimeoutMs)
      const signal = AbortSignal.any([sharedSignal, timeout])
      try {
        const result = await provider.upload({
          accountId: request.accountId,
          modelId: request.modelId,
          attachment: request.attachment,
          data: request.data,
          expiresAfterSeconds: request.policy.expiresAfterSeconds,
          ...request.providerOptions === undefined ? {} : { providerOptions: request.providerOptions },
          signal,
        })
        const now = this.currentTime()
        if (result.bytes !== request.data.byteLength || !Number.isSafeInteger(result.expiresAt)
          || result.expiresAt <= now + request.policy.refreshMarginSeconds * 1_000) {
          throw new LlmError('LLM Files provider returned invalid upload metadata.', 'INVALID_RESPONSE')
        }
        this.cache.set(key, {
          providerId: request.providerId,
          accountId: request.accountId,
          key,
          fileId: result.fileId,
          bytes: result.bytes,
          expiresAt: result.expiresAt,
        })
        const uploaded = result.uploaded !== false
        if (uploaded) {
          this.metricsValue = {
            ...this.metricsValue,
            uploads: this.metricsValue.uploads + 1,
            uploadedBytes: this.metricsValue.uploadedBytes + result.bytes,
          }
        }
        return { fileId: result.fileId, expiresAt: result.expiresAt, uploaded }
      } catch (error: unknown) {
        lastError = error
        if (sharedSignal.aborted) throw abortReason(sharedSignal)
        if (!quotaRecoveryUsed && provider.isQuotaError?.(error) === true
          && provider.reclaimQuota !== undefined && request.policy.quotaCleanupBatch > 0) {
          quotaRecoveryUsed = true
          const reclaimed = await provider.reclaimQuota(request.accountId, request.policy.quotaCleanupBatch, sharedSignal)
          if (reclaimed > 0) {
            attempt -= 1
            continue
          }
        }
      }
    }
    throw failure(lastError)
  }

  /**
   * Remove one exact cached generation after an upstream model endpoint rejects it.
   * @param request - Cache identity and bytes used to derive the content digest.
   * @param fileId - Exact provider generation rejected by the model endpoint.
   */
  invalidate(request: Pick<LlmFileRequest, 'providerId' | 'accountId' | 'modelId' | 'data'>, fileId: ProviderFileId): void {
    const key = JSON.stringify([request.providerId, request.accountId, request.modelId, digest(request.data)])
    if (this.cache.get(key)?.fileId === fileId) this.cache.delete(key)
  }

  /**
   * Delete expired runtime-owned upstream files when their provider supports deletion.
   * @param signal - Optional cancellation for provider deletion work.
   * @returns Number of local cache entries removed after successful or unnecessary provider deletion.
   */
  async cleanupExpired(signal?: AbortSignal): Promise<number> {
    const now = this.currentTime()
    let deleted = 0
    for (const [key, entry] of this.cache) {
      signal?.throwIfAborted()
      if (entry.expiresAt > now) continue
      const provider = this.providers.get(entry.providerId)
      if (provider?.delete !== undefined) await provider.delete(entry.accountId, entry.fileId, signal)
      this.cache.delete(key)
      deleted += 1
    }
    return deleted
  }
}

export default LlmFilesRuntime
