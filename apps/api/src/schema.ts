/** PostgreSQL identity and tenant tables. Authentication credentials are not business memberships. */
import {
  pgSchema,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  unique,
  primaryKey,
  foreignKey,
  index,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const authSchema = pgSchema('enterprise_auth')
export const tenantSchema = pgSchema('enterprise')
const date = (name: string) => timestamp(name, { withTimezone: true })
const created = () => date('created_at').notNull().defaultNow()
const money = (name: string) => bigint(name, { mode: 'number' })

export const user = authSchema.table('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: created(),
  updatedAt: date('updated_at').notNull().defaultNow(),
})
export const session = authSchema.table('session', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: date('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: created(),
  updatedAt: date('updated_at').notNull().defaultNow(),
})
export const account = authSchema.table('account', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: date('access_token_expires_at'),
  refreshTokenExpiresAt: date('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: created(),
  updatedAt: date('updated_at').notNull().defaultNow(),
})
export const verification = authSchema.table('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: date('expires_at').notNull(),
  createdAt: created(),
  updatedAt: date('updated_at').notNull().defaultNow(),
})
export const platformAdmins = authSchema.table('platform_admin', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => user.id),
})
export const deployment = authSchema.table('deployment', {
  id: text('id').primaryKey(),
  rootOrganizationId: text('root_organization_id'),
  mode: text('mode').notNull(),
  registration: text('registration').notNull(),
  domains: jsonb('domains').$type<string[]>().notNull().default([]),
})
export const organizations = tenantSchema.table('organization', {
  id: text('id').primaryKey(),
  parentId: text('parent_id'),
  rootId: text('root_id'),
  depth: integer('depth').notNull().default(0),
  path: text('path').notNull().default(''),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('team'),
  status: text('status').notNull().default('active'),
  policyRevision: integer('policy_revision').notNull().default(1),
  independentReview: boolean('independent_review').notNull().default(false),
  createdAt: created(),
})
export const units = tenantSchema.table(
  'org_unit',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    parentId: text('parent_id'),
    unitType: text('unit_type').notNull(),
    name: text('name').notNull(),
  },
  t => [
    unique().on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.parentId], foreignColumns: [t.organizationId, t.id] }),
    check('unit_not_self', sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
  ],
)
export const memberships = tenantSchema.table(
  'membership',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    accountId: text('account_id')
      .notNull()
      .references(() => user.id),
    status: text('status').notNull().default('active'),
    createdAt: created(),
  },
  t => [unique().on(t.organizationId, t.accountId), unique().on(t.organizationId, t.id)],
)
export const assignments = tenantSchema.table(
  'unit_assignment',
  {
    organizationId: text('organization_id').notNull(),
    membershipId: text('membership_id').notNull(),
    unitId: text('unit_id').notNull(),
  },
  t => [
    primaryKey({ columns: [t.membershipId, t.unitId] }),
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }),
    foreignKey({ columns: [t.organizationId, t.unitId], foreignColumns: [units.organizationId, units.id] }),
  ],
)
export const roles = tenantSchema.table(
  'role_binding',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    membershipId: text('membership_id').notNull(),
    unitId: text('unit_id'),
    role: text('role').notNull(),
    effect: text('effect').notNull().default('allow'),
  },
  t => [
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }),
    foreignKey({ columns: [t.organizationId, t.unitId], foreignColumns: [units.organizationId, units.id] }),
  ],
)
export const permissions = tenantSchema.table('permission', {
  id: text('id').primaryKey(),
  resource: text('resource').notNull(),
  action: text('action').notNull(),
  description: text('description').notNull(),
  platform: boolean('platform').notNull().default(false),
  highRisk: boolean('high_risk').notNull().default(false),
})
export const customRoles = tenantSchema.table('custom_role', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  system: boolean('system').notNull().default(false),
  version: integer('version').notNull().default(1),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: created(),
}, t => [unique().on(t.organizationId, t.name)])
export const customRolePermissions = tenantSchema.table('custom_role_permission', {
  roleId: text('role_id').notNull().references(() => customRoles.id, { onDelete: 'cascade' }),
  permissionId: text('permission_id').notNull().references(() => permissions.id),
}, t => [primaryKey({ columns: [t.roleId, t.permissionId] })])
export const identityProviders = tenantSchema.table('identity_provider', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  protocol: text('protocol').notNull(),
  issuer: text('issuer'),
  enabled: boolean('enabled').notNull().default(false),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: created(),
  updatedAt: date('updated_at').notNull().defaultNow(),
}, t => [unique().on(t.organizationId, t.name)])
export const syncScripts = tenantSchema.table('sync_script', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  version: integer('version').notNull().default(1),
  source: text('source').notNull(),
  status: text('status').notNull().default('draft'),
  approvedBy: text('approved_by').references(() => user.id),
  createdAt: created(),
  updatedAt: date('updated_at').notNull().defaultNow(),
}, t => [unique().on(t.organizationId, t.name, t.version)])
export const syncRuns = tenantSchema.table('sync_run', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  scriptId: text('script_id').notNull().references(() => syncScripts.id),
  trigger: text('trigger').notNull(),
  status: text('status').notNull().default('queued'),
  preview: jsonb('preview').$type<Record<string, unknown>>().notNull().default({}),
  error: text('error'),
  startedAt: date('started_at'),
  finishedAt: date('finished_at'),
  createdAt: created(),
})
export const syncDiffs = tenantSchema.table('sync_diff', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  runId: text('run_id').notNull().references(() => syncRuns.id),
  entityType: text('entity_type').notNull(),
  externalId: text('external_id').notNull(),
  changeType: text('change_type').notNull(),
  before: jsonb('before').$type<Record<string, unknown> | null>(),
  after: jsonb('after').$type<Record<string, unknown> | null>(),
  status: text('status').notNull().default('pending'),
  version: integer('version').notNull().default(1),
  decidedBy: text('decided_by').references(() => user.id),
  decidedAt: date('decided_at'),
  createdAt: created(),
}, t => [index('sync_diff_org_status').on(t.organizationId, t.status, t.createdAt)])
export const syncRollbacks = tenantSchema.table('sync_rollback', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  sourceRunId: text('source_run_id').notNull().references(() => syncRuns.id),
  compensatingRunId: text('compensating_run_id').references(() => syncRuns.id),
  status: text('status').notNull().default('queued'),
  version: integer('version').notNull().default(1),
  requestedBy: text('requested_by').notNull().references(() => user.id),
  createdAt: created(),
}, t => [index('sync_rollback_org_time').on(t.organizationId, t.createdAt)])
export const identityFieldMappings = tenantSchema.table('identity_field_mapping', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  providerId: text('provider_id').notNull().references(() => identityProviders.id, { onDelete: 'cascade' }),
  sourceField: text('source_field').notNull(),
  targetField: text('target_field').notNull(),
  transform: text('transform').notNull().default('direct'),
  required: boolean('required').notNull().default(false),
  version: integer('version').notNull().default(1),
  createdAt: created(),
  updatedAt: date('updated_at').notNull().defaultNow(),
}, t => [unique('identity_field_mapping_source').on(t.providerId, t.sourceField)])
export const identityLoginFailures = tenantSchema.table('identity_login_failure', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  providerId: text('provider_id').references(() => identityProviders.id, { onDelete: 'set null' }),
  subjectHint: text('subject_hint').notNull(),
  reasonCode: text('reason_code').notNull(),
  ipHash: text('ip_hash'),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: date('occurred_at').notNull().defaultNow(),
}, t => [index('identity_login_failure_org_time').on(t.organizationId, t.occurredAt)])
export const sessionApprovals = tenantSchema.table('session_approval', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  sessionId: text('session_id').notNull().references(() => conversations.id),
  requesterId: text('requester_id').notNull().references(() => user.id),
  action: text('action').notNull(),
  reason: text('reason').notNull().default(''),
  status: text('status').notNull().default('pending'),
  version: integer('version').notNull().default(1),
  decidedBy: text('decided_by').references(() => user.id),
  decidedAt: date('decided_at'),
  createdAt: created(),
}, t => [index('session_approval_org_status').on(t.organizationId, t.status, t.createdAt)])
export const subscriptions = tenantSchema.table(
  'subscription',
  {
    organizationId: text('organization_id')
      .primaryKey()
      .references(() => organizations.id),
    plan: text('plan').notNull().default('team'),
    seats: integer('seats').notNull().default(1),
    runtimes: integer('runtimes').notNull().default(2),
    budgetMicros: money('budget_micros').notNull().default(0),
    spentMicros: money('spent_micros').notNull().default(0),
    reservedMicros: money('reserved_micros').notNull().default(0),
  },
  t => [
    check(
      'subscription_nonnegative',
      sql`${t.budgetMicros} >= 0 AND ${t.spentMicros} >= 0 AND ${t.reservedMicros} >= 0 AND ${t.seats} > 0 AND ${t.runtimes} > 0`,
    ),
  ],
)
export const organizationWallets = tenantSchema.table('organization_wallet', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organizations.id),
  balanceMicrosCny: money('balance_micros_cny').notNull().default(0),
  updatedAt: date('updated_at').notNull().defaultNow(),
  version: integer('version').notNull().default(1),
}, t => [check('organization_wallet_version_positive', sql`${t.version} > 0`)])

export const redemptionCodes = authSchema.table('redemption_code', {
  id: text('id').primaryKey(),
  batchId: text('batch_id').notNull(),
  codeHash: text('code_hash').notNull().unique(),
  codeHint: text('code_hint').notNull(),
  amountMicrosCny: money('amount_micros_cny').notNull(),
  note: text('note'),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  expiresAt: date('expires_at'),
  revokedAt: date('revoked_at'),
  redeemedAt: date('redeemed_at'),
  redeemedBy: text('redeemed_by').references(() => user.id),
  redeemedOrganizationId: text('redeemed_organization_id').references(() => organizations.id),
  createdAt: created(),
}, t => [
  index('redemption_code_batch').on(t.batchId, t.createdAt),
  check('redemption_code_amount_positive', sql`${t.amountMicrosCny} > 0`),
])

export const invitations = tenantSchema.table(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    email: text('email').notNull(),
    role: text('role').notNull(),
    unitId: text('unit_id'),
    tokenHash: text('token_hash').notNull().unique(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id),
    expiresAt: date('expires_at').notNull(),
    acceptedAt: date('accepted_at'),
    createdAt: created(),
  },
  t => [foreignKey({ columns: [t.organizationId, t.unitId], foreignColumns: [units.organizationId, units.id] })],
)
export const runtimes = tenantSchema.table(
  'runtime',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    accountId: text('account_id')
      .notNull()
      .references(() => user.id),
    name: text('name').notNull(),
    type: text('type').notNull(),
    version: text('version').notNull(),
    capabilities: jsonb('capabilities').$type<string[]>().notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    leaseUntil: date('lease_until').notNull(),
    revokedAt: date('revoked_at'),
    createdAt: created(),
  },
  t => [unique().on(t.organizationId, t.id)],
)
export const workspaces = tenantSchema.table('workspace', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  accountId: text('account_id').notNull().references(() => user.id),
  name: text('name').notNull(),
  image: text('image').notNull().default('dsh-base'),
  status: text('status').notNull().default('stopped'),
  provider: text('provider').notNull().default('e2b'),
  providerId: text('provider_id'),
  leaseId: text('lease_id'),
  leaseUntil: date('lease_until'),
  createdAt: created(),
  updatedAt: date('updated_at').notNull().defaultNow(),
}, t => [unique().on(t.organizationId, t.id), index('workspace_org_status').on(t.organizationId, t.status)])
export const walletLedger = tenantSchema.table(
  'wallet_ledger',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    amountMicrosCny: money('amount_micros_cny').notNull(),
    kind: text('kind').notNull(),
    usageId: text('usage_id'),
    redemptionCodeId: text('redemption_code_id').references(() => redemptionCodes.id),
    accountId: text('account_id')
      .notNull()
      .references(() => user.id),
    runtimeId: text('runtime_id'),
    balanceAfterMicrosCny: money('balance_after_micros_cny').notNull(),
    createdAt: created(),
  },
  t => [
    unique('wallet_ledger_usage').on(t.usageId),
    unique('wallet_ledger_redemption').on(t.redemptionCodeId),
    foreignKey({ columns: [t.organizationId, t.runtimeId], foreignColumns: [runtimes.organizationId, runtimes.id] }),
    index('wallet_ledger_org_time').on(t.organizationId, t.createdAt, t.id),
    check('wallet_ledger_kind_valid', sql`
      (${t.kind} = 'redemption_credit' AND ${t.amountMicrosCny} > 0 AND ${t.redemptionCodeId} IS NOT NULL AND ${t.usageId} IS NULL)
      OR (${t.kind} = 'model_usage_debit' AND ${t.amountMicrosCny} <= 0 AND ${t.usageId} IS NOT NULL AND ${t.redemptionCodeId} IS NULL)
    `),
  ],
)
export const models = authSchema.table('model', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  upstreamModel: text('upstream_model').notNull(),
  secret: text('secret').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  images: boolean('images').notNull().default(false),
  protocol: text('protocol').notNull().default('openai-completions'),
  inputModalities: jsonb('input_modalities').$type<string[]>().notNull().default(['text']),
  videoAudioMode: text('video_audio_mode').notNull().default('visual-only'),
  fileInputPolicy: text('file_input_policy').notNull().default('unsupported'),
  maxFileBytes: integer('max_file_bytes').notNull().default(10 * 1024 * 1024),
  maxRequestBytes: integer('max_request_bytes').notNull().default(32 * 1024 * 1024),
  filesTtlSeconds: integer('files_ttl_seconds').notNull().default(7 * 24 * 60 * 60),
  fileUploadTimeoutMs: integer('file_upload_timeout_ms').notNull().default(120_000),
  fileUploadMaxRetries: integer('file_upload_max_retries').notNull().default(1),
  fileRefreshMarginSeconds: integer('file_refresh_margin_seconds').notNull().default(60),
  fileQuotaCleanupBatch: integer('file_quota_cleanup_batch').notNull().default(0),
  modelCallTimeoutMs: integer('model_call_timeout_ms').notNull().default(300_000),
  contextTokens: integer('context_tokens').notNull(),
  maxOutputTokens: integer('max_output_tokens').notNull(),
  inputMicrosPerMillion: money('input_micros_per_million').notNull(),
  outputMicrosPerMillion: money('output_micros_per_million').notNull(),
  inputPriceMicrosCnyPerMillion: money('input_price_micros_cny_per_million').notNull().default(0),
  cachedInputPriceMicrosCnyPerMillion: money('cached_input_price_micros_cny_per_million').notNull().default(0),
  outputPriceMicrosCnyPerMillion: money('output_price_micros_cny_per_million').notNull().default(0),
}, t => [
  check('model_cny_prices_nonnegative', sql`
    ${t.inputPriceMicrosCnyPerMillion} >= 0
    AND ${t.cachedInputPriceMicrosCnyPerMillion} >= 0
    AND ${t.outputPriceMicrosCnyPerMillion} >= 0
  `),
  check('model_capability_values_supported', sql`
    ${t.protocol} IN ('openai-completions', 'openai-responses', 'anthropic-messages')
    AND ${t.fileInputPolicy} IN ('unsupported', 'inline', 'provider-files')
    AND ${t.videoAudioMode} IN ('visual-only', 'visual-and-audio')
    AND (${t.videoAudioMode} = 'visual-only' OR ${t.inputModalities} ? 'video')
  `),
  check('model_file_limits_positive', sql`
    ${t.maxFileBytes} > 0
    AND ${t.maxRequestBytes} >= ${t.maxFileBytes}
    AND ${t.filesTtlSeconds} > 0
  `),
  check('model_file_transfer_policy_valid', sql`
    ${t.fileUploadTimeoutMs} > 0
    AND ${t.fileUploadMaxRetries} >= 0
    AND ${t.fileRefreshMarginSeconds} >= 0
    AND ${t.fileRefreshMarginSeconds} < ${t.filesTtlSeconds}
    AND ${t.fileQuotaCleanupBatch} >= 0
  `),
  check('model_call_timeout_positive', sql`${t.modelCallTimeoutMs} > 0`),
])

/** Published provider-neutral adapters for non-text model operations. */
export const modelAdapters = authSchema.table('model_adapter', {
  id: text('id').primaryKey(),
  publicModel: text('public_model').notNull(),
  operation: text('operation').notNull(),
  version: integer('version').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  secret: text('secret').notNull(),
  configuration: jsonb('configuration').$type<Record<string, unknown>>().notNull(),
  prices: jsonb('prices').$type<Record<string, string>>().notNull(),
  reserveMicrosCny: money('reserve_micros_cny').notNull(),
  createdAt: created(),
}, t => [
  unique('model_adapter_model_version').on(t.publicModel, t.operation, t.version),
  index('model_adapter_published').on(t.enabled, t.publicModel, t.operation),
  check('model_adapter_operation_valid', sql`${t.operation} IN ('embedding.create', 'image.generate', 'video.generate', 'audio.synthesize', 'audio.transcribe')`),
  check('model_adapter_version_valid', sql`${t.version} > 0 AND ${t.reserveMicrosCny} >= 0`),
])

/** Durable task state and immutable adapter and pricing snapshots. */
export const modelTasks = tenantSchema.table('model_task', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  accountId: text('account_id').notNull().references(() => user.id),
  runtimeId: text('runtime_id'),
  idempotencyKey: text('idempotency_key').notNull(),
  publicModel: text('public_model').notNull(),
  operation: text('operation').notNull(),
  adapterVersion: integer('adapter_version').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  input: jsonb('input').$type<Record<string, unknown>>().notNull(),
  parameters: jsonb('parameters').$type<Record<string, unknown>>().notNull(),
  providerTaskId: text('provider_task_id'),
  status: text('status').notNull(),
  results: jsonb('results').$type<unknown[]>().notNull().default([]),
  usage: jsonb('usage').$type<Record<string, unknown>>(),
  error: jsonb('error').$type<Record<string, unknown>>(),
  billingStatus: text('billing_status').notNull(),
  reservedMicrosCny: money('reserved_micros_cny').notNull(),
  finalMicrosCny: money('final_micros_cny'),
  collectedMicrosCny: money('collected_micros_cny').notNull().default(0),
  outstandingMicrosCny: money('outstanding_micros_cny').notNull().default(0),
  queryLeaseUntil: date('query_lease_until'),
  queryLeaseToken: text('query_lease_token'),
  lastQueriedAt: date('last_queried_at'),
  nextQueryAt: date('next_query_at').notNull().defaultNow(),
  reviewReason: text('review_reason'),
  version: integer('version').notNull().default(1),
  createdAt: created(),
  updatedAt: date('updated_at').notNull().defaultNow(),
  settledAt: date('settled_at'),
}, t => [
  unique('model_task_org_idempotency').on(t.organizationId, t.idempotencyKey),
  foreignKey({ columns: [t.organizationId, t.runtimeId], foreignColumns: [runtimes.organizationId, runtimes.id] }),
  index('model_task_scan_due').on(t.createdAt, t.billingStatus, t.nextQueryAt, t.queryLeaseUntil),
  index('model_task_owner').on(t.organizationId, t.accountId, t.createdAt),
  check('model_task_status_valid', sql`${t.status} IN ('queued', 'submitting', 'processing', 'succeeded', 'failed', 'cancelled', 'unknown')`),
  check('model_task_billing_status_valid', sql`${t.billingStatus} IN ('reserved', 'awaiting_usage', 'settled', 'partially_collected', 'review_required')`),
  check('model_task_amounts_nonnegative', sql`${t.reservedMicrosCny} >= 0 AND ${t.collectedMicrosCny} >= 0 AND ${t.outstandingMicrosCny} >= 0 AND ${t.version} > 0`),
])

/** Append-only wallet movements for task holds, refunds, charges, and corrections. */
export const modelTaskLedger = tenantSchema.table('model_task_ledger', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  taskId: text('task_id').notNull().references(() => modelTasks.id),
  accountId: text('account_id').notNull().references(() => user.id),
  runtimeId: text('runtime_id'),
  eventKey: text('event_key').notNull(),
  kind: text('kind').notNull(),
  amountMicrosCny: money('amount_micros_cny').notNull(),
  balanceAfterMicrosCny: money('balance_after_micros_cny').notNull(),
  createdAt: created(),
}, t => [
  unique('model_task_ledger_event').on(t.taskId, t.eventKey),
  foreignKey({ columns: [t.organizationId, t.runtimeId], foreignColumns: [runtimes.organizationId, runtimes.id] }),
  index('model_task_ledger_org_time').on(t.organizationId, t.createdAt, t.id),
  check('model_task_ledger_kind_valid', sql`${t.kind} IN ('reserve', 'settle', 'release', 'charge', 'adjustment')`),
])
export const usage = tenantSchema.table(
  'usage',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    accountId: text('account_id')
      .notNull()
      .references(() => user.id),
    runtimeId: text('runtime_id'),
    pluginId: text('plugin_id'),
    pluginInstallationId: text('plugin_installation_id'),
    pluginReleaseId: text('plugin_release_id'),
    pluginCallId: text('plugin_call_id'),
    modelId: text('model_id')
      .notNull()
      .references(() => models.id),
    purpose: text('purpose').notNull(),
    reservedMicros: money('reserved_micros').notNull(),
    actualMicros: money('actual_micros'),
    billedMicros: money('billed_micros'),
    inputTokens: integer('input_tokens'),
    cachedInputTokens: integer('cached_input_tokens'),
    uncachedInputTokens: integer('uncached_input_tokens'),
    outputTokens: integer('output_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    totalTokens: integer('total_tokens'),
    protocol: text('protocol').notNull().default('openai-completions'),
    inputModalities: jsonb('input_modalities').$type<string[]>().notNull().default(['text']),
    fileUploadCount: integer('file_upload_count').notNull().default(0),
    uploadedBytes: money('uploaded_bytes').notNull().default(0),
    fileUploadFailures: integer('file_upload_failures').notNull().default(0),
    reconciliationReason: text('reconciliation_reason'),
    failureReason: text('failure_reason'),
    currency: text('currency'),
    pricingVersion: integer('pricing_version'),
    inputPriceMicrosCnyPerMillion: money('input_price_micros_cny_per_million'),
    cachedInputPriceMicrosCnyPerMillion: money('cached_input_price_micros_cny_per_million'),
    outputPriceMicrosCnyPerMillion: money('output_price_micros_cny_per_million'),
    inputCostMicrosCny: money('input_cost_micros_cny'),
    cachedInputCostMicrosCny: money('cached_input_cost_micros_cny'),
    outputCostMicrosCny: money('output_cost_micros_cny'),
    totalCostMicrosCny: money('total_cost_micros_cny'),
    requestStartedAt: date('request_started_at'),
    durationMs: integer('duration_ms'),
    upstreamRequestId: text('upstream_request_id'),
    status: text('status').notNull().default('reserved'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: created(),
    settledAt: date('settled_at'),
  },
  t => [
    unique().on(t.organizationId, t.idempotencyKey),
    foreignKey({ columns: [t.organizationId, t.runtimeId], foreignColumns: [runtimes.organizationId, runtimes.id] }),
    index('usage_settled_time').on(t.settledAt, t.id),
    index('usage_org_settled_time').on(t.organizationId, t.settledAt),
    index('usage_model_settled_time').on(t.modelId, t.settledAt),
    index('usage_account_settled_time').on(t.accountId, t.settledAt),
    index('usage_plugin_installation').on(t.pluginInstallationId, t.createdAt),
    check('usage_cny_complete', sql`${t.currency} IS NULL OR (
      ${t.currency} = 'CNY' AND ${t.pricingVersion} = 1
      AND ${t.inputTokens} >= 0 AND ${t.cachedInputTokens} >= 0 AND ${t.uncachedInputTokens} >= 0
      AND ${t.outputTokens} >= 0 AND ${t.reasoningTokens} >= 0 AND ${t.totalTokens} >= 0
      AND ${t.cachedInputTokens} + ${t.uncachedInputTokens} = ${t.inputTokens}
      AND ${t.totalTokens} = ${t.inputTokens} + ${t.outputTokens}
      AND ${t.reasoningTokens} <= ${t.outputTokens}
      AND ${t.inputPriceMicrosCnyPerMillion} >= 0 AND ${t.cachedInputPriceMicrosCnyPerMillion} >= 0
      AND ${t.outputPriceMicrosCnyPerMillion} >= 0 AND ${t.inputCostMicrosCny} >= 0
      AND ${t.cachedInputCostMicrosCny} >= 0 AND ${t.outputCostMicrosCny} >= 0
      AND ${t.totalCostMicrosCny} = ${t.inputCostMicrosCny} + ${t.cachedInputCostMicrosCny} + ${t.outputCostMicrosCny}
      AND ${t.requestStartedAt} IS NOT NULL AND ${t.durationMs} >= 0
    )`),
    check('usage_multimodal_dimensions_valid', sql`
      ${t.protocol} IN ('openai-completions', 'openai-responses')
      AND ${t.fileUploadCount} >= 0
      AND ${t.uploadedBytes} >= 0
      AND ${t.fileUploadFailures} >= 0
    `),
  ],
)
export const audit = tenantSchema.table(
  'audit',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    resourceId: text('resource_id'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: created(),
  },
  t => [index('audit_org_time').on(t.organizationId, t.createdAt)],
)
export const conversations = tenantSchema.table(
  'conversation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    accountId: text('account_id')
      .notNull()
      .references(() => user.id),
    header: jsonb('header').notNull(),
    inheritedEventCount: integer('inherited_event_count').notNull().default(0),
    nextSeq: integer('next_seq').notNull().default(0),
    writer: text('writer'),
    writerRuntimeId: text('writer_runtime_id'),
    leaseUntil: date('lease_until'),
    createdAt: created(),
  },
  t => [unique().on(t.organizationId, t.id)],
)
export const events = tenantSchema.table(
  'session_event',
  {
    organizationId: text('organization_id').notNull(),
    sessionId: text('session_id').notNull(),
    seq: integer('seq').notNull(),
    event: jsonb('event').notNull(),
  },
  t => [
    primaryKey({ columns: [t.sessionId, t.seq] }),
    foreignKey({
      columns: [t.organizationId, t.sessionId],
      foreignColumns: [conversations.organizationId, conversations.id],
    }),
  ],
)
export const plugins = tenantSchema.table(
  'plugin_release',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    submitterId: text('submitter_id').notNull(),
    pluginId: text('plugin_id').notNull(),
    version: text('version').notNull(),
    manifest: jsonb('manifest').notNull(),
    hostCode: text('host_code'),
    clientCode: text('client_code'),
    digest: text('digest').notNull(),
    manifestDigest: text('manifest_digest').notNull(),
    permissionsDigest: text('permissions_digest').notNull(),
    status: text('status').notNull().default('submitted'),
    review: jsonb('review'),
    reviewerId: text('reviewer_id'),
    revokedAt: date('revoked_at'),
    /** Marketplace visibility: private, organization, or platform. */
    visibility: text('visibility').notNull().default('organization'),
    /** Storage format for the immutable artifact. Legacy rows keep their JSON artifact. */
    packageFormat: text('package_format').notNull().default('legacy-json'),
    packageSize: integer('package_size'),
    artifactKey: text('artifact_key'),
    publishedAt: date('published_at'),
    createdAt: created(),
  },
  t => [unique().on(t.organizationId, t.pluginId, t.version)],
)

/** Account-level desired plugin state synchronized to each compatible device. */
export const pluginInstallations = tenantSchema.table(
  'plugin_installation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id),
    accountId: text('account_id').notNull().references(() => user.id),
    pluginId: text('plugin_id').notNull(),
    releaseId: text('release_id').notNull().references(() => plugins.id),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').notNull().default({}),
    targetState: jsonb('target_state').notNull().default({}),
    ownerKind: text('owner_kind').notNull().default('personal'),
    dataSpaceId: text('data_space_id').notNull(),
    permissionRevision: integer('permission_revision').notNull().default(1),
    desiredState: text('desired_state').notNull().default('disabled'),
    observedState: text('observed_state').notNull().default('not-installed'),
    cleanupState: text('cleanup_state').notNull().default('none'),
    lastError: text('last_error'),
    uninstalledAt: date('uninstalled_at'),
    createdAt: created(),
    updatedAt: date('updated_at').notNull().defaultNow(),
  },
  t => [
    index('plugin_installation_plugin').on(t.organizationId, t.pluginId, t.ownerKind),
    index('plugin_installation_account').on(t.organizationId, t.accountId, t.updatedAt),
  ],
)

/** Device-specific desired and observed target state for one installation. */
export const pluginDeviceActivations = tenantSchema.table(
  'plugin_device_activation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id),
    installationId: text('installation_id').notNull().references(() => pluginInstallations.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull().references(() => user.id),
    deviceId: text('device_id').notNull(),
    targetKind: text('target_kind').notNull(),
    desiredState: text('desired_state').notNull().default('disabled'),
    observedState: text('observed_state').notNull().default('not-installed'),
    releaseId: text('release_id').notNull().references(() => plugins.id),
    permissionRevision: integer('permission_revision').notNull().default(1),
    lastError: text('last_error'),
    heartbeatAt: date('heartbeat_at'),
    leaseExpiresAt: date('lease_expires_at'),
    cleanupState: text('cleanup_state').notNull().default('none'),
    updatedAt: date('updated_at').notNull().defaultNow(),
  },
  t => [
    unique().on(t.installationId, t.deviceId, t.targetKind),
    index('plugin_device_activation_account').on(t.organizationId, t.accountId, t.updatedAt),
  ],
)

/** One short-lived activation lease and its revocation revision. */
export const pluginActivations = tenantSchema.table(
  'plugin_activation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id),
    installationId: text('installation_id').notNull().references(() => pluginInstallations.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    targetKind: text('target_kind').notNull(),
    releaseId: text('release_id').notNull().references(() => plugins.id),
    permissionRevision: integer('permission_revision').notNull(),
    tokenHash: text('token_hash').notNull(),
    startedAt: date('started_at').notNull().defaultNow(),
    expiresAt: date('expires_at').notNull().defaultNow(),
    stoppedAt: date('stopped_at'),
    revokedAt: date('revoked_at'),
  },
  t => [index('plugin_activation_lookup').on(t.organizationId, t.installationId, t.deviceId)],
)

/** Durable lifecycle operation record used for idempotent control-plane changes. */
export const pluginOperations = tenantSchema.table(
  'plugin_operation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id),
    installationId: text('installation_id').notNull().references(() => pluginInstallations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    stage: text('stage').notNull(),
    status: text('status').notNull().default('running'),
    error: text('error'),
    retryable: boolean('retryable').notNull().default(true),
    recoveryAction: text('recovery_action'),
    createdAt: created(),
    updatedAt: date('updated_at').notNull().defaultNow(),
  },
  t => [unique().on(t.organizationId, t.idempotencyKey), index('plugin_operation_installation').on(t.installationId, t.updatedAt)],
)

/** Durable metadata for installation-scoped business objects; bytes remain in artifact storage. */
export const pluginObjects = tenantSchema.table(
  'plugin_object',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id),
    installationId: text('installation_id').notNull().references(() => pluginInstallations.id, { onDelete: 'cascade' }),
    dataSpaceId: text('data_space_id').notNull(),
    objectId: text('object_id').notNull(),
    version: text('version').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    contentType: text('content_type').notNull(),
    artifactKey: text('artifact_key').notNull(),
    idempotencyKey: text('idempotency_key'),
    createdAt: created(),
    deletedAt: date('deleted_at'),
  },
  t => [
    unique().on(t.installationId, t.objectId, t.version),
    unique().on(t.installationId, t.idempotencyKey),
    index('plugin_object_lookup').on(t.organizationId, t.dataSpaceId, t.objectId, t.createdAt),
  ],
)

/** Cloud drive spaces, directory nodes and immutable file versions. */
export const driveSpaces = tenantSchema.table('drive_space', {
  id: text('id').primaryKey(), organizationId: text('organization_id').references(() => organizations.id),
  accountId: text('account_id').references(() => user.id), kind: text('kind').notNull(), name: text('name').notNull(),
  createdAt: created(),
}, t => [index('drive_space_owner').on(t.organizationId, t.accountId)])
export const driveNodes = tenantSchema.table('drive_node', {
  id: text('id').primaryKey(), spaceId: text('space_id').notNull().references(() => driveSpaces.id, { onDelete: 'cascade' }),
  parentId: text('parent_id').references((): AnyPgColumn => driveNodes.id, { onDelete: 'cascade' }), name: text('name').notNull(), kind: text('kind').notNull(), size: bigint('size', { mode: 'number' }).notNull().default(0),
  contentType: text('content_type').notNull().default('application/octet-stream'), versionId: text('version_id'), deletedAt: date('deleted_at'), updatedAt: date('updated_at').notNull().defaultNow(),
}, t => [unique().on(t.spaceId, t.parentId, t.name), index('drive_node_parent').on(t.spaceId, t.parentId, t.updatedAt)])
export const driveVersions = tenantSchema.table('drive_version', {
  id: text('id').primaryKey(), nodeId: text('node_id').notNull().references(() => driveNodes.id, { onDelete: 'cascade' }),
  size: bigint('size', { mode: 'number' }).notNull(), contentType: text('content_type').notNull(), checksum: text('checksum').notNull(), objectKey: text('object_key').notNull(), createdBy: text('created_by').notNull(), createdAt: created(),
})
export const driveDescriptions = tenantSchema.table('drive_description', {
  id: text('id').primaryKey(), nodeId: text('node_id').notNull().references(() => driveNodes.id, { onDelete: 'cascade' }), versionId: text('version_id').references(() => driveVersions.id), type: text('type').notNull(), content: text('content').notNull(), fields: jsonb('fields'), source: text('source').notNull(), status: text('status').notNull().default('active'), reference: jsonb('reference'), createdBy: text('created_by').notNull(), createdAt: created(), updatedAt: date('updated_at').notNull().defaultNow(),
}, t => [index('drive_description_node').on(t.nodeId, t.status)])
export const desktopCodes = authSchema.table('desktop_code', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => user.id),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  challenge: text('challenge').notNull(),
  expiresAt: date('expires_at').notNull(),
  consumedAt: date('consumed_at'),
  runtime: jsonb('runtime')
    .$type<{ name: string; type: 'desktop'; version: string; capabilities: string[] }>()
    .notNull(),
})
export const driveUploads = tenantSchema.table('drive_upload', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id),
  spaceId: text('space_id').notNull().references(() => driveSpaces.id, { onDelete: 'cascade' }), nodeId: text('node_id').references(() => driveNodes.id, { onDelete: 'cascade' }), reservedNodeId: text('reserved_node_id'), parentId: text('parent_id'), expectedName: text('expected_name').notNull(),
  versionId: text('version_id').notNull(), objectKey: text('object_key').notNull(), expectedSize: bigint('expected_size', { mode: 'number' }).notNull(), expectedContentType: text('expected_content_type').notNull(), expectedChecksum: text('expected_checksum'), status: text('status').notNull().default('created'), expiresAt: date('expires_at').notNull(), createdBy: text('created_by').notNull(), createdAt: created(),
}, t => [index('drive_upload_expiry').on(t.status, t.expiresAt)])
export const driveEditSessions = tenantSchema.table('drive_edit_session', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id), nodeId: text('node_id').notNull().references(() => driveNodes.id, { onDelete: 'cascade' }), baseVersionId: text('base_version_id').notNull(), accountId: text('account_id').notNull().references(() => user.id), status: text('status').notNull().default('active'), conflict: boolean('conflict').notNull().default(false), expiresAt: date('expires_at').notNull(), createdAt: created(), closedAt: date('closed_at'),
}, t => [index('drive_edit_session_owner').on(t.accountId, t.status, t.expiresAt)])
export const driveAudit = tenantSchema.table('drive_audit', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id), actorId: text('actor_id').notNull(), spaceId: text('space_id'), nodeId: text('node_id'), versionId: text('version_id'), descriptionId: text('description_id'), action: text('action').notNull(), detail: jsonb('detail').notNull().default({}), createdAt: created(),
}, t => [index('drive_audit_lookup').on(t.organizationId, t.spaceId, t.createdAt, t.id)])
