/** Original OS LLM adapter consuming the verified Arivo plugin's versioned native operations. */
import { createHash } from 'node:crypto'
import { LlmAdapter, LlmError, isAgentLoopRequest, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import { arivoLanguageInput, arivoLanguageChunk, arivoModelRoute, arivoStepCommand } from './language-mapping.ts'
import type { ArivoLanguageHandle, ArivoLanguageHost } from './language-wire.ts'

/** Deployment-owned discovery and default output limits; never override a frozen request's explicit cap. */
export interface ArivoLanguageConfig {
  defaultMaxOutputTokens: number
  catalogTimeoutMs: number
  maxCatalogPages: number
}

/** One Arivo route, original OS sessions and tools, and no automatic paid request retries. */
export class ArivoLanguageAdapter extends LlmAdapter {
  private readonly lifetime = new AbortController()
  private readonly handles = new Set<ArivoLanguageHandle>()
  private readonly calls = new Map<symbol, AsyncGenerator<StreamChunk>>()
  private closing?: Promise<void>
  constructor(private readonly host: ArivoLanguageHost, private readonly sessions: SessionStore,
    private readonly config: ArivoLanguageConfig, private readonly stopFailed: () => void,
    private readonly selectedRoute: () => string | undefined = () => undefined) { super() }

  override providerInfo(provider: string) { return { id: provider, name: 'Arivo' } }
  override providerRetryPolicy(): ResolvedRetryPolicy {
    return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'Arivo model recovery')
  }
  override async listModels(provider: string, signal?: AbortSignal): Promise<readonly LlmModelInfo[]> {
    const selected = this.selectedRoute()
    if (!selected) return []
    return this.projectModels(provider, selected, signal)
  }
  /** Discover only the explicitly authorized project's tool-capable online models.
   * @param provider - Registered Arivo provider id.
   * @param model - Verified workspace/project/adapter route.
   * @param signal - Owning Session catalog read cancellation.
   * @returns Bounded advisory entries without changing deployment or Session defaults.
   */
  async projectModels(provider: string, model: string, signal?: AbortSignal): Promise<readonly LlmModelInfo[]> {
    signal?.throwIfAborted()
    const route = arivoModelRoute(model), handle = await this.open()
    const joined = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.config.catalogTimeoutMs), ...signal ? [signal] : []])
    const items: LlmModelInfo[] = [], cursors = new Set<string>()
    let cursor: string | undefined
    try {
      for (let page = 0; page < this.config.maxCatalogPages; page++) {
        joined.throwIfAborted()
        const result = await handle.session.models(route, joined, cursor)
        joined.throwIfAborted()
        items.push(...result.items.filter(item => item.tools).map(item => ({
          provider, id: `${route.cloudWorkspaceId}/${route.cloudProjectId}/${item.id}`, name: item.displayName, inputModalities: ['text' as const],
        })))
        if (!result.nextCursor) return items
        if (cursors.has(result.nextCursor)) throw new LlmError('Invalid Arivo model catalog.', 'ARIVO_PROTOCOL_UNAVAILABLE')
        cursors.add(result.nextCursor); cursor = result.nextCursor
      }
      throw new LlmError('Arivo model catalog exceeds its configured budget.', 'ARIVO_CATALOG_LIMIT')
    } finally { this.release(handle) }
  }
  private async open() {
    this.lifetime.signal.throwIfAborted()
    const handle = await this.host.languageSession()
    if (this.lifetime.signal.aborted || handle.protocolVersion !== 1) {
      handle.dispose(); throw new LlmError('Arivo model bridge is unavailable.', 'ARIVO_PROTOCOL_UNAVAILABLE')
    }
    this.handles.add(handle)
    return handle
  }
  private release(handle: ArivoLanguageHandle) { handle.dispose(); this.handles.delete(handle) }
  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const route = arivoModelRoute(model), handle = await this.open()
    const joined = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.config.catalogTimeoutMs), ...signal ? [signal] : []])
    try {
      let cursor: string | undefined
      const cursors = new Set<string>()
      for (let page = 0; page < this.config.maxCatalogPages; page++) {
        const result = await handle.session.models(route, joined, cursor)
        const found = result.items.find(item => item.id === route.adapterId)
        if (found && !found.tools) throw new LlmError('This model does not support Agent tools.', 'ARIVO_TOOLS_REQUIRED')
        if (found) return { provider, id: model, name: found.displayName,
          inputModalities: ['text'], defaultMaxTokens: Math.min(this.config.defaultMaxOutputTokens, found.maxOutputTokens) }
        if (!result.nextCursor) break
        if (cursors.has(result.nextCursor)) throw new LlmError('Invalid Arivo model catalog.', 'ARIVO_PROTOCOL_UNAVAILABLE')
        cursors.add(result.nextCursor); cursor = result.nextCursor
      }
      throw new LlmError('The selected Arivo model is unavailable for this project.', 'ARIVO_MODEL_UNAVAILABLE')
    } finally { this.release(handle) }
  }
  private stepIdentity(options: GenerateOptions) {
    if (!options.sessionId) throw new LlmError('Arivo model calls require a durable Session.', 'ARIVO_SESSION_REQUIRED')
    const session = this.sessions.get(options.sessionId)
    if (!session) throw new LlmError('Arivo Session is not active.', 'ARIVO_SESSION_REQUIRED')
    if (isAgentLoopRequest(options)) {
      const boundary = session.snapshotEvents().findLast(event => event.type === 'step/start' || event.type === 'step/end')
      if (!boundary || boundary.type !== 'step/start') throw new LlmError('Arivo model calls require an open durable step.', 'ARIVO_STEP_REQUIRED')
      return { sessionId: String(session.id), stepId: `step:${boundary.seq}` }
    }
    if (!options.purpose) throw new LlmError('Arivo auxiliary calls require an explicit purpose.', 'ARIVO_STEP_REQUIRED')
    const digest = createHash('sha256').update(JSON.stringify(options.messages.map(message => String(message.id)))).digest('hex')
    return { sessionId: String(session.id), stepId: `aux:${options.purpose}:${digest}` }
  }
  override stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    this.lifetime.signal.throwIfAborted()
    const key = Symbol()
    const iterator = this.tracked(options, key)
    this.calls.set(key, iterator)
    return iterator
  }
  private async *tracked(options: GenerateOptions, key: symbol): AsyncGenerator<StreamChunk> {
    try { yield* this.generate(options) }
    finally { this.calls.delete(key) }
  }
  private async *generate(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const route = arivoModelRoute(options.model), identity = this.stepIdentity(options), input = arivoLanguageInput(options)
    const commandId = arivoStepCommand(identity.sessionId, identity.stepId), handle = await this.open()
    const joined = AbortSignal.any([this.lifetime.signal, ...options.signal ? [options.signal] : []])
    let stop: Promise<void> | undefined
    const cancel = () => {
      // Teardown only closes subscriptions. An explicit live Agent abort persists a separate stop command.
      if (this.lifetime.signal.aborted || stop) return
      stop = handle.session.stop(commandId).then(() => {}, () => { this.stopFailed() })
    }
    options.signal?.addEventListener('abort', cancel, { once: true })
    try {
      joined.throwIfAborted()
      for await (const event of handle.session.run({ ...identity, ...route, commandId, input }, joined)) {
        joined.throwIfAborted()
        const chunk = arivoLanguageChunk(event)
        if (chunk) yield chunk
      }
    } catch (error: unknown) {
      if (options.signal?.aborted && !this.lifetime.signal.aborted) cancel()
      if (joined.aborted) throw new LlmError('Arivo model subscription stopped.', 'ABORTED')
      const code = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        && (/^(?:LANGUAGE_[A-Z_]+|COMMAND_CONFLICT|REVISION_CONFLICT|SIGN_IN_REQUIRED|LOCAL_SCOPE_CHANGED)$/.test(error.code)
          || /^(?:BILLING_[A-Z_]+|GENERATION_QUOTE_CHANGED|IDEMPOTENCY_CONFLICT)$/.test(error.code))
        ? error.code : 'ARIVO_MODEL_RECOVERY_REQUIRED'
      const guidance: Record<string, string> = {
        BILLING_BUDGET_NOT_FOUND: '项目尚未配置预算。请打开 Arivo 账号 → 项目预算。',
        BILLING_BUDGET_EXCEEDED: '项目预算不足。请打开 Arivo 账号 → 项目预算。',
        BILLING_WORKSPACE_CREDITS_EXCEEDED: '空间可用积分不足。请打开 Arivo 账号 → 团队积分与成员额度，向此空间分配积分。',
        BILLING_TEAM_MIGRATION_REQUIRED: '团队账本尚未接入。请打开 Arivo 账号 → 团队积分与成员额度。',
        BILLING_TEAM_CREDITS_EXCEEDED: '团队可分配积分不足。请打开 Arivo 账号 → 团队积分与成员额度。',
        BILLING_MEMBER_BUDGET_EXCEEDED: '成员消费额度不足。请联系团队管理员调整成员积分预算。',
        BILLING_MEMBER_PAUSED: '成员消费权限已暂停。请联系团队管理员。',
        BILLING_PROJECT_PAUSED: '项目账务正在核对，请在 Arivo 账号中查看账单与任务。',
        BILLING_PROJECT_SETTLEMENT_PENDING: '项目有待结算费用。请在 Arivo 账号中核对账单与空间积分。',
        GENERATION_QUOTE_CHANGED: '模型配置或报价已变化。请核对原调用后重新选择模型。',
      }
      throw new LlmError(guidance[code]
        ?? 'Arivo model output could not be confirmed. Recover the original call before starting another.', code)
    } finally {
      options.signal?.removeEventListener('abort', cancel)
      await stop
      this.release(handle)
    }
  }
  /** Close all subscriptions during plugin teardown; do not cancel accepted cloud calls.
   * @returns Completion after active generators release their handles.
   */
  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.lifetime.abort()
      for (const handle of this.handles) handle.dispose()
      await Promise.allSettled([...this.calls.values()].map(iterator => iterator.return(undefined)))
      this.calls.clear(); this.handles.clear()
    })()
  }
}
