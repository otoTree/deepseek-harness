import { isAbsolute } from 'node:path'
import { z } from 'zod'

const id = z.string().min(1).max(200)
const timestamp = z.iso.datetime()
const fileFilter = z.object({
  includes: z.array(z.string().min(1).max(500)).max(100).default(['**/*']),
  excludes: z.array(z.string().min(1).max(500)).max(100).default([]),
  maxDepth: z.number().int().min(0).max(100).default(20),
}).strict()
const source = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('timer'), schedule: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('at'), at: timestamp }).strict(),
    z.object({ kind: z.literal('every'), everySeconds: z.number().int().min(1), anchorAt: timestamp }).strict(),
  ]) }).strict(),
  z.object({
    kind: z.literal('local-file'),
    roots: z.array(z.string().refine(isAbsolute)).min(1).max(32),
    filter: fileFilter,
    stabilityMs: z.number().int().min(50).max(60_000).default(500),
    maxEventsPerMinute: z.number().int().min(1).max(100_000).default(1_000),
  }).strict(),
  z.object({ kind: z.literal('cloud-file'), spaceId: id, filter: fileFilter }).strict(),
])
const delivery = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('queue-each') }).strict(),
  z.object({ kind: z.literal('batch-window'), windowMs: z.number().int().min(50).max(60_000) }).strict(),
])
const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing-session'), sessionId: id }).strict(),
  z.object({
    kind: z.literal('new-session'), workspacePath: z.string().refine(isAbsolute),
    agentPreset: z.string().min(1).max(100), permissionPreset: z.string().min(1).max(100),
    model: z.object({ provider: z.string().min(1), model: z.string().min(1) }).strict().optional(),
    titleTemplate: z.string().min(1).max(200),
  }).strict(),
])
const template = z.object({ version: z.number().int().positive(), text: z.string().min(1).max(100_000) }).strict()

export const triggerRuleInputSchema = z.object({
  id: id.optional(), name: z.string().trim().min(1).max(120), enabled: z.boolean(),
  source, delivery, target, instructionTemplate: template, createdBy: id,
}).strict()

export const triggerRuleSchema = triggerRuleInputSchema.extend({
  id, version: z.number().int().positive(), createdAt: timestamp, updatedAt: timestamp,
}).strict()

const resource = z.object({
  resourceId: z.string().min(1).max(2_048), displayName: z.string().min(1).max(2_048),
  operation: z.enum(['created', 'updated', 'deleted', 'timer']), version: z.string().min(1).max(512),
  mergedVersions: z.array(z.string().min(1).max(512)).max(10_000),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
}).strict()

export const triggerEventSchema = z.object({
  id, sourceEventId: z.string().min(1).max(2_048), ruleId: id, occurredAt: timestamp, resource,
}).strict()

export const triggerBatchSchema = z.object({
  id, ruleId: id, ruleVersion: z.number().int().positive(), eventIds: z.array(id).min(1),
  ruleSnapshot: triggerRuleSchema,
  resources: z.array(resource).min(1), createdAt: timestamp,
  state: z.enum(['queued', 'delivering', 'delivered', 'processing', 'failed', 'unknown', 'cancelled']),
  sessionId: id.optional(), deliveredAt: timestamp.optional(), error: z.string().max(4_000).optional(),
}).strict()

export const persistedTriggerStateSchema = z.object({
  version: z.literal(1), rules: z.array(triggerRuleSchema), events: z.array(triggerEventSchema),
  batches: z.array(triggerBatchSchema), cloudCursors: z.record(z.string(), z.string()),
}).strict()
