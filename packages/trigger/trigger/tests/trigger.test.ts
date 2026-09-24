import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { TriggerService } from '../src/runtime.ts'
import { CloudFileTriggerProvider, LocalFileTriggerProvider } from '../src/providers.ts'
import { TriggerRuleId } from '../src/brand.ts'
import type { TriggerProviderContext, TriggerRule, TriggerRuleInput } from '../src/types.ts'

const now = (): string => new Date(Date.now() + 60_000).toISOString()

function contextWithServices(controller: Record<string, unknown>): Context {
  const ctx = new Context()
  ctx.reflect.provide('sessionController', controller)
  ctx.reflect.provide('permissionPresets', { resolve: (name: string) => ({ name }), set: () => undefined })
  return ctx
}

function cloudRule(overrides: Partial<TriggerRuleInput> = {}): TriggerRuleInput {
  return {
    name: 'Cloud changes', enabled: true,
    source: { kind: 'cloud-file', spaceId: 'space', filter: { includes: ['**/*'], excludes: [], maxDepth: 10 } },
    delivery: { kind: 'batch-window', windowMs: 50 },
    target: { kind: 'existing-session', sessionId: 'session-1' as never },
    instructionTemplate: { version: 1, text: 'Process {{resources.json}}' }, createdBy: 'account', ...overrides,
  }
}

function change(id: string, versionId: string, name = 'report.txt') {
  return { id, spaceId: 'space', nodeId: 'node-1', versionId, name, operation: 'updated' as const, occurredAt: now() }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!(await predicate()) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(await predicate(), true, label)
}

test('cloud provider adopts the first cursor, emits matching versions, and aborts on dispose', async () => {
  const emitted: string[] = []
  const reports: string[] = []
  let calls = 0
  let signalSeen: AbortSignal | undefined
  const context: TriggerProviderContext = {
    emit: async (event) => { emitted.push(event.sourceEventId) },
    report: (status) => { reports.push(status.state) },
  }
  const provider = new CloudFileTriggerProvider(context, async (_space, cursor, signal) => {
    calls += 1; signalSeen = signal
    if (cursor === undefined) return { cursor: 'head-1', skipped: true, items: [] }
    return { cursor: 'head-2', skipped: false, items: [change('event-1', 'v1'), change('event-2', 'v2', 'notes.md')] }
  }, 10)
  const rule = { ...cloudRule(), id: TriggerRuleId('rule-1'), version: 1, createdAt: now(), updatedAt: now() } as TriggerRule
  await provider.replaceRules([rule])
  await waitFor(() => calls >= 1, 'initial cloud poll')
  assert.deepEqual(emitted, [])
  await waitFor(() => emitted.length === 2, 'second cloud poll')
  assert.deepEqual(emitted, ['cloud:event-1', 'cloud:event-2'])
  await provider.dispose()
  assert.equal(signalSeen?.aborted, false)
  assert.ok(reports.includes('watching'))
})

test('cloud provider aborts an in-flight poll during disposal', async () => {
  let signalSeen: AbortSignal | undefined
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const provider = new CloudFileTriggerProvider(
    { emit: async () => undefined, report: () => undefined },
    async (_space, _cursor, signal) => {
      signalSeen = signal
      signal.addEventListener('abort', () => { release() }, { once: true })
      await pending
      return { cursor: 'head', skipped: false, items: [] }
    }, 10,
  )
  const rule = { ...cloudRule(), id: TriggerRuleId('rule-abort'), version: 1, createdAt: now(), updatedAt: now() } as TriggerRule
  await provider.replaceRules([rule])
  await new Promise(resolve => setTimeout(resolve, 20))
  await provider.dispose()
  release()
  assert.equal(signalSeen?.aborted, true)
})

test('local provider ignores the initial baseline and stops emitting after disposal', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-trigger-local-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const emitted: string[] = []
  const provider = new LocalFileTriggerProvider({
    emit: async (event) => { emitted.push(event.resource.displayName) },
    report: () => undefined,
  })
  const rule = {
    id: TriggerRuleId('rule-local'), version: 1, createdAt: now(), updatedAt: now(), ...cloudRule({
      source: { kind: 'local-file', roots: [root], filter: { includes: ['**/*'], excludes: [], maxDepth: 2 }, stabilityMs: 50, maxEventsPerMinute: 10 },
    }),
  } as TriggerRule
  await provider.replaceRules([rule])
  await new Promise(resolve => setTimeout(resolve, 80))
  const { writeFile } = await import('node:fs/promises')
  const path = join(root, 'report.txt')
  await writeFile(path, 'first')
  await waitFor(() => emitted.includes('report.txt'), 'local file event')
  const count = emitted.length
  await provider.dispose()
  await writeFile(path, 'second')
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(emitted.length, count)
})

test('file batches deduplicate source events, retain merged versions, and keep the rule revision', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-trigger-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const prompts: string[] = []
  let emit!: TriggerProviderContext['emit']
  const controller = {
    inspect: async () => ({}),
    prompt: async (request: { content: readonly { text: string }[] }) => { prompts.push(request.content[0]?.text ?? ''); return {} },
  }
  const ctx = contextWithServices(controller)
  const service = new TriggerService(ctx, { statePath: join(root, 'state.json'), maxParallelTargets: 1, retainedEvents: 100, retainedBatches: 100 })
  service.registerSourceProvider((context) => { emit = context.emit; return { kind: 'cloud-file', replaceRules: async () => undefined, dispose: async () => undefined } })
  const saved = await service.saveRule(cloudRule())
  await emit({ id: 'event-1' as never, sourceEventId: 'source-1', ruleId: saved.id, occurredAt: now(), resource: { resourceId: 'node-1', displayName: 'report.txt', operation: 'updated', version: 'v1', mergedVersions: ['v1'], metadata: {} } })
  await emit({ id: 'event-2' as never, sourceEventId: 'source-1', ruleId: saved.id, occurredAt: now(), resource: { resourceId: 'node-1', displayName: 'report.txt', operation: 'updated', version: 'v2', mergedVersions: ['v2'], metadata: {} } })
  await emit({ id: 'event-3' as never, sourceEventId: 'source-2', ruleId: saved.id, occurredAt: now(), resource: { resourceId: 'node-2', displayName: 'notes.md', operation: 'updated', version: 'v3', mergedVersions: ['v3'], metadata: {} } })
  await waitFor(async () => (await service.snapshot()).batches.length === 1, 'one merged batch')
  const snapshot = await service.snapshot()
  assert.equal(snapshot.rules[0]?.version, 1)
  assert.equal(snapshot.batches[0]?.ruleVersion, 1)
  assert.deepEqual(snapshot.batches[0]?.eventIds, ['event-1', 'event-3'])
  assert.deepEqual(snapshot.batches[0]?.resources.map(resource => resource.version), ['v1', 'v3'])
  await waitFor(() => prompts.length === 1, 'batch delivery')
  assert.equal(prompts.length, 1)
})

test('new-session delivery retries with the same deterministic Session identity', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-trigger-new-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'workspace'))
  let createCalls = 0; let promptCalls = 0; let failPrompt = true
  const created = new Set<string>()
  let emit!: TriggerProviderContext['emit']
  const createdIds: string[] = []
  const controller = {
    create: async (request: { sessionId: string }) => { createCalls += 1; if (created.has(request.sessionId)) throw new Error('duplicate Session creation'); created.add(request.sessionId); createdIds.push(request.sessionId); return { sessionId: request.sessionId } },
    resolveAgent: async () => ({ agent: { session: {} } }), rename: async () => ({}),
    prompt: async () => { promptCalls += 1; if (failPrompt) throw new Error('temporary prompt failure'); return {} },
  }
  const ctx = contextWithServices(controller)
  const service = new TriggerService(ctx, { statePath: join(root, 'state.json'), maxParallelTargets: 1, retainedEvents: 100, retainedBatches: 100 })
  service.registerSourceProvider((context) => { emit = context.emit; return { kind: 'cloud-file', replaceRules: async () => undefined, dispose: async () => undefined } })
  const saved = await service.saveRule(cloudRule({ target: { kind: 'new-session', workspacePath: join(root, 'workspace'), agentPreset: 'default', permissionPreset: 'workspace-write', titleTemplate: '{{rule.name}}' } }))
  await emit({ id: 'event-1' as never, sourceEventId: 'source-1', ruleId: saved.id, occurredAt: now(), resource: { resourceId: 'node', displayName: 'file', operation: 'updated', version: 'v1', mergedVersions: ['v1'], metadata: {} } })
  await waitFor(async () => (await service.snapshot()).batches[0]?.state === 'failed', 'failed first delivery')
  failPrompt = false
  const batchId = (await service.snapshot()).batches[0]?.id
  assert.ok(batchId)
  await service.retryBatch(batchId)
  await waitFor(async () => (await service.snapshot()).batches[0]?.state === 'delivered', 'successful retry')
  assert.equal(createCalls, 1)
  assert.equal(new Set(createdIds).size, 1)
  assert.equal(promptCalls, 2)
})
