import { z } from 'zod'

const isoDate = z.string().datetime({ offset: true })

export const adminDashboardSnapshot = z.object({
  range: z.object({ from: isoDate, to: isoDate, timezone: z.literal('Asia/Shanghai') }),
  metrics: z.object({
    organizations: z.number(),
    members: z.number(),
    runtimes: z.number(),
    calls: z.number(),
    totalTokens: z.number(),
    totalCostMicrosCny: z.number(),
  }),
  trend: z.array(z.object({
    day: z.string(),
    calls: z.number(),
    totalTokens: z.number(),
    totalCostMicrosCny: z.number(),
  })),
  pending: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    count: z.number(),
    status: z.enum(['ready', 'warning', 'failed']),
  })),
  health: z.array(z.object({
    id: z.string(),
    label: z.string(),
    status: z.enum(['ready', 'warning', 'failed', 'unknown']),
    availability: z.number().nullable(),
  })),
  audit: z.array(z.object({
    id: z.string(),
    action: z.string(),
    resourceId: z.string().nullable(),
    organizationId: z.string(),
    createdAt: isoDate,
  })),
})

export type AdminDashboardSnapshot = z.infer<typeof adminDashboardSnapshot>
export type AdminHealthSummary = AdminDashboardSnapshot['health'][number]
export type AdminPendingItem = AdminDashboardSnapshot['pending'][number]
export type AdminAuditEvent = AdminDashboardSnapshot['audit'][number]
export type AdminUsageTrendPoint = AdminDashboardSnapshot['trend'][number]
export type AdminOrganizationSummary = { id: string; name: string; kind?: string; status?: string; memberCount?: number; childCount?: number }
export type AdminAccountSummary = { id: string; name?: string | null; email: string; emailVerified?: boolean }
export type AdminSyncRunSummary = { id: string; scriptId?: string; status: string; trigger?: string; error?: string | null }
export type AdminPermissionSummary = { id: string; resource: string; action: string; description?: string; highRisk?: boolean }
export type AdminRuntimeSummary = { id: string; name: string; type?: string; version?: string; revokedAt?: string | null }
export type AdminPluginReviewSummary = { id: string; pluginId: string; version: string; status: string; digest?: string }

export function parseDashboardSnapshot(value: unknown): AdminDashboardSnapshot | null {
  const result = adminDashboardSnapshot.safeParse(value)
  return result.success ? result.data : null
}

export function formatCny(micros: number): string {
  return `¥ ${(micros / 1_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
