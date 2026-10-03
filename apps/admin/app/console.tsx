'use client'

import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { z } from 'zod'
import { zh as t } from './messages'
import { request } from './client-api'
import { AccountDrawer, CreateAccountModal, CreateOrganizationModal, HeterogeneousModelEditorModal, ModelEditorModal, OrganizationTree } from './admin-components'
import { UsageDashboard } from './usage-dashboard'
import { formatCompact, formatCny, parseDashboardSnapshot, type AdminDashboardSnapshot } from './admin-view-models'

const row = z.record(z.string(), z.unknown())
const rows = z.array(row)
type Row = z.infer<typeof row>
type Section = 'organizationDirectory' | 'accounts' | 'globalAudit' | 'overview' | 'units' | 'members' | 'models' | 'runtimes' | 'sessions' | 'plugins' | 'usage' | 'audit' | 'modelConfig' | 'redemptionCodes' | 'platform' | 'permissions' | 'identityProviders' | 'syncScripts'
type AccountTab = 'organizations' | 'roles' | 'runtimes' | 'sessions' | 'usage' | 'audit'
type NavigationLabel = 'overviewGroup' | 'identityGroup' | 'governanceGroup' | 'runtimeGroup'
type PageDescriptionKey = `${Section}Description`
const descriptions: Record<Section, PageDescriptionKey> = {
  organizationDirectory: 'organizationDirectoryDescription', accounts: 'accountsDescription', globalAudit: 'globalAuditDescription',
  overview: 'overviewDescription', units: 'unitsDescription', members: 'membersDescription',
  models: 'modelsDescription', runtimes: 'runtimesDescription', sessions: 'sessionsDescription',
  plugins: 'pluginsDescription', usage: 'usageDescription', audit: 'auditDescription', modelConfig: 'modelConfigDescription', redemptionCodes: 'redemptionCodesDescription', platform: 'platformDescription', permissions: 'permissionsDescription', identityProviders: 'identityProvidersDescription', syncScripts: 'syncScriptsDescription',
}
const navigation: Array<{ label: NavigationLabel; items: Section[] }> = [
  { label: 'overviewGroup', items: ['overview', 'usage', 'globalAudit'] },
  { label: 'identityGroup', items: ['organizationDirectory', 'units', 'members', 'accounts', 'identityProviders', 'syncScripts'] },
  { label: 'governanceGroup', items: ['permissions', 'sessions', 'audit'] },
  { label: 'runtimeGroup', items: ['models', 'modelConfig', 'runtimes', 'plugins', 'redemptionCodes', 'platform'] },
]
const text = (value: unknown) =>
  value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const message = (key: string): string => {
  const value = (t as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : key
}
const localizedCell = (key: string, value: unknown): string => {
  const raw = text(value)
  if (key === 'kind' || key === 'unitType') return t.organizationKinds[raw as keyof typeof t.organizationKinds] ?? raw
  if (key === 'protocol') return t.identityProtocols[raw as keyof typeof t.identityProtocols] ?? t.protocols[raw as keyof typeof t.protocols] ?? raw
  if (key === 'role') {
    const label = (t as Record<string, unknown>)[raw]
    return typeof label === 'string' ? label : raw
  }
  if (key === 'action') return t.sessionActions[raw as keyof typeof t.sessionActions] ?? raw
  if (key === 'registration') return t.registrationPolicies[raw as keyof typeof t.registrationPolicies] ?? raw
  if (key === 'target') return t.pluginTargets[raw as keyof typeof t.pluginTargets] ?? raw
  return t.statusLabels[raw as keyof typeof t.statusLabels] ?? raw
}
const parseRow = (value: unknown): Row | null => {
  const result = row.safeParse(value)
  return result.success ? result.data : null
}
const parseRows = (value: unknown): Row[] => {
  const result = rows.safeParse(value)
  return result.success ? result.data : []
}

const organizationScopedSections: Section[] = ['units', 'members', 'models', 'runtimes', 'sessions', 'plugins', 'usage', 'audit', 'permissions', 'identityProviders', 'syncScripts']
const subscriptionRows = (value: unknown): Row[] => {
  const overview = parseRow(value)
  const subscription = overview ? parseRow(overview.subscription) : null
  return subscription ? [{ plan: subscription.plan, seats: subscription.seats, runtimes: subscription.runtimes }] : []
}
const memberRows = (value: unknown): Row[] => {
  const overview = parseRow(value)
  return overview ? parseRows(overview.members) : []
}
const roleRows = (value: unknown): Row[] => {
  const overview = parseRow(value)
  return overview ? parseRows(overview.roles) : []
}

function Field({
  name,
  label,
  type = 'text',
  required = true,
  value,
  onChange,
  multiline = false,
}: {
  name: string
  label: string
  type?: string
  required?: boolean
  value?: string
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void
  multiline?: boolean
}) {
  return (
    <label>
      {label}
      {multiline ? (
        <textarea name={name} required={required} defaultValue={value ?? ''} rows={8} />
      ) : (
        <input
          name={name}
          type={type}
          required={required}
          {...(value === undefined ? { defaultValue: '' } : { value })}
          onChange={onChange}
          readOnly={value !== undefined && onChange === undefined}
          autoComplete={type === 'password' ? 'current-password' : 'off'}
        />
      )}
    </label>
  )
}

function Table({ data, actions }: { data: Row[]; actions?: (item: Row) => React.ReactNode }) {
  if (!data.length) return <p className="muted">{t.noData}</p>
  const keys = Object.keys(data[0]).filter(
    key => !['secret', 'tokenHash', 'organizationId', 'header', 'manifest', 'review', 'budgetMicros', 'spentMicros', 'reservedMicros'].includes(key),
  )
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {keys.map(key => (
              <th key={key}>{t.columns[key as keyof typeof t.columns] ?? t.field}</th>
            ))}
            {actions && <th />}
          </tr>
        </thead>
        <tbody>
          {data.map((item, index) => (
            <tr key={text(item.id) || index}>
              {keys.map(key => (
                <td key={key}>{localizedCell(key, item[key])}</td>
              ))}
              {actions && <td className="actions">{actions(item)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PageState({ state, empty = t.noData }: { state: 'loading' | 'ready' | 'empty' | 'error'; empty?: string }) {
  if (state === 'loading') return <p className="muted" role="status">{t.loading}</p>
  if (state === 'error') return <p className="error" role="alert">{t.error}</p>
  if (state === 'empty') return <p className="muted">{empty}</p>
  return null
}

function MetricCard({ label, value, meta, tone = 'accent', icon }: { label: string; value: string; meta?: string; tone?: 'accent' | 'success' | 'warning'; icon: string }) {
  return <article className={`metric-card metric-${tone}`}><div className="metric-card-heading"><span>{label}</span><b aria-hidden="true">{icon}</b></div><strong>{value}</strong>{meta ? <small>{meta}</small> : null}</article>
}

function PageToolbar({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-toolbar"><div><p className="eyebrow">{eyebrow ?? t.platformManagement}</p><h2>{title}</h2>{description ? <p className="muted">{description}</p> : null}</div>{actions ? <div className="toolbar-actions">{actions}</div> : null}</div>
}

function StatStrip({ items }: { items: Array<{ label: string; value: string; meta?: string; tone?: 'accent' | 'success' | 'warning'; icon?: string }> }) {
  return <div className="stat-strip">{items.map((item, index) => <MetricCard key={`${item.label}-${index}`} {...item} icon={item.icon ?? '•'} />)}</div>
}

function StatusBadge({ value }: { value: unknown }) {
  const status = text(value).toLowerCase()
  const tone = status.includes('fail') || status.includes('error') || status.includes('revok') || status.includes('disabled') ? 'danger' : status.includes('pending') || status.includes('await') || status.includes('draft') ? 'warning' : status.includes('run') || status.includes('active') || status.includes('publish') || status.includes('enabled') || status.includes('success') ? 'success' : 'neutral'
  const label = t.statusLabels[status as keyof typeof t.statusLabels] ?? (text(value) || t.noData)
  return <span className={`status-badge ${tone}`}><i />{label}</span>
}

function EmptyState({ title = t.noData, description = t.noSelection }: { title?: string; description?: string }) {
  return <div className="empty-state compact"><strong>{title}</strong><span>{description}</span></div>
}

function FilterBar({ children }: { children: ReactNode }) {
  return <div className="filter-bar"><span className="filter-label">{t.filters}</span>{children}</div>
}

function OverviewDashboard({ dashboard, loading, onNavigate }: { dashboard: AdminDashboardSnapshot | null; loading: boolean; onNavigate: (section: Section) => void }) {
  if (loading && dashboard === null) return <section className="overview-loading" role="status">{t.loading}</section>
  if (!dashboard) return <section className="empty-state"><strong>{t.overviewUnavailable}</strong><p>{t.error}</p></section>
  const maxCost = Math.max(...dashboard.trend.map(item => item.totalCostMicrosCny), 1)
  const allReady = dashboard.health.length > 0 && dashboard.health.every(item => item.status === 'ready')
  return <div className="overview-dashboard">
    <div className="overview-toolbar"><div><span className="eyebrow">{t.platformManagement}</span><p className="muted">{t.overviewRange}</p></div><button className="secondary-button">▣ {t.last30Days}</button></div>
    <div className="metric-grid">
      <MetricCard label={t.organizationCount} value={dashboard.metrics.organizations.toLocaleString()} meta={t.last30Days} icon="▥" />
      <MetricCard label={t.memberCount} value={dashboard.metrics.members.toLocaleString()} meta={t.last30Days} icon="♙" />
      <MetricCard label={t.onlineRuntimes} value={dashboard.metrics.runtimes.toLocaleString()} meta={t.runningNormally} tone="success" icon="▣" />
      <MetricCard label={t.monthlyCost} value={formatCny(dashboard.metrics.totalCostMicrosCny)} meta={`${formatCompact(dashboard.metrics.totalTokens)} ${t.tokenUnit}`} icon="▤" />
    </div>
    <div className="overview-grid overview-grid-main">
      <section className="card chart-card"><div className="card-heading"><div><h2>{t.modelUsageAndCost}</h2><p className="muted">{formatCompact(dashboard.metrics.totalTokens)} {t.tokenUnit} · {formatCny(dashboard.metrics.totalCostMicrosCny)}</p></div><button className="text-button" onClick={() => onNavigate('usage')}>{t.viewDetails} ↗</button></div><div className="bar-chart" aria-label={t.usageTrend}>{dashboard.trend.length ? dashboard.trend.map(item => <div className="bar-column" key={item.day}><div className="bar-track"><i style={{ height: `${Math.max(8, item.totalCostMicrosCny / maxCost * 100)}%` }} /><em style={{ height: `${Math.max(4, item.calls / Math.max(...dashboard.trend.map(value => value.calls), 1) * 45)}%` }} /></div><small>{item.day.slice(5)}</small></div>) : <p className="muted">{t.noData}</p>}</div></section>
      <section className="card pending-card"><div className="card-heading"><h2>{t.pendingItems}</h2><button className="text-button" onClick={() => onNavigate('audit')}>{t.viewAll}</button></div><div className="pending-list">{dashboard.pending.map(item => <button className="pending-item" key={item.id} onClick={() => onNavigate(item.kind === 'directory-sync' ? 'syncScripts' : item.kind === 'plugin-review' ? 'plugins' : 'audit')}><span className={`status-dot ${item.status}`} /> <span>{item.kind === 'directory-sync' ? t.directorySync : item.kind === 'plugin-review' ? t.pluginReview : t.audit}</span><strong>{item.count}</strong><span>›</span></button>)}</div></section>
    </div>
    <div className="overview-grid overview-grid-bottom">
      <section className="card health-card"><div className="card-heading"><h2>{t.systemHealth}</h2><span className={`health-summary ${allReady ? '' : 'unknown'}`}><i />{allReady ? t.runningNormally : t.monitoringUnavailable}</span></div><div className="health-list">{dashboard.health.map(item => <div className="health-row" key={item.id}><span><i className={`status-dot ${item.status}`} />{item.label}</span><strong>{item.availability === null ? (item.status === 'ready' ? t.runningNormally : item.status === 'unknown' ? t.monitoringUnavailable : t.attentionRequired) : `${item.availability.toFixed(2)}%`}</strong></div>)}</div></section>
      <section className="card audit-card"><div className="card-heading"><h2>{t.recentAudit}</h2><button className="text-button" onClick={() => onNavigate('globalAudit')}>{t.viewAll}</button></div><div className="audit-list">{dashboard.audit.map(item => <div className="audit-row" key={item.id}><strong>{item.action}</strong><span>{item.resourceId ?? '—'}</span><small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small></div>)}</div></section>
    </div>
  </div>
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function CustomRolePanel({ organization, busy, onDone }: { organization: string; busy: boolean; onDone: () => void }) {
  const [roles, setRoles] = useState<Row[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [permissionIds, setPermissionIds] = useState('')
  useEffect(() => {
    void request('/v1/organizations/' + organization + '/roles/custom')
      .then(value => setRoles(parseRows(value)))
      .catch(() => setRoles([]))
  }, [organization])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !name.trim()) return
    await request('/v1/organizations/' + organization + '/roles/custom', 'POST', {
      name: name.trim(), description: description.trim(),
      permissionIds: permissionIds.split(',').map(value => value.trim()).filter(Boolean),
    })
    setName('')
    setDescription('')
    setPermissionIds('')
    const value = await request('/v1/organizations/' + organization + '/roles/custom')
    setRoles(parseRows(value))
    onDone()
  }
  return <>
    <Table data={roles} actions={item => <span className="status">v{text(item.version)} · {item.enabled ? t.enabled : t.disabled}</span>} />
    <form className="grid-form" onSubmit={submit}>
      <label>{t.roleName}<input value={name} onChange={event => setName(event.target.value)} required /></label>
      <label>{t.roleDescription}<input value={description} onChange={event => setDescription(event.target.value)} /></label>
      <label className="full-width">{t.permissionIds}<input value={permissionIds} onChange={event => setPermissionIds(event.target.value)} placeholder="member.read,role.manage" /></label>
      <button className="primary" disabled={busy || !name.trim()}>{t.create}</button>
    </form>
  </>
}

/** Authenticated enterprise administration console. */
export default function Console() {
  const [me, setMe] = useState<Row | null>(null)
  const [organizations, setOrganizations] = useState<Row[]>([])
  const [organization, setOrganization] = useState('')
  const [section, setSection] = useState<Section>('overview')
  const [data, setData] = useState<unknown>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [detail, setDetail] = useState<unknown>(null)
  const [platformOrganizations, setPlatformOrganizations] = useState<Row[]>([])
  const [platformAccounts, setPlatformAccounts] = useState<Row[]>([])
  const [organizationChildren, setOrganizationChildren] = useState<Record<string, Row[]>>({})
  const [expandedOrganizations, setExpandedOrganizations] = useState<Set<string>>(new Set())
  const [selectedDirectoryOrganization, setSelectedDirectoryOrganization] = useState('')
  const [directoryMembers, setDirectoryMembers] = useState<Row[]>([])
  const [createOrganizationOpen, setCreateOrganizationOpen] = useState(false)
  const [createAccountOpen, setCreateAccountOpen] = useState(false)
  const [accountDetail, setAccountDetail] = useState<Row | null>(null)
  const [accountTab, setAccountTab] = useState<AccountTab>('organizations')
  const [accountResource, setAccountResource] = useState<unknown>(null)
  const [pageState, setPageState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [sessionQuery, setSessionQuery] = useState('')
  const [accountQuery, setAccountQuery] = useState('')
  const [confirmIntent, setConfirmIntent] = useState<{
    path: string
    method: string
    body?: unknown
    success?: string
    message: string
  } | null>(null)
  const [modelEditorOpen, setModelEditorOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<Row | null>(null)
  const [modelAdapters, setModelAdapters] = useState<Row[]>([])
  const [adapterEditorOpen, setAdapterEditorOpen] = useState(false)
  const [redemptionStatus, setRedemptionStatus] = useState('')
  const [redemptionBatch, setRedemptionBatch] = useState('')
  const [redemptionNextCursor, setRedemptionNextCursor] = useState<string | null>(null)
  const [generatedCodes, setGeneratedCodes] = useState<{ batchId: string; codes: string[] } | null>(null)
  const [dashboard, setDashboard] = useState<AdminDashboardSnapshot | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const prefix = '/v1/organizations/' + organization

  function updateUrl(next: Partial<{ section: Section; organizationId: string; accountId: string; tab: string; query: string; status: string; batchId: string; from: string; to: string; cursor: string; page: string }>): void {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (next.section !== undefined) params.set('section', next.section)
    if (next.organizationId !== undefined) {
      if (next.organizationId) params.set('organizationId', next.organizationId)
      else params.delete('organizationId')
    }
    if (next.accountId !== undefined) {
      if (next.accountId) params.set('accountId', next.accountId)
      else params.delete('accountId')
    }
    for (const key of ['tab', 'query', 'status', 'batchId', 'from', 'to', 'cursor', 'page'] as const) {
      const value = next[key]
      if (value === undefined) continue
      if (value) params.set(key, value)
      else params.delete(key)
    }
    window.history.pushState(null, '', `?${params.toString()}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  function navigateSection(next: Section): void {
    setSection(next)
    setMobileNavOpen(false)
    updateUrl({ section: next })
  }

  async function loadIdentity() {
    try {
      const identity = parseRow(await request('/v1/me'))
      const list = parseRows(await request('/v1/organizations'))
      if (!identity) throw new Error('Invalid identity response')
      setOrganizations(list)
      setMe(identity)
      setOrganization(previous => (list.some(item => item.id === previous) ? previous : text(list[0]?.id)))
    } catch {
      setMe(null)
      setOrganizations([])
      setOrganization('')
    }
  }
  useEffect(() => {
    void loadIdentity()
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const applyUrl = () => {
      const params = new URLSearchParams(window.location.search)
      const requested = params.get('section') as Section | null
      if (requested && navigation.some(group => group.items.includes(requested))) setSection(requested)
      const organizationId = params.get('organizationId')
      if (organizationId) {
        setOrganization(organizationId)
        setSelectedDirectoryOrganization(organizationId)
      }
      const query = params.get('query') ?? ''
      setAccountQuery(query)
      setSessionQuery(query)
      const tab = params.get('tab')
      if (tab && ['organizations', 'roles', 'runtimes', 'sessions', 'usage', 'audit'].includes(tab)) setAccountTab(tab as AccountTab)
      setRedemptionStatus(params.get('status') ?? '')
      setRedemptionBatch(params.get('batchId') ?? '')
      const accountId = params.get('accountId')
      if (!accountId) {
        setAccountDetail(null)
        setAccountResource(null)
      } else {
        void request('/v1/platform/accounts/' + accountId + '/organizations')
          .then((value) => { setAccountDetail(parseRow(value)); setAccountResource(null) })
          .catch(() => setNotice(t.error))
      }
    }
    applyUrl()
    window.addEventListener('popstate', applyUrl)
    return () => window.removeEventListener('popstate', applyUrl)
  }, [])
  useEffect(() => {
    if (!mobileNavOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileNavOpen])
  useEffect(() => {
    if (!me || section === 'usage' || (!organization && !['overview', 'platform', 'organizationDirectory', 'accounts', 'globalAudit', 'modelConfig', 'redemptionCodes'].includes(section))) return
    let disposed = false
    setData(null)
    setDetail(null)
    setNotice('')
    const path = section === 'overview'
      ? '/v1/platform/overview'
      : section === 'identityProviders'
        ? prefix + '/identity-providers'
        : section === 'syncScripts'
          ? prefix + '/sync-scripts'
          : section === 'permissions'
            ? prefix + '/permissions'
            : section === 'modelConfig'
              ? '/v1/platform/models'
              : section === 'redemptionCodes'
                ? '/v1/platform/redemption-codes?' + new URLSearchParams({
                  ...(redemptionStatus ? { status: redemptionStatus } : {}),
                  ...(redemptionBatch.trim() ? { batchId: redemptionBatch.trim() } : {}),
                }).toString()
                : section === 'platform'
                  ? '/v1/platform/policy'
                  : section === 'accounts'
                    ? '/v1/platform/accounts?limit=100' + (accountQuery.trim() ? '&query=' + encodeURIComponent(accountQuery.trim()) : '')
                    : section === 'globalAudit'
                      ? '/v1/platform/audit?limit=200'
                      : section === 'organizationDirectory'
                        ? '/v1/platform/organizations/tree?parentId=null'
                        : section === 'sessions'
                          ? prefix + '/sessions?scope=organization' + (sessionQuery.trim() ? '&q=' + encodeURIComponent(sessionQuery.trim()) : '')
                          : prefix + '/' + section
    setPageState('loading')
    void request(path)
      .then((value) => {
        if (!disposed) {
          setData(value)
          if (section === 'overview') setDashboard(parseDashboardSnapshot(value))
          if (section === 'modelConfig') {
            void request('/v1/platform/model-adapters').then(parseRows).then(setModelAdapters).catch(() => setModelAdapters([]))
          }
          if (section === 'redemptionCodes') {
            const page = parseRow(value)
            setRedemptionNextCursor(typeof page?.nextCursor === 'string' ? page.nextCursor : null)
          }
          setPageState(Array.isArray(value) && value.length === 0 ? 'empty' : 'ready')
          if (section === 'organizationDirectory') setPlatformOrganizations(parseRows(value))
          if (section === 'accounts') setPlatformAccounts(parseRows(value))
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setNotice(error instanceof Error ? error.message : t.error)
          setPageState('error')
        }
      })
    return () => {
      disposed = true
    }
  }, [organization, section, revision, me, prefix, sessionQuery, accountQuery, redemptionStatus, redemptionBatch])
  useEffect(() => {
    if (!me || !['organizationDirectory', 'accounts', 'modelConfig'].includes(section)) return
    if (section === 'organizationDirectory' && !platformOrganizations.length)
      void request('/v1/platform/organizations/tree?parentId=null').then(value => setPlatformOrganizations(parseRows(value))).catch(() => setPlatformOrganizations([]))
    if (section === 'accounts' && !platformAccounts.length)
      void request('/v1/platform/accounts?limit=100').then(value => setPlatformAccounts(parseRows(value))).catch(() => setPlatformAccounts([]))
  }, [me, section, revision, platformOrganizations.length, platformAccounts.length])

  useEffect(() => {
    if (!me || section !== 'organizationDirectory' || !selectedDirectoryOrganization) {
      setDirectoryMembers([])
      return
    }
    let disposed = false
    void request('/v1/platform/organization-nodes/' + selectedDirectoryOrganization + '/members')
      .then((value) => {
        if (!disposed) setDirectoryMembers(parseRows(parseRow(value)?.members))
      })
      .catch(() => { if (!disposed) setDirectoryMembers([]) })
    return () => { disposed = true }
  }, [me, section, selectedDirectoryOrganization, revision])
  useEffect(() => {
    if (!selectedDirectoryOrganization && typeof window !== 'undefined') {
      const fromUrl = new URLSearchParams(window.location.search).get('organizationId')
      if (fromUrl) setSelectedDirectoryOrganization(fromUrl)
    }
  }, [selectedDirectoryOrganization, platformOrganizations])

  async function action(path: string, method: string, body?: unknown, success: string = t.success) {
    setBusy(true)
    setNotice('')
    try {
      await request(path, method, body)
      setNotice(success)
      setRevision(value => value + 1)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setBusy(false)
    }
  }
  async function createOrganization(value: { name: string; kind: string }) {
    setBusy(true)
    setNotice('')
    try {
      await request('/v1/platform/organizations', 'POST', {
        ...value,
        parentId: selectedDirectoryOrganization || null,
      })
      setCreateOrganizationOpen(false)
      setNotice(t.success)
      setOrganizationChildren({})
      setExpandedOrganizations(new Set())
      setRevision(revisionValue => revisionValue + 1)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setBusy(false)
    }
  }
  async function createAccount(value: { name: string; email: string; password: string; organizationNodeId: string; role: string }) {
    setBusy(true)
    setNotice('')
    try {
      await request('/v1/platform/accounts', 'POST', value)
      setCreateAccountOpen(false)
      setNotice(t.success)
      setRevision(value => value + 1)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setBusy(false)
    }
  }
  async function saveModel(value: Record<string, unknown>) {
    const path = editingModel ? '/v1/platform/models/' + text(editingModel.id) : '/v1/platform/models'
    const method = editingModel ? 'PATCH' : 'POST'
    setBusy(true)
    setNotice('')
    try {
      await request(path, method, value)
      setModelEditorOpen(false)
      setEditingModel(null)
      setNotice(t.success)
      setRevision(valueRevision => valueRevision + 1)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setBusy(false)
    }
  }
  async function saveModelAdapter(value: Record<string, unknown>) {
    setBusy(true)
    setNotice('')
    try {
      await request('/v1/platform/model-adapters', 'POST', value)
      setAdapterEditorOpen(false)
      setNotice(t.success)
      setRevision(valueRevision => valueRevision + 1)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setBusy(false)
    }
  }
  async function createRedemptionCodes(form: FormData) {
    setBusy(true)
    setNotice('')
    try {
      const expiresAt = string(form, 'expiresAt')
      const result = parseRow(await request('/v1/platform/redemption-code-batches', 'POST', {
        amountCny: string(form, 'amountCny'),
        count: number(form, 'count'),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        ...(string(form, 'note').trim() ? { note: string(form, 'note').trim() } : {}),
      }))
      const batchId = text(result?.batchId)
      const codes = result && Array.isArray(result.codes) ? result.codes.filter((value): value is string => typeof value === 'string') : []
      if (!batchId || !codes.length) throw new Error(t.error)
      setGeneratedCodes({ batchId, codes })
      setNotice(t.redemptionCreated)
      setRevision(value => value + 1)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setBusy(false)
    }
  }
  async function loadMoreRedemptionCodes() {
    if (!redemptionNextCursor) return
    setBusy(true)
    setNotice('')
    try {
      const page = parseRow(await request('/v1/platform/redemption-codes?' + new URLSearchParams({
        ...(redemptionStatus ? { status: redemptionStatus } : {}),
        ...(redemptionBatch.trim() ? { batchId: redemptionBatch.trim() } : {}),
        cursor: redemptionNextCursor,
      }).toString()))
      if (!page) throw new Error(t.error)
      setData((current: unknown) => {
        const previous = parseRow(current)
        return { ...previous, ...page, items: [...parseRows(previous?.items), ...parseRows(page.items)] }
      })
      setRedemptionNextCursor(typeof page.nextCursor === 'string' ? page.nextCursor : null)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setBusy(false)
    }
  }
  function confirmAction(path: string, method: string, body: unknown, message: string, success: string = t.success) {
    setConfirmIntent({ path, method, body, message, success })
  }
  async function toggleOrganization(item: Row) {
    const id = text(item.id)
    if (expandedOrganizations.has(id)) {
      setExpandedOrganizations((previous) => { const next = new Set(previous); next.delete(id); return next })
      return
    }
    if (!organizationChildren[id]) {
      try {
        const value = await request('/v1/platform/organizations/tree?parentId=' + encodeURIComponent(id))
        setOrganizationChildren(previous => ({ ...previous, [id]: parseRows(value) }))
      } catch { setNotice(t.error); return }
    }
    setExpandedOrganizations(previous => new Set(previous).add(id))
  }
  function selectDirectoryOrganization(item: Row) {
    const id = text(item.id)
    setSelectedDirectoryOrganization(id)
    setOrganization(id)
    updateUrl({ organizationId: id, section: 'organizationDirectory' })
  }
  function openAccount(item: Row) {
    const id = text(item.id)
    setAccountTab('organizations')
    updateUrl({ accountId: id, tab: 'organizations' })
  }
  useEffect(() => {
    if (!accountDetail || !['runtimes', 'sessions', 'usage', 'audit'].includes(accountTab)) return
    const id = text(accountDetail.account && parseRow(accountDetail.account)?.id)
    if (!id) return
    const path = accountTab === 'audit' ? '/v1/platform/accounts/' + id + '/history' : '/v1/platform/accounts/' + id + '/' + accountTab
    void request(path).then(setAccountResource).catch(() => setAccountResource(null))
  }, [accountDetail, accountTab])
  function form(handler: (data: FormData) => Promise<void>) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!busy) void handler(new FormData(event.currentTarget))
    }
  }
  const string = (form: FormData, key: string) => text(form.get(key))
  const number = (form: FormData, key: string) => Number(form.get(key))
  const promptRuntimeId = () => window.prompt(t.reviewRuntime) ?? ''

  if (!me)
    return (
      <main className="login">
        <section className="login-brand"><div className="brand-lockup"><span className="brand-mark">智</span><div className="wordmark">{t.adminBrand}</div></div><div className="login-hero"><h1>{t.loginHeroTitle}</h1><p>{t.loginHeroDescription}</p></div><p className="login-note">{t.adminLoginOnly}</p></section>
        <section className="login-form-panel"><h2>{t.signInHeading}</h2><p className="muted">{t.subtitle}</p><form onSubmit={form(async (data) => { await action('/auth/sign-in/email', 'POST', { email: string(data, 'email'), password: string(data, 'password') }); await loadIdentity() })}><Field name="email" label={t.email} type="email" /><Field name="password" label={t.password} type="password" /><label className="remember-row"><input type="checkbox" defaultChecked />{t.keepSignedIn}<a href="/reset">{t.cannotSignIn}</a></label><button className="primary" disabled={busy}>＋　{t.login}</button></form><div className="login-divider"><span>{t.or}</span></div><a className="secondary-button" href={process.env.NEXT_PUBLIC_ENTERPRISE_PORTAL_URL ?? 'http://127.0.0.1:3001'}>⇩　{t.userPortal}</a><p className="login-note">{t.adminLoginOnly}</p><p role="status">{notice}</p></section>
      </main>
    )

  return (
    <div className="shell">
      <button className="mobile-nav-toggle" aria-label={mobileNavOpen ? t.closeNavigation : t.openNavigation} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(value => !value)}>☰</button>
      {mobileNavOpen ? <button className="mobile-nav-scrim" aria-label={t.closeNavigation} onClick={() => setMobileNavOpen(false)} /> : null}
      <aside className={mobileNavOpen ? 'nav-open' : ''}>
        <div className="brand-lockup"><span className="brand-mark">智</span><div><div className="wordmark">{t.adminBrand}</div><small>{t.administration}</small></div></div>
        <button className="scope-switcher" onClick={() => navigateSection('organizationDirectory')}><small>{t.currentScope}</small><strong>{t.globalScope}</strong><span>⌄</span></button>
        <nav aria-label={t.navigation}>
          {navigation.map(group => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{t[group.label]}</span>
              {group.items.map(item => (
                <button key={item} className={section === item ? 'selected' : ''} onClick={() => navigateSection(item)}>
                  <span className="nav-icon" aria-hidden="true">{item === 'overview' ? '▦' : item === 'organizationDirectory' || item === 'accounts' ? '♙' : item === 'syncScripts' ? '⟳' : item === 'permissions' || item === 'audit' ? '◇' : item === 'models' || item === 'modelConfig' || item === 'runtimes' ? '▣' : item === 'plugins' ? '◈' : item === 'usage' ? '⌁' : '⚙'}</span>{message(item)}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-health"><strong>{t.systemHealth}</strong><span><i />{t.monitoringUnavailable}</span><small>{t.lastHealthCheck}</small></div>
        <div className="account">
          <span className="account-avatar">管</span>
          <span><strong>{t.platformAdministrator}</strong><small>{text(me.email)}</small></span>
          <button onClick={() => void action('/auth/sign-out', 'POST', {}).then(loadIdentity)}>{t.logout}</button>
        </div>
      </aside>
      <main>
        <header>
          <div className="page-heading">
            <div className="breadcrumb">{t.platformManagement}<span>›</span><strong>{message(section)}</strong></div>
            <h1>{message(section)}</h1>
            <p className="page-description">{message(descriptions[section])}</p>
          </div>
          <div className="header-actions"><label className="global-search"><span aria-hidden="true">⌕</span><input aria-label={t.globalSearch} placeholder={t.globalSearchPlaceholder} /></label><button className="icon-button" aria-label={t.notifications}>♧</button><button onClick={() => setRevision(value => value + 1)}>{t.refresh}</button></div>
        </header>
        {organizationScopedSections.includes(section) && organization && (
          <div className="scope-bar" role="status">
            <span>{t.currentOrganization}</span>
            <strong>{text(organizations.find(item => text(item.id) === organization)?.name) || organization}</strong>
            <button onClick={() => navigateSection('organizationDirectory')}>{t.changeOrganization}</button>
          </div>
        )}
        <p className="status-line" role="status">{notice}</p>
        {!['organizationDirectory', 'accounts', 'modelConfig', 'redemptionCodes', 'platform', 'usage', 'overview', 'permissions', 'identityProviders', 'syncScripts', 'runtimes', 'plugins'].includes(section) && <PageState state={pageState} />}
        {section === 'organizationDirectory' && (
          <section className="split-layout">
            <div className="card tree-panel">
              <div className="card-heading"><h2>{t.organizationTree}</h2><button onClick={() => setRevision(value => value + 1)}>{t.refresh}</button></div>
              <OrganizationTree nodes={[...platformOrganizations, ...Object.values(organizationChildren).flat()]}
                expanded={expandedOrganizations} selected={selectedDirectoryOrganization}
                onToggle={item => void toggleOrganization(item)} onSelect={selectDirectoryOrganization} />
              {!platformOrganizations.length && pageState === 'ready' && <p className="muted">{t.noData}</p>}
            </div>
            <div className="card">
              <div className="card-heading"><div><p className="eyebrow">{t.organization}</p><h2>{t.currentNode}</h2></div><button className="primary" onClick={() => setCreateOrganizationOpen(true)}>＋ {t.createOrganization}</button></div>
              {(() => {
                const item = [...platformOrganizations, ...Object.values(organizationChildren).flat()]
                  .find(value => text(value.id) === selectedDirectoryOrganization)
                if (!item) return <p className="muted">{t.selectNode}</p>
                return <>
                  <p><strong>{text(item.name)}</strong> · {text(item.kind)} · {item.status === 'active' ? t.active : t.disabled}</p>
                  <p className="muted">{t.memberCount}: {text(item.memberCount)}　{t.childCount}: {text(item.childCount)}</p>
                  <div className="subnav-tabs" role="tablist"><button onClick={() => navigateSection('accounts')}>{t.accounts}</button><button onClick={() => navigateSection('members')}>{t.members}</button></div>
                  <div className="directory-members"><div className="card-heading"><h3>{t.members}</h3><span className="muted">{directoryMembers.length}</span></div><Table data={directoryMembers} actions={member => <button onClick={() => openAccount({ id: member.accountId })}>{t.accountOverview}</button>} /></div>
                </>
              })()}
            </div>
          </section>
        )}
        <CreateOrganizationModal open={createOrganizationOpen} busy={busy}
          parentName={text([...platformOrganizations, ...Object.values(organizationChildren).flat()]
            .find(item => text(item.id) === selectedDirectoryOrganization)?.name)}
          onClose={() => setCreateOrganizationOpen(false)} onSubmit={value => void createOrganization(value)} />
        {section === 'accounts' && (
          <div className="admin-page-stack"><StatStrip items={[{ label: t.accountDirectory, value: String(platformAccounts.length), meta: t.total, icon: '♙' }, { label: t.statusActive, value: String(platformAccounts.filter(item => item.disabled !== true).length), meta: t.statusActive, tone: 'success', icon: '✓' }, { label: t.statusInactive, value: String(platformAccounts.filter(item => item.disabled === true).length), meta: t.statusInactive, tone: 'warning', icon: '!' }]} /><section className="card resource-card">
            <PageToolbar title={t.accountDirectory} description={t.accountsDescription} actions={<><button onClick={() => setCreateAccountOpen(true)}>{t.createAccount}</button><button onClick={() => setRevision(value => value + 1)}>{t.refresh}</button></>} />
            <form className="inline" onSubmit={form(async (form) => { setAccountQuery(string(form, 'query')); setRevision(value => value + 1) })}>
              <Field name="query" label={t.search} value={accountQuery} onChange={event => setAccountQuery(event.currentTarget.value)} required={false} />
              <button disabled={busy}>{t.search}</button>
            </form>
            <Table data={platformAccounts} actions={item => <button onClick={() => openAccount(item)}>{t.accountOverview}</button>} />
          </section></div>
        )}
        <CreateAccountModal open={createAccountOpen} busy={busy} nodes={[...platformOrganizations, ...Object.values(organizationChildren).flat()]} onLoadChildren={async (node) => { const value = await request('/v1/platform/organizations/tree?parentId=' + encodeURIComponent(text(node.id))); const children = parseRows(value); setOrganizationChildren(previous => ({ ...previous, [text(node.id)]: children })); return children }} onClose={() => setCreateAccountOpen(false)} onSubmit={value => void createAccount(value)} />
        {section === 'globalAudit' && <section className="card"><Table data={parseRows(data)} /></section>}
        {section === 'modelConfig' && (
          <section className="card">
            <div className="card-heading">
              <div><h2>{t.modelCatalog}</h2><p className="muted">{t.modelConfigDescription}</p></div>
              <div className="actions">
                <button onClick={() => setRevision(value => value + 1)}>{t.refresh}</button>
                <button className="primary" onClick={() => { setEditingModel(null); setModelEditorOpen(true) }}>＋ {t.create}</button>
              </div>
            </div>
            <Table data={parseRows(data)} actions={item => <span className="actions">
              <button onClick={() => { setEditingModel(item); setModelEditorOpen(true) }}>{t.edit}</button>
              <button onClick={() => void action('/v1/platform/models/' + text(item.id), 'PATCH', { enabled: !item.enabled })}>{item.enabled ? t.disabled : t.enabled}</button>
              <button onClick={() => confirmAction('/v1/platform/models/' + text(item.id), 'DELETE', undefined, t.confirmDelete, t.delete)}>{t.delete}</button>
            </span>} />
            <div className="card-heading"><div><h2>{t.heterogeneousModel}</h2><p className="muted">{t.heterogeneousModelDescription}</p></div><button className="primary" onClick={() => setAdapterEditorOpen(true)}>＋ {t.create}</button></div>
            <Table data={modelAdapters.map(({ configuration: _configuration, ...item }) => item)} actions={() => <button onClick={() => setAdapterEditorOpen(true)}>{t.newVersion}</button>} />
            <ModelEditorModal open={modelEditorOpen} model={editingModel} busy={busy}
              onClose={() => { setModelEditorOpen(false); setEditingModel(null) }} onSubmit={value => void saveModel(value)} />
            <HeterogeneousModelEditorModal open={adapterEditorOpen} busy={busy}
              onClose={() => setAdapterEditorOpen(false)} onSubmit={value => void saveModelAdapter(value)} />
          </section>
        )}
        {section === 'overview' && data != null && (
          <OverviewDashboard dashboard={dashboard} loading={pageState === 'loading'} onNavigate={navigateSection} />
        )}
        {section === 'units' && organization && (
          <section className="card">
            <form
              className="inline"
              onSubmit={form(form =>
                action(prefix + '/units', 'POST', {
                  name: string(form, 'name'),
                  parentId: string(form, 'parentId'),
                  unitType: string(form, 'unitType'),
                }),
              )}
            >
              <Field name="name" label={t.name} />
              <label>
                {t.parent}
                <select name="parentId">
                  {parseRows(data).map(item => (
                    <option key={text(item.id)} value={text(item.id)}>
                      {text(item.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label>{t.unitType}<select name="unitType" defaultValue="department">{Object.entries(t.organizationKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <button disabled={busy}>{t.create}</button>
            </form>
            <Table data={parseRows(data)} />
          </section>
        )}
        {section === 'members' && organization && (
          <section className="card">
            <form
              className="inline"
              onSubmit={form(form =>
                action(prefix + '/invitations', 'POST', { email: string(form, 'email'), role: string(form, 'role') }),
              )}
            >
              <Field name="email" label={t.email} type="email" />
              <label>
                {t.role}
                <select name="role">
                  {(
                    ['member', 'administrator', 'security_reviewer', 'plugin_publisher', 'finance_auditor'] as const
                  ).map(role => (
                    <option key={role} value={role}>
                      {t[role]}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy}>{t.invite}</button>
            </form>
            <Table
              data={memberRows(data)}
              actions={item => (
                <button
                  onClick={() =>
                    void action(prefix + '/members/' + text(item.id), 'PATCH', {
                      status: item.status === 'active' ? 'suspended' : 'active',
                    })
                  }
                >
                  {item.status === 'active' ? t.suspend : t.restore}
                </button>
              )}
            />
            <form
              className="inline"
              onSubmit={form(form =>
                action(prefix + '/roles', 'POST', {
                  membershipId: string(form, 'membershipId'),
                  unitId: string(form, 'unitId') || null,
                  role: string(form, 'role'),
                }, t.grantRole),
              )}
            >
              <Field name="membershipId" label={t.membershipId} />
              <Field name="unitId" label={t.unitId} required={false} />
              <label>
                {t.role}
                <select name="role">
                  {(['administrator', 'member', 'security_reviewer', 'plugin_publisher', 'finance_auditor'] as const).map(role => (
                    <option key={role} value={role}>{t[role]}</option>
                  ))}
                </select>
              </label>
              <button disabled={busy}>{t.grantRole}</button>
            </form>
            <Table
              data={roleRows(data)}
              actions={item => (
                <button onClick={() => void action(prefix + '/roles/' + text(item.id), 'DELETE', undefined, t.revokeRole)}>
                  {t.revokeRole}
                </button>
              )}
            />
          </section>
        )}
        {section === 'models' && (
          <section className="card">
            {Array.isArray(data) && data.length === 0 && <p>{t.noModels}</p>}
            <Table data={parseRows(data)} />
          </section>
        )}
        {section === 'permissions' && organization && (() => {
          const items = parseRows(data)
          return <div className="admin-page-stack"><StatStrip items={[{ label: t.permissionCatalog, value: String(items.length), meta: t.total, icon: '◇' }, { label: t.roleBindings, value: '—', meta: t.monitoringUnavailable, icon: '♙' }, { label: t.effectivePermissions, value: '—', meta: t.monitoringUnavailable, tone: 'success', icon: '✓' }]} /><section className="card resource-card"><PageToolbar title={t.permissions} description={t.permissionsDescription} actions={<button onClick={() => setRevision(value => value + 1)}>{t.refresh}</button>} /><div className="subnav-tabs admin-tabs" role="tablist"><button className="selected">{t.permissionCatalog}</button><button>{t.roleBindings}</button><button>{t.effectivePermissions}</button></div><FilterBar><input aria-label={t.search} placeholder={t.globalSearchPlaceholder} /><select aria-label={t.status}><option>{t.filterAll}</option><option>{t.direct}</option><option>{t.inherited}</option></select></FilterBar><div className="resource-split permissions-split"><div className="resource-list">{items.length ? items.map((item, index) => <button className={`resource-list-item ${index === 0 ? 'selected' : ''}`} key={text(item.id) || index}><span className="resource-list-icon">◇</span><span><strong>{text(item.name) || text(item.id)}</strong><small>{text(item.description) || text(item.scope) || t.permissionCatalog}</small></span><StatusBadge value={item.enabled === false ? 'disabled' : 'active'} /></button>) : <EmptyState title={t.permissionCatalog} />}</div><div className="resource-detail">{items[0] ? <><div className="detail-heading"><div><p className="eyebrow">{t.detailPanel}</p><h3>{text(items[0].name) || text(items[0].id)}</h3></div><StatusBadge value="active" /></div><dl className="detail-grid"><div><dt>{t.modelId}</dt><dd>{text(items[0].id) || '—'}</dd></div><div><dt>{t.purpose}</dt><dd>{text(items[0].description) || '—'}</dd></div><div><dt>{t.status}</dt><dd>{t.enabled}</dd></div></dl></> : <EmptyState />}</div></div><div className="section-divider"><h3>{t.customRoles}</h3><CustomRolePanel organization={organization} busy={busy} onDone={() => setRevision(value => value + 1)} /></div></section></div>
        })()}
        {section === 'identityProviders' && organization && (() => {
          const items = parseRows(data)
          const selected = items[0]
          return <div className="admin-page-stack">
            <StatStrip items={[{ label: t.identityProviders, value: String(items.length), meta: t.total, icon: '◎' }, { label: t.configured, value: String(items.filter(item => item.enabled).length), meta: t.statusActive, tone: 'success', icon: '✓' }, { label: t.loginFailures, value: '—', meta: t.monitoringUnavailable, tone: 'warning', icon: '!' }]} />
            <section className="card resource-card">
              <PageToolbar title={t.identityProviders} description={t.identityProvidersDescription} actions={<button className="primary" onClick={() => document.getElementById('identity-provider-form')?.scrollIntoView({ behavior: 'smooth' })}>＋ {t.configure}</button>} />
              <FilterBar><select aria-label={t.status}><option>{t.filterAll}</option><option>{t.statusActive}</option><option>{t.statusInactive}</option></select><input aria-label={t.search} placeholder={t.globalSearchPlaceholder} /></FilterBar>
              <div className="resource-split"><div className="resource-list">{items.length ? items.map((item, index) => <button className={`resource-list-item ${index === 0 ? 'selected' : ''}`} key={text(item.id) || index}><span className="resource-list-icon">{text(item.protocol).slice(0, 1).toUpperCase() || 'I'}</span><span><strong>{text(item.name) || text(item.protocol) || t.identityProviders}</strong><small>{text(item.issuer) || text(item.protocol)}</small></span><StatusBadge value={item.enabled ? 'active' : 'disabled'} /></button>) : <EmptyState />}</div><div className="resource-detail">{selected ? <><div className="detail-heading"><div><p className="eyebrow">{t.providerConfig}</p><h3>{text(selected.name) || text(selected.protocol)}</h3></div><StatusBadge value={selected.enabled ? 'active' : 'disabled'} /></div><dl className="detail-grid"><div><dt>{t.protocol}</dt><dd>{text(selected.protocol)}</dd></div><div><dt>{t.issuer}</dt><dd>{text(selected.issuer) || '—'}</dd></div><div><dt>{t.createdAt}</dt><dd>{text(selected.createdAt) || '—'}</dd></div><div><dt>{t.lastUpdated}</dt><dd>{text(selected.updatedAt) || '—'}</dd></div></dl><div className="detail-actions"><button onClick={() => void action(prefix + '/identity-providers/' + text(selected.id), 'PATCH', { enabled: !selected.enabled })}>{selected.enabled ? t.disabled : t.enabled}</button><button>{t.fieldMapping}</button><button>{t.loginFailures}</button></div></> : <EmptyState />}</div></div>
              <form id="identity-provider-form" className="inline create-form" onSubmit={form(form => action(prefix + '/identity-providers', 'POST', { name: string(form, 'providerName'), protocol: string(form, 'protocol'), ...(string(form, 'issuer').trim() ? { issuer: string(form, 'issuer').trim() } : {}), config: {} }, t.success))}><Field name="providerName" label={t.name} /><label>{t.protocol}<select name="protocol">{Object.entries(t.identityProtocols).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Field name="issuer" label={t.issuer} required={false} /><button className="primary" disabled={busy}>{t.configure}</button></form>
            </section>
          </div>
        })()}
        {section === 'syncScripts' && organization && (() => {
          const items = parseRows(data)
          return <div className="admin-page-stack"><StatStrip items={[{ label: t.directoryRuns, value: String(items.length), meta: t.total, icon: '↻' }, { label: t.statusRunning, value: String(items.filter(item => text(item.status).includes('run')).length), meta: t.statusRunning, tone: 'success', icon: '▶' }, { label: t.failed, value: String(items.filter(item => text(item.status).includes('fail')).length), meta: t.attentionRequired, tone: 'warning', icon: '!' }]} /><section className="card resource-card"><PageToolbar title={t.syncScripts} description={t.syncScriptsDescription} actions={<button className="primary" onClick={() => document.getElementById('sync-script-form')?.scrollIntoView({ behavior: 'smooth' })}>＋ {t.create}</button>} /><FilterBar><select aria-label={t.status}><option>{t.filterAll}</option><option>{t.statusRunning}</option><option>{t.statusFailed}</option><option>{t.statusApproved}</option></select><button onClick={() => setRevision(value => value + 1)}>{t.refresh}</button></FilterBar><div className="table-wrap"><Table data={items} actions={item => <span className="actions"><StatusBadge value={item.status} />{item.status === 'draft' ? <button disabled={busy} onClick={() => void action(prefix + '/sync-scripts/' + text(item.id) + '/approve', 'POST', undefined, t.approve)}>{t.approve}</button> : null}{item.status === 'approved' ? <button disabled={busy} onClick={() => void action(prefix + '/sync-scripts/' + text(item.id) + '/publish', 'POST', undefined, t.publish)}>{t.publish}</button> : null}</span>} /></div><form id="sync-script-form" className="grid-form create-form" onSubmit={form(form => action(prefix + '/sync-scripts', 'POST', { name: string(form, 'scriptName'), source: string(form, 'source') }, t.success))}><Field name="scriptName" label={t.name} /><Field name="source" label={t.scriptSource} multiline /><button className="primary" disabled={busy}>{t.create}</button></form></section></div>
        })()}
        {section === 'runtimes' && (() => {
          const items = parseRows(data)
          const online = items.filter(item => !item.revokedAt).length
          return <div className="admin-page-stack"><StatStrip items={[{ label: t.runtimeDevices, value: String(items.length), meta: t.total, icon: '▣' }, { label: t.onlineRuntimes, value: String(online), meta: t.statusRunning, tone: 'success', icon: '✓' }, { label: t.revoked, value: String(items.length - online), meta: t.statusInactive, tone: 'warning', icon: '!' }]} /><section className="card resource-card"><PageToolbar title={t.runtimes} description={t.runtimesDescription} actions={<button onClick={() => setRevision(value => value + 1)}>{t.refresh}</button>} /><FilterBar><input aria-label={t.search} placeholder={t.accountSearchPlaceholder} /><select aria-label={t.status}><option>{t.filterAll}</option><option>{t.statusRunning}</option><option>{t.statusInactive}</option></select></FilterBar><Table data={items} actions={item => <span className="actions"><StatusBadge value={item.revokedAt ? 'disabled' : 'active'} /><button disabled={Boolean(item.revokedAt)} onClick={() => void action(prefix + '/runtimes/' + text(item.id), 'DELETE')}>{t.revoke}</button></span>} /></section></div>
        })()}
        {section === 'sessions' && (
          <section className="card">
            <p>{t.privacy}</p>
            <form className="inline" onSubmit={form(async (data) => {
              setSessionQuery(string(data, 'sessionQuery').trim())
              setRevision(value => value + 1)
            })}>
              <Field
                name="sessionQuery"
                label={t.search}
                value={sessionQuery}
                onChange={event => setSessionQuery(event.currentTarget.value)}
              />
              <button disabled={busy}>{t.search}</button>
            </form>
            <Table
              data={parseRows(data)}
              actions={item => (
                <span className="actions">
                  <button onClick={() => void request(prefix + '/sessions/' + text(item.id) + '/events?reason=admin-read').then(setDetail).catch(() => setNotice(t.error))}>{t.read}</button>
                  <button onClick={() => void request(prefix + '/sessions/' + text(item.id) + '/export?reason=admin-export').then(value => downloadJson(text(item.id) + '.json', value)).catch(() => setNotice(t.error))}>{t.export}</button>
                </span>
              )}
            />
          </section>
        )}
        {section === 'plugins' && organization && (() => {
          const items = parseRows(data)
          const pending = items.filter(item => ['awaiting_ai', 'awaiting_human', 'draft'].includes(text(item.status))).length
          return <div className="admin-page-stack"><StatStrip items={[{ label: t.pluginVersions, value: String(items.length), meta: t.total, icon: '◈' }, { label: t.pending, value: String(pending), meta: t.statusPending, tone: 'warning', icon: '!' }, { label: t.statusApproved, value: String(items.filter(item => text(item.status) === 'published').length), meta: t.statusApproved, tone: 'success', icon: '✓' }]} /><section className="card resource-card"><PageToolbar title={t.plugins} description={t.pluginsDescription} actions={<button className="primary" onClick={() => document.getElementById('plugin-submit-form')?.scrollIntoView({ behavior: 'smooth' })}>＋ {t.submitPlugin}</button>} /><FilterBar><input aria-label={t.search} placeholder={t.globalSearchPlaceholder} /><select aria-label={t.status}><option>{t.filterAll}</option><option>{t.statusPending}</option><option>{t.statusApproved}</option></select></FilterBar><Table data={items} actions={(item) => { const status = text(item.status); return <span className="actions"><StatusBadge value={status} />{status === 'awaiting_ai' ? <button disabled={busy} onClick={() => void action(prefix + '/plugins/' + text(item.id) + '/ai-review', 'POST', { runtimeId: promptRuntimeId() }, t.aiReview)}>{t.aiReview}</button> : status === 'awaiting_human' ? <button disabled={busy} onClick={() => void action(prefix + '/plugins/' + text(item.id) + '/approve', 'POST', { digest: text(item.digest) }, t.approve)}>{t.approve}</button> : status === 'published' ? <button disabled={busy} onClick={() => void action(prefix + '/plugins/' + text(item.id) + '/revoke', 'POST', undefined, t.revoke)}>{t.revoke}</button> : null}</span> }} /><form id="plugin-submit-form" className="grid-form create-form" onSubmit={form(form => action(prefix + '/plugins', 'POST', { manifest: { pluginId: string(form, 'pluginId'), version: string(form, 'pluginVersion'), targets: [string(form, 'pluginTarget')], permissions: string(form, 'pluginPermissions').split(',').map(value => value.trim()).filter(Boolean), tools: [] }, clientCode: string(form, 'pluginCode') }, t.submitPlugin))}><Field name="pluginId" label={t.pluginId} /><Field name="pluginVersion" label={t.pluginVersion} value="1.0.0" /><label>{t.pluginTarget}<select name="pluginTarget">{Object.entries(t.pluginTargets).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Field name="pluginPermissions" label={t.pluginPermissions} required={false} /><Field name="pluginCode" label={t.pluginCode} multiline /><button className="primary" disabled={busy}>{t.submitPlugin}</button></form></section></div>
        })()}
        {section === 'audit' && (
          <section className="card">
            <Table data={parseRows(data)} />
          </section>
        )}
        {section === 'usage' && <UsageDashboard organizations={organizations} revision={revision} />}
        {section === 'redemptionCodes' && (() => {
          const items = parseRows(parseRow(data)?.items)
          return <div className="admin-page-stack"><StatStrip items={[{ label: t.redemptionBatches, value: String(items.length), meta: t.total, icon: '▤' }, { label: t.available, value: String(items.filter(item => text(item.status) === 'available').length), meta: t.available, tone: 'success', icon: '✓' }, { label: t.redeemed, value: String(items.filter(item => text(item.status) === 'redeemed').length), meta: t.redeemed, icon: '↗' }, { label: t.expired, value: String(items.filter(item => text(item.status) === 'expired').length), meta: t.expired, tone: 'warning', icon: '!' }]} /><section className="card resource-card"><PageToolbar title={t.redemptionCodes} description={t.redemptionPlaintextWarning} actions={<button className="primary" onClick={() => document.getElementById('redemption-create-form')?.scrollIntoView({ behavior: 'smooth' })}>＋ {t.generateRedemptionCodes}</button>} /><FilterBar><select aria-label={t.status} value={redemptionStatus} onChange={(event) => { const value = event.currentTarget.value; setRedemptionStatus(value); updateUrl({ status: value }) }}><option value="">{t.filterAll}</option><option value="available">{t.available}</option><option value="redeemed">{t.redeemed}</option><option value="revoked">{t.revoked}</option><option value="expired">{t.expired}</option></select><input aria-label={t.redemptionBatchId} value={redemptionBatch} onChange={event => setRedemptionBatch(event.currentTarget.value)} placeholder={t.redemptionBatchId} /><button onClick={() => { updateUrl({ status: redemptionStatus, batchId: redemptionBatch.trim() }); setRevision(value => value + 1) }}>{t.search}</button></FilterBar><Table data={items} actions={item => <span className="actions"><StatusBadge value={item.status} /><button disabled={Boolean(item.redeemedAt) || Boolean(item.revokedAt)} onClick={() => confirmAction('/v1/platform/redemption-codes/' + text(item.id) + '/revoke', 'POST', undefined, t.confirmRevokeCode, t.revoke)}>{t.revoke}</button></span>} />{redemptionNextCursor ? <div className="usage-load-more"><button disabled={busy} onClick={() => void loadMoreRedemptionCodes()}>{busy ? t.loading : t.loadMore}</button></div> : null}<div className="section-divider"><PageToolbar title={t.createRedemptionBatch} description={t.redemptionPlaintextWarning} /><form id="redemption-create-form" className="grid-form create-form" onSubmit={form(createRedemptionCodes)}><Field name="amountCny" label={t.amountCny} /><Field name="count" label={t.redemptionCount} type="number" /><Field name="expiresAt" label={t.redemptionExpiresAt} type="datetime-local" required={false} /><Field name="note" label={t.redemptionNote} required={false} /><button className="primary" disabled={busy}>{t.generateRedemptionCodes}</button></form>{generatedCodes ? <div className="generated-codes" role="status"><p><strong>{t.redemptionBatchId}:</strong> {generatedCodes.batchId}</p><pre>{generatedCodes.codes.join('\n')}</pre><button onClick={() => { downloadJson(`redemption-${generatedCodes.batchId}.json`, generatedCodes); setGeneratedCodes(null) }}>{t.exportAndClear}</button></div> : null}</div></section></div>
        })()}
        {section === 'platform' && (
          <>
            <section className="card">
              <form
                className="grid-form"
                onSubmit={form(form =>
                  action('/v1/platform/organizations/' + string(form, 'organizationId') + '/subscription', 'PUT', {
                    plan: string(form, 'plan'),
                    seats: number(form, 'seats'),
                    runtimes: number(form, 'runtimeLimit'),
                  }),
                )}
              >
                {(['organizationId', 'plan', 'seats', 'runtimeLimit'] as const).map(key => (
                  <Field
                    key={key}
                    name={key}
                    label={t[key]}
                    type={['seats', 'runtimeLimit'].includes(key) ? 'number' : 'text'}
                  />
                ))}
                <button disabled={busy}>{t.saveSubscription}</button>
              </form>
            </section>
            <section className="card">
              <form
                className="inline"
                onSubmit={form(form =>
                  action('/v1/platform/policy', 'PUT', {
                    registration: string(form, 'registration'),
                    domains: string(form, 'domains')
                      .split(',')
                      .map(value => value.trim())
                      .filter(Boolean),
                  }),
                )}
              >
                <label>
                  {t.policy}
                  <select name="registration">
                    {Object.entries(t.registrationPolicies).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <Field name="domains" label={t.domains} required={false} />
                <button disabled={busy}>{t.save}</button>
              </form>
            </section>
          </>
        )}
        <AccountDrawer account={accountDetail} tab={accountTab} resource={accountResource}
          onClose={() => { setAccountDetail(null); setAccountResource(null); updateUrl({ accountId: '', tab: '' }) }} onTabChange={(value) => { setAccountTab(value); updateUrl({ tab: value }) }} />
        {confirmIntent && (
          <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-label={t.confirmTitle}>
            <div className="confirm-dialog"><h2>{t.confirmTitle}</h2><p>{confirmIntent.message}</p><div className="actions"><button onClick={() => setConfirmIntent(null)}>{t.close}</button><button className="primary" disabled={busy} onClick={() => { const next = confirmIntent; setConfirmIntent(null); void action(next.path, next.method, next.body, next.success) }}>{t.confirmTitle}</button></div></div>
          </div>
        )}
        {detail != null && (
          <section className="card">
            <button onClick={() => setDetail(null)}>{t.close}</button>
            {(() => {
              const record = parseRow(detail)
              const organization = record ? parseRow(record.organization) : null
              const members = record ? parseRows(record.members) : []
              if (!organization || !record || !Array.isArray(record.members))
                return <pre>{JSON.stringify(detail, null, 2)}</pre>
              return (
                <>
                  <Table data={members} actions={item => (
                    <span className="actions">
                      <button onClick={() => void action('/v1/platform/organizations/' + text(organization.id) + '/members/' + text(item.id), 'PATCH', {
                        status: item.status === 'active' ? 'suspended' : 'active',
                      })}>
                        {item.status === 'active' ? t.suspend : t.restore}
                      </button>
                      <button onClick={() => confirmAction('/v1/platform/organizations/' + text(organization.id) + '/members/' + text(item.id), 'DELETE', undefined, t.confirmRemove, t.remove)}>
                        {t.remove}
                      </button>
                      <form className="inline" onSubmit={form(form => action(
                        '/v1/platform/organizations/' + text(organization.id) + '/members/' + text(item.id) + '/transfer',
                        'POST', { organizationId: string(form, 'organizationId') }, t.transfer,
                      ))}>
                        <select name="organizationId" required defaultValue="">
                          <option value="" disabled>{t.selectOrg}</option>
                          {platformOrganizations.filter(org => text(org.id) !== text(organization.id)).map(org => (
                            <option key={text(org.id)} value={text(org.id)}>{text(org.name)}</option>
                          ))}
                        </select>
                        <button disabled={busy}>{t.transfer}</button>
                      </form>
                    </span>
                  )} />
                </>
              )
            })()}
          </section>
        )}
      </main>
    </div>
  )
}
