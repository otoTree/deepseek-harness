/* oxlint-disable @stylistic/max-len -- Wire schemas mirror the enterprise RPC payloads. */
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
  pluginId: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  ownerKind: z.enum(['personal', 'organization']).default('personal'),
  dataSpaceId: opaqueId,
  enabled: z.boolean(),
  desiredState: z.enum(['enabled', 'disabled', 'uninstalled']).default('disabled'),
  observedState: z.enum(['unknown', 'not-installed', 'preparing', 'active', 'stopping', 'disabled', 'failed', 'revoked', 'stale', 'cleanup-failed']).default('not-installed'),
  cleanupState: z.enum(['none', 'pending', 'failed', 'complete']).optional(),
  permissionRevision: z.number().int().positive().default(1),
  lastError: z.string().nullable().optional(),
  config: z.record(z.string(), z.json()),
  targetState: z.record(z.string(), z.json()),
  updatedAt: z.coerce.string(),
}).strict())

export const enterprisePluginDeviceTargets = z.array(z.object({
  installationId: opaqueId,
  pluginId: z.string().min(1),
  releaseId: opaqueId,
  version: z.string().min(1),
  targetKind: z.enum(['client', 'host']),
  desiredState: z.enum(['enabled', 'disabled', 'stopping', 'uninstalled']),
  observedState: z.enum(['unknown', 'not-installed', 'preparing', 'active', 'stopping', 'disabled', 'failed', 'revoked', 'stale', 'cleanup-failed']),
  activationId: opaqueId.nullable().optional(),
  permissionRevision: z.number().int().positive(),
  cleanupState: z.enum(['none', 'pending', 'failed', 'complete']),
  operation: z.object({ id: opaqueId, stage: z.string(), status: z.string() }).nullable().optional(),
  lastError: z.string().nullable().optional(),
  heartbeatAt: z.coerce.string().nullable().optional(),
  leaseExpiresAt: z.coerce.string().nullable().optional(),
}).strict())

export const pluginUploadInput = z.object({
  visibility: z.enum(['private', 'organization', 'platform']),
  bytes: z.array(z.number().int().min(0).max(255)).min(1),
}).strict()
export const pluginInstallationInput = z.object({ releaseId: opaqueId }).strict()
export const pluginEnableInput = z.object({ installationId: opaqueId, enabled: z.boolean() }).strict()
export const pluginUpgradeInput = z.object({ installationId: opaqueId, releaseId: opaqueId, confirmPermissions: z.literal(true) }).strict()

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

export const driveSpace = z.object({
  id: opaqueId,
  kind: z.enum(['personal', 'organization']),
  name: z.string().min(1),
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
}).strict()
export const driveSpaces = z.array(driveSpace)
export const driveFile = z.object({
  id: opaqueId,
  parentId: opaqueId.nullable(),
  name: z.string().min(1),
  kind: z.enum(['folder', 'file']),
  size: z.number().int().nonnegative(),
  contentType: z.string().min(1),
  versionId: opaqueId.nullable(),
  updatedAt: z.coerce.string(),
  deletedAt: z.coerce.string().nullable(),
}).strict()
export const driveFilePage = z.object({
  items: z.array(driveFile), nextCursor: z.string().nullable(),
  summary: z.object({ spaceId: opaqueId, parentId: opaqueId.nullable(), totalKnown: z.number().int().nonnegative().nullable() }).strict(),
}).strict()
export const driveCreateFolderInput = z.object({ spaceId: opaqueId, parentId: opaqueId.nullable(), name: z.string().trim().min(1).max(255) }).strict()
export const driveFileSearchInput = z.object({ spaceId: opaqueId, query: z.string().trim().min(1).max(200), cursor: z.string().max(2048).optional() }).strict()
export const driveUploadInput = z.object({ spaceId: opaqueId, nodeId: opaqueId.optional(), parentId: opaqueId.nullable(), name: z.string().trim().min(1).max(255), size: z.number().int().nonnegative(), contentType: z.string().min(1), checksum: z.string().length(64).optional() }).strict()
export const driveUploadSession = z.object({ uploadId: opaqueId, nodeId: opaqueId, versionId: opaqueId, name: z.string().min(1), uploadUrl: z.url(), expiresAt: z.coerce.string() }).strict()
export const driveVersion = z.object({ id: opaqueId, nodeId: opaqueId, size: z.number().int().nonnegative(), contentType: z.string(), checksum: z.string(), objectKey: z.never().optional(), createdBy: opaqueId, createdAt: z.coerce.string() }).strict()
export const driveDescription = z.object({ id: opaqueId, nodeId: opaqueId, versionId: opaqueId.nullable(), type: z.string(), content: z.string(), fields: z.record(z.string(), z.json()).nullable(), source: z.enum(['user', 'agent', 'import']), reference: z.record(z.string(), z.json()).nullable().optional(), status: z.enum(['active', 'superseded', 'deleted']), createdBy: opaqueId, createdAt: z.coerce.string(), updatedAt: z.coerce.string() }).strict()

const triggerFileFilter = z.object({
  includes: z.array(z.string().min(1).max(500)).max(100),
  excludes: z.array(z.string().min(1).max(500)).max(100),
  maxDepth: z.number().int().min(0).max(100),
}).strict()
const triggerSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('timer'), schedule: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('at'), at: z.iso.datetime() }).strict(),
    z.object({ kind: z.literal('every'), everySeconds: z.number().int().min(1), anchorAt: z.iso.datetime() }).strict(),
  ]) }).strict(),
  z.object({
    kind: z.literal('local-file'), roots: z.array(z.string().min(1)).min(1).max(32),
    filter: triggerFileFilter, stabilityMs: z.number().int().min(50).max(60_000),
    maxEventsPerMinute: z.number().int().min(1).max(100_000),
  }).strict(),
  z.object({ kind: z.literal('cloud-file'), spaceId: opaqueId, filter: triggerFileFilter }).strict(),
])
const triggerDelivery = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('queue-each') }).strict(),
  z.object({ kind: z.literal('batch-window'), windowMs: z.number().int().min(50).max(60_000) }).strict(),
])
const triggerTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing-session'), sessionId: opaqueId }).strict(),
  z.object({
    kind: z.literal('new-session'), workspacePath: z.string().min(1), agentPreset: z.string().min(1).max(100),
    permissionPreset: z.string().min(1).max(100),
    model: z.object({ provider: z.string().min(1), model: z.string().min(1) }).strict().optional(),
    titleTemplate: z.string().min(1).max(200),
  }).strict(),
])
const triggerInstructionTemplate = z.object({ version: z.number().int().positive(), text: z.string().min(1).max(100_000) }).strict()
export const triggerRuleSaveInput = z.object({
  id: opaqueId.optional(), name: z.string().trim().min(1).max(120), enabled: z.boolean(),
  source: triggerSource, delivery: triggerDelivery, target: triggerTarget,
  instructionTemplate: triggerInstructionTemplate,
}).strict()
export const triggerRule = triggerRuleSaveInput.extend({
  id: opaqueId, version: z.number().int().positive(), createdBy: opaqueId,
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict()
const triggerResource = z.object({
  resourceId: z.string().min(1), displayName: z.string().min(1),
  operation: z.enum(['created', 'updated', 'deleted', 'timer']), version: z.string().min(1),
  mergedVersions: z.array(z.string().min(1)),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
}).strict()
export const triggerBatch = z.object({
  id: opaqueId, ruleId: opaqueId, ruleVersion: z.number().int().positive(),
  eventIds: z.array(opaqueId).min(1), ruleSnapshot: triggerRule,
  resources: z.array(triggerResource).min(1), createdAt: z.iso.datetime(),
  state: z.enum(['queued', 'delivering', 'delivered', 'processing', 'failed', 'unknown', 'cancelled']),
  sessionId: opaqueId.optional(), deliveredAt: z.iso.datetime().optional(), error: z.string().optional(),
}).strict()
export const triggerProviderStatus = z.object({
  ruleId: opaqueId, state: z.enum(['watching', 'idle', 'missed', 'failed']),
  message: z.string().optional(), updatedAt: z.iso.datetime(),
}).strict()
export const triggerSnapshot = z.object({
  rules: z.array(triggerRule), batches: z.array(triggerBatch), providers: z.array(triggerProviderStatus),
}).strict()
export const cloudFileChangePage = z.object({
  cursor: z.string().min(1), skipped: z.boolean(),
  items: z.array(z.object({
    id: opaqueId, spaceId: opaqueId, nodeId: opaqueId, versionId: opaqueId,
    name: z.string().min(1), operation: z.enum(['created', 'updated', 'deleted']),
    occurredAt: z.iso.datetime(),
  }).strict()),
}).strict()

export type EnterpriseDashboard = z.infer<typeof enterpriseDashboard>
export type EnterprisePluginCatalog = z.infer<typeof enterprisePluginCatalog>
export type EnterprisePluginInstallations = z.infer<typeof enterprisePluginInstallations>
export type EnterprisePluginDeviceTargets = z.infer<typeof enterprisePluginDeviceTargets>
export type EnterpriseModelSelection = z.infer<typeof enterpriseModelSelection>
export type EnterpriseWallet = z.infer<typeof enterpriseWallet>
export type EnterpriseWalletLedger = z.infer<typeof enterpriseWalletLedger>
export type EnterpriseUsagePage = z.infer<typeof enterpriseUsagePage>
export type EnterpriseTeam = z.infer<typeof enterpriseTeam>
export type DriveSpace = z.infer<typeof driveSpace>
export type DriveSpaces = z.infer<typeof driveSpaces>
export type DriveFile = z.infer<typeof driveFile>
export type DriveFilePage = z.infer<typeof driveFilePage>
export type DriveVersion = z.infer<typeof driveVersion>
export type DriveDescription = z.infer<typeof driveDescription>
export type DriveUploadSession = z.infer<typeof driveUploadSession>
export type TriggerRuleSaveInput = z.infer<typeof triggerRuleSaveInput>
export type TriggerRule = z.infer<typeof triggerRule>
export type TriggerBatch = z.infer<typeof triggerBatch>
export type TriggerSnapshot = z.infer<typeof triggerSnapshot>
