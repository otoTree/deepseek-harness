import type {
  TriggerBatchId as TriggerBatchIdType,
  TriggerEventId as TriggerEventIdType,
  TriggerRuleId as TriggerRuleIdType,
} from './types.ts'

/** Brand one persisted rule identity. */
export const TriggerRuleId = (value: string): TriggerRuleIdType => value as TriggerRuleIdType
/** Brand one normalized event identity. */
export const TriggerEventId = (value: string): TriggerEventIdType => value as TriggerEventIdType
/** Brand one execution batch identity. */
export const TriggerBatchId = (value: string): TriggerBatchIdType => value as TriggerBatchIdType
