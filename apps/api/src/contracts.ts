/** Validated enterprise wire records; resource IDs are opaque to clients. */
import { z } from 'zod'

export const accountId = z.string().min(1).max(128).brand<'AccountId'>()
export const organizationId = z.uuid().brand<'OrganizationId'>()
export const resourceId = z.uuid().brand<'ResourceId'>()
/** Bounded task-history page; cursors retain server ordering across identical timestamps. */
export const modelTaskListInput = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['queued', 'submitting', 'processing', 'succeeded', 'failed', 'cancelled', 'unknown']).optional(),
  query: z.string().trim().max(120).optional(),
}).strict()
export const sessionId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/).brand<'SessionId'>()
export const sessionHeader = z.object({
  id: sessionId, version: z.literal(2), createdAt: z.number().int().nonnegative(), isSeeded: z.boolean(),
  cwd: z.string().regex(/^(?:\/|[A-Za-z]:[\\/])/).optional(), parentSession: sessionId.optional(),
  origin: z.literal('subagent').optional(), delegationDepth: z.number().int().nonnegative().optional(),
  agentPreset: z.string().optional(),
}).strict()
export const sessionEvent = z.object({
  seq: z.number().int().nonnegative(), type: z.string().min(1).max(200),
  time: z.number().int().nonnegative(), data: z.json(), ignorable: z.literal(true).optional(),
  sourceEventSeqs: z.array(z.number().int().nonnegative()).optional(), surfaceOp: z.json().optional(),
}).strict()
export const sessionCreate = z.object({
  id: sessionId, header: sessionHeader, inheritedEventCount: z.number().int().nonnegative().default(0),
  writer: resourceId.optional(),
}).strict().refine(value => value.id === value.header.id && (value.header.isSeeded || value.inheritedEventCount === 0), 'Invalid session metadata')
export const sessionMetadata = z.object({
  id: sessionId, header: sessionHeader, inheritedEventCount: z.number().int().nonnegative(), nextSeq: z.number().int().nonnegative(),
}).strict()
export const sessionPage = sessionMetadata.extend({ events: z.array(sessionEvent).max(500) })
export const sessionLease = z.object({ writer: resourceId, leaseUntil: z.iso.datetime(), nextSeq: z.number().int().nonnegative() }).strict()
export const sessionAppend = z.object({ writer: resourceId, events: z.array(sessionEvent).min(1).max(500) }).strict()
export const desktopAuthorization = z.object({
  organizationId,
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  callback: z.url(),
  state: z.string().min(32).max(128),
}).strict()
export const desktopTokenRequest = z.object({
  code: z.string().min(32).max(128),
  verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
}).strict()
export const desktopCredential = z.object({
  runtimeId: resourceId,
  accountId,
  token: z.string().min(32).max(200),
  expiresAt: z.iso.datetime(),
  organizationId,
}).strict()
export const runtimeAuthorization = z.object({ expiresAt: z.iso.datetime(), policyRevision: z.number().int().positive() }).strict()
export const modelCatalog = z.array(z.object({
  id: resourceId, name: z.string().min(1), images: z.boolean(),
  operations: z.array(z.string()).default(['text.generate']),
  outputModalities: z.array(z.string()).default(['text']),
  operationConfigurations: z.array(z.record(z.string(), z.unknown())).default([]),
  inputPriceMicrosCnyPerMillion: z.number().int().nonnegative().optional(),
  cachedInputPriceMicrosCnyPerMillion: z.number().int().nonnegative().optional(),
  outputPriceMicrosCnyPerMillion: z.number().int().nonnegative().optional(),
  /** Provider wire protocol selected by the platform directory. */
  protocol: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']).default('openai-completions'),
  /** Provider input capabilities; text is always present for the current gateway. */
  inputModalities: z.array(z.enum(['text', 'image', 'video', 'audio', 'document'])).min(1).default(['text']),
  /** Whether video input is interpreted as frames only or frames plus its embedded audio track. */
  videoAudioMode: z.enum(['visual-only', 'visual-and-audio']).default('visual-only'),
  /** File handling policy reserved for provider Files API integrations. */
  fileInputPolicy: z.enum(['unsupported', 'inline', 'provider-files']).default('unsupported'),
  maxFileBytes: z.number().int().positive().default(10 * 1024 * 1024),
  maxRequestBytes: z.number().int().positive().default(32 * 1024 * 1024),
  filesTtlSeconds: z.number().int().positive().default(7 * 24 * 60 * 60),
  fileUploadTimeoutMs: z.number().int().positive().default(120_000),
  fileUploadMaxRetries: z.number().int().nonnegative().default(1),
  fileRefreshMarginSeconds: z.number().int().nonnegative().default(60),
  fileQuotaCleanupBatch: z.number().int().nonnegative().default(0),
  modelCallTimeoutMs: z.number().int().positive().default(300_000),
  contextTokens: z.number().int().positive(), maxOutputTokens: z.number().int().positive(),
}).strict())
export const modelStreamChunk = z.object({
  choices: z.array(z.object({
    index: z.literal(0),
    delta: z.object({
      content: z.string().nullable().optional(), reasoning_content: z.string().nullable().optional(),
      tool_calls: z.array(z.object({
        index: z.number().int().nonnegative(), id: z.string().nullable().optional(),
        function: z.object({ name: z.string().nullable().optional(), arguments: z.string().optional() }).optional(),
      })).optional(),
    }).optional(),
    finish_reason: z.string().nullable().optional(),
  })).max(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(),
    prompt_cache_hit_tokens: z.number().int().nonnegative().optional(),
    prompt_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative().optional() }).optional(),
    completion_tokens_details: z.object({ reasoning_tokens: z.number().int().nonnegative().optional() }).optional(),
  }).nullable().optional(),
})
export const role = z.enum([
  'owner',
  'administrator',
  'member',
  'security_reviewer',
  'plugin_publisher',
  'finance_auditor',
])
/** Stable resource/action permissions used by organization and platform policy. */
export const permissionId = z.string().regex(/^[a-z][a-z0-9_.:-]{2,119}$/)
export const permissionDefinition = z.object({
  id: permissionId,
  resource: z.string().min(1).max(80),
  action: z.string().min(1).max(80),
  description: z.string().max(500),
  platform: z.boolean().default(false),
  highRisk: z.boolean().default(false),
}).strict()
export const customRoleInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  permissionIds: z.array(permissionId).max(200).default([]),
}).strict()
export const permissionScope = z.object({ organizationId, unitId: resourceId.nullable().default(null) }).strict()
export const customRoleBindingInput = z.object({
  membershipId: resourceId,
  roleId: resourceId,
  unitId: resourceId.nullable().default(null),
  source: z.enum(['manual', 'sso', 'directory']).default('manual'),
  effect: z.enum(['allow', 'deny']).default('allow'),
}).strict()
export const identityProviderInput = z.object({
  name: z.string().trim().min(1).max(120),
  protocol: z.enum(['oidc', 'oauth2', 'saml', 'ldap']),
  issuer: z.url().optional(),
  config: z.record(z.string(), z.json()).default({}),
}).strict()
export const syncScriptInput = z.object({
  name: z.string().trim().min(1).max(120),
  source: z.string().min(1).max(256_000),
}).strict()
export const workspaceInput = z.object({
  name: z.string().trim().min(1).max(120),
  image: z.string().trim().min(1).max(120).default('dsh-base'),
}).strict()
export const workspaceStatus = z.enum(['stopped', 'starting', 'running', 'failed'])
export const registrationPolicy = z.enum(['open', 'domain_restricted', 'invite_only', 'disabled'])
/** Public deployment and registration policy used by native account entry. */
export const accountDeployment = z.object({ mode: z.enum(['open', 'private']), registration: registrationPolicy }).strict()
export const workspaceMode = z.enum(['read-only', 'workspace-write', 'danger-full-access'])
/** Maximum model context and output capacities accepted by the platform directory. */
export const MAX_MODEL_TOKENS = 2_000_000
/** Maximum CNY price accepted for one million tokens. */
export const MAX_MODEL_PRICE_CNY_PER_MILLION = 1_000_000
export const modelPriceCny = z.number().min(0).max(MAX_MODEL_PRICE_CNY_PER_MILLION)
/** Explicit member spending policy; zero is a limit and null is never used for unlimited. */
export const memberBudget = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('inherit') }).strict(),
  z.object({ mode: z.literal('unlimited') }).strict(),
  z.object({ mode: z.literal('limited'), amountMicrosCny: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(),
])
export type MemberBudget = z.infer<typeof memberBudget>
/** Team-funded storage and monthly spending defaults chosen during provisioning. */
export const teamResourcePolicy = z.object({
  defaultBudget: z.union([memberBudget.options[1], memberBudget.options[2]]),
  timeZone: z.string().min(1).refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true }
    catch { return false /* Parser rejects unsupported IANA time zones. */ }
  }),
  storageBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  personalStorageBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict()
export type TeamResourcePolicy = z.infer<typeof teamResourcePolicy>
export const createOrganization = z.object({
  name: z.string().trim().min(1).max(120), defaultBudget: teamResourcePolicy.shape.defaultBudget,
}).strict()
export const createUnit = z
  .object({
    name: z.string().trim().min(1).max(120),
    parentId: resourceId,
    unitType: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  })
  .strict()
/** File audiences are scoped to one organization; null policies inherit from a folder. */
export const driveSharingPolicy = z.object({
  organizationId,
  scope: z.enum(['private', 'selected', 'organization']),
  permission: z.enum(['viewer', 'member']),
  memberIds: z.array(accountId).max(500),
  departments: z.array(z.object({ id: resourceId, includeDescendants: z.boolean() }).strict()).max(100),
}).strict().superRefine((value, ctx) => {
  const count = value.memberIds.length + value.departments.length
  if ((value.scope === 'selected') !== (count > 0)) ctx.addIssue({ code: 'custom', message: 'Selected sharing requires recipients; other scopes forbid recipients' })
  if (new Set(value.memberIds).size !== value.memberIds.length || new Set(value.departments.map(item => item.id)).size !== value.departments.length) ctx.addIssue({ code: 'custom', message: 'Duplicate sharing recipients' })
})
export type DriveSharingPolicy = z.infer<typeof driveSharingPolicy>

/** Idempotent same-team copy or temporary model-result save into a workspace. */
export const driveImportInput = z.object({ requestId: resourceId, source: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), nodeId: resourceId }).strict(),
  z.object({ kind: z.literal('model-asset'), assetId: resourceId }).strict(),
]), spaceId: resourceId, parentId: resourceId.nullable(), name: z.string().trim().min(1).max(255) }).strict()

export const driveCreateFolderInput = z.object({
  spaceId: resourceId,
  parentId: resourceId.nullable(),
  name: z.string().trim().min(1).max(255),
}).strict()
export const inviteMember = z
  .object({
    email: z.email().toLowerCase(),
    role: role.exclude(['owner']).default('member'),
    unitId: resourceId.optional(),
  })
  .strict()
/** Published model audiences use exact team IDs and never organization ancestry. */
export const modelAudience = z.object({ mode: z.enum(['all', 'selected']), organizationIds: z.array(organizationId).max(10000) }).strict()
  .refine(value => value.mode === 'all' ? value.organizationIds.length === 0 : value.organizationIds.length > 0, 'MODEL_AUDIENCE_REQUIRED')
  .refine(value => new Set(value.organizationIds).size === value.organizationIds.length, 'MODEL_AUDIENCE_DUPLICATE')
export const modelInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    audience: modelAudience.default({ mode: 'all', organizationIds: [] }),
    baseUrl: z.url().optional(),
    providerId: resourceId.optional(),
    operations: z.array(z.enum(['text.generate', 'embedding.create', 'image.generate', 'video.generate', 'audio.synthesize', 'audio.transcribe'])).min(1).default(['text.generate']),
    outputModalities: z.array(z.enum(['text', 'embedding', 'image', 'video', 'audio', 'transcript'])).min(1).default(['text']),
    upstreamModel: z.string().min(1).max(200),
    apiKey: z.string().min(1).max(4096).optional(),
    inputPriceCnyPerMillion: modelPriceCny,
    cachedInputPriceCnyPerMillion: modelPriceCny,
    outputPriceCnyPerMillion: modelPriceCny,
    maxOutputTokens: z.number().int().min(1).max(MAX_MODEL_TOKENS),
    contextTokens: z.number().int().min(1024).max(MAX_MODEL_TOKENS),
    images: z.boolean().default(false),
    protocol: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']).default('openai-completions'),
    inputModalities: z.array(z.enum(['text', 'image', 'video', 'audio', 'document'])).min(1).max(5).default(['text']),
    videoAudioMode: z.enum(['visual-only', 'visual-and-audio']).default('visual-only'),
    fileInputPolicy: z.enum(['unsupported', 'inline', 'provider-files']).default('unsupported'),
    maxFileBytes: z.number().int().min(1).max(512 * 1024 * 1024).default(10 * 1024 * 1024),
    maxRequestBytes: z.number().int().min(1).max(512 * 1024 * 1024).default(32 * 1024 * 1024),
    filesTtlSeconds: z.number().int().min(60).max(30 * 24 * 60 * 60).default(7 * 24 * 60 * 60),
    fileUploadTimeoutMs: z.number().int().min(1_000).max(10 * 60 * 1_000).default(120_000),
    fileUploadMaxRetries: z.number().int().min(0).max(10).default(1),
    fileRefreshMarginSeconds: z.number().int().min(0).max(30 * 24 * 60 * 60).default(60),
    fileQuotaCleanupBatch: z.number().int().min(0).max(10_000).default(0),
    modelCallTimeoutMs: z.number().int().min(1_000).max(30 * 60 * 1_000).default(300_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.providerId && (!value.baseUrl || !value.apiKey)) context.addIssue({ code: 'custom', path: ['providerId'], message: 'A provider or connection settings are required' })
    if (value.operations.includes('text.generate') && !value.inputModalities.includes('text')) context.addIssue({ code: 'custom', path: ['inputModalities'], message: 'Text modality is required' })
    if (value.videoAudioMode === 'visual-and-audio' && !value.inputModalities.includes('video')) {
      context.addIssue({ code: 'custom', path: ['videoAudioMode'], message: 'Video audio understanding requires video input' })
    }
    if (value.maxRequestBytes < value.maxFileBytes) context.addIssue({ code: 'custom', path: ['maxRequestBytes'], message: 'Request limit must include one maximum-size file' })
    if (value.fileRefreshMarginSeconds >= value.filesTtlSeconds) context.addIssue({ code: 'custom', path: ['fileRefreshMarginSeconds'], message: 'Refresh margin must be shorter than provider file lifetime' })
    if (value.operations.includes('text.generate') && value.inputModalities.some(modality => !['text', 'image'].includes(modality)) && value.fileInputPolicy === 'unsupported') {
      context.addIssue({ code: 'custom', path: ['fileInputPolicy'], message: 'Native file modalities require a file input policy' })
    }
  })
export const runtimeInput = z
  .object({
    name: z.string().min(1).max(120),
    type: z.enum(['browser', 'desktop']),
    version: z.string().min(1).max(40),
    capabilities: z.array(z.string().max(80)).max(80),
  })
  .strict()
export const pluginManifest = z
  .object({
    pluginId: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    targets: z
      .array(z.enum(['browser', 'desktop', 'cloud']))
      .min(1)
      .max(2),
    permissions: z.array(z.string().max(120)).max(80),
    tools: z
      .array(
        z
          .object({
            name: z.string().max(80),
            description: z.string().max(2000),
            inputSchema: z.record(z.string(), z.json()),
          })
          .strict(),
      )
      .max(40),
  })
  .strict()
export const pluginSubmission = z
  .object({
    manifest: pluginManifest,
    hostCode: z.string().max(256000).optional(),
    clientCode: z.string().max(256000).optional(),
    lockfile: z.string().max(512000).optional(),
  })
  .strict()
  .refine(v => Boolean(v.hostCode || v.clientCode), 'At least one code target is required')
export const aiReview = z
  .object({
    verdict: z.enum(['pass', 'reject']),
    summary: z.string().min(1).max(4000),
    findings: z
      .array(z.object({ severity: z.enum(['info', 'warning', 'blocker']), message: z.string().max(2000) }).strict())
      .max(100),
  })
  .strict()
export type AccountId = z.infer<typeof accountId>
export type OrganizationId = z.infer<typeof organizationId>
export type ResourceId = z.infer<typeof resourceId>
export type Role = z.infer<typeof role>

/** Platform plan defaults; prices are reference amounts and never debit wallets on assignment. */
export const subscriptionPlanInput = z.object({
  name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000),
  seats: z.number().int().min(1).max(100000), priceMicrosCny: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  resourcePolicy: teamResourcePolicy.nullable(), enabled: z.boolean(),
}).strict()
/** Plan codes are immutable and preserve existing subscription references. */
export const subscriptionPlan = subscriptionPlanInput.extend({
  code: z.string().trim().min(1).max(60), version: z.number().int().positive(), assignedTeams: z.number().int().nonnegative(),
})
/** A catalog edit requires the displayed version and an audit reason. */
export const subscriptionPlanWrite = z.object({
  expectedVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(1000), values: subscriptionPlanInput,
}).strict()

/** Versioned team management commands shared by Admin and desktop. */
export const governanceAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('credit'), amountMicrosCny: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).refine(value => value !== 0) }).strict(),
  z.object({ action: z.literal('resources'), policy: teamResourcePolicy }).strict(),
  z.object({ action: z.literal('subscription'), expiresAt: z.iso.datetime().nullable().optional(), plan: z.string().trim().min(1).max(60), planVersion: z.number().int().positive().optional(), seats: z.number().int().positive().max(100000) }).strict(),
  z.object({ action: z.literal('restore-request') }).strict(),
  z.object({ action: z.literal('leave') }).strict(),
  z.object({ action: z.literal('budget'), membershipId: resourceId, budget: memberBudget }).strict(),
  z.object({ action: z.literal('member-storage'), membershipId: resourceId,
    bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable() }).strict(),
  z.object({ action: z.literal('member-state'), membershipId: resourceId,
    status: z.enum(['active', 'suspended', 'removed']) }).strict(),
  z.object({ action: z.literal('owner-transfer'), membershipId: resourceId }).strict(),
  z.object({ action: z.literal('team-state'), status: z.enum(['active', 'suspended', 'closed']),
    closureReview: z.object({ tasks: z.literal(true), balance: z.literal(true), assets: z.literal(true),
      exports: z.literal(true) }).strict().optional(),
  }).strict().refine(value => value.status !== 'closed' || value.closureReview !== undefined, 'CLOSURE_REVIEW_REQUIRED'),
  z.object({ action: z.literal('handover'), membershipId: resourceId, targetMembershipId: resourceId }).strict(),
])
export const governanceRequest = z.object({ expectedVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(1000),
  change: governanceAction }).strict()

/** Safe team management state; no provider credentials or customer content. */
export const governanceSummary = z.object({
  organizationId, name: z.string(), status: z.enum(['active', 'suspended', 'closed']), version: z.number().int().positive(),
  subscription: z.object({ plan: z.string(), seats: z.number().int(), expiresAt: z.iso.datetime().nullable() }).nullable(),
  policy: teamResourcePolicy.nullable(), nextTimeZone: z.object({ timeZone: z.string(), effectiveAt: z.iso.datetime() }).nullable(),
  month: z.string(), permissions: z.array(z.string()),
  members: z.array(z.object({ id: resourceId, accountId, name: z.string(), email: z.string(), status: z.string(),
    budget: memberBudget, storageLimitBytes: z.number().int().nonnegative().nullable(),
    spentMicrosCny: z.number().int().nonnegative().nullable() }).strict()),
  balanceMicrosCny: z.number().int().nullable(), unfinishedTasks: z.number().int().nonnegative(),
  unsettledTasks: z.number().int().nonnegative(),
  storage: z.object({ usedBytes: z.number(), trashBytes: z.number(), versionBytes: z.number(), uploadBytes: z.number() }).strict(),
  readiness: z.record(z.string(), z.boolean()),
  updatedAt: z.iso.datetime(),
}).strict()

/** Monthly costs use admission attribution; pending estimates never count as settled spend. */
export const billingSummary = z.object({
  scope: z.enum(['own', 'organization']), month: z.string().regex(/^\d{4}-\d{2}$/), timeZone: z.string(),
  balanceMicrosCny: z.number().int().nullable(), budget: memberBudget, ownerExempt: z.boolean(),
  settledMicrosCny: z.number().int().nonnegative(), pendingCount: z.number().int().nonnegative(),
  pendingEstimateMicrosCny: z.number().int().nonnegative(), refundMicrosCny: z.number().int().nonnegative(),
  adjustmentMicrosCny: z.number().int(),
  departments: z.array(z.object({ id: resourceId, name: z.string().nullable(),
    settledMicrosCny: z.number().int().nonnegative() }).strict()),
  updatedAt: z.iso.datetime(),
}).strict()

/** Desktop administration commands are limited to the current team's management resources. */
export const teamManagementCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('role-create'), input: customRoleInput }).strict(),
  z.object({ action: z.literal('role-update'), id: resourceId, input: customRoleInput.extend({ expectedVersion: z.number().int().positive() }) }).strict(),
  z.object({ action: z.literal('role-disable'), id: resourceId, expectedVersion: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('role-bind'), id: resourceId, input: customRoleBindingInput.omit({ roleId: true }) }).strict(),
  z.object({ action: z.literal('fixed-role-bind'), input: z.object({ membershipId: resourceId, unitId: resourceId.nullable(), role,
    effect: z.enum(['allow', 'deny']).default('allow') }).strict() }).strict(),
  z.object({ action: z.literal('role-unbind'), id: resourceId }).strict(),
  z.object({ action: z.literal('identity-create'), input: identityProviderInput }).strict(),
  z.object({ action: z.literal('identity-update'), id: resourceId, input: identityProviderInput.partial().extend({ enabled: z.boolean().optional(), expectedVersion: z.number().int().positive() }).strict() }).strict(),
])
export const teamManagementState = z.object({
  permissions: z.array(z.string()),
  members: z.array(z.object({ id: resourceId, name: z.string(), email: z.string() })),
  catalog: z.array(z.object({ id: z.string(), description: z.string() })),
  roles: z.array(z.object({ id: resourceId, name: z.string(), description: z.string(), permissionIds: z.array(z.string()),
    version: z.number().int(), enabled: z.boolean(), system: z.boolean() })),
  bindings: z.array(z.object({ id: resourceId, membershipId: resourceId, role: z.string(), effect: z.enum(['allow', 'deny']), unitId: resourceId.nullable() })),
  providers: z.array(z.object({ id: resourceId, name: z.string(), protocol: z.string(), issuer: z.string().nullable(),
    enabled: z.boolean(), version: z.number().int() })),
}).strict()
export const teamAuditPage = z.object({
  items: z.array(z.object({ id: resourceId, actorId: accountId, action: z.string(), resourceId: z.string().nullable(),
    createdAt: z.string(), detail: z.record(z.string(), z.unknown()) })),
  nextCursor: z.string().nullable(),
}).strict()

/** Platform directory metadata never conveys membership or customer content access. */
export const platformTeamPage = z.object({
  items: z.array(z.object({ id: organizationId, name: z.string(), status: z.enum(['active', 'suspended', 'closed']),
    plan: z.string().nullable(), seats: z.number().int().nonnegative(), members: z.number().int().nonnegative(),
    balanceMicrosCny: z.number().int().nullable(), policy: teamResourcePolicy.nullable(),
    owners: z.array(z.object({ id: resourceId, email: z.email() }).strict()),
  }).strict()), nextCursor: organizationId.nullable(),
}).strict()

/** Targeted account recovery requires the displayed identity revision and an audited reason. */
export const accountRecovery = z.object({
  expectedUpdatedAt: z.iso.datetime(), reason: z.string().trim().min(1).max(1000),
}).strict()
