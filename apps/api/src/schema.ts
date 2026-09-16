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
  },
  t => [
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }),
    foreignKey({ columns: [t.organizationId, t.unitId], foreignColumns: [units.organizationId, units.id] }),
  ],
)
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
export const models = authSchema.table('model', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  upstreamModel: text('upstream_model').notNull(),
  secret: text('secret').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  images: boolean('images').notNull().default(false),
  contextTokens: integer('context_tokens').notNull(),
  maxOutputTokens: integer('max_output_tokens').notNull(),
  inputMicrosPerMillion: money('input_micros_per_million').notNull(),
  outputMicrosPerMillion: money('output_micros_per_million').notNull(),
  inputPriceMicrosCnyPerMillion: money('input_price_micros_cny_per_million').notNull().default(0),
  cachedInputPriceMicrosCnyPerMillion: money('cached_input_price_micros_cny_per_million').notNull().default(0),
  outputPriceMicrosCnyPerMillion: money('output_price_micros_cny_per_million').notNull().default(0),
}, t => [check('model_cny_prices_nonnegative', sql`
  ${t.inputPriceMicrosCnyPerMillion} >= 0
  AND ${t.cachedInputPriceMicrosCnyPerMillion} >= 0
  AND ${t.outputPriceMicrosCnyPerMillion} >= 0
`)])
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
    signature: text('signature'),
    revokedAt: date('revoked_at'),
    createdAt: created(),
  },
  t => [unique().on(t.organizationId, t.pluginId, t.version)],
)
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
