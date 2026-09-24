/** Managed trigger capability: rules, source providers, batching, and Session delivery. */

export { TriggerBatchId, TriggerEventId, TriggerRuleId } from './brand.ts'
export { CloudFileTriggerProvider, LocalFileTriggerProvider, TimerTriggerProvider, matchesGlob } from './providers.ts'
export { TriggerService, triggerConfigSchema, type TriggerConfig } from './runtime.ts'
export type * from './types.ts'

export { TriggerService as default } from './runtime.ts'
