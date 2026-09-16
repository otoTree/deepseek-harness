/** Provider-neutral Files API vocabulary. @module @deepseek-ai/dsh-llm-files/types */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { MediaAttachmentRef } from '@deepseek-ai/dsh-llm'

/** Opaque identifier issued by one upstream Files API. */
export type ProviderFileId = Branded<'ProviderFileId'>

/**
 * Brand an upstream Files API identifier after provider response validation.
 * @param value - Validated provider-owned identifier.
 * @returns Opaque provider file identifier.
 */
export function ProviderFileId(value: string): ProviderFileId {
  return value as ProviderFileId
}

/** Stable, non-secret account namespace used only in cache keys. */
export type LlmFileAccountId = Branded<'LlmFileAccountId'>

/**
 * Brand a non-secret account namespace chosen by a provider plugin.
 * @param value - Stable provider account namespace.
 * @returns Opaque cache account identifier.
 */
export function LlmFileAccountId(value: string): LlmFileAccountId {
  return value as LlmFileAccountId
}

/** File metadata and verified bytes supplied to a Files API provider. */
export interface LlmFileUpload {
  readonly accountId: LlmFileAccountId
  readonly modelId: string
  readonly attachment: MediaAttachmentRef | {
    readonly attachmentId: AttachmentId
    readonly mediaType: string
    readonly name?: string
    readonly bytes: number
  }
  readonly data: Uint8Array
  readonly expiresAfterSeconds: number
  readonly providerOptions?: Readonly<Record<string, string | number | boolean>>
  readonly signal: AbortSignal
}

/** Validated upstream upload result. Times are Unix milliseconds. */
export interface LlmFileUploadResult {
  readonly fileId: ProviderFileId
  readonly bytes: number
  readonly expiresAt: number
  /** Whether this provider call created a remote file instead of reusing one. */
  readonly uploaded?: boolean
}

/** Provider implementation registered with {@link LlmFilesRuntime}. */
export interface LlmFilesProvider {
  readonly id: string
  upload(request: LlmFileUpload): Promise<LlmFileUploadResult>
  delete?(accountId: LlmFileAccountId, fileId: ProviderFileId, signal?: AbortSignal): Promise<void>
  reclaimQuota?(accountId: LlmFileAccountId, limit: number, signal?: AbortSignal): Promise<number>
  isQuotaError?(error: unknown): boolean
}

/** Explicit caller policy for one upload resolution. */
export interface LlmFilePolicy {
  readonly expiresAfterSeconds: number
  readonly refreshMarginSeconds: number
  readonly uploadTimeoutMs: number
  readonly maxRetries: number
  readonly quotaCleanupBatch: number
}

/** Request to resolve one attachment to a reusable upstream file id. */
export interface LlmFileRequest extends Omit<LlmFileUpload, 'signal' | 'expiresAfterSeconds'> {
  readonly providerId: string
  readonly policy: LlmFilePolicy
  readonly signal?: AbortSignal
}

/** One cache resolution; provider ids remain runtime-only. */
export interface LlmFileReference {
  readonly fileId: ProviderFileId
  readonly expiresAt: number
  readonly uploaded: boolean
}

/** Runtime-only upload counters suitable for provider telemetry. */
export interface LlmFileMetrics {
  readonly uploads: number
  readonly uploadedBytes: number
  readonly failures: number
  readonly refreshes: number
  readonly rejectedBytes: number
}
