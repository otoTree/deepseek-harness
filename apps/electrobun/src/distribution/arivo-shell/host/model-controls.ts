/** Original OS default selection over account-fenced native Arivo catalog queries. */
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ArivoLanguageAdapter, ArivoLanguageConfig } from './language-adapter.ts'
import type { ArivoLanguageHandle, ArivoLanguageHost } from './language-wire.ts'
import { modelRequestSchema, modelResponseSchema } from '../model-protocol.ts'
import type { ArivoModelResponse } from '../model-protocol.ts'

/** Existing OS default-model use case; account-specific DSH homes own its persistence. */
export interface ArivoDefaultModel {
  /** Read the existing OS default selection.
   * @returns Provider and model retained by the OS settings service.
   */
  currentSelection(): { provider: string; model: string }
  /** Save through the original settings owner, without changing existing Session selections.
   * @param selection - Validated Arivo route.
   * @returns Completion after durable settings storage.
   */
  saveSelection(selection: { provider: string; model: string }): Promise<void>
}

/** Own catalog operations and await all outstanding work on startup-plugin disposal. */
export class ArivoModelControls {
  private readonly lifetime = new AbortController()
  private readonly handles = new Set<ArivoLanguageHandle>()
  private readonly pending = new Set<Promise<ArivoModelResponse>>()
  constructor(private readonly host: ArivoLanguageHost, private readonly adapter: ArivoLanguageAdapter,
    private readonly defaults: ArivoDefaultModel, private readonly config: ArivoLanguageConfig,
    private readonly changed: () => void) {}

  /** Validate each local RPC before native access and return only safe catalog metadata.
   * @param raw - Untrusted authenticated local RPC payload.
   * @returns A bounded catalog page or the saved default status.
   */
  request(raw: unknown): Promise<ArivoModelResponse> {
    const operation = this.run(raw)
    this.pending.add(operation)
    void operation.finally(() => this.pending.delete(operation)).catch(() => {})
    return operation
  }
  private async run(raw: unknown): Promise<ArivoModelResponse> {
    this.lifetime.signal.throwIfAborted()
    const request = modelRequestSchema.parse(raw)
    if (request.type === 'state') return { type: 'state', configured: this.defaults.currentSelection().provider === 'arivo' }
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.config.catalogTimeoutMs)])
    if (request.type === 'select') {
      const model = `${request.cloudWorkspaceId}/${request.cloudProjectId}/${request.adapterId}`
      await this.adapter.resolveModel('arivo', model, signal)
      signal.throwIfAborted()
      await this.defaults.saveSelection({ provider: 'arivo', model })
      signal.throwIfAborted()
      this.changed()
      return { type: 'state', configured: true }
    }
    const handle = await this.host.languageSession()
    this.handles.add(handle)
    try {
      signal.throwIfAborted()
      if (handle.protocolVersion !== 1 || handle.catalog?.protocolVersion !== 1) {
        throw new LlmError('Update the Arivo creative plugin to browse models.', 'ARIVO_CATALOG_UNAVAILABLE')
      }
      switch (request.type) {
        case 'workspaces': return modelResponseSchema.parse({ type: request.type,
          ...await handle.catalog.workspaces(signal, request.cursor) })
        case 'projects': return modelResponseSchema.parse({ type: request.type,
          ...await handle.catalog.projects(request.cloudWorkspaceId, signal, request.cursor) })
        case 'models': {
          const page = await handle.session.models(request, signal, request.cursor)
          return modelResponseSchema.parse({ type: request.type, nextCursor: page.nextCursor,
            items: page.items.filter(item => item.tools).map(item => ({ id: item.id, name: item.displayName })) })
        }
        default: return assertNever(request, 'Arivo model operation')
      }
    } finally { handle.dispose(); this.handles.delete(handle) }
  }
  /** Stop native subscriptions and drain in-flight controls.
   * @returns Completion once all requests release their handles.
   */
  async close(): Promise<void> {
    this.lifetime.abort()
    for (const handle of this.handles) handle.dispose()
    await Promise.allSettled([...this.pending])
    this.handles.clear()
  }
}
