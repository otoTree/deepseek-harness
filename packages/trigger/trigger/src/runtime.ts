import { createHash, randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { z } from 'zod'
import { TriggerBatchId, TriggerRuleId } from './brand.ts'
import { LocalFileTriggerProvider, TimerTriggerProvider } from './providers.ts'
import { triggerEventSchema, triggerRuleInputSchema } from './schema.ts'
import { readTriggerState, writeTriggerState, type PersistedTriggerState } from './store.ts'
import type {
  TriggerBatch, TriggerBatchId as TriggerBatchIdType, TriggerEvent, TriggerProviderStatus,
  TriggerProviderContext, TriggerRule, TriggerRuleId as TriggerRuleIdType, TriggerRuleInput, TriggerServiceContract,
  TriggerSnapshot, TriggerSourceProvider,
} from './types.ts'

export const triggerConfigSchema = z.object({
  statePath: z.string().refine(isAbsolute),
  maxParallelTargets: z.number().int().min(1).max(32).default(4),
  retainedEvents: z.number().int().min(100).max(100_000).default(10_000),
  retainedBatches: z.number().int().min(100).max(100_000).default(10_000),
}).strict()
export type TriggerConfig = z.infer<typeof triggerConfigSchema>

declare module '@deepseek-ai/cordis' {
  interface Context {
    triggers: TriggerServiceContract
  }
}

function isoNow(): string { return new Date().toISOString() }

function renderTemplate(template: string, rule: TriggerRule, batch: TriggerBatch): string {
  const resources = JSON.stringify(batch.resources)
  const variables: Record<string, string> = {
    'batch.id': String(batch.id),
    'rule.id': String(rule.id),
    'rule.name': rule.name,
    'events.count': String(batch.eventIds.length),
    'resources.count': String(batch.resources.length),
    'resources.json': resources,
  }
  return template.replace(/\{\{\s*([a-z.]+)\s*\}\}/gu, (_match, name: string) => {
    const value = variables[name]
    if (value === undefined) throw new Error(`trigger template references unknown variable "${name}"`)
    return value
  })
}

function batchResources(events: readonly TriggerEvent[]): TriggerBatch['resources'] {
  const grouped = new Map<string, TriggerEvent[]>()
  for (const event of events) {
    const list = grouped.get(event.resource.resourceId) ?? []
    list.push(event)
    grouped.set(event.resource.resourceId, list)
  }
  return [...grouped.values()].map((items) => {
    const latest = items.at(-1)
    if (latest === undefined) throw new Error('trigger: empty resource group')
    const versions = [...new Set(items.flatMap(item => item.resource.mergedVersions))]
    return { ...latest.resource, mergedVersions: versions }
  })
}

function executionKey(batch: TriggerBatch): string {
  return batch.ruleSnapshot.target.kind === 'existing-session'
    ? `session:${String(batch.ruleSnapshot.target.sessionId)}`
    : `batch:${String(batch.id)}`
}

/** Local trigger rule store, event batcher, and Session dispatcher. */
export class TriggerService extends Service implements TriggerServiceContract {
  static inject = ['sessionController', 'permissionPresets']

  private readonly config: TriggerConfig
  private state: PersistedTriggerState = { version: 1, rules: [], events: [], batches: [], cloudCursors: {} }
  private readonly providers = new Map<TriggerSourceProvider['kind'], TriggerSourceProvider>()
  private readonly providerContext: {
    emit: (event: TriggerEvent) => Promise<void>
    report: (status: TriggerProviderStatus) => void
  }
  private readonly statuses = new Map<TriggerRuleIdType, TriggerProviderStatus>()
  private readonly batchTimers = new Map<TriggerRuleIdType, ReturnType<typeof setTimeout>>()
  private readonly activeKeys = new Set<string>()
  private readonly activeRuns = new Set<Promise<void>>()
  private mutation = Promise.resolve()
  private disposed = false
  private readonly ready: Promise<void>
  private readonly abort = new AbortController()

  constructor(ctx: Context, input: TriggerConfig) {
    super(ctx, 'triggers')
    this.config = triggerConfigSchema.parse(input)
    this.providerContext = {
      emit: (event: TriggerEvent) => this.ingest(event),
      report: (status: TriggerProviderStatus) => { this.statuses.set(status.ruleId, status) },
    }
    this.providers.set('timer', new TimerTriggerProvider(this.providerContext))
    this.providers.set('local-file', new LocalFileTriggerProvider(this.providerContext))
    this.ready = this.initialize()
    ctx.effect(() => async () => { await this.disposeRuntime() }, 'trigger.runtime')
  }

  /** Read the current rule, queue, and provider presentation. */
  async snapshot(): Promise<TriggerSnapshot> {
    await this.ready
    return {
      rules: structuredClone(this.state.rules),
      batches: structuredClone(this.state.batches),
      providers: structuredClone([...this.statuses.values()]),
    }
  }

  /** Create a rule or publish its next immutable revision. */
  async saveRule(raw: TriggerRuleInput): Promise<TriggerRule> {
    const input = triggerRuleInputSchema.parse(raw) as unknown as TriggerRuleInput
    if (input.source.kind === 'timer' && input.delivery.kind !== 'queue-each') {
      throw new Error('timer trigger rules require queue-each delivery')
    }
    if (input.source.kind !== 'timer' && input.delivery.kind !== 'batch-window') {
      throw new Error('file trigger rules require batch-window delivery')
    }
    await this.validateRuleInput(input)
    const saved = await this.mutate(async () => {
      const existing = input.id === undefined ? undefined : this.state.rules.find(rule => rule.id === input.id)
      if (input.id !== undefined && existing === undefined) {
        throw new Error(`trigger rule "${String(input.id)}" was not found`)
      }
      if (existing !== undefined) this.formPendingBatch(existing)
      const now = isoNow()
      const rule: TriggerRule = {
        ...input,
        id: existing?.id ?? TriggerRuleId(randomUUID()),
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      if (existing === undefined) this.state.rules.push(rule)
      else this.state.rules.splice(this.state.rules.indexOf(existing), 1, rule)
      return rule
    })
    await this.syncProviders()
    this.pump()
    return structuredClone(saved)
  }

  /** Enable or pause one rule as a new revision. */
  async setEnabled(id: TriggerRuleIdType, enabled: boolean): Promise<TriggerRule> {
    await this.ready
    const rule = this.state.rules.find(item => item.id === id)
    if (rule === undefined) throw new Error(`trigger rule "${String(id)}" was not found`)
    return this.saveRule({ ...rule, enabled })
  }

  /** Remove one rule and cancel its batches that have not begun delivery. */
  async removeRule(id: TriggerRuleIdType): Promise<void> {
    await this.mutate(async () => {
      const index = this.state.rules.findIndex(rule => rule.id === id)
      if (index < 0) throw new Error(`trigger rule "${String(id)}" was not found`)
      this.state.rules.splice(index, 1)
      this.state.batches = this.state.batches.map(batch => batch.ruleId === id && batch.state === 'queued'
        ? { ...batch, state: 'cancelled' }
        : batch)
    })
    const timer = this.batchTimers.get(id)
    if (timer !== undefined) clearTimeout(timer)
    this.batchTimers.delete(id)
    this.statuses.delete(id)
    await this.syncProviders()
  }

  /** Return one failed or unknown batch to its original target queue. */
  async retryBatch(id: TriggerBatchIdType): Promise<void> {
    await this.mutate(async () => {
      const index = this.state.batches.findIndex(batch => batch.id === id)
      const batch = this.state.batches[index]
      if (batch === undefined) throw new Error(`trigger batch "${String(id)}" was not found`)
      if (batch.state !== 'failed' && batch.state !== 'unknown') throw new Error('only failed or unknown trigger batches can be retried')
      const { error: _error, ...retryable } = batch
      this.state.batches[index] = { ...retryable, state: 'queued' }
    })
    this.pump()
  }

  /** Add one event-source provider. The returned disposer retracts and settles it. */
  registerSourceProvider(create: (context: TriggerProviderContext) => TriggerSourceProvider): () => void {
    const provider = create(this.providerContext)
    if (this.providers.has(provider.kind)) throw new Error(`trigger source provider "${provider.kind}" is already registered`)
    this.providers.set(provider.kind, provider)
    void this.ready.then(() => this.syncProvider(provider)).catch(error => this.ctx.logger.warn(String(error)))
    return () => {
      if (this.providers.get(provider.kind) !== provider) return
      this.providers.delete(provider.kind)
      void provider.dispose().catch(error => this.ctx.logger.warn(String(error)))
    }
  }

  private async initialize(): Promise<void> {
    this.state = await readTriggerState(this.config.statePath)
    let recovered = false
    this.state.batches = this.state.batches.map((batch) => {
      if (batch.state !== 'delivering' && batch.state !== 'processing') return batch
      recovered = true
      return { ...batch, state: 'unknown', error: 'Runtime stopped before delivery completion could be confirmed.' }
    })
    if (recovered) await writeTriggerState(this.config.statePath, this.state)
    for (const rule of this.state.rules) this.schedulePendingBatch(rule)
    await this.syncProviders()
    this.pump()
  }

  private async ingest(raw: TriggerEvent): Promise<void> {
    const event = triggerEventSchema.parse(raw) as unknown as TriggerEvent
    const rule = this.state.rules.find(item => item.id === event.ruleId)
    if (rule === undefined || !rule.enabled) return
    let accepted = false
    await this.mutate(async () => {
      if (this.state.events.some(item => item.sourceEventId === event.sourceEventId)) return
      this.state.events.push(event)
      accepted = true
      if (rule.delivery.kind === 'queue-each') this.formBatch(rule, [event])
    })
    if (!accepted) return
    if (rule.delivery.kind === 'batch-window') this.schedulePendingBatch(rule)
    else this.pump()
  }

  private schedulePendingBatch(rule: TriggerRule): void {
    if (rule.delivery.kind !== 'batch-window' || this.batchTimers.has(rule.id) || this.disposed) return
    this.batchTimers.set(rule.id, setTimeout(() => {
      this.batchTimers.delete(rule.id)
      void this.flushBatch(rule.id)
    }, rule.delivery.windowMs))
  }

  private async flushBatch(ruleId: TriggerRuleIdType): Promise<void> {
    await this.mutate(async () => {
      const rule = this.state.rules.find(item => item.id === ruleId)
      if (rule === undefined || !rule.enabled) return
      this.formPendingBatch(rule)
    })
    this.pump()
  }

  private formPendingBatch(rule: TriggerRule): void {
    const used = new Set(this.state.batches.flatMap(batch => batch.eventIds))
    const pending = this.state.events.filter(event => event.ruleId === rule.id && !used.has(event.id))
    if (pending.length > 0) this.formBatch(rule, pending)
  }

  private formBatch(rule: TriggerRule, events: readonly TriggerEvent[]): void {
    this.state.batches.push({
      id: TriggerBatchId(randomUUID()), ruleId: rule.id, ruleVersion: rule.version,
      ruleSnapshot: structuredClone(rule), eventIds: events.map(event => event.id),
      resources: batchResources(events), createdAt: isoNow(), state: 'queued',
    })
  }

  private pump(): void {
    if (this.disposed) return
    while (this.activeRuns.size < this.config.maxParallelTargets) {
      const batch = this.state.batches.find(item => item.state === 'queued' && !this.activeKeys.has(executionKey(item)))
      if (batch === undefined) return
      const key = executionKey(batch)
      this.activeKeys.add(key)
      const run = this.execute(batch.id).finally(() => {
        this.activeKeys.delete(key)
        this.activeRuns.delete(run)
        this.pump()
      })
      this.activeRuns.add(run)
    }
  }

  private async execute(id: TriggerBatchIdType): Promise<void> {
    let batch = this.state.batches.find(item => item.id === id)
    if (batch === undefined || batch.state !== 'queued') return
    await this.updateBatch(id, (current) => {
      const { error: _error, ...deliverable } = current
      return { ...deliverable, state: 'delivering' }
    })
    batch = this.state.batches.find(item => item.id === id)
    if (batch === undefined) return
    try {
      const rule = batch.ruleSnapshot
      const prompt = renderTemplate(rule.instructionTemplate.text, rule, batch)
      let sessionId: SessionId
      if (rule.target.kind === 'existing-session') {
        sessionId = rule.target.sessionId
      } else {
        const digest = createHash('sha256').update(`${String(rule.id)}:${String(batch.id)}`).digest('hex').slice(0, 32)
        sessionId = batch.sessionId ?? SessionId(`trigger-${digest}`)
        if (batch.sessionId === undefined) {
          await this.updateBatch(id, current => ({ ...current, sessionId }))
          const created = await this.sessionController().create({
            sessionId, cwd: rule.target.workspacePath, agentPreset: rule.target.agentPreset,
          })
          sessionId = created.sessionId
          const resolved = await this.sessionController().resolveAgent(sessionId)
          if ('error' in resolved) throw resolved.error
          this.ctx.permissionPresets.set(resolved.agent.session, rule.target.permissionPreset)
          await this.sessionController().rename({ sessionId, title: renderTemplate(rule.target.titleTemplate, rule, batch) })
          if (rule.target.model !== undefined) {
            await this.sessionController().selectModel({ sessionId, ...rule.target.model })
          }
        }
      }
      this.abort.signal.throwIfAborted()
      await this.sessionController().prompt({
        requestId: `trigger:${String(batch.id)}` as SessionRequestId,
        sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }],
      }, this.abort.signal)
      await this.updateBatch(id, current => ({ ...current, state: 'delivered', sessionId, deliveredAt: isoNow() }))
    } catch (error) {
      if (this.disposed) {
        await this.updateBatch(id, current => ({ ...current, state: 'unknown', error: 'Runtime stopped while delivery was in progress.' }))
      } else {
        await this.updateBatch(id, current => ({ ...current, state: 'failed', error: String(error) }))
      }
    }
  }

  private sessionController(): SessionController {
    const controller = this.ctx.get('sessionController')
    if (controller === undefined) throw new Error('trigger: sessionController service is unavailable')
    return controller
  }

  private async validateRuleInput(input: TriggerRuleInput): Promise<void> {
    if (input.source.kind === 'local-file') {
      await Promise.all(input.source.roots.map(async (root) => {
        const info = await stat(root)
        if (!info.isDirectory()) throw new Error(`trigger local root is not a directory: ${root}`)
      }))
    }
    if (input.target.kind === 'existing-session') {
      await this.sessionController().inspect(input.target.sessionId)
      return
    }
    const workspace = await stat(input.target.workspacePath)
    if (!workspace.isDirectory()) {
      throw new Error(`trigger workspace path is not a directory: ${input.target.workspacePath}`)
    }
    this.ctx.permissionPresets.resolve(input.target.permissionPreset)
  }

  private async updateBatch(id: TriggerBatchIdType, update: (batch: TriggerBatch) => TriggerBatch): Promise<void> {
    await this.mutate(async () => {
      const index = this.state.batches.findIndex(batch => batch.id === id)
      const batch = this.state.batches[index]
      if (batch !== undefined) this.state.batches[index] = update(batch)
    })
  }

  private async mutate<T>(operation: () => Promise<T> | T): Promise<T> {
    await this.ready.catch(() => undefined)
    let resolveResult!: (value: T) => void
    let rejectResult!: (reason?: unknown) => void
    const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
    this.mutation = this.mutation.then(async () => {
      try {
        const value = await operation()
        this.trimState()
        await writeTriggerState(this.config.statePath, this.state)
        resolveResult(value)
      } catch (error) {
        rejectResult(error)
      }
    })
    return result
  }

  private trimState(): void {
    if (this.state.events.length > this.config.retainedEvents) {
      const referenced = new Set(this.state.batches.flatMap(batch => batch.eventIds))
      const removable = this.state.events.filter(event => !referenced.has(event.id))
      const remove = new Set(removable.slice(0, this.state.events.length - this.config.retainedEvents).map(event => event.id))
      this.state.events = this.state.events.filter(event => !remove.has(event.id))
    }
    if (this.state.batches.length > this.config.retainedBatches) {
      const removable = this.state.batches.filter(batch => ['delivered', 'failed', 'cancelled'].includes(batch.state))
      const remove = new Set(removable.slice(0, this.state.batches.length - this.config.retainedBatches).map(batch => batch.id))
      this.state.batches = this.state.batches.filter(batch => !remove.has(batch.id))
    }
  }

  private async syncProviders(): Promise<void> {
    await Promise.all([...this.providers.values()].map(provider => this.syncProvider(provider)))
  }

  private syncProvider(provider: TriggerSourceProvider): Promise<void> {
    return provider.replaceRules(this.state.rules.filter(rule => rule.source.kind === provider.kind))
  }

  private async disposeRuntime(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.abort.abort('trigger Runtime disposed')
    for (const timer of this.batchTimers.values()) clearTimeout(timer)
    this.batchTimers.clear()
    await Promise.allSettled([...this.providers.values()].map(provider => provider.dispose()))
    await Promise.allSettled([...this.activeRuns])
  }
}
