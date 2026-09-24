import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { persistedTriggerStateSchema } from './schema.ts'
import type { TriggerBatch, TriggerEvent, TriggerRule } from './types.ts'

/** Complete owner-only persisted trigger state. */
export interface PersistedTriggerState {
  readonly version: 1
  rules: TriggerRule[]
  events: TriggerEvent[]
  batches: TriggerBatch[]
  cloudCursors: Record<string, string>
}

/** Read a trigger state file, returning an empty versioned document when absent. */
export async function readTriggerState(path: string): Promise<PersistedTriggerState> {
  try {
    return persistedTriggerStateSchema.parse(JSON.parse(await readFile(path, 'utf8'))) as unknown as PersistedTriggerState
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      return { version: 1, rules: [], events: [], batches: [], cloudCursors: {} }
    }
    throw new Error(`trigger: failed to read state at ${path}`, { cause: error })
  }
}

/** Atomically replace the trigger state with owner-only permissions. */
export function writeTriggerState(path: string, state: PersistedTriggerState): Promise<void> {
  return writeFileAtomic(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}
