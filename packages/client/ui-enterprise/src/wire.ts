/* oxlint-disable @stylistic/max-len -- Wire schemas mirror the enterprise RPC payloads. */
import { z } from 'zod'
import { pluginManifest } from '@deepseek-ai/dsh-plugin-protocol'
export { driveImportInput } from '@deepseek-ai/dsh-enterprise-api/contracts'
export { modelTaskListInput } from '@deepseek-ai/dsh-enterprise-api/contracts'

const opaqueId = z.string().min(1).max(128)
const money = z.number().int().nonnegative()
const signedMoney = z.number().int()

/** Capacity totals include every retained version, trash and pending upload. */
export const enterpriseStorage = z.object({
  team: z.object({ usedBytes: z.number(), trashBytes: z.number(), versionBytes: z.number(), uploadBytes: z.number(), limitBytes: z.number().nullable() }).strict(),
  personal: z.object({ usedBytes: z.number(), trashBytes: z.number(), versionBytes: z.number(), uploadBytes: z.number(), limitBytes: z.number().nullable() }).strict(),
  updatedAt: z.string(),
}).strict()
/** Custody exposes file metadata and cleanup controls without content URLs. */
export const enterpriseCustody = z.object({ items: z.array(z.object({ id: opaqueId, name: z.string(), kind: z.string(), spaceId: opaqueId,
  ownerAccountId: opaqueId.nullable(), deletedAt: z.string().nullable(), purging: z.boolean(), size: z.number().nullable() }).strict()), nextCursor: opaqueId.nullable() }).strict()

/** Caller-owned task summaries; supplier credentials and raw results never cross this API. */
export const enterpriseTasks = z.array(z.object({
  id: opaqueId, publicModel: z.string(), status: z.string(), billingStatus: z.string(), assetStatus: z.string(),
  estimatedMicrosCny: money, finalMicrosCny: money.nullable(), assetTrackingUntil: z.string().nullable(),
  results: z.array(z.object({ kind: z.string(), assetId: opaqueId.optional(), recoverableUntil: z.string().nullable().optional() }).loose()),
}).loose())
/** Server-paged task history retains a cursor for results beyond the current page. */
export const enterpriseTaskPage = z.object({ items: enterpriseTasks, nextCursor: z.string().nullable() }).strict()
/** Stable task IDs keep cancellation and result-save retries on the original generation. */
export const enterpriseTaskAction = z.object({ taskId: opaqueId, action: z.enum(['cancel', 'retry-save']) }).strict()
/** A temporary download includes both the URL lifetime and the retained-result deadline. */
export const enterpriseAssetAccess = z.object({ url: z.url(), expiresAt: z.string(), recoverableUntil: z.string().nullable() }).loose()

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
  }).strict(),
  roles: z.array(z.object({ role: z.string().min(1), unitId: opaqueId.nullable() }).strict()),
  permissions: z.array(z.string()),
  capabilities: z.object({ manageOrganizationPlugins: z.boolean(), publishPlugins: z.boolean() }).strict().optional(),
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
    expiresAt: z.string(),
    revokedAt: z.string().nullable(),
    current: z.boolean(),
  }).strict()),
}).strict()

export const enterpriseModelSelection = z.object({
  provider: z.literal('enterprise'),
  model: opaqueId,
}).strict()
/** Human-editable non-secret fields declared by an independent plugin. */
export const pluginConfiguration = z.object({
  fields: z.array(z.object({
    name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/),
    label: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    type: z.enum(['string', 'url', 'email', 'number', 'boolean', 'string-list']),
    required: z.boolean().default(false),
    default: z.json().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().optional(),
    network: z.boolean().optional(),
  }).strict()).max(64),
  help: z.string().max(2000).optional(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.fields.map(field => field.name)).size !== value.fields.length) ctx.addIssue({ code: 'custom', message: 'Configuration field names must be unique' })
  for (const field of value.fields) {
    if (field.network && field.type !== 'url') ctx.addIssue({ code: 'custom', message: 'Network fields must be URLs' })
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) ctx.addIssue({ code: 'custom', message: 'Invalid configuration range' })
  }
})

/** Validate declared fields while preserving plugin-owned settings outside the form.
 * @param specification - Fields read from the verified package.
 * @param input - Non-secret installation settings.
 * @returns Settings with declared defaults applied.
 */
export function resolvePluginConfiguration(specification: z.infer<typeof pluginConfiguration>, input: Record<string, unknown>): Record<string, unknown> {
  const config = new Map(Object.entries(input))
  for (const field of specification.fields) {
    const value = input[field.name] ?? field.default
    if (value === undefined || value === '') {
      if (field.required) throw new Error(`plugin/not-configured: ${field.label}`)
      config.delete(field.name)
      continue
    }
    let schema: z.ZodType
    switch (field.type) {
      case 'url': schema = z.url({ protocol: /^https?$/ }); break
      case 'email': schema = z.email(); break
      case 'boolean': schema = z.boolean(); break
      case 'string-list': schema = z.array(z.string().min(1)).max(1000); break
      case 'string': schema = z.string().min(field.min ?? 1).max(field.max ?? 16384); break
      case 'number': {
        let number = z.number()
        if (field.integer) number = number.int()
        if (field.min !== undefined) number = number.min(field.min)
        if (field.max !== undefined) number = number.max(field.max)
        schema = number
        break
      }
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new Error(`plugin/not-configured: ${field.label}`)
    config.set(field.name, parsed.data)
  }
  return Object.fromEntries(config)
}

/** Setup form values and secret presence; credential values never leave the Host. */
export const pluginSettings = z.object({
  installationId: opaqueId,
  specification: pluginConfiguration,
  config: z.record(z.string(), z.json()),
  credentials: z.array(z.object({ name: z.string(), label: z.string(), configured: z.boolean() }).strict()),
}).strict()

/** Human-supplied configuration and replacement credentials for one installation. */
export const pluginSettingsInput = z.object({
  installationId: opaqueId,
  config: z.record(z.string(), z.json()),
  credentials: z.record(z.string(), z.string().min(1).max(256 * 1024)),
}).strict()

export const enterprisePluginCatalog = z.array(z.object({
  id: opaqueId,
  pluginId: z.string().min(1),
  name: z.string().min(1).optional(),
  icon: pluginManifest.shape.icon,
  description: z.string().max(500).optional(),
  category: z.enum(['work', 'mcp', 'skill']).optional(),
  setupKind: z.enum(['mcp', 'configuration']).optional(),
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

/** Host-observed capability evidence used by the plugin market status. */
export const enterprisePluginCapabilityDiagnostics = z.array(z.object({
  installationId: opaqueId,
  pluginId: z.string().min(1),
  version: z.string().min(1),
  targetKind: z.enum(['host', 'client']),
  activationId: z.uuid(),
  state: z.enum(['active', 'stale']),
  tools: z.object({ names: z.array(z.string()), present: z.array(z.string()) }).strict(),
  skills: z.object({ names: z.array(z.string()), present: z.array(z.string()) }).strict(),
  mcpTools: z.object({ names: z.array(z.string()), present: z.array(z.string()) }).strict(),
  mcpServers: z.array(z.object({
    serverName: z.string(), state: z.enum(['connecting', 'connected', 'reconnecting', 'failed', 'disposed']),
    discoveredTools: z.array(z.string()), reconnectAttempts: z.number().int().nonnegative(), lastError: z.string().optional(),
  }).strict()),
  presets: z.array(z.object({ id: z.string(), present: z.boolean(), broken: z.string().optional() }).strict()),
  clientSlots: z.array(z.object({ id: z.string(), slot: z.string(), present: z.boolean(), error: z.string().optional() }).strict()),
  clientWindows: z.array(z.object({ windowId: z.string(), moduleId: z.string(), activationId: z.string(), pluginId: z.string(), mountState: z.enum(['active', 'failed', 'disconnected']), lastError: z.string().nullable(), lastSeen: z.number() }).strict()),
}).strict())

export const pluginUploadInput = z.object({
  visibility: z.enum(['private', 'organization', 'platform']),
  bytes: z.array(z.number().int().min(0).max(255)).min(1),
}).strict()
export const pluginInstallationInput = z.object({ releaseId: opaqueId }).strict()
export const pluginEnableInput = z.object({ installationId: opaqueId, enabled: z.boolean() }).strict()
export const pluginUpgradeInput = z.object({ installationId: opaqueId, releaseId: opaqueId, confirmPermissions: z.literal(true) }).strict()

/** Verified MCP connection metadata; fixed service endpoints are not editable. */
export const pluginMcpConnection = z.object({
  url: z.url().optional(),
  auth: z.enum(['oauth', 'token', 'none']),
  credentialUrl: z.url().optional(),
  oauth: z.object({
    authorizationServerMetadataUrl: z.url().optional(),
    responseTypesSupported: z.tuple([z.literal('code')]).optional(),
  }).strict().optional(),
}).strict()

/** Token-free OAuth failure codes suitable for localized Client messages. */
export const pluginAuthorizationFailure = z.enum([
  'plugin/authorization-failed',
  'plugin/authorization-discovery-failed',
  'plugin/authorization-registration-failed',
  'plugin/authorization-exchange-failed',
  'plugin/authorization-denied',
  'plugin/authorization-cancelled',
])

/** Browser-safe installation configuration; secret values are never returned. */
export const pluginConnectionSettings = z.object({
  installationId: opaqueId,
  connection: pluginMcpConnection,
  customUrl: z.url().optional(),
  configured: z.boolean(),
}).strict()

/** Connection inputs supplied by the human, distinct from ordinary installation config. */
export const pluginConnectionInput = z.object({
  installationId: opaqueId,
  url: z.url().optional(),
  token: z.string().trim().min(1).max(256 * 1024).optional(),
}).strict()

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
    kind: z.enum(['redemption_credit', 'model_usage_debit', 'manual_adjustment', 'model_task_reserve', 'model_task_settle', 'model_task_release', 'model_task_charge', 'model_task_adjustment']),
    usageId: opaqueId.nullable(),
    redemptionCodeId: opaqueId.nullable(),
    accountId: opaqueId,
    runtimeId: opaqueId.nullable(),
    balanceAfterMicrosCny: signedMoney.nullable(),
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
  protocol: z.enum(['openai-completions', 'openai-responses', 'media-task']),
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

/** Complete personal usage totals for the selected reporting interval. */
export const enterpriseUsageSummary = z.object({
  calls: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  totalCostMicrosCny: money,
  unpricedCalls: z.number().int().nonnegative(),
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
    settledCostMicrosCny: money.nullable(),
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
/** Organization-scoped department tree and member assignments. */
export const enterpriseDepartments = z.object({
  units: z.array(z.object({ id: opaqueId, parentId: opaqueId.nullable(), name: z.string(), unitType: z.string() }).loose()),
  assignments: z.array(z.object({ membershipId: opaqueId, unitId: opaqueId }).loose()),
}).strict()
/** Department names and parent references supplied by an administrator. */
export const createDepartmentInput = z.object({ name: z.string().trim().min(1).max(120), parentId: opaqueId }).strict()
/** Existing department mutation; root departments cannot be changed. */
export const updateDepartmentInput = createDepartmentInput.extend({ unitId: opaqueId }).strict()
/** Department deletion reference. */
export const deleteDepartmentInput = z.object({ unitId: opaqueId }).strict()
/** Complete nonempty set of departments assigned to one active member. */
export const memberDepartmentsInput = z.object({ membershipId: opaqueId, unitIds: z.array(opaqueId).min(1).max(100) }).strict()
/** Browser-safe department management data. */
export type EnterpriseDepartments = z.infer<typeof enterpriseDepartments>
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
/** Paging and optional reporting interval for the caller's usage. */
export const ownUsageInput = teamUsageRangeInputBase.extend({
  cursor: z.string().min(1).max(512).optional(),
}).strict().superRefine(validateUsageRange)

/** Cursor for the caller's wallet activity. */
export const walletLedgerInput = z.object({ scope: z.enum(['own', 'organization']).optional(), cursor: z.string().min(1).max(512).optional() }).strict()

export const memberUsageInput = teamUsageRangeInputBase.extend({
  accountId: opaqueId,
  cursor: z.string().min(1).max(512).optional(),
}).strict().superRefine(validateUsageRange)

export const driveSharingPolicy = z.object({
  organizationId: opaqueId, scope: z.enum(['private', 'selected', 'organization']),
  permission: z.enum(['viewer', 'member']), memberIds: z.array(opaqueId),
  departments: z.array(z.object({ id: opaqueId, includeDescendants: z.boolean() }).strict()),
}).strict()
export const driveSharing = z.object({
  policy: driveSharingPolicy, inheritedFrom: opaqueId.nullable(), canManage: z.boolean(),
  role: z.enum(['owner', 'member', 'viewer']), audienceCount: z.number().int().nonnegative(),
}).strict()
export const driveDirectory = z.object({
  organizationId: opaqueId, organizationName: z.string(),
  members: z.array(z.object({ id: opaqueId, name: z.string() }).strict()),
  departments: z.array(z.object({ id: opaqueId, parentId: opaqueId.nullable(), name: z.string() }).strict()),
  myDepartmentIds: z.array(opaqueId),
}).strict()
export type DriveSharingPolicy = z.infer<typeof driveSharingPolicy>
export type DriveSharing = z.infer<typeof driveSharing>
export type DriveDirectory = z.infer<typeof driveDirectory>

export const driveSpace = z.object({
  id: opaqueId,
  kind: z.enum(['personal', 'organization']),
  name: z.string().min(1),
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
}).strict()
export const driveSpaces = z.array(driveSpace)
export const driveFile = z.object({
  id: opaqueId, spaceId: opaqueId, sharing: driveSharingPolicy.nullable(),
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
export const driveFileSearchInput = z.object({ spaceId: opaqueId, shared: z.boolean().optional(), query: z.string().trim().min(1).max(200), cursor: z.string().max(2048).optional() }).strict()
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
export type EnterpriseUsageSummary = z.infer<typeof enterpriseUsageSummary>
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

/** Shared governance schemas keep desktop and platform mutations identical. */
export { governanceSummary as enterpriseGovernance, governanceRequest as enterpriseGovernanceRequest } from '@deepseek-ai/dsh-enterprise-api/contracts'

/** Admission-month billing summary shared with the API. */
export { billingSummary as enterpriseBillingSummary } from '@deepseek-ai/dsh-enterprise-api/contracts'

/** Team management messages share the API's validated commands. */
export { teamManagementState, teamManagementCommand, teamAuditPage } from '@deepseek-ai/dsh-enterprise-api/contracts'
