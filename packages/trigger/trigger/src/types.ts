/** Browser-safe trigger rule, event, batch, and execution records. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export type TriggerRuleId = Branded<'TriggerRuleId'>
export type TriggerEventId = Branded<'TriggerEventId'>
export type TriggerBatchId = Branded<'TriggerBatchId'>

export interface TimerTriggerSource {
  readonly kind: 'timer'
  readonly schedule:
    | { readonly kind: 'at'; readonly at: string }
    | { readonly kind: 'every'; readonly everySeconds: number; readonly anchorAt: string }
}

export interface FileFilter {
  readonly includes: readonly string[]
  readonly excludes: readonly string[]
  readonly maxDepth: number
}

export interface LocalFileTriggerSource {
  readonly kind: 'local-file'
  readonly roots: readonly string[]
  readonly filter: FileFilter
  readonly stabilityMs: number
  readonly maxEventsPerMinute: number
}

export interface CloudFileTriggerSource {
  readonly kind: 'cloud-file'
  readonly spaceId: string
  readonly filter: FileFilter
}

export type TriggerSourceSpec = TimerTriggerSource | LocalFileTriggerSource | CloudFileTriggerSource

export type TriggerDeliveryPolicy =
  | { readonly kind: 'queue-each' }
  | { readonly kind: 'batch-window'; readonly windowMs: number }

export interface ExistingSessionTarget {
  readonly kind: 'existing-session'
  readonly sessionId: SessionId
}

export interface NewSessionTarget {
  readonly kind: 'new-session'
  readonly workspacePath: string
  readonly agentPreset: string
  readonly permissionPreset: string
  readonly model?: { readonly provider: string; readonly model: string }
  readonly titleTemplate: string
}

export type TriggerTarget = ExistingSessionTarget | NewSessionTarget

export interface VersionedInstructionTemplate {
  readonly version: number
  readonly text: string
}

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

export interface TriggerResourceSnapshot {
  readonly resourceId: string
  readonly displayName: string
  readonly operation: 'created' | 'updated' | 'deleted' | 'timer'
  readonly version: string
  readonly mergedVersions: readonly string[]
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>
}

export interface TriggerEvent {
  readonly id: TriggerEventId
  readonly sourceEventId: string
  readonly ruleId: TriggerRuleId
  readonly occurredAt: string
  readonly resource: TriggerResourceSnapshot
}

export type TriggerBatchState = 'queued' | 'delivering' | 'delivered' | 'processing' | 'failed' | 'unknown' | 'cancelled'

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

export interface TriggerProviderStatus {
  readonly ruleId: TriggerRuleId
  readonly state: 'watching' | 'idle' | 'missed' | 'failed'
  readonly message?: string
  readonly updatedAt: string
}

export interface TriggerSnapshot {
  readonly rules: readonly TriggerRule[]
  readonly batches: readonly TriggerBatch[]
  readonly providers: readonly TriggerProviderStatus[]
}

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

export interface TriggerProviderContext {
  readonly emit: (event: TriggerEvent) => Promise<void>
  readonly report: (status: TriggerProviderStatus) => void
}

export interface TriggerSourceProvider {
  readonly kind: TriggerSourceSpec['kind']
  replaceRules(rules: readonly TriggerRule[]): Promise<void>
  dispose(): Promise<void>
}

/** Public trigger runtime operations used by the enterprise Host bridge. */
export interface TriggerServiceContract {
  snapshot(): Promise<TriggerSnapshot>
  saveRule(input: TriggerRuleInput): Promise<TriggerRule>
  setEnabled(id: TriggerRuleId, enabled: boolean): Promise<TriggerRule>
  removeRule(id: TriggerRuleId): Promise<void>
  retryBatch(id: TriggerBatchId): Promise<void>
  registerSourceProvider(create: (context: TriggerProviderContext) => TriggerSourceProvider): () => void
}

export interface CloudFileChange {
  readonly id: string
  readonly spaceId: string
  readonly nodeId: string
  readonly versionId: string
  readonly name: string
  readonly operation: 'created' | 'updated' | 'deleted'
  readonly occurredAt: string
}

export interface CloudFileChangePage {
  readonly cursor: string
  readonly skipped: boolean
  readonly items: readonly CloudFileChange[]
}
