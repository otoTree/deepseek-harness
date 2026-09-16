import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { describe, expect, it, vi } from 'vitest'
import LlmFilesRuntime, {
  LlmFileAccountId,
  ProviderFileId,
} from '../src/index.ts'
import type { LlmFileRequest, LlmFileUploadResult, LlmFilesProvider } from '../src/index.ts'

const NOW = 1_700_000_000_000
const DATA = Uint8Array.of(1, 2, 3)
const ATTACHMENT = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  kind: 'document' as const,
  mediaType: 'application/pdf',
  name: 'report.pdf',
  bytes: DATA.byteLength,
}
const POLICY = {
  expiresAfterSeconds: 600,
  refreshMarginSeconds: 60,
  uploadTimeoutMs: 10_000,
  maxRetries: 1,
  quotaCleanupBatch: 10,
}

class TestLlmFilesRuntime extends LlmFilesRuntime {
  constructor(ctx: Context, private readonly now: () => number) {
    super(ctx)
  }

  protected override currentTime(): number {
    return this.now()
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept
    reject = refuse
  })
  return { promise, resolve, reject }
}

function result(id: string, now = NOW): LlmFileUploadResult {
  return { fileId: ProviderFileId(id), bytes: DATA.byteLength, expiresAt: now + 600_000 }
}

async function fixture(provider: LlmFilesProvider, now: () => number = () => NOW) {
  const ctx = new Context()
  const mounted = await ctx.plugin(TestLlmFilesRuntime, now)
  const dispose = ctx.llmFiles.registerProvider(provider)
  const request: LlmFileRequest = {
    providerId: provider.id,
    accountId: LlmFileAccountId('account-a'),
    modelId: 'model-a',
    attachment: ATTACHMENT,
    data: DATA,
    policy: POLICY,
  }
  return { ctx, mounted, files: ctx.llmFiles, request, dispose }
}

describe('LlmFilesRuntime', () => {
  it('singleflights uploads and reuses a live account/model/content mapping', async () => {
    const gate = deferred<LlmFileUploadResult>()
    const upload = vi.fn(() => gate.promise)
    const { mounted, files, request } = await fixture({ id: 'provider-a', upload })

    const first = files.ensureUploaded(request)
    const second = files.ensureUploaded(request)
    expect(upload).toHaveBeenCalledOnce()
    gate.resolve(result('file-shared'))

    await expect(Promise.all([first, second])).resolves.toEqual([
      { fileId: 'file-shared', expiresAt: NOW + 600_000, uploaded: true },
      { fileId: 'file-shared', expiresAt: NOW + 600_000, uploaded: false },
    ])
    await expect(files.ensureUploaded(request)).resolves.toMatchObject({ fileId: 'file-shared', uploaded: false })
    expect(upload).toHaveBeenCalledOnce()
    await mounted.dispose()
  })

  it('includes provider, account, model, and content digest in reuse identity', async () => {
    let calls = 0
    const upload = vi.fn(async () => result(`file-${++calls}`))
    const { mounted, files, request } = await fixture({ id: 'provider-a', upload })

    await files.ensureUploaded(request)
    await files.ensureUploaded({ ...request, accountId: LlmFileAccountId('account-b') })
    await files.ensureUploaded({ ...request, modelId: 'model-b' })
    await files.ensureUploaded({
      ...request,
      attachment: { ...ATTACHMENT, attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`) },
      data: Uint8Array.of(3, 2, 1),
    })
    expect(upload).toHaveBeenCalledTimes(4)
    await mounted.dispose()
  })

  it('keeps a shared upload alive until its final waiter cancels', async () => {
    const started = deferred<AbortSignal>()
    const stopped = deferred<undefined>()
    const upload = vi.fn(async ({ signal }: Parameters<LlmFilesProvider['upload']>[0]) => {
      started.resolve(signal)
      return new Promise<LlmFileUploadResult>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          stopped.resolve(undefined)
          reject(signal.reason instanceof Error
            ? signal.reason
            : new Error('Upload aborted with a non-Error reason.', { cause: signal.reason }))
        }, { once: true })
      })
    })
    const { mounted, files, request } = await fixture({ id: 'provider-a', upload })
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = files.ensureUploaded({ ...request, signal: firstController.signal })
    const second = files.ensureUploaded({ ...request, signal: secondController.signal })
    const sharedSignal = await started.promise

    firstController.abort(new Error('cancel first'))
    await expect(first).rejects.toThrow('cancel first')
    expect(sharedSignal.aborted).toBe(false)
    secondController.abort(new Error('cancel second'))
    await stopped.promise
    await expect(second).rejects.toThrow('cancel second')
    expect(sharedSignal.aborted).toBe(true)
    await mounted.dispose()
  })

  it('refreshes at the configured margin and invalidates only an exact generation', async () => {
    let now = NOW
    let calls = 0
    const upload = vi.fn(async () => result(`file-${++calls}`, now))
    const { mounted, files, request } = await fixture({ id: 'provider-a', upload }, () => now)

    const first = await files.ensureUploaded(request)
    files.invalidate(request, ProviderFileId('different'))
    await expect(files.ensureUploaded(request)).resolves.toMatchObject({ fileId: first.fileId, uploaded: false })
    files.invalidate(request, first.fileId)
    await expect(files.ensureUploaded(request)).resolves.toMatchObject({ fileId: 'file-2', uploaded: true })
    now += (POLICY.expiresAfterSeconds - POLICY.refreshMarginSeconds) * 1_000
    await expect(files.ensureUploaded(request)).resolves.toMatchObject({ fileId: 'file-3', uploaded: true })
    expect(files.metrics()).toMatchObject({ uploads: 3, uploadedBytes: 9, refreshes: 1 })
    await mounted.dispose()
  })

  it('performs bounded quota cleanup and retry', async () => {
    const quota = new Error('quota')
    const upload = vi.fn()
      .mockRejectedValueOnce(quota)
      .mockResolvedValueOnce(result('file-recovered'))
    const reclaimQuota = vi.fn(async () => 1)
    const { mounted, files, request } = await fixture({
      id: 'provider-a',
      upload,
      reclaimQuota,
      isQuotaError: error => error === quota,
    })

    await expect(files.ensureUploaded(request)).resolves.toMatchObject({ fileId: 'file-recovered' })
    expect(upload).toHaveBeenCalledTimes(2)
    expect(reclaimQuota).toHaveBeenCalledWith(request.accountId, POLICY.quotaCleanupBatch, expect.any(AbortSignal))
    await mounted.dispose()
  })

  it('bounds ordinary retries and does not cache failed uploads', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('unavailable'))
    const { mounted, files, request } = await fixture({ id: 'provider-a', upload })

    await expect(files.ensureUploaded(request)).rejects.toThrow('unavailable')
    expect(upload).toHaveBeenCalledTimes(POLICY.maxRetries + 1)
    await expect(files.ensureUploaded({ ...request, policy: { ...POLICY, maxRetries: 0 } })).rejects.toThrow('unavailable')
    expect(files.metrics()).toMatchObject({ failures: 2, uploads: 0 })
    await mounted.dispose()
  })

  it('cleans expired files without exposing file ids in metrics', async () => {
    let now = NOW
    const deleteFile = vi.fn(async () => {})
    const { mounted, files, request } = await fixture({
      id: 'provider-a',
      upload: async () => result('file-expiring'),
      delete: deleteFile,
    }, () => now)
    await files.ensureUploaded(request)
    now += 600_001

    await expect(files.cleanupExpired()).resolves.toBe(1)
    expect(deleteFile).toHaveBeenCalledWith(request.accountId, ProviderFileId('file-expiring'), undefined)
    expect(JSON.stringify(files.metrics())).not.toContain('file-expiring')
    await mounted.dispose()
  })

  it('rejects metadata byte mismatches before calling a provider', async () => {
    const upload = vi.fn(async () => result('unused'))
    const { mounted, files, request } = await fixture({ id: 'provider-a', upload })

    expect(() => files.ensureUploaded({ ...request, attachment: { ...ATTACHMENT, bytes: 4 } }))
      .toThrow('do not match')
    expect(upload).not.toHaveBeenCalled()
    expect(files.metrics().rejectedBytes).toBe(3)
    await mounted.dispose()
  })
})
