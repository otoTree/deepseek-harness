import { stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { TriggerEventId } from './brand.ts'
import type {
  CloudFileChangePage, TriggerEvent, TriggerProviderContext, TriggerRule, TriggerRuleId,
  TriggerSourceProvider,
} from './types.ts'

function nowIso(): string { return new Date().toISOString() }

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/gu, '\\$&')
}

/** Match the small glob vocabulary exposed by trigger file filters. */
export function matchesGlob(path: string, pattern: string): boolean {
  const normalized = path.split(sep).join('/')
  let expression = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*' && pattern[index + 1] === '*' && pattern[index + 2] === '/') {
      expression += '(?:.*/)?'
      index += 2
    } else if (char === '*' && pattern[index + 1] === '*') {
      expression += '.*'
      index += 1
    } else if (char === '*') expression += '[^/]*'
    else if (char === '?') expression += '[^/]'
    else expression += escapeRegex(char ?? '')
  }
  return new RegExp(`^${expression}$`, 'u').test(normalized)
}

function fileIncluded(path: string, rule: TriggerRule): boolean {
  if (rule.source.kind !== 'local-file' && rule.source.kind !== 'cloud-file') return false
  const { includes, excludes } = rule.source.filter
  return includes.some(pattern => matchesGlob(path, pattern))
    && !excludes.some(pattern => matchesGlob(path, pattern))
}

/** Timer source with one owned timeout per enabled rule. */
export class TimerTriggerProvider implements TriggerSourceProvider {
  readonly kind = 'timer' as const
  private readonly timers = new Map<TriggerRuleId, ReturnType<typeof setTimeout>>()
  private disposed = false

  constructor(private readonly context: TriggerProviderContext) {}

  async replaceRules(rules: readonly TriggerRule[]): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    if (this.disposed) return
    for (const rule of rules) this.arm(rule)
  }

  private arm(rule: TriggerRule, fixedTarget?: number): void {
    if (!rule.enabled || rule.source.kind !== 'timer') return
    const now = Date.now()
    const schedule = rule.source.schedule
    let target = fixedTarget ?? Date.parse(schedule.kind === 'at' ? schedule.at : schedule.anchorAt)
    if (fixedTarget === undefined && schedule.kind === 'every') {
      const interval = schedule.everySeconds * 1_000
      if (target <= now) target += (Math.floor((now - target) / interval) + 1) * interval
    } else if (fixedTarget === undefined && schedule.kind === 'at' && target <= now) {
      this.context.report({ ruleId: rule.id, state: 'missed', message: 'The one-time target passed while the Runtime was unavailable.', updatedAt: nowIso() })
      return
    }
    const wait = Math.min(Math.max(0, target - now), 2_147_000_000)
    this.context.report({ ruleId: rule.id, state: 'watching', updatedAt: nowIso() })
    this.timers.set(rule.id, setTimeout(() => {
      if (this.disposed) return
      if (target > Date.now()) { this.arm(rule, target); return }
      const scheduledAt = new Date(target).toISOString()
      const event: TriggerEvent = {
        id: TriggerEventId(`timer:${String(rule.id)}:${scheduledAt}`),
        sourceEventId: `timer:${String(rule.id)}:${scheduledAt}`,
        ruleId: rule.id,
        occurredAt: scheduledAt,
        resource: {
          resourceId: scheduledAt, displayName: rule.name, operation: 'timer', version: scheduledAt,
          mergedVersions: [scheduledAt], metadata: { scheduledAt },
        },
      }
      void this.context.emit(event).finally(() => {
        if (schedule.kind === 'every') {
          const interval = schedule.everySeconds * 1_000
          const nextTarget = target + interval
          this.arm(rule, nextTarget <= Date.now()
            ? nextTarget + (Math.floor((Date.now() - nextTarget) / interval) + 1) * interval
            : nextTarget)
        }
        else this.context.report({ ruleId: rule.id, state: 'idle', updatedAt: nowIso() })
      })
    }, wait))
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}

interface LocalRuleWatch {
  readonly watcher: FSWatcher
  readonly recent: number[]
  readonly ruleVersion: number
}

/** Local directory watcher that begins from a fresh baseline on every start. */
export class LocalFileTriggerProvider implements TriggerSourceProvider {
  readonly kind = 'local-file' as const
  private readonly watches = new Map<TriggerRuleId, LocalRuleWatch>()
  private disposed = false

  constructor(private readonly context: TriggerProviderContext) {}

  async replaceRules(rules: readonly TriggerRule[]): Promise<void> {
    const nextRules = new Map(rules.map(rule => [rule.id, rule]))
    const closing: Promise<void>[] = []
    for (const [id, watch] of this.watches) {
      const rule = nextRules.get(id)
      if (rule?.enabled === true && rule.source.kind === 'local-file' && rule.version === watch.ruleVersion) continue
      this.watches.delete(id)
      closing.push(watch.watcher.close())
    }
    await Promise.all(closing)
    if (this.disposed) return
    for (const rule of rules) {
      if (!rule.enabled || rule.source.kind !== 'local-file' || this.watches.has(rule.id)) continue
      const watcher = chokidar.watch([...rule.source.roots], {
        ignoreInitial: true,
        depth: rule.source.filter.maxDepth,
        awaitWriteFinish: {
          stabilityThreshold: rule.source.stabilityMs,
          pollInterval: Math.max(25, Math.floor(rule.source.stabilityMs / 5)),
        },
      })
      const state: LocalRuleWatch = { watcher, recent: [], ruleVersion: rule.version }
      this.watches.set(rule.id, state)
      const handle = (operation: 'created' | 'updated' | 'deleted', path: string): void => {
        void this.emitFile(rule, state, operation, path)
      }
      watcher.on('add', (path) => { handle('created', path) })
      watcher.on('change', (path) => { handle('updated', path) })
      watcher.on('unlink', (path) => { handle('deleted', path) })
      watcher.on('error', (error) => {
        this.context.report({ ruleId: rule.id, state: 'failed', message: String(error), updatedAt: nowIso() })
      })
      this.context.report({ ruleId: rule.id, state: 'watching', updatedAt: nowIso() })
    }
  }

  private async emitFile(rule: TriggerRule, state: LocalRuleWatch, operation: 'created' | 'updated' | 'deleted', path: string): Promise<void> {
    if (this.disposed || rule.source.kind !== 'local-file') return
    const root = rule.source.roots.find((candidate) => {
      const rel = relative(resolve(candidate), resolve(path))
      return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..')
    })
    if (root === undefined) return
    const relativePath = relative(root, path).split(sep).join('/')
    if (!fileIncluded(relativePath, rule)) return
    const cutoff = Date.now() - 60_000
    const firstCurrent = state.recent.findIndex(value => value >= cutoff)
    if (firstCurrent < 0) state.recent.length = 0
    else if (firstCurrent > 0) state.recent.splice(0, firstCurrent)
    if (state.recent.length >= rule.source.maxEventsPerMinute) {
      this.context.report({ ruleId: rule.id, state: 'failed', message: 'The local file event limit was reached; review output exclusions before re-enabling the rule.', updatedAt: nowIso() })
      await state.watcher.close()
      this.watches.delete(rule.id)
      return
    }
    state.recent.push(Date.now())
    const info = operation === 'deleted' ? undefined : await stat(path).catch(() => undefined)
    const version = info === undefined ? `deleted:${Date.now()}` : `${String(info.mtimeMs)}:${String(info.size)}`
    const sourceEventId = `local:${String(rule.id)}:${resolve(path)}:${operation}:${version}`
    await this.context.emit({
      id: TriggerEventId(sourceEventId), sourceEventId, ruleId: rule.id, occurredAt: nowIso(),
      resource: {
        resourceId: resolve(path), displayName: relativePath, operation, version,
        mergedVersions: [version], metadata: { path: resolve(path), root: resolve(root), relativePath },
      },
    })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    const watches = [...this.watches.values()]
    this.watches.clear()
    await Promise.all(watches.map(item => item.watcher.close()))
  }
}

/** Polling cloud-drive provider. The first read adopts the head cursor and emits nothing. */
export class CloudFileTriggerProvider implements TriggerSourceProvider {
  readonly kind = 'cloud-file' as const
  private rules: readonly TriggerRule[] = []
  private readonly cursors = new Map<TriggerRuleId, string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private running = false
  private activeController: AbortController | undefined
  private activePoll: Promise<void> | undefined

  constructor(
    private readonly context: TriggerProviderContext,
    private readonly fetchChanges: (spaceId: string, cursor: string | undefined, signal: AbortSignal) => Promise<CloudFileChangePage>,
    private readonly pollIntervalMs: number,
  ) {}

  async replaceRules(rules: readonly TriggerRule[]): Promise<void> {
    this.rules = rules.filter(rule => rule.enabled && rule.source.kind === 'cloud-file')
    const ids = new Set(this.rules.map(rule => rule.id))
    for (const id of this.cursors.keys()) if (!ids.has(id)) this.cursors.delete(id)
    this.schedule(0)
  }

  private schedule(delay = this.pollIntervalMs): void {
    if (this.disposed || this.running || this.rules.length === 0 || this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const poll = this.poll()
      this.activePoll = poll
      void poll.finally(() => {
        if (this.activePoll === poll) this.activePoll = undefined
      })
    }, delay)
  }

  private async poll(): Promise<void> {
    if (this.disposed || this.running) return
    this.running = true
    const controller = new AbortController()
    this.activeController = controller
    try {
      for (const rule of this.rules) {
        if (rule.source.kind !== 'cloud-file') continue
        try {
          const page = await this.fetchChanges(rule.source.spaceId, this.cursors.get(rule.id), controller.signal)
          this.cursors.set(rule.id, page.cursor)
          this.context.report({ ruleId: rule.id, state: 'watching', ...(page.skipped ? { message: 'Cloud changes before this Runtime connection were skipped.' } : {}), updatedAt: nowIso() })
          for (const change of page.items) {
            if (!fileIncluded(change.name, rule)) continue
            const sourceEventId = `cloud:${change.id}`
            await this.context.emit({
              id: TriggerEventId(sourceEventId), sourceEventId, ruleId: rule.id, occurredAt: change.occurredAt,
              resource: {
                resourceId: change.nodeId, displayName: change.name, operation: change.operation,
                version: change.versionId, mergedVersions: [change.versionId],
                metadata: { spaceId: change.spaceId, nodeId: change.nodeId, versionId: change.versionId },
              },
            })
          }
        } catch (error) {
          if (!this.disposed) this.context.report({ ruleId: rule.id, state: 'failed', message: String(error), updatedAt: nowIso() })
        }
      }
    } finally {
      if (this.activeController === controller) this.activeController = undefined
      this.running = false
      this.schedule()
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.activeController?.abort('cloud trigger provider disposed')
    await this.activePoll
  }
}
