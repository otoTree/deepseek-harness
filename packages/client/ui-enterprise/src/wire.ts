import { z } from 'zod'

const opaqueId = z.string().min(1).max(128)
const money = z.number().int().nonnegative()

export const enterpriseDashboard = z.object({
  organization: z.object({
    id: opaqueId,
    name: z.string().min(1),
    kind: z.string().min(1),
    status: z.string().min(1),
    policyRevision: z.number().int().positive(),
  }).strict(),
  subscription: z.object({
    plan: z.string().min(1),
    seats: z.number().int().positive(),
    runtimes: z.number().int().positive(),
    budgetMicros: money,
    spentMicros: money,
    reservedMicros: money,
  }).strict(),
  roles: z.array(z.object({ role: z.string().min(1), unitId: opaqueId.nullable() }).strict()),
  models: z.array(z.object({
    id: opaqueId,
    name: z.string().min(1),
    images: z.boolean(),
    protocol: z.enum(['openai-completions', 'openai-responses']).default('openai-completions'),
    inputModalities: z.array(z.enum(['text', 'image', 'video', 'audio', 'document'])).default(['text']),
    videoAudioMode: z.enum(['visual-only', 'visual-and-audio']).default('visual-only'),
    fileInputPolicy: z.enum(['unsupported', 'inline', 'provider-files']).default('unsupported'),
    contextTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
  }).strict()),
  runtimes: z.array(z.object({
    id: opaqueId,
    name: z.string().min(1),
    type: z.string().min(1),
    version: z.string().min(1),
    leaseUntil: z.string(),
    revokedAt: z.string().nullable(),
    current: z.boolean(),
  }).strict()),
  usage: z.object({
    calls: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    actualMicros: money,
    billedMicros: money,
  }).strict(),
}).strict()

export const enterpriseModelSelection = z.object({
  provider: z.literal('enterprise'),
  model: opaqueId,
}).strict()

export const enterprisePluginCatalog = z.array(z.object({
  id: opaqueId,
  pluginId: z.string().min(1),
  version: z.string().min(1),
  targets: z.array(z.enum(['browser', 'desktop', 'cloud'])),
  permissions: z.array(z.string()),
  tools: z.array(z.object({ name: z.string(), description: z.string() }).loose()),
  publishedAt: z.string(),
  policyRevision: z.number().int().positive(),
}).strict())

export const revokeRuntimeInput = z.object({ runtimeId: opaqueId }).strict()
export const setModelInput = z.object({ model: opaqueId }).strict()

export type EnterpriseDashboard = z.infer<typeof enterpriseDashboard>
export type EnterprisePluginCatalog = z.infer<typeof enterprisePluginCatalog>
export type EnterpriseModelSelection = z.infer<typeof enterpriseModelSelection>
