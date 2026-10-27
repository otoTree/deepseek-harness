'use client'

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { publishPlatformPlugin, request } from './client-api'
import { HeterogeneousModelEditorModal, ModelEditorModal } from './admin-components'
import { CreateAccountModal, CreateOrganizationModal, OrganizationTree } from './admin-components'
import CostTrend from './cost-trend'
import { UsageDashboard } from './usage-dashboard'
import UsageReferenceWorkspace from './usage-reference-workspace'
import DesktopReleasesWorkspace from './desktop-releases-workspace'
import PlatformSettingsWorkspace from './platform-settings-workspace'
import ModelRuntimeWorkspace from './model-runtime-workspace'
import { zh as t } from './messages'
import { useDialogFocus } from './use-dialog-focus'
import TeamAdministration from './team-administration'
import SubscriptionPlansWorkspace from './subscription-plans-workspace'
import EnterpriseWorkspace from './enterprise-workspace'

type RecordValue = Record<string, unknown>
type Route = { area: string; id?: string; sub?: string }
type SsoProvider = { id: string; name: string; protocol: 'oidc' | 'oauth2' }

const text = (value: unknown): string => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const rows = (value: unknown): RecordValue[] => Array.isArray(value) ? value.filter((item): item is RecordValue => Boolean(item) && typeof item === 'object') : value && typeof value === 'object' ? [value as RecordValue] : []
const first = (value: unknown): RecordValue | null => rows(value)[0] ?? null
const usageCostMicros = (item: RecordValue): number => Number(item.totalCostMicrosCny ?? item.billedMicros ?? item.actualMicros ?? 0)
const message = (key: string): string => { const value = (t as Record<string, unknown>)[key]; return typeof value === 'string' ? value : key }
const statusTone = (value: unknown): string => {
  const status = text(value).toLowerCase()
  if (/fail|error|reject|revok|disabled|delete/.test(status)) return 'danger'
  if (/pending|draft|unknown|preview|queued/.test(status)) return 'warning'
  if (/ready|active|approved|published|completed|running|enabled|success/.test(status)) return 'success'
  return 'neutral'
}
const localizedValue = (value: unknown, key?: string): string => {
  const raw = text(value)
  if (key === 'protocol') return t.identityProtocols[raw as keyof typeof t.identityProtocols] ?? t.protocols[raw as keyof typeof t.protocols] ?? raw
  if (key === 'operation') return t.modelCapabilities[raw as keyof typeof t.modelCapabilities] ?? raw
  if (key === 'mode' && (raw === 'synchronous' || raw === 'asynchronous')) return raw === 'synchronous' ? t.synchronousMode : t.asynchronousMode
  if (key === 'billing') return raw === 'fixed-reservation' ? t.fixedReservationBilling : raw === 'provider-usage' ? t.providerUsageBilling : raw
  if (key === 'role') {
    const label = (t as Record<string, unknown>)[raw]
    return typeof label === 'string' ? label : raw
  }
  if (key === 'action') return t.sessionActions[raw as keyof typeof t.sessionActions] ?? raw
  if (key === 'registration') return t.registrationPolicies[raw as keyof typeof t.registrationPolicies] ?? raw
  return t.statusLabels[raw as keyof typeof t.statusLabels] ?? raw
}
const status = (value: unknown) => <span className={`status-badge ${statusTone(value)}`}><i />{localizedValue(value) || t.noData}</span>

function useData(path: string | null): { value: unknown; loading: boolean; error: string; errorStatus?: number; reload: () => void } {
  const [value, setValue] = useState<unknown>(null)
  const [loading, setLoading] = useState(Boolean(path))
  const [error, setError] = useState('')
  const [errorStatus, setErrorStatus] = useState<number>()
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener('enterprise-admin-refresh', refresh)
    return () => window.removeEventListener('enterprise-admin-refresh', refresh)
  }, [])
  useEffect(() => {
    if (!path) { setValue(null); setLoading(false); setErrorStatus(undefined); return }
    let cancelled = false
    setLoading(true)
    setError('')
    setErrorStatus(undefined)
    void request(path).then((result) => { if (!cancelled) setValue(result) }).catch((errorValue) => {
      if (cancelled) return
      const status = typeof errorValue === 'object' && errorValue !== null && 'status' in errorValue
        && typeof errorValue.status === 'number' ? errorValue.status : undefined
      setError(errorValue instanceof Error ? errorValue.message : t.error)
      setErrorStatus(status)
      if (status === 401 || status === 403) setValue(null)
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [path, revision])
  return { value, loading, error, errorStatus, reload: () => setRevision(value => value + 1) }
}

function LoginGate({ error, onAuthenticated }: { error?: string; onAuthenticated: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(error ?? '')
  const [ssoProviders, setSsoProviders] = useState<SsoProvider[]>([])
  useEffect(() => {
    let cancelled = false
    void request('/auth/sso/providers').then((value) => {
      if (!Array.isArray(value) || cancelled) return
      const providers = value.filter((item): item is SsoProvider => Boolean(item) && typeof item === 'object'
        && typeof (item as Record<string, unknown>).id === 'string'
        && typeof (item as Record<string, unknown>).name === 'string'
        && ((item as Record<string, unknown>).protocol === 'oidc' || (item as Record<string, unknown>).protocol === 'oauth2'))
      setSsoProviders(providers)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setNotice('')
    try {
      await request('/auth/sign-in/email', 'POST', { email, password })
      onAuthenticated()
    } catch (value) {
      setNotice(value instanceof Error ? value.message : t.error)
    } finally {
      setBusy(false)
    }
  }
  async function signInSso(provider: SsoProvider) {
    setBusy(true)
    setNotice('')
    try {
      const result = await request('/auth/sign-in/social', 'POST', {
        provider: provider.id,
        callbackURL: window.location.href,
        disableRedirect: true,
      })
      const url = result && typeof result === 'object' && 'url' in result && typeof result.url === 'string' ? result.url : undefined
      if (!url) throw new Error(t.ssoUnavailable)
      window.location.assign(url)
    } catch (value) {
      setNotice(value instanceof Error ? value.message : t.ssoUnavailable)
      setBusy(false)
    }
  }
  return <main className="login"><section className="login-brand"><div className="brand-lockup"><img className="brand-mark" src="/admin/brand.png" alt="" /><div className="wordmark">{t.adminBrand}</div></div><div className="login-hero"><h1>{t.loginHeroTitle}</h1><p>{t.loginHeroDescription}</p></div><p className="login-note">{t.adminLoginOnly}</p></section><section className="login-form-panel"><h2>{t.signInHeading}</h2><p className="muted">{t.subtitle}</p><form onSubmit={signIn}><label>{t.email}<input name="email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label><label>{t.password}<input name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label><button className="primary" disabled={busy}>{busy ? t.loading : t.login}</button></form>{ssoProviders.length > 0 ? <><div className="login-divider"><span>{t.or}</span></div><div className="sso-actions">{ssoProviders.map(provider => <button className="secondary-button" type="button" key={provider.id} disabled={busy} onClick={() => void signInSso(provider)}>{t.ssoLogin} · {provider.name}</button>)}</div></> : null}<p className="login-note">{t.adminLoginOnly}</p><p className="login-error" role="alert">{notice}</p></section></main>
}

function DataTable({ data, columns, onRow, actions }: { data: RecordValue[]
  columns: Array<{ key: string; label: string }>
  onRow?: (item: RecordValue) => void
  actions?: (item: RecordValue) => ReactNode }) {
  if (!data.length) return <div className="empty-state compact"><strong>{t.noData}</strong><span>{t.noSelection}</span></div>
  return <div className="table-scroll"><table><thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}{actions ? <th>{t.operation}</th> : null}</tr></thead><tbody>{data.map((item, index) => <tr key={text(item.id) || String(index)} onClick={() => onRow?.(item)} tabIndex={onRow ? 0 : undefined} onKeyDown={(event) => { if (onRow && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onRow(item) } }} className={onRow ? 'clickable-row' : ''}>{columns.map(column => <td key={column.key}>{column.key === 'emailVerified' ? <span className={`status-badge ${item[column.key] ? 'success' : 'warning'}`}>{item[column.key] ? t.emailIsVerified : t.emailNeedsVerification}</span> : column.key === 'status' || column.key === 'state' || column.key === 'enabled' ? status(item[column.key]) : column.key === 'kind' || column.key === 'unitType' ? (t.organizationKinds[text(item[column.key]) as keyof typeof t.organizationKinds] ?? text(item[column.key])) : localizedValue(item[column.key], column.key) || '—'}</td>)}{actions ? <td className="actions-cell" onClick={event => event.stopPropagation()}>{actions(item)}</td> : null}</tr>)}</tbody></table></div>
}

type OperationField = { minLength?: number; name: string; label: string; type?: 'text' | 'email' | 'password' | 'url' | 'number' | 'datetime-local' | 'textarea' | 'select'; required?: boolean; defaultValue?: string; options?: Array<{ value: string; label: string }> }

function OperationModal({ open, title, description, fields, busy, onClose, onSubmit }: { open: boolean
  title: string
  description?: string
  fields: OperationField[]
  busy: boolean
  onClose: () => void
  onSubmit: (values: Record<string, string>) => void }) {
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    if (open) setValues(Object.fromEntries(fields.map(field => [field.name, field.defaultValue ?? ''])))
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open, onClose])
  if (!open) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="operation-modal-title"><div className="modal-heading"><div><p className="eyebrow">{t.operation}</p><h2 id="operation-modal-title">{title}</h2></div><button className="icon-button" type="button" data-dialog-close onClick={onClose} aria-label={t.close}>×</button></div>{description ? <p className="muted">{description}</p> : null}<form className="operation-form" onSubmit={(event) => { event.preventDefault(); onSubmit(values) }}>{fields.map(field => <label key={field.name}>{field.label}{field.type === 'textarea' ? <textarea rows={5} value={values[field.name] ?? ''} onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))} required={field.required !== false} /> : field.type === 'select' ? <select value={values[field.name] ?? ''} onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))} required={field.required !== false}>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input minLength={field.minLength} type={field.type ?? 'text'} value={values[field.name] ?? ''} onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))} required={field.required !== false} />}</label>)}<div className="modal-actions"><button type="button" data-dialog-close onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy}>{busy ? t.loading : t.confirm}</button></div></form></section></div>
}

function ConfirmModal({ open, title, description, busy, onClose, onConfirm }: { open: boolean
  title: string
  description: string
  busy: boolean
  onClose: () => void
  onConfirm: () => void }) {
  if (!open) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-operation-title"><div className="modal-heading"><h2 id="confirm-operation-title">{title}</h2><button className="icon-button" type="button" data-dialog-close onClick={onClose} aria-label={t.close}>×</button></div><p className="muted">{description}</p><div className="modal-actions"><button type="button" data-dialog-close onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy} onClick={onConfirm}>{busy ? t.loading : t.confirm}</button></div></section></div>
}


function MetricStrip({ values }: { values: Array<{ label: string; value: string; tone?: string }> }) {
  return <div className="stat-strip">{values.map(value => <article className={`metric-card ${value.tone ? `metric-${value.tone}` : ''}`} key={value.label}><div className="metric-card-heading"><span>{value.label}</span><b aria-hidden="true">•</b></div><strong>{value.value}</strong></article>)}</div>
}


function PageFrame({ title, breadcrumbTitle, breadcrumb, description, eyebrow, actions, className, children }: { title: string
  breadcrumbTitle?: string
  breadcrumb?: ReactNode
  description?: string
  eyebrow?: string
  actions?: ReactNode
  className?: string
  children: ReactNode }) {
  return <><header className={`page-header ${className ?? ''}`}><div className="page-heading"><h1>{title}</h1>{description ? <p className="page-description">{description}</p> : null}</div><div className="header-actions">{actions}</div></header>{children}</>
}

function PlatformSettingTabs({ area }: { area: string }) {
  return <div className="platform-setting-tabs" role="tablist"><a className={area === 'identity/providers' ? 'selected' : ''} href="/identity/providers">{t.identityProviders}</a><a className={area === 'identity/mapping' ? 'selected' : ''} href="/identity/providers">{t.fieldMapping}</a><a className={area === 'identity/login-failures' ? 'selected' : ''} href="/identity/login-failures">{t.loginFailures}</a><a className={area === 'settings' ? 'selected' : ''} href="/platform/settings">{t.platformSettings}</a><a className={area === 'redemptions' ? 'selected' : ''} href="/platform/redemptions">{t.redemptionCodes}</a></div>
}

function GovernanceTabs({ area }: { area: string }) {
  const tabs = [['permissions/catalog', t.permissionCatalog], ['permissions/roles', t.customRoles], ['permissions/session-approvals', t.sessionApprovals], ['permissions/audit', t.globalAudit]] as const
  return <div className="platform-setting-tabs governance-tabs" role="tablist">{tabs.map(([key, label]) => <a className={area === key ? 'selected' : ''} href={`/${key}`} key={key}>{label}</a>)}</div>
}

function UsagePage() {
  return <PageFrame title={t.usage} breadcrumbTitle={t.usage} description={t.usagePageDescription} actions={<button className="secondary-button">⇩ {t.export}</button>}><div className="usage-page"><div className="usage-page-tabs" role="tablist"><a className="selected" href="/platform/usage">{t.usageOverviewTab}</a><a href="/platform/usage?view=ranking">{t.usageRankingTab}</a><a href="/platform/usage?view=reconciliation">{t.usageReconciliationTab}</a></div><div className="usage-page-heading"><div><h1>{t.usage}</h1><p>{t.usagePageDescription}</p></div><div className="usage-page-actions"><button className="secondary-button">▣ {t.last30Days}</button><button className="secondary-button">⚙ {t.all}</button><button className="secondary-button">⌁ {t.all}</button></div></div><UsageDashboard organizations={[]} revision={0} /></div></PageFrame>
}

function PluginReviewPage() {
  const data = useData('/v1/platform/plugins')
  const releases = rows(data.value)
  const pending = releases.filter(item => text(item.status) === 'awaiting_platform_review')
  const rejected = releases.filter(item => /reject/.test(text(item.status))).length
  const [uploading, setUploading] = useState(false)
  const [pluginSearch, setPluginSearch] = useState('')
  const [notice, setNotice] = useState('')
  const filteredReleases = releases.filter((item) => {
    const needle = pluginSearch.trim().toLowerCase()
    return !needle || [text(item.pluginId), text(item.publisherId), text(item.version)].some(value => value.toLowerCase().includes(needle))
  })
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = event.currentTarget.elements.namedItem('package')
    if (!(input instanceof HTMLInputElement) || !input.files?.length) return
    const form = event.currentTarget
    const files = Array.from(input.files)
    setUploading(true)
    setNotice('')
    let published = 0
    const failures: string[] = []
    for (const file of files) {
      try {
        await publishPlatformPlugin(await file.arrayBuffer())
        published += 1
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : t.error}`)
      }
      setNotice(t.pluginUploadProgress.replace('{done}', String(published + failures.length)).replace('{total}', String(files.length)))
    }
    setNotice([
      t.pluginPublishedCount.replace('{count}', String(published)),
      ...failures,
    ].join('\n'))
    if (failures.length === 0) form.reset()
    data.reload()
    setUploading(false)
  }
  async function approve(item: RecordValue) {
    try { await request(`/v1/platform/plugins/${text(item.id)}/approve`, 'POST', { digest: text(item.digest) }); data.reload() } catch (error) { setNotice(error instanceof Error ? error.message : t.error) }
  }
  async function reject(item: RecordValue) {
    try { await request(`/v1/platform/plugins/${text(item.id)}/reject`, 'POST', { reason: t.pluginRejectedReason }); data.reload() } catch (error) { setNotice(error instanceof Error ? error.message : t.error) }
  }
  return <PageFrame title={t.pluginReview} breadcrumbTitle={t.plugins} description={t.pluginReviewDescription} actions={<button className="primary" onClick={() => document.getElementById('platform-plugin-upload')?.scrollIntoView({ behavior: 'smooth' })}>＋ {t.uploadPlugin}</button>}><MetricStrip values={[{ label: t.pendingReview, value: String(pending.length), tone: 'warning' }, { label: t.pluginVersionCount, value: String(releases.length) }, { label: t.publishedPluginCount, value: String(releases.filter(item => text(item.status) === 'published').length), tone: 'success' }, { label: t.rejectedPluginCount, value: String(rejected) }]} />{data.error && <p className="error" role="alert">{data.error}</p>}{data.loading && !data.value && <p role="status">{t.loading}</p>}{notice ? <p className="operation-notice" role="status" style={{ whiteSpace: 'pre-line' }}>{notice}</p> : null}<div className="plugin-review-layout"><section className="card plugin-release-card"><div className="card-heading"><h2>{t.pluginVersions}</h2><input aria-label={t.searchPluginPlaceholder} placeholder={t.searchPluginPlaceholder} value={pluginSearch} onChange={event => setPluginSearch(event.target.value)} /></div><DataTable data={filteredReleases} columns={[{ key: 'pluginId', label: t.pluginId }, { key: 'version', label: t.pluginVersion }, { key: 'visibility', label: t.visibility }, { key: 'status', label: t.status }, { key: 'createdAt', label: t.createdAt }]} actions={item => text(item.status) === 'awaiting_platform_review' ? <><button className="table-action" onClick={() => void approve(item)}>{t.approve}</button><button className="table-action danger" onClick={() => void reject(item)}>{t.reject}</button></> : null} /></section><section className="card plugin-upload-card"><h2>{t.uploadPlugin}</h2><p className="muted">{t.marketplaceOnlyDescription}</p><form id="platform-plugin-upload" onSubmit={upload}><label>{t.pluginPackage}<input name="package" type="file" accept=".dsh-plugin.zip" multiple required /></label><button className="primary" disabled={uploading}>{uploading ? t.loading : t.uploadAndPublishPlugin}</button></form></section></div></PageFrame>
}

const navigation: Array<{ label: string; items: Array<[string, string]> }> = [
  { label: 'overviewGroup', items: [['overview', '/overview'], ['usage', '/platform/usage'], ['globalAudit', '/permissions/audit']] },
  { label: 'identityGroup', items: [['organizationDirectory', '/organizations/directory'], ['accounts', '/accounts'], ['plans', '/platform/plans']] },
  { label: 'runtimeGroup', items: [['modelRuntime', '/models/catalog'], ['plugins', '/platform/plugins'], ['desktopReleases', '/platform/desktop-releases']] },
  { label: 'configurationGroup', items: [['enterpriseIdentity', '/identity/providers'], ['enterpriseDirectory', '/sync/scripts'], ['platformSettingsNav', '/platform/settings']] },
]

function routeFromSegments(segments: string[]): Route {
  if (!segments.length) return { area: 'overview' }
  if (segments[0] === 'organizations') {
    if (segments[1] === 'members') return { area: 'organizations/members', id: segments[2] }
    if (segments[1] === 'directory' && segments[2] === 'members') return { area: 'organizations/members', sub: 'members' }
    return { area: 'organizations/directory', id: segments[2], sub: segments[2] === 'structure' ? 'structure' : undefined }
  }
  if (segments[0] === 'accounts') return { area: 'accounts', id: segments[1] }
  if (segments[0] === 'sync') return { area: `sync/${segments[1] ?? 'scripts'}` }
  if (segments[0] === 'permissions') return { area: `permissions/${segments[1] ?? 'catalog'}` }
  if (segments[0] === 'models') return { area: `models/${segments[1] ?? 'catalog'}`, id: segments[2] }
  if (segments[0] === 'identity') {
    if (segments[1] === 'providers' && segments[3] === 'mapping') return { area: 'identity/mapping', id: segments[2] }
    if (segments[1] === 'providers' && segments[2] === 'mapping') return { area: 'identity/mapping' }
    return { area: `identity/${segments[1] ?? 'providers'}`, id: segments[2] }
  }
  if (segments[0] === 'platform') return { area: `platform/${segments[1] ?? 'settings'}` }
  return { area: 'overview' }
}

function OverviewPage() {
  const data = useData('/v1/platform/overview')
  const snapshot = first(data.value)
  const metrics = snapshot?.metrics && typeof snapshot.metrics === 'object' ? snapshot.metrics as RecordValue : {}
  const health = rows(snapshot?.health)
  const pending = rows(snapshot?.pending)
  const audit = rows(snapshot?.audit)
  return <PageFrame title={t.overviewTitle} description={t.overviewDescription} actions={<><a className="secondary-button" href="/platform/health">{t.systemHealth}</a><button onClick={data.reload}>{t.refresh}</button></>}>
    <div className="overview-page">
      {data.error ? <p className="error" role="alert">{data.error}</p> : null}
      <MetricStrip values={[{ label: t.organizationCount, value: Number(metrics.organizations || 0).toLocaleString('zh-CN') }, { label: t.memberRelationships, value: Number(metrics.members || 0).toLocaleString('zh-CN') }, { label: t.last30DaysCost, value: `¥ ${((Number(metrics.totalCostMicrosCny) || 0) / 1_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }, { label: t.pendingItems, value: String(pending.reduce((sum, item) => sum + Number(item.count || 0), 0)), tone: 'warning' }]} />
      <div className="overview-grid overview-grid-main"><section className="card chart-card"><div className="card-heading"><div><h2>{t.modelUsageAndCost}</h2><p className="muted">{Number(metrics.totalTokens || 0).toLocaleString('zh-CN')} {t.tokenUnit} · ¥ {((Number(metrics.totalCostMicrosCny) || 0) / 1_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div><a className="text-button" href="/platform/usage">{t.viewDetails}</a></div><CostTrend items={rows(snapshot?.trend)} /></section><section className="card pending-card"><div className="card-heading"><h2>{t.pendingItems}</h2><a className="text-button" href="/models/providers?view=tasks">{t.viewAll}</a></div><div className="pending-list">{pending.map(item => <div className="pending-item" key={text(item.id)}><span className={`status-dot ${statusTone(item.status)}`} /><span>{text(item.kind) === 'directory-sync' ? t.directorySync : text(item.kind) === 'plugin-review' ? t.pluginReview : text(item.kind)}</span><strong>{text(item.count) || '0'}</strong></div>)}</div></section></div>
      <div className="overview-grid overview-grid-bottom"><section className="card health-card"><div className="card-heading"><h2>{t.systemHealth}</h2><a className="text-button" href="/platform/health">{t.viewDetails}</a></div><div className="health-list">{health.map(item => <div className="health-row" key={text(item.id)}><span><i className={`status-dot ${statusTone(item.status)}`} />{text(item.label)}</span><strong>{item.availability == null ? (text(item.status) === 'ready' ? t.runningNormally : t.monitoringUnavailable) : `${Number(item.availability).toFixed(2)}%`}</strong></div>)}</div></section><section className="card audit-card"><div className="card-heading"><h2>{t.recentAudit}</h2><a className="text-button" href="/permissions/audit">{t.viewAll}</a></div><div className="audit-list">{audit.map(item => <div className="audit-row" key={text(item.id)}><strong>{text(item.action)}</strong><span>{text(item.resourceId) || '—'}</span><small>{text(item.createdAt) ? new Date(text(item.createdAt)).toLocaleString('zh-CN') : '—'}</small></div>)}</div></section></div></div>
  </PageFrame>
}

function AccountsPage({ id }: { id?: string }) {
  const [accountQuery, setAccountQuery] = useState(''), [draftAccountQuery, setDraftAccountQuery] = useState('')
  const [accountOffset, setAccountOffset] = useState(0)
  const accounts = useData(`/v1/platform/accounts?limit=100&offset=${accountOffset}&query=${encodeURIComponent(accountQuery)}`)
  const organizations = useData('/v1/platform/organizations/tree?all=true')
  const detail = useData(id ? `/v1/platform/accounts/${id}/organizations` : null)
  const accountRows = rows(accounts.value)
  const detailRecord = first(detail.value)
  const account = first(detailRecord?.account)
  const [modal, setModal] = useState<'create' | 'edit' | 'password' | null>(null)
  const [selected, setSelected] = useState<RecordValue | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(values: Record<string, string>) {
    if (!selected && modal !== 'create') return
    setBusy(true); setNotice('')
    try {
      if (modal === 'create') await request('/v1/platform/accounts', 'POST', { name: values.name.trim(), email: values.email.trim(), password: values.password, organizationNodeId: values.organizationNodeId, role: values.role })
      else if (modal === 'edit') await request(`/v1/platform/accounts/${text(selected?.id)}`, 'PATCH', { name: values.name.trim(), email: values.email.trim(), reason: values.reason, expectedUpdatedAt: selected?.updatedAt })
      else await request(`/v1/platform/accounts/${text(selected?.id)}/password`, 'POST', { password: values.password, reason: values.reason, expectedUpdatedAt: selected?.updatedAt })
      setModal(null); setSelected(null); setNotice(t.success); await accounts.reload(); if (id) await detail.reload()
    } catch (error) { setNotice(error instanceof Error ? error.message : t.error) } finally { setBusy(false) }
  }
  if (id) return <PageFrame title={t.accountDetail} description={t.accountDetailDescription} eyebrow={t.accounts} actions={<><button className="secondary-button" disabled={!account || busy} onClick={() => { setSelected(account); setModal('edit') }}>{t.edit}</button><button className="secondary-button" disabled={!account || busy} onClick={() => { setSelected(account); setModal('password') }}>{t.resetPassword}</button><a className="secondary-button" href="/accounts">{t.backToDirectory}</a></>}>{detail.error && <p className="error" role="alert">{detail.error}</p>}{detail.loading && !account && <p role="status">{t.loading}</p>}{notice && <p role="status">{notice}</p>}<section className="card"><div className="detail-heading"><div><h3>{text(account?.email) || id}</h3><p className="muted">{text(account?.name)}</p></div>{account && <span className={`status-badge ${account.emailVerified ? 'success' : 'warning'}`}>{account.emailVerified ? t.emailIsVerified : t.emailNeedsVerification}</span>}</div><dl className="detail-grid"><div><dt>{t.columns.id}</dt><dd>{text(account?.id) || id}</dd></div><div><dt>{t.createdAt}</dt><dd>{text(account?.createdAt) || '—'}</dd></div><div><dt>{t.lastUpdated}</dt><dd>{text(account?.updatedAt) || '—'}</dd></div></dl></section><section className="card"><h2>{t.organizations}</h2><DataTable data={rows(detailRecord?.memberships)} columns={[{ key: 'organizationName', label: t.organization }, { key: 'status', label: t.status }, { key: 'createdAt', label: t.createdAt }]} /></section><OperationModal open={modal === 'edit'} title={t.editAccount} fields={[{ name: 'name', label: t.name, defaultValue: text(account?.name) }, { name: 'email', label: t.email, type: 'email', defaultValue: text(account?.email) }, { name: 'reason', label: t.teamAdministration.reason, required: true }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /><OperationModal open={modal === 'password'} title={t.resetPassword} fields={[{ name: 'password', label: t.newPassword, type: 'password', minLength: 12 }, { name: 'reason', label: t.teamAdministration.reason, required: true }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /></PageFrame>
  const organizationOptions = rows(organizations.value)
  return <PageFrame title={t.accounts} description={t.accountsDescription} actions={<button className="primary" onClick={() => { setSelected(null); setModal('create') }}>＋ {t.createAccount}</button>}><section className="card">{notice ? <p className="operation-notice" role="status">{notice}</p> : null}<div className="filter-bar"><span className="filter-label">{t.filters}</span><form onSubmit={(event) => { event.preventDefault(); setAccountQuery(draftAccountQuery); setAccountOffset(0) }}><input aria-label={t.accountSearch} placeholder={t.accountSearchPlaceholder} value={draftAccountQuery} onChange={event => setDraftAccountQuery(event.target.value)} /><button disabled={accounts.loading}>{t.search}</button></form></div><p role={accounts.error ? 'alert' : 'status'}>{accounts.error || (accounts.loading ? t.loading : '')}</p><DataTable data={accounts.error ? [] : accountRows} columns={[{ key: 'name', label: t.name }, { key: 'email', label: t.email }, { key: 'emailVerified', label: t.status }, { key: 'createdAt', label: t.createdAt }]} actions={item => <><button className="table-action" onClick={() => { setSelected(item); setModal('edit') }}>{t.edit}</button><button className="table-action" onClick={() => { setSelected(item); setModal('password') }}>{t.resetPassword}</button></>} onRow={item => window.location.assign(`/accounts/${text(item.id)}`)} /><div className="detail-actions"><button disabled={accounts.loading || accountOffset === 0} onClick={() => setAccountOffset(value => Math.max(0, value - 100))}>{t.previousPage}</button><button disabled={accounts.loading || accountRows.length < 100} onClick={() => setAccountOffset(value => value + 100)}>{t.nextPage}</button></div></section><CreateAccountModal open={modal === 'create'} busy={busy} nodes={organizationOptions} onLoadChildren={async node => rows(await request(`/v1/platform/organizations/tree?parentId=${encodeURIComponent(text(node.id))}`))} onClose={() => setModal(null)} onSubmit={values => void submit(values)} /><OperationModal open={modal === 'edit'} title={t.editAccount} fields={[{ name: 'name', label: t.name, defaultValue: text(selected?.name) }, { name: 'email', label: t.email, type: 'email', defaultValue: text(selected?.email) }, { name: 'reason', label: t.teamAdministration.reason, required: true }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /><OperationModal open={modal === 'password'} title={t.resetPassword} fields={[{ name: 'password', label: t.newPassword, type: 'password', minLength: 12 }, { name: 'reason', label: t.teamAdministration.reason, required: true }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /></PageFrame>
}

function HealthMetric({ icon, value, label, tone }: { icon: string; value: string; label: string; tone?: 'danger' | 'success' | 'info' }) {
  return <article className={`health-metric ${tone ? `health-metric-${tone}` : ''}`}><span className="health-metric-icon" aria-hidden="true">{icon}</span><div><strong>{value}</strong><small>{label}</small></div></article>
}

function HealthPage({ payload, error, onRefresh }: { payload: RecordValue | null; error: string; onRefresh: () => void }) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'attention'>('all')
  const services = rows(payload?.services)
  const query = search.trim().toLowerCase()
  const filteredServices = services.filter((item) => {
    const matchesSearch = !query || text(item.label).toLowerCase().includes(query)
    const matchesStatus = statusFilter === 'all' || ['warning', 'failed'].includes(text(item.status))
    return matchesSearch && matchesStatus
  })
  const healthyCount = services.filter(item => text(item.status) === 'ready').length
  const criticalAlerts = services.filter(item => text(item.status) === 'failed')
  const activeAlert = criticalAlerts[0] ?? services.find(item => text(item.status) === 'warning')
  const checkedAt = text(payload?.checkedAt)
  const displayTime = checkedAt ? new Date(checkedAt).toLocaleString('zh-CN') : '—'
  const availability = (item: RecordValue): string => item.availability == null ? '—' : `${Number(item.availability).toFixed(2)}%`
  const latency = (item: RecordValue): string => item.latencyMs == null ? '—' : `${Number(item.latencyMs)}ms`
  const cycleFilter = () => setStatusFilter(current => current === 'all' ? 'attention' : 'all')
  return <PageFrame title={t.systemHealthPageTitle} breadcrumbTitle={t.systemHealthPageTitle} eyebrow={t.overview} description={t.systemHealthPageDescription} actions={<button className="primary" onClick={onRefresh}>＋ {t.healthRefresh}</button>}><div className="health-page"><div className="health-heading"><div className="health-filters"><button type="button" onClick={() => setSearchOpen(current => !current)}>⌕ {t.healthSearch}</button><button type="button" onClick={cycleFilter}>≡ {statusFilter === 'all' ? t.healthFilter : t.healthAttentionOnly}</button><button type="button" onClick={onRefresh}>▣ {t.healthLast30Days}</button></div></div>{searchOpen ? <div className="health-search"><span>⌕</span><input autoFocus aria-label={t.healthSearch} placeholder={t.healthSearchPlaceholder} value={search} onChange={event => setSearch(event.target.value)} /></div> : null}{error ? <p className="error" role="alert">{error}</p> : null}<div className="health-metrics"><HealthMetric icon="♡" value={`${healthyCount} / ${services.length}`} label={t.healthServices} tone="info" /><HealthMetric icon="♧" value={String(criticalAlerts.length)} label={t.healthCriticalAlerts} tone="danger" /><HealthMetric icon="⚙" value="—" label={t.healthTodayErrors} tone="info" /><HealthMetric icon="↻" value="—" label={t.healthAverageRecovery} tone="info" /></div><div className="health-layout"><section className="health-service-panel"><div className="health-panel-heading"><h2>{t.healthServiceStatus}</h2><span># {filteredServices.length} {t.healthRecordCount}</span></div><div className="health-table-scroll"><table className="health-service-table"><thead><tr><th>{t.healthService}</th><th>{t.healthAvailability}</th><th>{t.healthLatency}</th><th>{t.healthErrorRate}</th><th>{t.healthLastCheck}</th><th>{t.healthStatus}</th></tr></thead><tbody>{filteredServices.map(item => <tr key={text(item.id)}><td>{text(item.label)}</td><td>{availability(item)}</td><td>{latency(item)}</td><td>{text(item.errorRate) || '—'}</td><td>{displayTime}</td><td>{status(item.status)}</td></tr>)}</tbody></table>{!filteredServices.length ? <div className="health-empty">{t.noData}</div> : null}</div></section><aside className="health-alert-panel"><div className="health-panel-heading"><h2>{t.healthAlertDetails}</h2></div>{activeAlert ? <dl className="health-alert-details"><div><dt>{t.healthSeverity}</dt><dd className={text(activeAlert.status) === 'failed' ? 'health-danger' : 'health-warning'}>{text(activeAlert.status) === 'failed' ? t.healthCritical : t.healthWarning}</dd></div><div><dt>{t.healthCurrentService}</dt><dd>{text(activeAlert.label)}</dd></div><div><dt>{t.healthCurrentStatus}</dt><dd>{status(activeAlert.status)}</dd></div><div><dt>{t.healthCheckedAt}</dt><dd>{displayTime}</dd></div><div><dt>{t.healthLatency}</dt><dd>{latency(activeAlert)}</dd></div><div><dt>{t.healthAvailability}</dt><dd>{availability(activeAlert)}</dd></div></dl> : <div className="health-alert-empty"><strong>{t.healthNoActiveAlerts}</strong><span>{t.healthNoActiveAlertsDescription}</span></div>}</aside></div></div></PageFrame>
}

function PlatformPage({ area }: { area: string }) {
  const [auditSearch, setAuditSearch] = useState('')
  const [auditPage, setAuditPage] = useState(0)
  const data = useData(area === 'health' ? '/v1/platform/health' : area === 'settings' ? '/v1/platform/policy' : area === 'redemptions' ? '/v1/platform/redemption-codes?limit=100' : area === 'audit' ? '/v1/platform/audit?limit=200' : area === 'adapters' ? '/v1/platform/model-adapters' : area === 'runtimes' ? '/v1/platform/runtimes' : '/v1/platform/models')
  const payload = first(data.value)
  const tableRows = area === 'adapters' ? rows(data.value).map((item) => {
    const configuration = item.configuration && typeof item.configuration === 'object' ? item.configuration as Record<string, unknown> : {}
    return { ...item, mode: configuration.mode ?? 'asynchronous', billing: configuration.billing ?? 'provider-usage' }
  }) : rows(data.value)
  const auditRows = area === 'audit' ? tableRows.filter(item => !auditSearch.trim() || JSON.stringify(item).toLowerCase().includes(auditSearch.trim().toLowerCase())) : tableRows
  const [modal, setModal] = useState<'settings' | 'redemptions' | null>(null)
  const [modelEditorOpen, setModelEditorOpen] = useState(false)
  const [adapterEditorOpen, setAdapterEditorOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<RecordValue | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [generatedCodes, setGeneratedCodes] = useState<RecordValue | null>(null)
  async function mutate(path: string, method: string, body?: unknown) {
    setBusy(true)
    setNotice('')
    try {
      const result = await request(path, method, body)
      setNotice(t.success)
      await data.reload()
      return result
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
      return null
    } finally {
      setBusy(false)
    }
  }
  async function submit(values: Record<string, string>) {
    setBusy(true)
    setNotice('')
    try {
      if (area === 'settings') {
        await request('/v1/platform/policy', 'PUT', { registration: values.registration, domains: values.domains.split(',').map(value => value.trim()).filter(Boolean) })
      } else {
        const result = await request('/v1/platform/redemption-code-batches', 'POST', { amountCny: values.amountCny, count: Number(values.count), ...(values.expiresAt ? { expiresAt: new Date(values.expiresAt).toISOString() } : {}), ...(values.note.trim() ? { note: values.note.trim() } : {}) })
        setGeneratedCodes(first(result))
      }
      setModal(null)
      setNotice(area === 'redemptions' ? t.redemptionCreated : t.success)
      await data.reload()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setBusy(false)
    }
  }
  async function saveModel(value: Record<string, unknown>) {
    const path = editingModel ? `/v1/platform/models/${text(editingModel.id)}` : '/v1/platform/models'
    const result = await mutate(path, editingModel ? 'PATCH' : 'POST', editingModel ? { ...value, expectedPublicationRevision: editingModel.publicationRevision } : value)
    if (result !== null) { setModelEditorOpen(false); setEditingModel(null) }
  }
  async function saveAdapter(value: Record<string, unknown>) {
    const result = await mutate('/v1/platform/model-adapters', 'POST', value)
    if (result !== null) setAdapterEditorOpen(false)
  }
  if (area === 'health') return <HealthPage payload={payload} error={data.error} onRefresh={data.reload} />
  const labels: Record<string, string> = { settings: t.platformSettings, redemptions: t.redemptionCodes, models: t.modelCatalog,
    adapters: t.modelAdapters, runtimes: t.runtimeDevices, audit: t.globalAudit }
  const descriptions: Record<string, string> = { settings: t.platformSettingsDescription, redemptions: t.redemptionCodesDescription, models: `${t.modelCatalogDescription} ${t.modelAdaptersDescription}`, adapters: t.modelAdaptersDescription, runtimes: t.runtimeDevicesDescription, audit: t.globalAuditDescription }
  const columns = area === 'settings' ? [{ key: 'registration', label: t.registrationPolicy }, { key: 'mode', label: t.mode }, { key: 'domains', label: t.domains }] : area === 'redemptions' ? [{ key: 'batchId', label: t.batchId }, { key: 'codeHint', label: t.code }, { key: 'amountMicrosCny', label: t.amountCny }, { key: 'redeemedAt', label: t.redeemed }, { key: 'expiresAt', label: t.expired }] : area === 'audit' ? [{ key: 'createdAt', label: t.createdAt }, { key: 'action', label: t.action }, { key: 'resourceId', label: t.resource }, { key: 'actorId', label: t.account }] : area === 'adapters' ? [{ key: 'publicModel', label: t.model }, { key: 'operation', label: t.operation }, { key: 'mode', label: t.executionMode }, { key: 'billing', label: t.billingMode }, { key: 'version', label: t.version }, { key: 'enabled', label: t.status }] : area === 'runtimes' ? [{ key: 'name', label: t.name }, { key: 'type', label: t.columns.type }, { key: 'version', label: t.version }, { key: 'expiresAt', label: t.columns.expiresAt }, { key: 'revokedAt', label: t.columns.revokedAt }] : [{ key: 'name', label: t.name }, { key: 'baseUrl', label: t.baseUrl }, { key: 'upstreamModel', label: t.upstreamModel }, { key: 'enabled', label: t.status }]
  const tableActions = (item: RecordValue) => area === 'redemptions' ? <button className="table-action danger" disabled={Boolean(item.redeemedAt) || Boolean(item.revokedAt) || busy} onClick={() => void mutate(`/v1/platform/redemption-codes/${text(item.id)}/revoke`, 'POST')}>{t.revoke}</button> : area === 'models' ? <><button className="table-action" disabled={busy} onClick={() => { setEditingModel(item); setModelEditorOpen(true) }}>{t.edit}</button><button className="table-action" disabled={busy} onClick={() => void mutate(`/v1/platform/models/${text(item.id)}`, 'PATCH', { enabled: !item.enabled, expectedPublicationRevision: item.publicationRevision })}>{item.enabled ? t.disabled : t.enabled}</button></> : null
  const policy = area === 'settings' ? payload : null
  const settingsPage = ['settings', 'redemptions'].includes(area)
  const action = area === 'settings' ? <button className="primary" onClick={() => setModal('settings')}>＋ {t.configure}</button> : area === 'redemptions' ? <button className="primary" onClick={() => setModal('redemptions')}>＋ {t.create}</button> : area === 'models' ? <button className="primary" onClick={() => { setEditingModel(null); setModelEditorOpen(true) }}>＋ {t.create}</button> : area === 'adapters' ? <button className="primary" onClick={() => setAdapterEditorOpen(true)}>＋ {t.create}</button> : <button className="secondary-button" onClick={data.reload}>{t.refresh}</button>
  return <PageFrame title={labels[area] ?? t.resourceList} description={descriptions[area]} actions={action}>{settingsPage ? <PlatformSettingTabs area={area} /> : null}<div className={settingsPage ? 'platform-setting-page' : ''}><section className="card">{data.error ? <p className="error" role="alert">{data.error}</p> : null}{notice ? <p className="operation-notice" role="status">{notice}</p> : null}<div className="detail-grid"><div><dt>{t.total}</dt><dd>{tableRows.length || (payload ? 1 : 0)}</dd></div><div><dt>{t.lastUpdated}</dt><dd>{text(payload?.lastUpdated) || '—'}</dd></div></div><>{area === 'audit' && <div className="filter-bar"><label>{t.search}<input value={auditSearch} placeholder={t.auditSearchPlaceholder} onChange={(event) => { setAuditSearch(event.target.value); setAuditPage(0) }} /></label><span className="muted">{t.loadedRecords} · {auditRows.length}</span></div>}<DataTable data={area === 'audit' ? auditRows.slice(auditPage * 25, (auditPage + 1) * 25) : tableRows} columns={columns} onRow={area === 'runtimes' ? item => window.location.assign(`/models/runtimes/${text(item.id)}`) : undefined} actions={['redemptions', 'models'].includes(area) ? tableActions : undefined} />{area === 'audit' && <div className="detail-actions"><button disabled={auditPage === 0} onClick={() => setAuditPage(value => value - 1)}>{t.previousPage}</button><span>{auditPage + 1} / {Math.max(1, Math.ceil(auditRows.length / 25))}</span><button disabled={(auditPage + 1) * 25 >= auditRows.length} onClick={() => setAuditPage(value => value + 1)}>{t.nextPage}</button></div>}</></section></div>{generatedCodes ? <section className="card generated-codes"><div className="card-heading"><h2>{t.redemptionCreated}</h2><button className="secondary-button" onClick={() => setGeneratedCodes(null)}>{t.close}</button></div><p><strong>{t.batchId}:</strong> {text(generatedCodes.batchId)}</p><pre>{Array.isArray(generatedCodes.codes) ? generatedCodes.codes.join('\n') : ''}</pre></section> : null}<OperationModal open={modal === 'settings'} title={t.platformSettings} description={t.platformSettingsDescription} fields={[{ name: 'registration', label: t.registrationPolicy, type: 'select', defaultValue: text(policy?.registration) || 'open', options: Object.entries(t.registrationPolicies).map(([value, label]) => ({ value, label })) }, { name: 'domains', label: t.domains, defaultValue: Array.isArray(policy?.domains) ? policy.domains.join(', ') : '', required: false }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /><OperationModal open={modal === 'redemptions'} title={t.createRedemptionBatch} description={t.redemptionCodesDescription} fields={[{ name: 'amountCny', label: t.amountCny, type: 'number', defaultValue: '100' }, { name: 'count', label: t.redemptionCount, type: 'number', defaultValue: '1' }, { name: 'expiresAt', label: t.redemptionExpiresAt, type: 'datetime-local', required: false }, { name: 'note', label: t.redemptionNote, required: false }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /><ModelEditorModal open={modelEditorOpen} model={editingModel} busy={busy} onClose={() => { setModelEditorOpen(false); setEditingModel(null) }} onSubmit={value => void saveModel(value)} /><HeterogeneousModelEditorModal open={adapterEditorOpen} busy={busy} onClose={() => setAdapterEditorOpen(false)} onSubmit={value => void saveAdapter(value)} /></PageFrame>
}

function RuntimeDetail({ id }: { id?: string }) {
  const data = useData(id ? `/v1/platform/runtimes/${id}` : null)
  const record = first(data.value)
  const runtime = first(record?.runtime)
  const fields: Array<[string, string]> = [['id', t.columns.id], ['organizationId', t.organizationId], ['accountId', t.columns.accountId], ['expiresAt', t.columns.expiresAt], ['createdAt', t.createdAt]]
  return <PageFrame title={t.runtimeDetail} description={t.runtimeDetailDescription} eyebrow={t.runtimeDevices}><section className="card"><div className="detail-heading"><div><h3>{text(runtime?.name) || id}</h3><p className="muted">{text(runtime?.type)} · {text(runtime?.version)}</p></div>{status(runtime?.revokedAt ? 'revoked' : 'active')}</div><div className="detail-grid">{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{text(runtime?.[key]) || '—'}</dd></div>)}</div></section><section className="card"><h2>{t.recentAudit}</h2><DataTable data={rows(record?.audit)} columns={[{ key: 'action', label: t.action }, { key: 'resourceId', label: t.resource }, { key: 'createdAt', label: t.createdAt }]} /></section></PageFrame>
}

function ShellContent({ route }: { route: Route }) {
  if (route.area === 'overview') return <OverviewPage />
  if (route.area === 'platform/usage') return <UsageReferenceWorkspace />
  if (route.area === 'platform/plans') return <SubscriptionPlansWorkspace />
  if (route.area === 'platform/desktop-releases') return <DesktopReleasesWorkspace />
  if (route.area === 'platform/plugins') return <PluginReviewPage />
  if (['platform/settings', 'platform/redemptions'].includes(route.area)) return <PlatformSettingsWorkspace area={route.area as Parameters<typeof PlatformSettingsWorkspace>[0]['area']} id={route.id} />
  if (route.area === 'organizations/directory') return <TeamAdministration teamId={route.id} />
  if (route.area === 'organizations/members') return <TeamAdministration teamId={route.id} />
  if (route.area === 'accounts') return <AccountsPage id={route.id} />
  if (route.area === 'permissions/audit') return <PlatformPage area="audit" />
  if (route.area.startsWith('models/')) return <ModelRuntimeWorkspace view={route.area === 'models/providers' ? 'providers' : route.area === 'models/adapters' ? 'adapters' : route.area === 'models/runtimes' ? 'runtimes' : 'models'} runtimeId={route.id} />
  if (route.area.startsWith('sync/') || route.area.startsWith('identity/')) return <EnterpriseWorkspace area={route.area} providerId={route.id} />
  if (route.area.startsWith('permissions/')) return <PageFrame title={t.teamManagementDesktop} description={t.teamManagementDesktopHelp}><a href="/organizations/directory">{t.organizationDirectory}</a></PageFrame>
  if (route.area.startsWith('platform/')) return <PlatformPage area={route.area.slice('platform/'.length)} />
  return <OverviewPage />
}

export default function AdminShell({ segments }: { segments: string[] }) {
  useDialogFocus()
  const route = useMemo(() => routeFromSegments(segments), [segments])
  const me = useData('/v1/me')
  const [navOpen, setNavOpen] = useState(false)
  if (me.loading && me.value === null) return <main className="auth-loading"><img className="brand-mark" src="/admin/brand.png" alt="" /><strong>{t.adminBrand}</strong><span>{t.loading}</span></main>
  if (me.error && me.value === null) {
    if (me.errorStatus === 401 ||
      /login|required|verified/i.test(me.error)) return <LoginGate error={me.error} onAuthenticated={me.reload} />
    return <main className="auth-loading"><strong>{t.error}</strong><span>{me.error}</span><button className="primary" onClick={me.reload}>{t.refresh}</button></main>
  }
  if (first(me.value)?.platformAdmin !== true) return <main className="auth-loading"><strong>{t.adminLoginOnly}</strong><a href="/account">{t.accountEntry.title}</a></main>
  return <div className="shell"><button className="mobile-nav-toggle" onClick={() => setNavOpen(value => !value)} aria-label={navOpen ? t.closeNavigation : t.openNavigation} aria-expanded={navOpen}>☰</button>{navOpen ? <button className="mobile-nav-scrim" onClick={() => setNavOpen(false)} aria-label={t.closeNavigation} /> : null}<aside className={navOpen ? 'nav-open' : ''}><div className="admin-sidebar-content"><div className="brand-lockup"><img className="brand-mark" src="/admin/brand.png" alt="" /><span className="wordmark">{t.adminBrand}<small>{t.administration}</small></span></div><div className="scope-switcher"><small>{t.currentScope}</small><strong>{t.globalScope}</strong></div><nav aria-label={t.navigation}>{navigation.map(group => <div className="nav-group" key={group.label}><span className="nav-label">{message(group.label)}</span>{group.items.map(([key, href]) => { const itemArea = key === 'accounts' ? 'accounts' : key === 'plans' ? 'platform/plans' : key === 'desktopReleases' ? 'platform/desktop-releases' : key === 'overview' ? 'overview' : key === 'usage' ? 'platform/usage' : key === 'globalAudit' ? 'permissions/audit' : key === 'organizationDirectory' ? 'organizations/directory' : key === 'modelRuntime' ? 'models/catalog' : key === 'platformSettingsNav' ? 'platform/settings' : key; const selected = key === 'enterpriseIdentity' ? route.area.startsWith('identity/') : key === 'enterpriseDirectory' ? route.area.startsWith('sync/') : key === 'platformSettingsNav' ? ['platform/settings', 'platform/redemptions'].includes(route.area) : key === 'modelRuntime' ? route.area.startsWith('models/') : route.area === itemArea; return <a className={selected ? 'selected' : ''} href={href} key={key} onClick={() => setNavOpen(false)}><img className="nav-icon" aria-hidden="true" src={`/admin/icons/${({ overview: 'layout-dashboard', usage: 'chart-no-axes-combined', globalAudit: 'clipboard-list', organizationDirectory: 'users', accounts: 'contact-round', plans: 'badge-check', modelRuntime: 'boxes', plugins: 'puzzle', desktopReleases: 'download', enterpriseIdentity: 'badge-check', enterpriseDirectory: 'boxes', platformSettingsNav: 'settings-2' } as Record<string, string>)[key]}.svg`} width={16} height={16} />{message(key)}</a> })}</div>)}</nav><div className="account"><span className="account-avatar">{text(first(me.value)?.name).slice(0, 1) || '智'}</span><span><strong>{text(first(me.value)?.name) || t.platformAdministrator}</strong><small>{text(first(me.value)?.email)}</small></span></div></div></aside><main><div className="admin-topbar"><div className="breadcrumb"><span>{t.adminConsole}</span><b>/</b><strong>{navigation.flatMap(group => group.items).find(([, href]) => href === '/' + route.area || (href === '/models/catalog' && route.area.startsWith('models/')) || (href === '/identity/providers' && route.area.startsWith('identity/')) || (href === '/sync/scripts' && route.area.startsWith('sync/')))?.[0] ? message(navigation.flatMap(group => group.items).find(([, href]) => href === '/' + route.area || (href === '/models/catalog' && route.area.startsWith('models/')) || (href === '/identity/providers' && route.area.startsWith('identity/')) || (href === '/sync/scripts' && route.area.startsWith('sync/')))![0]) : t.platformManagement}</strong></div><span className="admin-role">{t.platformAdministrator}</span></div><div className="admin-page-content">{me.error && <p className="error" role="alert">{me.error}</p>}<ShellContent route={route} /><footer className="admin-footer"><span>{t.adminBrand} / {t.platformManagement}</span><span>{t.managementScope}</span></footer></div></main></div>
}
