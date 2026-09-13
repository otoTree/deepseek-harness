import { z } from 'zod'

const taskId = z.string().trim().min(1).max(256)
const taskSchema = z.object({
  id: taskId,
  scheduledAt: z.number(),
  sideEffect: z.boolean(),
}).strict()

/** A local task that can be marked missed when the machine is unavailable. */
export type DesktopTask = z.infer<typeof taskSchema> & {
  state: 'scheduled' | 'running' | 'completed' | 'missed'
  missedReason?: 'sleep' | 'logout' | 'offline' | 'runtime-stopped'
}

/**
 * Tracks local jobs across sleep, logout, and connectivity loss. Recovery is
 * deliberately observational: missed work is surfaced to the UI and never
 * replayed automatically, because a task may have external side effects.
 */
export class DesktopTaskState {
  private readonly tasks = new Map<string, DesktopTask>()

  /** Register a new local task. Duplicate identifiers are rejected. */
  register(input: z.input<typeof taskSchema>): DesktopTask {
    const task = taskSchema.parse(input)
    if (this.tasks.has(task.id)) throw new Error(`Desktop task already exists: ${task.id}`)
    const value: DesktopTask = { ...task, state: 'scheduled' }
    this.tasks.set(value.id, value)
    return { ...value }
  }

  /** Mark a task as actively executing. */
  start(id: string): DesktopTask {
    const task = this.require(id)
    if (task.state !== 'scheduled') throw new Error(`Desktop task is not schedulable: ${id}`)
    task.state = 'running'
    return { ...task }
  }

  /** Commit a successfully completed task. */
  complete(id: string): DesktopTask {
    const task = this.require(id)
    if (task.state !== 'running') throw new Error(`Desktop task is not running: ${id}`)
    task.state = 'completed'
    return { ...task }
  }

  /** Mark all non-terminal work as missed when execution cannot continue. */
  markUnavailable(reason: DesktopTask['missedReason']): DesktopTask[] {
    if (reason === undefined) throw new Error('A missed-task reason is required')
    const missed: DesktopTask[] = []
    for (const task of this.tasks.values()) {
      if (task.state !== 'scheduled' && task.state !== 'running') continue
      task.state = 'missed'
      task.missedReason = reason
      missed.push({ ...task })
    }
    return missed
  }

  /** Read tasks without granting an implicit retry. */
  list(): DesktopTask[] { return [...this.tasks.values()].map(task => ({ ...task })) }

  private require(id: string): DesktopTask {
    const parsed = taskId.parse(id)
    const task = this.tasks.get(parsed)
    if (!task) throw new Error(`Unknown desktop task: ${parsed}`)
    return task
  }
}
