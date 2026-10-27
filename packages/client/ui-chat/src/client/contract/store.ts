/** Chat-owned interaction state and remembered transcript geometry. */

/** Tool call identity as carried by Chat nodes. */
export type ToolCallId = string

/** Selection target for the Chat details linkage channel. */
export interface SelectionTarget {
  turnSeq: number
  stepSeq?: number
  callId?: ToolCallId
  toolName?: string
}

/** One manually expanded Turn answer generation. */
export interface TurnProcessViewEntry {
  readonly turn: number
  readonly answerStep: number
}

/** Measured transcript segment, retained across view remounts. */
export interface ChatHistoryMeasurement {
  readonly height: number
  readonly anchors: readonly string[]
}

/** Last rendered transcript geometry; contains no Session business data. */
export interface ChatHistoryLayout {
  readonly viewportWidth: number
  readonly segments: Readonly<Record<string, ChatHistoryMeasurement>>
}

/** Per-Session state shared only by the Chat view and details surface. */
export interface ChatStoreState {
  selection: SelectionTarget | null
  turnProcesses: TurnProcessViewEntry[]
  historyLayout: ChatHistoryLayout | null
}
