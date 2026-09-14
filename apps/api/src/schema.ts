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
})
export const modelGrants = tenantSchema.table(
  'model_grant',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    modelId: text('model_id')
      .notNull()
      .references(() => models.id),
    enabled: boolean('enabled').notNull().default(true),
    priority: integer('priority').notNull().default(100),
    isDefault: boolean('is_default').notNull().default(false),
    updatedAt: date('updated_at').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.organizationId, t.modelId] })],
)
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
    outputTokens: integer('output_tokens'),
    status: text('status').notNull().default('reserved'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: created(),
    settledAt: date('settled_at'),
  },
  t => [
    unique().on(t.organizationId, t.idempotencyKey),
    foreignKey({ columns: [t.organizationId, t.runtimeId], foreignColumns: [runtimes.organizationId, runtimes.id] }),
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
