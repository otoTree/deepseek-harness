import { z } from 'zod'

const opaqueId = z.string().min(1).max(128)
const money = z.number().int().nonnegative()
const signedMoney = z.number().int()

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
    totalCostMicrosCny: money,
    unpricedCalls: z.number().int().nonnegative(),
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
  targets: z.array(z.enum(['client', 'host', 'browser', 'desktop', 'cloud'])),
  permissions: z.array(z.string()),
  tools: z.array(z.object({ name: z.string(), description: z.string() }).loose()),
  visibility: z.enum(['private', 'organization', 'platform']).optional(),
  status: z.string().default('published'),
  packageFormat: z.string().optional(),
  digest: z.string().length(64).optional(),
  manifestDigest: z.string().length(64).optional(),
  permissionsDigest: z.string().length(64).optional(),
  publishedAt: z.string(),
  policyRevision: z.number().int().positive(),
}).strict())

export const enterprisePluginInstallations = z.array(z.object({
  id: opaqueId,
  releaseId: opaqueId,
  ownerKind: z.enum(['personal', 'organization']).default('personal'),
  dataSpaceId: opaqueId,
  enabled: z.boolean(),
  desiredState: z.enum(['enabled', 'disabled', 'uninstalled']).default('disabled'),
  observedState: z.enum(['unknown', 'not-installed', 'preparing', 'active', 'stopping', 'disabled', 'failed', 'revoked']).default('not-installed'),
  permissionRevision: z.number().int().positive().default(1),
  lastError: z.string().nullable().optional(),
  config: z.record(z.string(), z.json()),
  targetState: z.record(z.string(), z.json()),
  updatedAt: z.coerce.string(),
}).strict())

export const pluginUploadInput = z.object({
  visibility: z.enum(['private', 'organization', 'platform']),
  bytes: z.array(z.number().int().min(0).max(255)).min(1),
}).strict()
export const pluginInstallationInput = z.object({ releaseId: opaqueId }).strict()
export const pluginEnableInput = z.object({ installationId: opaqueId, enabled: z.boolean() }).strict()

export const revokeRuntimeInput = z.object({ runtimeId: opaqueId }).strict()
export const setModelInput = z.object({ model: opaqueId }).strict()

export const enterpriseWallet = z.object({
  organizationId: opaqueId,
  balanceMicrosCny: signedMoney,
  updatedAt: z.coerce.string(),
  version: z.number().int().positive(),
}).strict()

export const enterpriseWalletLedger = z.object({
  items: z.array(z.object({
    id: opaqueId,
    amountMicrosCny: signedMoney,
    kind: z.enum(['redemption_credit', 'model_usage_debit']),
    usageId: opaqueId.nullable(),
    redemptionCodeId: opaqueId.nullable(),
    accountId: opaqueId,
    runtimeId: opaqueId.nullable(),
    balanceAfterMicrosCny: signedMoney,
    createdAt: z.coerce.string(),
  }).loose()),
  nextCursor: z.string().nullable(),
  currency: z.literal('CNY'),
}).strict()

const usageRange = z.object({ from: z.coerce.string(), to: z.coerce.string(), timeZone: z.string() }).strict()
const enterpriseUsageItem = z.object({
  id: opaqueId,
  accountId: opaqueId,
  runtimeId: opaqueId.nullable(),
  modelId: opaqueId,
  purpose: z.string(),
  status: z.enum(['settled', 'pending_reconciliation', 'failed']),
  protocol: z.enum(['openai-completions', 'openai-responses']),
  inputModalities: z.array(z.enum(['text', 'image', 'video', 'audio', 'document'])),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  totalCostMicrosCny: money.nullable(),
  currency: z.string().nullable(),
  occurredAt: z.coerce.string(),
}).loose()

export const enterpriseUsagePage = z.object({
  items: z.array(enterpriseUsageItem),
  nextCursor: z.string().nullable(),
  range: usageRange,
}).strict()

export const enterpriseTeam = z.object({
  canManage: z.boolean(),
  canInviteAdministrator: z.boolean(),
  members: z.array(z.object({
    membershipId: opaqueId,
    accountId: opaqueId,
    name: z.string(),
    email: z.string(),
    status: z.string(),
    roles: z.array(z.string()),
    calls: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    settledCostMicrosCny: money,
    lastActivityAt: z.coerce.string().nullable(),
  }).strict()),
  invitations: z.array(z.object({
    id: opaqueId,
    email: z.string(),
    role: z.string(),
    expiresAt: z.coerce.string(),
    acceptedAt: z.coerce.string().nullable(),
  }).loose()),
  range: usageRange,
}).strict()

export const redeemCodeInput = z.object({ code: z.string().trim().min(16).max(128) }).strict()
export const inviteMemberInput = z.object({
  email: z.email(),
  role: z.enum(['member', 'administrator']),
}).strict()
export const revokeInvitationInput = z.object({ invitationId: opaqueId }).strict()
const teamUsageRangeInputBase = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
}).strict()

function validateUsageRange<T extends { from?: string | undefined; to?: string | undefined }>(
  value: T,
  context: z.RefinementCtx<T>,
): void {
  if ((value.from === undefined) !== (value.to === undefined)) {
    context.addIssue({ code: 'custom', path: ['from'], message: 'from and to must be provided together' })
  } else if (value.from !== undefined && value.to !== undefined && value.from >= value.to) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'to must be later than from' })
  }
}

export const teamUsageRangeInput = teamUsageRangeInputBase.superRefine(validateUsageRange)
export const memberUsageInput = teamUsageRangeInputBase.extend({
  accountId: opaqueId,
  cursor: z.string().max(512).optional(),
}).strict().superRefine(validateUsageRange)

export type EnterpriseDashboard = z.infer<typeof enterpriseDashboard>
export type EnterprisePluginCatalog = z.infer<typeof enterprisePluginCatalog>
export type EnterprisePluginInstallations = z.infer<typeof enterprisePluginInstallations>
export type EnterpriseModelSelection = z.infer<typeof enterpriseModelSelection>
export type EnterpriseWallet = z.infer<typeof enterpriseWallet>
export type EnterpriseWalletLedger = z.infer<typeof enterpriseWalletLedger>
export type EnterpriseUsagePage = z.infer<typeof enterpriseUsagePage>
export type EnterpriseTeam = z.infer<typeof enterpriseTeam>
