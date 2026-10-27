/** Deterministic metadata for Admin rendering; identifiers never address a live deployment. */
export const teamId = '11111111-1111-4111-8111-111111111111'
const memberId = '22222222-2222-4222-8222-222222222222'
const createdAt = '2026-10-01T08:00:00.000Z'
const policy = { defaultBudget: { mode: 'limited', amountMicrosCny: 100_000_000 }, timeZone: 'Asia/Shanghai', storageBytes: 10737418240, personalStorageBytes: 1073741824 }
const plan = { code: 'team', name: '验收团队套餐', description: '验收用套餐', seats: 20, priceMicrosCny: 100_000_000, resourcePolicy: policy, enabled: true, version: 3, assignedTeams: 1 }
const account = { id: 'acceptance-admin', name: '验收管理员', email: 'admin@example.test', emailVerified: true, createdAt, updatedAt: createdAt }
const team = { id: teamId, name: '验收团队', status: 'active', plan: 'team', seats: 20, members: 2, balanceMicrosCny: 120_000_000, policy, owners: [{ id: memberId, email: account.email }] }
const model = { id: 'model-fixture', name: '验收模型', upstreamModel: 'acceptance-model', protocol: 'openai-completions', enabled: true, contextTokens: 128000, maxOutputTokens: 8192, inputModalities: ['text'], inputPriceCnyPerMillion: 1, cachedInputPriceCnyPerMillion: 0.1, outputPriceCnyPerMillion: 2, publicationRevision: 4, audience: { mode: 'all' }, fileInputPolicy: 'unsupported', modelCallTimeoutMs: 300000 }
const runtime = { id: 'runtime-fixture', name: '验收设备', accountId: account.id, organizationId: teamId, type: 'desktop', version: '1.0.0', expiresAt: '2099-01-01T00:00:00.000Z', createdAt, revokedAt: null }
const summary = { totalCostMicrosCny: 12_600_000, calls: 6, totalTokens: 12000, cachedInputTokens: 1000 }
const trend = [0, 1, 2, 3].map(index => ({ day: `2026-10-0${index + 1}`, calls: index, totalCostMicrosCny: index * 2_100_000 }))
const audit = [{ id: 'audit-fixture', action: 'team.updated', resourceId: teamId, actorId: account.id, createdAt }]
const health = [{ id: 'api', label: 'API', status: 'ready', latencyMs: 8, availability: null }, { id: 'database', label: 'PostgreSQL', status: 'unknown', latencyMs: null, availability: null }]
const record = { id: 'usage-fixture', organizationId: teamId, organizationName: team.name, accountEmail: account.email, modelName: model.name, occurredAt: createdAt, status: 'pending_reconciliation', reconciliationReason: '供应商结果待核对', inputTokens: 8000, cachedInputTokens: 1000, outputTokens: 3000, reasoningTokens: 0, totalCostMicrosCny: 12_600_000 }

/** Return the fixture for an exact Admin read; unknown paths fail to expose accidental requests.
 * @param pathname API pathname, without origin or query.
 * @param search Request query parameters for breakdown attribution.
 * @returns Safe deterministic API response, or undefined for an unsupported path.
 */
export function pageFixture(pathname: string, search = ''): unknown {
  const data: Record<string, unknown> = {
    '/v1/organizations': [{ id: teamId, name: team.name }],
    [`/v1/organizations/${teamId}/capabilities`]: { permissions: ['identity.manage', 'directory.sync'] },
    [`/v1/organizations/${teamId}/identity-providers`]: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Enterprise OIDC', protocol: 'oidc', enabled: true, issuer: 'https://identity.example.test', version: 5, config: { clientId: 'fixture-client', clientSecret: 'fixture-secret-never-render', scopes: 'openid profile email' }, createdAt, updatedAt: createdAt }],
    [`/v1/organizations/${teamId}/identity-providers/33333333-3333-4333-8333-333333333333/mappings`]: [{ id: 'mapping-fixture', sourceField: 'email', targetField: 'email', transform: 'lowercase', required: true, version: 2 }],
    [`/v1/organizations/${teamId}/identity-login-failures`]: [{ id: 'failure-fixture', providerId: '33333333-3333-4333-8333-333333333333', subjectHint: 'a***@example.test', reasonCode: 'INVALID_STATE', occurredAt: createdAt, detail: { code: 'INVALID_STATE' } }],
    [`/v1/organizations/${teamId}/sync-scripts`]: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Enterprise directory', version: 3, source: 'module.exports = input => input', status: 'published', updatedAt: createdAt }],
    [`/v1/organizations/${teamId}/sync-runs`]: [{ id: '55555555-5555-4555-8555-555555555555', scriptName: 'Enterprise directory', scriptVersion: 3, status: 'preview', trigger: 'manual', createdAt, preview: { accepted: true, counts: { users: 1 } } }],
    [`/v1/organizations/${teamId}/sync-diffs`]: [{ id: '66666666-6666-4666-8666-666666666666', runId: '55555555-5555-4555-8555-555555555555', entityType: 'department', externalId: 'engineering', changeType: 'update', status: 'pending', version: 4, before: { name: 'Engineering' }, after: { name: 'Product Engineering' } }],
    [`/v1/organizations/${teamId}/sync-rollbacks`]: [{ id: 'rollback-fixture', sourceRunId: 'earlier-run', compensatingRunId: 'compensation-run', status: 'queued', createdAt }],
    '/v1/me': { ...account, platformAdmin: true },
    '/auth/sso/providers': [], '/auth/deployment': { registration: 'open' }, '/desktop/downloads': [],
    '/v1/platform/accounts': [account],
    [`/v1/platform/accounts/${account.id}/organizations`]: { account, memberships: [{ organizationName: team.name, status: 'active', createdAt }] },
    '/v1/platform/organizations': { items: [team], nextCursor: null },
    '/v1/platform/organizations/tree': [{ id: teamId, name: team.name, parentId: null, hasChildren: false, kind: 'team', memberCount: 2 }],
    [`/v1/platform/organizations/${teamId}/governance`]: { organizationId: teamId, name: team.name, status: 'active', version: 7, subscription: { plan: 'team', seats: 20, expiresAt: null }, policy, nextTimeZone: null, month: '2026-10', permissions: [], members: [{ id: memberId, accountId: account.id, name: account.name, email: account.email, status: 'active', budget: { mode: 'inherit' }, storageLimitBytes: null, spentMicrosCny: 0 }], balanceMicrosCny: 120_000_000, unfinishedTasks: 1, unsettledTasks: 1, storage: { usedBytes: 1000, trashBytes: 0, versionBytes: 0, uploadBytes: 0 }, readiness: { owner: true, login: true, budget: true, storage: true, recovery: false, models: true, funding: true, desktop: true }, updatedAt: createdAt },
    '/v1/platform/plans': [plan], '/v1/platform/models': [model],
    '/v1/platform/model-providers': [{ id: 'provider-fixture', name: '验收供应商', baseUrl: 'https://provider.example.test', version: 2, enabled: true, timeoutMs: 300000, retryableHttpStatuses: [429, 503] }],
    '/v1/platform/model-tasks': [{ id: 'task-fixture', publicModel: model.name, organizationId: teamId, status: 'unknown', billingStatus: 'pending', assetStatus: 'pending', version: 3, reviewReason: '需要供应商凭证', outstandingMicrosCny: 1000000 }],
    '/v1/platform/model-adapters': [{ id: 'adapter-fixture', publicModel: model.name, modelId: model.id, operation: 'image.generate', version: 2, enabled: true, configuration: { mode: 'asynchronous', billing: 'provider-usage' } }],
    '/v1/platform/runtimes': [runtime], [`/v1/platform/runtimes/${runtime.id}`]: { runtime, account, audit },
    '/v1/platform/plugins': [{ id: 'plugin-fixture', pluginId: 'acceptance-plugin', version: '1.0.0', visibility: 'public', status: 'awaiting_platform_review', createdAt }],
    '/v1/platform/desktop-releases': { apiUrl: 'https://api.example.test', requirements: { signingKey: true, storage: true, https: true }, configured: true, maxBytes: 10000000, releases: [{ id: 'release-fixture', version: '1.0.0', target: 'darwin-arm64', publishedAt: createdAt }] },
    '/v1/platform/policy': { id: 'primary', registration: 'open', domains: [], mode: 'private' },
    '/v1/platform/redemption-codes': { items: [{ id: 'code-fixture', batchId: 'batch-fixture', codeHint: 'ABCD…WXYZ', amountMicrosCny: 100000000, expiresAt: null, revokedAt: null, redeemedAt: null }] },
    '/v1/platform/audit': audit, '/v1/platform/health': { checkedAt: createdAt, services: health },
    '/v1/platform/overview': { metrics: { organizations: 1, members: 2, runtimes: 1, ...summary }, trend, pending: [{ id: 'plugin-review', kind: 'plugin-review', count: 1, status: 'warning' }], audit, health },
    '/v1/platform/usage/summary': summary, '/v1/platform/usage/timeseries': { values: trend },
    '/v1/platform/usage/records': { items: [record], nextCursor: null },
    '/v1/platform/usage/breakdown': { values: [{ id: new URLSearchParams(search).get('groupBy') === 'organization' ? team.id : model.id, label: new URLSearchParams(search).get('groupBy') === 'organization' ? team.name : model.name, ...summary }] },
  }
  return data[pathname]
}
