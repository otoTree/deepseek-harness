import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatCny, formatCompact, parseDashboardSnapshot } from '../app/admin-view-models'

const dashboard = {
  range: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T00:00:00.000Z', timezone: 'Asia/Shanghai' },
  metrics: { organizations: 1, members: 2, runtimes: 3, calls: 4, totalTokens: 5, totalCostMicrosCny: 6_000_000 },
  trend: [{ day: '2026-09-01', calls: 4, totalTokens: 5, totalCostMicrosCny: 6_000_000 }],
  pending: [{ id: 'plugin-review', kind: 'plugin-review', count: 1, status: 'warning' }],
  health: [{ id: 'api', label: 'API 网关', status: 'unknown', availability: null }],
  audit: [{ id: 'event', action: 'login', resourceId: null, organizationId: 'org', createdAt: '2026-09-30T00:00:00.000Z' }],
}

void test('parses the platform dashboard snapshot and rejects incomplete data', () => {
  assert.deepEqual(parseDashboardSnapshot(dashboard), dashboard)
  assert.equal(parseDashboardSnapshot({ ...dashboard, metrics: undefined }), null)
})

void test('formats dashboard money and compact totals for the admin cards', () => {
  assert.equal(formatCny(286_430_000_000), '¥ 286,430.00')
  assert.equal(formatCompact(2_843_000_000), '28.4亿')
})
