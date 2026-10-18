/** Browser-safe trigger rule, event, batch, and execution records. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable identity of a persisted trigger rule. */
export type TriggerRuleId = Branded<'TriggerRuleId'>
/** Stable identity of one normalized source event. */
export type TriggerEventId = Branded<'TriggerEventId'>
/** Stable identity of a durable delivery batch. */
export type TriggerBatchId = Branded<'TriggerBatchId'>

/** One-time or anchored recurring timer schedule, using ISO timestamps. */
export interface TimerTriggerSource {
  readonly kind: 'timer'
  readonly schedule:
    | { readonly kind: 'at'; readonly at: string }
    | { readonly kind: 'every'; readonly everySeconds: number; readonly anchorAt: string }
}

/** Relative-path glob selection and maximum directory depth. */
export interface FileFilter {
  readonly includes: readonly string[]
  readonly excludes: readonly string[]
  readonly maxDepth: number
}

/** Local roots with write stabilization and an event-rate limit. */
export interface LocalFileTriggerSource {
  readonly kind: 'local-file'
  readonly roots: readonly string[]
  readonly filter: FileFilter
  readonly stabilityMs: number
  readonly maxEventsPerMinute: number
}

/** Cloud space and relative-path selection for cursor polling. */
export interface CloudFileTriggerSource {
  readonly kind: 'cloud-file'
  readonly spaceId: string
  readonly filter: FileFilter
}

/** Source configuration retained in each rule revision. */
export type TriggerSourceSpec = TimerTriggerSource | LocalFileTriggerSource | CloudFileTriggerSource

/** Individual delivery or resource coalescing within a bounded window. */
export type TriggerDeliveryPolicy =
  | { readonly kind: 'queue-each' }
  | { readonly kind: 'batch-window'; readonly windowMs: number }

/** Persisted Session receiving queued trigger prompts. */
export interface ExistingSessionTarget {
  readonly kind: 'existing-session'
  readonly sessionId: SessionId
}

/** Workspace, presets, model and title used for idempotent Session creation. */
export interface NewSessionTarget {
  readonly kind: 'new-session'
  readonly workspacePath: string
  readonly agentPreset: string
  readonly permissionPreset: string
  readonly model?: { readonly provider: string; readonly model: string }
  readonly titleTemplate: string
}

/** Persisted destination for an accepted trigger batch. */
export type TriggerTarget = ExistingSessionTarget | NewSessionTarget

/** Revisioned prompt text rendered with rule, batch and resource variables. */
export interface VersionedInstructionTemplate {
  readonly version: number
  readonly text: string
}

/** Immutable rule revision with source, delivery and target configuration. */
export interface TriggerRule {
  readonly id: TriggerRuleId
  readonly version: number
  readonly name: string
  readonly enabled: boolean
  readonly source: TriggerSourceSpec
  readonly delivery: TriggerDeliveryPolicy
  readonly target: TriggerTarget
  readonly instructionTemplate: VersionedInstructionTemplate
  readonly createdBy: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** Resource operation and versions retained when a batch is formed. */
export interface TriggerResourceSnapshot {
  readonly resourceId: string
  readonly displayName: string
  readonly operation: 'created' | 'updated' | 'deleted' | 'timer'
  readonly version: string
  readonly mergedVersions: readonly string[]
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>
}

/** Normalized source event with a stable source identity for deduplication. */
export interface TriggerEvent {
  readonly id: TriggerEventId
  readonly sourceEventId: string
  readonly ruleId: TriggerRuleId
  readonly occurredAt: string
  readonly resource: TriggerResourceSnapshot
}

/** Durable delivery status; unknown requires an explicit retry after recovery. */
export type TriggerBatchState = 'queued' | 'delivering' | 'delivered' | 'processing' | 'failed' | 'unknown' | 'cancelled'

/** Persisted batch retaining its rule revision and resource versions. */
export interface TriggerBatch {
  readonly id: TriggerBatchId
  readonly ruleId: TriggerRuleId
  readonly ruleVersion: number
  /** Immutable rule revision used when this batch was formed. */
  readonly ruleSnapshot: TriggerRule
  readonly eventIds: readonly TriggerEventId[]
  readonly resources: readonly TriggerResourceSnapshot[]
  readonly createdAt: string
  readonly state: TriggerBatchState
  readonly sessionId?: SessionId
  readonly deliveredAt?: string
  readonly error?: string
}

/** Current source health and the timestamp of its last report. */
export interface TriggerProviderStatus {
  readonly ruleId: TriggerRuleId
  readonly state: 'watching' | 'idle' | 'missed' | 'failed'
  readonly message?: string
  readonly updatedAt: string
}

/** Rule, batch and source-health view returned to the enterprise client. */
export interface TriggerSnapshot {
  readonly rules: readonly TriggerRule[]
  readonly batches: readonly TriggerBatch[]
  readonly providers: readonly TriggerProviderStatus[]
}

/** Validated rule authoring fields; an omitted id creates a new rule. */
export interface TriggerRuleInput {
  readonly id?: TriggerRuleId
  readonly name: string
  readonly enabled: boolean
  readonly source: TriggerSourceSpec
  readonly delivery: TriggerDeliveryPolicy
  readonly target: TriggerTarget
  readonly instructionTemplate: VersionedInstructionTemplate
  readonly createdBy: string
}

/** Runtime callbacks for durable event ingestion and source-health reporting. */
export interface TriggerProviderContext {
  readonly emit: (event: TriggerEvent) => Promise<void>
  readonly report: (status: TriggerProviderStatus) => void
}

/** Owned source adapter whose replacement and disposal await resource cleanup. */
export interface TriggerSourceProvider {
  readonly kind: TriggerSourceSpec['kind']
  /**
   * Replace the enabled source subscriptions.
   * @param rules - Current rule revisions for this source kind.
   */
  replaceRules(rules: readonly TriggerRule[]): Promise<void>
  /** Stop subscriptions and await owned resource cleanup. */
  dispose(): Promise<void>
}

/** Public trigger runtime operations used by the enterprise Host bridge. */
export interface TriggerServiceContract {
  /**
   * Read persisted rules, delivery history and current source health.
   * @returns An independent snapshot for presentation.
   */
  snapshot(): Promise<TriggerSnapshot>
  /**
   * Validate and persist a new immutable rule revision.
   * @param input - Authoring fields and optional existing rule id.
   * @returns The persisted revision.
   */
  saveRule(input: TriggerRuleInput): Promise<TriggerRule>
  /**
   * Persist an enabled-state revision and update source subscriptions.
   * @param id - Existing rule identity.
   * @param enabled - Whether the source may emit new events.
   * @returns The persisted revision.
   */
  setEnabled(id: TriggerRuleId, enabled: boolean): Promise<TriggerRule>
  /**
   * Remove a rule and cancel its queued work.
   * @param id - Existing rule identity.
   */
  removeRule(id: TriggerRuleId): Promise<void>
  /**
   * Queue a failed or uncertain batch for explicit redelivery.
   * @param id - Persisted batch identity.
   */
  retryBatch(id: TriggerBatchId): Promise<void>
  /**
   * Install one source kind; duplicate kinds are refused.
   * @param create - Factory receiving runtime-owned ingestion and reporting callbacks.
   * @returns A disposer that unregisters and stops the provider.
   */
  registerSourceProvider(create: (context: TriggerProviderContext) => TriggerSourceProvider): () => void
}

/** Committed cloud resource version returned by the enterprise change feed. */
export interface CloudFileChange {
  readonly id: string
  readonly spaceId: string
  readonly nodeId: string
  readonly versionId: string
  readonly name: string
  readonly operation: 'created' | 'updated' | 'deleted'
  readonly occurredAt: string
}

/** Cursor page; skipped indicates that unavailable history was not replayed. */
export interface CloudFileChangePage {
  readonly cursor: string
  readonly skipped: boolean
  readonly items: readonly CloudFileChange[]
}
