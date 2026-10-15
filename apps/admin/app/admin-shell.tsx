'use client'

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { publishPlatformPlugin, request } from './client-api'
import { HeterogeneousModelEditorModal, ModelEditorModal } from './admin-components'
import { CreateAccountModal, CreateOrganizationModal, OrganizationTree } from './admin-components'
import { UsageDashboard } from './usage-dashboard'
import UsageReferenceWorkspace from './usage-reference-workspace'
import PlatformSettingsWorkspace from './platform-settings-workspace'
import ModelRuntimeWorkspace from './model-runtime-workspace'
import { zh as t } from './messages'

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
    if (!path) { setValue(null); setLoading(false); setErrorStatus(undefined); return }
    let cancelled = false
    setLoading(true)
    setError('')
    setErrorStatus(undefined)
    void request(path).then((result) => { if (!cancelled) setValue(result) }).catch((errorValue) => { if (!cancelled) { setError(errorValue instanceof Error ? errorValue.message : t.error); setErrorStatus(typeof errorValue === 'object' && errorValue !== null && 'status' in errorValue && typeof errorValue.status === 'number' ? errorValue.status : undefined) } }).finally(() => { if (!cancelled) setLoading(false) })
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
  return <main className="login"><section className="login-brand"><div className="brand-lockup"><span className="brand-mark">智</span><div className="wordmark">{t.adminBrand}</div></div><div className="login-hero"><h1>{t.loginHeroTitle}</h1><p>{t.loginHeroDescription}</p></div><p className="login-note">{t.adminLoginOnly}</p></section><section className="login-form-panel"><h2>{t.signInHeading}</h2><p className="muted">{t.subtitle}</p><form onSubmit={signIn}><label>{t.email}<input name="email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label><label>{t.password}<input name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label><button className="primary" disabled={busy}>{busy ? t.loading : t.login}</button></form>{ssoProviders.length > 0 ? <><div className="login-divider"><span>{t.or}</span></div><div className="sso-actions">{ssoProviders.map(provider => <button className="secondary-button" type="button" key={provider.id} disabled={busy} onClick={() => void signInSso(provider)}>{t.ssoLogin} · {provider.name}</button>)}</div></> : null}<p className="login-note">{t.adminLoginOnly}</p><p className="login-error" role="alert">{notice}</p></section></main>
}

function DataTable({ data, columns, onRow, actions }: { data: RecordValue[]
  columns: Array<{ key: string; label: string }>
  onRow?: (item: RecordValue) => void
  actions?: (item: RecordValue) => ReactNode }) {
  if (!data.length) return <div className="empty-state compact"><strong>{t.noData}</strong><span>{t.noSelection}</span></div>
  return <div className="table-scroll"><table><thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}{actions ? <th>{t.operation}</th> : null}</tr></thead><tbody>{data.map((item, index) => <tr key={text(item.id) || String(index)} onClick={() => onRow?.(item)} className={onRow ? 'clickable-row' : ''}>{columns.map(column => <td key={column.key}>{column.key === 'status' || column.key === 'state' || column.key === 'enabled' ? status(item[column.key]) : column.key === 'kind' || column.key === 'unitType' ? (t.organizationKinds[text(item[column.key]) as keyof typeof t.organizationKinds] ?? text(item[column.key])) : localizedValue(item[column.key], column.key) || '—'}</td>)}{actions ? <td className="actions-cell" onClick={event => event.stopPropagation()}>{actions(item)}</td> : null}</tr>)}</tbody></table></div>
}

type OperationField = { name: string; label: string; type?: 'text' | 'email' | 'password' | 'url' | 'number' | 'datetime-local' | 'textarea' | 'select'; required?: boolean; defaultValue?: string; options?: Array<{ value: string; label: string }> }

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
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="operation-modal-title"><div className="modal-heading"><div><p className="eyebrow">{t.operation}</p><h2 id="operation-modal-title">{title}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label={t.close}>×</button></div>{description ? <p className="muted">{description}</p> : null}<form className="operation-form" onSubmit={(event) => { event.preventDefault(); onSubmit(values) }}>{fields.map(field => <label key={field.name}>{field.label}{field.type === 'textarea' ? <textarea rows={5} value={values[field.name] ?? ''} onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))} required={field.required !== false} /> : field.type === 'select' ? <select value={values[field.name] ?? ''} onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))} required={field.required !== false}>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input type={field.type ?? 'text'} value={values[field.name] ?? ''} onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))} required={field.required !== false} />}</label>)}<div className="modal-actions"><button type="button" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy}>{busy ? t.loading : t.confirm}</button></div></form></section></div>
}

type SyncTemplateKey = 'rest' | 'ldap' | 'table'
type SyncScriptValues = { name: string; source: string; input: string }

const syncTemplates: Record<SyncTemplateKey, { label: string; description: string; source: string; input: string }> = {
  rest: {
    label: '企业接口分页模板',
    description: '把企业接口返回的当前页记录转换为统一的组织、账号和成员关系。接口游标由调用方放入 input.page.nextCursor。',
    source: `module.exports = function transform(input) {
  const page = input.page ?? { items: [] }
  const records = Array.isArray(page.items) ? page.items : []

  // 企业字段 -> 智域OS标准字段：稳定外部编号不能使用数组下标。
  const organizations = records
    .filter(item => item.kind === 'department')
    .map(item => ({
      externalId: String(item.dept_code),
      parentExternalId: item.parent_code ? String(item.parent_code) : null,
      name: String(item.dept_name ?? ''),
      kind: 'department',
      status: item.enabled === false ? 'suspended' : 'active'
    }))

  const users = records
    .filter(item => item.kind === 'employee')
    .map(item => ({
      externalId: String(item.employee_no),
      email: String(item.work_email ?? '').trim().toLowerCase(),
      name: String(item.display_name ?? item.employee_name ?? ''),
      active: item.employment_status === '在职'
    }))

  const memberships = records
    .filter(item => item.kind === 'employee' && item.dept_code)
    .map(item => ({
      externalId: String(item.employee_no) + '@' + String(item.dept_code),
      userExternalId: String(item.employee_no),
      organizationExternalId: String(item.dept_code),
      role: 'member',
      status: item.employment_status === '在职' ? 'active' : 'suspended'
    }))

  const pageInfo = { nextCursor: page.nextCursor ?? null, total: page.total ?? records.length }
  return {
    organizations: { items: organizations, ...pageInfo },
    users: { items: users, ...pageInfo },
    memberships: { items: memberships, ...pageInfo }
  }
}`,
    input: JSON.stringify({ page: { items: [{ kind: 'department', dept_code: '研发-001', dept_name: '研发中心', parent_code: null, enabled: true }, { kind: 'employee', employee_no: 'E10001', display_name: '张三', work_email: 'zhangsan@example.com', employment_status: '在职', dept_code: '研发-001' }], nextCursor: 'cursor-下一页', total: 120000 } }, null, 2),
  },
  ldap: {
    label: 'LDAP 目录模板',
    description: '把 LDAP 查询结果中的用户和组织属性转换为统一标准；LDAP 查询的分页由目录连接器负责。',
    source: `module.exports = function transform(input) {
  const users = (input.users ?? []).map(item => ({
    externalId: String(item.uid ?? item.employeeNumber),
    email: String(item.mail ?? '').trim().toLowerCase(),
    name: String(item.displayName ?? item.cn ?? ''),
    active: item.accountStatus !== 'disabled'
  }))
  const organizations = (input.groups ?? []).map(item => ({
    externalId: String(item.ou ?? item.entryUUID),
    parentExternalId: item.parentOu ? String(item.parentOu) : null,
    name: String(item.displayName ?? item.ou ?? ''),
    kind: 'department',
    status: 'active'
  }))
  const memberships = (input.memberships ?? []).map(item => ({
    externalId: String(item.uid) + '@' + String(item.ou),
    userExternalId: String(item.uid),
    organizationExternalId: String(item.ou),
    role: 'member'
  }))
  const pageInfo = { nextCursor: input.nextCursor ?? null, total: users.length + organizations.length }
  return { organizations: { items: organizations, ...pageInfo }, users: { items: users, ...pageInfo }, memberships: { items: memberships, ...pageInfo } }
}`,
    input: JSON.stringify({ users: [{ uid: 'zhangsan', mail: 'zhangsan@example.com', displayName: '张三', employeeNumber: 'E10001' }], groups: [{ ou: '研发-001', displayName: '研发中心' }], memberships: [{ uid: 'zhangsan', ou: '研发-001' }], nextCursor: null }, null, 2),
  },
  table: {
    label: '表格/数据库模板',
    description: '适合 CSV、Excel 或数据库查询结果；把查询结果放在 input.rows，字段映射集中写在转换函数中。',
    source: `module.exports = function transform(input) {
  const rows = Array.isArray(input.rows) ? input.rows : []
  return {
    users: rows.map(row => ({
      externalId: String(row.工号 ?? row.employee_id),
      email: String(row.企业邮箱 ?? row.email ?? '').trim().toLowerCase(),
      name: String(row.姓名 ?? row.name ?? ''),
      active: row.在职状态 === '在职' || row.active === true
    })),
    organizations: { items: [], nextCursor: input.nextCursor ?? null, total: 0 },
    memberships: { items: [], nextCursor: input.nextCursor ?? null, total: 0 }
  }
}`,
    input: JSON.stringify({ rows: [{ 工号: 'E10001', 企业邮箱: 'zhangsan@example.com', 姓名: '张三', 在职状态: '在职' }] }, null, 2),
  },
}

function SyncScriptModal({ open, busy, script, onClose, onSubmit, onDelete }: { open: boolean
  busy: boolean
  script?: RecordValue | null
  onClose: () => void
  onSubmit: (value: SyncScriptValues) => void
  onDelete?: () => void }) {
  const [template, setTemplate] = useState<SyncTemplateKey>('rest')
  const [name, setName] = useState('企业目录分页同步')
  const [source, setSource] = useState(syncTemplates.rest.source)
  useEffect(() => {
    if (open) {
      setTemplate('rest')
      setName(text(script?.name) || '企业目录分页同步')
      setSource(text(script?.source) || syncTemplates.rest.source)
    }
  }, [open, script])
  if (!open) return null
  const selected = syncTemplates[template]
  const chooseTemplate = (value: SyncTemplateKey) => {
    setTemplate(value)
    setSource(syncTemplates[value].source)
  }
  const editing = Boolean(script)
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="modal modal-wide sync-script-modal" role="dialog" aria-modal="true" aria-labelledby="sync-script-modal-title"><div className="modal-heading"><div><p className="eyebrow">{t.syncScripts}</p><h2 id="sync-script-modal-title">{editing ? t.editSyncTrigger : t.createSyncTrigger}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label={t.close}>×</button></div><p className="muted">{t.syncScriptFlow}</p><div className="sync-flow"><span>读取源系统</span><b>→</b><span>分页拉取</span><b>→</b><span>字段转换</span><b>→</b><span>预览审批</span><b>→</b><span>分批应用</span></div><form className="operation-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ name: name.trim(), source, input: selected.input }) }}><label>{t.name}<input autoFocus value={name} onChange={event => setName(event.target.value)} required /></label><label>{t.templateType}<select value={template} onChange={event => chooseTemplate(event.target.value as SyncTemplateKey)}>{Object.entries(syncTemplates).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label><p className="muted sync-template-help">{selected.description}</p><label>{t.scriptSource}<textarea rows={16} value={source} onChange={event => setSource(event.target.value)} required /></label><details className="sync-example" open><summary>{t.syncInputExample}</summary><pre>{selected.input}</pre></details><div className="sync-standard-note"><strong>{t.syncOutputStandard}</strong><span>{t.syncOutputStandardDescription}</span><code>organizations[] · users[] · memberships[] · page.nextCursor</code></div><div className="modal-actions">{editing && onDelete ? <button type="button" className="danger-button" disabled={busy} onClick={onDelete}>{t.deleteSyncTrigger}</button> : null}<span className="modal-actions-spacer" /><button type="button" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy || !name.trim() || !source.trim()}>{busy ? t.loading : t.confirm}</button></div></form></section></div>
}

function SyncPreviewModal({ open, scriptName, busy, onClose, onSubmit }: { open: boolean
  scriptName: string
  busy: boolean
  onClose: () => void
  onSubmit: (input: string) => void }) {
  const [input, setInput] = useState(syncTemplates.rest.input)
  useEffect(() => { if (open) setInput(syncTemplates.rest.input) }, [open])
  if (!open) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="sync-preview-title"><div className="modal-heading"><div><p className="eyebrow">{t.syncScripts}</p><h2 id="sync-preview-title">{t.testSyncScript}: {scriptName}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label={t.close}>×</button></div><p className="muted">{t.syncPreviewDescription}</p><label>{t.syncInputJson}<textarea rows={13} value={input} onChange={event => setInput(event.target.value)} /></label><div className="sync-standard-note"><strong>{t.syncLargeData}</strong><span>{t.syncLargeDataDescription}</span></div><div className="modal-actions"><button type="button" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy} onClick={() => onSubmit(input)}>{busy ? t.loading : t.runPreview}</button></div></section></div>
}

function ConfirmModal({ open, title, description, busy, onClose, onConfirm }: { open: boolean
  title: string
  description: string
  busy: boolean
  onClose: () => void
  onConfirm: () => void }) {
  if (!open) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-operation-title"><div className="modal-heading"><h2 id="confirm-operation-title">{title}</h2><button className="icon-button" type="button" onClick={onClose} aria-label={t.close}>×</button></div><p className="muted">{description}</p><div className="modal-actions"><button type="button" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy} onClick={onConfirm}>{busy ? t.loading : t.confirm}</button></div></section></div>
}

type IdentityProtocol = keyof typeof t.identityProtocols
type IdentityProviderForm = { name: string; protocol: IdentityProtocol; issuer?: string; config: Record<string, string> }

function IdentityProviderModal({ open, busy, onClose, onSubmit }: { open: boolean
  busy: boolean
  onClose: () => void
  onSubmit: (value: IdentityProviderForm) => void }) {
  const [protocol, setProtocol] = useState<IdentityProtocol>('oidc')
  const [values, setValues] = useState<Record<string, string>>({ name: '', issuer: '', clientId: '', clientSecret: '', scopes: 'openid profile email', redirectUri: '' })
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    setProtocol('oidc')
    setValues({ name: '', issuer: '', clientId: '', clientSecret: '', scopes: 'openid profile email', redirectUri: '' })
    setError('')
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open, onClose])
  if (!open) return null
  const update = (key: string, value: string) => setValues(current => ({ ...current, [key]: value }))
  const changeProtocol = (next: IdentityProtocol) => {
    setProtocol(next)
    setError('')
    const defaults: Record<string, string> = next === 'oidc'
      ? { name: values.name, issuer: '', clientId: '', clientSecret: '', scopes: 'openid profile email', redirectUri: '' }
      : next === 'oauth2'
        ? { name: values.name, authorizationUrl: '', tokenUrl: '', userInfoUrl: '', clientId: '', clientSecret: '', scopes: '', redirectUri: '' }
        : next === 'saml'
          ? { name: values.name, entityId: '', metadataUrl: '', ssoUrl: '', certificate: '', emailAttribute: 'email' }
          : { name: values.name, ldapUrl: 'ldap://', baseDn: '', bindDn: '', bindPassword: '', userBaseDn: '', userFilter: '(&(objectClass=inetOrgPerson)(uid=*))', usernameAttribute: 'uid', displayNameAttribute: 'displayName', emailAttribute: 'mail', membershipMode: 'user_attribute', groupBaseDn: '', groupFilter: '(objectClass=organizationalUnit)', groupNameAttribute: 'ou', memberAttribute: 'ou' }
    setValues(defaults)
  }
  const field = (key: string, label: string, type: 'text' | 'url' | 'password' | 'textarea' = 'text', required = true) => <label key={key}>{label}{type === 'textarea' ? <textarea rows={4} value={values[key] ?? ''} onChange={event => update(key, event.target.value)} required={required} /> : <input type={type} value={values[key] ?? ''} onChange={event => update(key, event.target.value)} required={required} />}</label>
  const jsonConfig = Object.fromEntries(Object.entries(values).filter(([key, value]) => key !== 'name' && key !== 'issuer' && value.trim() !== ''))
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!values.name.trim()) return
    if (protocol === 'saml' && !values.metadataUrl.trim() && !values.ssoUrl.trim()) { setError(t.samlEndpointRequired); return }
    if (protocol === 'ldap' && !values.ldapUrl.trim()) { setError(t.ldapUrlRequired); return }
    setError('')
    onSubmit({ name: values.name.trim(), protocol, ...(values.issuer.trim() ? { issuer: values.issuer.trim() } : {}), config: jsonConfig })
  }
  const protocolFields = protocol === 'oidc'
    ? <>{field('issuer', t.issuer, 'url')}{field('clientId', t.clientId)}{field('clientSecret', t.clientSecret, 'password')}{field('scopes', t.scopes)}{field('redirectUri', t.redirectUri, 'url', false)}</>
    : protocol === 'oauth2'
      ? <>{field('authorizationUrl', t.authorizationUrl, 'url')}{field('tokenUrl', t.tokenUrl, 'url')}{field('userInfoUrl', t.userInfoUrl, 'url')}{field('clientId', t.clientId)}{field('clientSecret', t.clientSecret, 'password', false)}{field('scopes', t.scopes, 'text', false)}{field('redirectUri', t.redirectUri, 'url', false)}</>
      : protocol === 'saml'
        ? <>{field('entityId', t.entityId)}{field('metadataUrl', t.metadataUrl, 'url', false)}{field('ssoUrl', t.ssoUrl, 'url', false)}{field('certificate', t.certificate, 'textarea', false)}{field('emailAttribute', t.emailAttribute)}</>
        : <>{field('ldapUrl', t.ldapUrl, 'url')}{field('baseDn', t.baseDn)}{field('bindDn', t.bindDn)}{field('bindPassword', t.bindPassword, 'password')}{field('userBaseDn', t.userBaseDn, 'text', false)}{field('userFilter', t.userFilter, 'text', false)}{field('usernameAttribute', t.usernameAttribute)}{field('displayNameAttribute', t.displayNameAttribute)}{field('emailAttribute', t.emailAttribute)}<label>{t.membershipMode}<select value={values.membershipMode ?? 'user_attribute'} onChange={event => update('membershipMode', event.target.value)}>{Object.entries(t.membershipModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{field('groupBaseDn', t.groupBaseDn, 'text', false)}{field('groupFilter', t.groupFilter, 'text', false)}{field('groupNameAttribute', t.groupNameAttribute, 'text', false)}{field('memberAttribute', t.memberAttribute, 'text', false)}</>
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="identity-provider-modal-title"><div className="modal-heading"><div><p className="eyebrow">{t.identityProviders}</p><h2 id="identity-provider-modal-title">{t.configure}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label={t.close}>×</button></div><p className="muted">{t.identityProtocolDescriptions[protocol]}</p><form className="grid-form" onSubmit={submit}><label>{t.name}<input autoFocus value={values.name ?? ''} onChange={event => update('name', event.target.value)} required /></label><label>{t.protocol}<select value={protocol} onChange={event => changeProtocol(event.target.value as IdentityProtocol)}>{Object.entries(t.identityProtocols).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{protocolFields}{error ? <p className="error full-width" role="alert">{error}</p> : null}<div className="modal-actions full-width"><button type="button" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy}>{busy ? t.loading : t.confirm}</button></div></form></section></div>
}

function MetricStrip({ values }: { values: Array<{ label: string; value: string; tone?: string }> }) {
  return <div className="stat-strip">{values.map(value => <article className={`metric-card ${value.tone ? `metric-${value.tone}` : ''}`} key={value.label}><div className="metric-card-heading"><span>{value.label}</span><b aria-hidden="true">•</b></div><strong>{value.value}</strong></article>)}</div>
}

function OverviewBars({ trend }: { trend: RecordValue[] }) {
  const costs = trend.map(item => Number(item.totalCostMicrosCny) || 0)
  const calls = trend.map(item => Number(item.calls) || 0)
  const maxCost = Math.max(...costs, 1)
  const maxCalls = Math.max(...calls, 1)
  return <div className="overview-bars" aria-label={t.modelUsageAndCost}>{trend.length ? trend.map((item, index) => <div className="overview-bar" key={text(item.day) || String(index)}><div className="overview-bar-track"><i style={{ height: `${Math.max(8, costs[index] / maxCost * 100)}%` }} /><em style={{ height: `${Math.max(4, calls[index] / maxCalls * 42)}%` }} /></div><small>{text(item.day).slice(5)}</small></div>) : <p className="muted">{t.noData}</p>}</div>
}

function PageFrame({ title, breadcrumbTitle, breadcrumb, description, eyebrow, actions, className, children }: { title: string
  breadcrumbTitle?: string
  breadcrumb?: ReactNode
  description?: string
  eyebrow?: string
  actions?: ReactNode
  className?: string
  children: ReactNode }) {
  return <><header className={[title === t.overviewTitle ? 'overview-header' : title === t.systemHealthPageTitle ? 'health-header' : '', className ?? ''].filter(Boolean).join(' ')}><div className="page-heading"><div className="breadcrumb">{breadcrumb ?? <><span>{eyebrow ?? t.platformManagement}</span><b>›</b><strong>{breadcrumbTitle ?? title}</strong></>}</div><h1>{title}</h1>{description ? <p className="page-description">{description}</p> : null}</div><div className="header-actions">{actions}</div></header>{children}</>
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

function SyncTabs({ area }: { area: string }) {
  const tabs = [
    ['sync/scripts', t.syncTabScripts],
    ['sync/runs', t.syncTabTasks],
    ['sync/diffs', t.syncTabDiffs],
    ['sync/history', t.syncTabHistory],
  ] as const
  return <div className="sync-tabs" role="tablist">{tabs.map(([key, label]) => <a className={area === key ? 'selected' : ''} href={`/${key}`} key={key}>{label}</a>)}</div>
}

function SyncMetric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const icon = label === t.syncMetricWebhooks ? '⌁' : label === t.syncMetricRunning ? '↻' : label === t.syncMetricRetries ? '↩' : '◫'
  return <article className={`sync-metric ${tone ? `sync-metric-${tone}` : ''}`}><span className="sync-metric-icon" aria-hidden="true">{icon}</span><div><span>{label}</span><strong>{value}</strong></div></article>
}

function SyncResourcePage({ area }: { area: string }) {
  const orgs = useData('/v1/platform/organizations/tree?all=true')
  const organizationId = text(rows(orgs.value)[0]?.id)
  const base = organizationId ? `/v1/organizations/${organizationId}` : ''
  const scripts = useData(base ? `${base}/sync-scripts` : null)
  const runs = useData(base ? `${base}/sync-runs` : null)
  const diffs = useData(base ? `${base}/sync-diffs` : null)
  const rollbacks = useData(base ? `${base}/sync-rollbacks` : null)
  const scriptRows = rows(scripts.value)
  const runRows = rows(runs.value)
  const diffRows = rows(diffs.value)
  const rollbackRows = rows(rollbacks.value)
  const [selectedScriptId, setSelectedScriptId] = useState('')
  const [selectedRunId, setSelectedRunId] = useState('')
  const [selectedDiffId, setSelectedDiffId] = useState('')
  const [selectedRollbackId, setSelectedRollbackId] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [manageScriptId, setManageScriptId] = useState('')
  const [deleteScriptPending, setDeleteScriptPending] = useState(false)
  const [previewScript, setPreviewScript] = useState<RecordValue | null>(null)
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const selectedScript = scriptRows.find(item => text(item.id) === selectedScriptId) ?? scriptRows[0]
  const selectedRun = runRows.find(item => text(item.id) === selectedRunId) ?? runRows[0]
  const selectedDiff = diffRows.find(item => text(item.id) === selectedDiffId) ?? diffRows[0]
  const selectedRollback = rollbackRows.find(item => text(item.id) === selectedRollbackId) ?? rollbackRows[0]
  const managedScript = scriptRows.find(item => text(item.id) === manageScriptId) ?? null
  const selectedScriptLastRun = runRows.find(item => text(item.scriptId) === text(selectedScript?.id))
  useEffect(() => { setSelectedScriptId(text(scriptRows[0]?.id)); setSource(text(scriptRows[0]?.source)) }, [scripts.value])
  useEffect(() => { if (selectedScript) setSource(text(selectedScript.source)) }, [selectedScriptId])
  const reload = async () => { await Promise.all([scripts.reload(), runs.reload(), diffs.reload(), rollbacks.reload()]) }
  async function mutate(path: string, method: string, body?: unknown) {
    setBusy(true); setNotice('')
    try { await request(path, method, body); setNotice(t.success)
      await reload() } catch (error) { setNotice(error instanceof Error ? error.message : t.error) } finally { setBusy(false) }
  }
  async function saveScript() {
    if (!selectedScript) return
    await mutate(`${base}/sync-scripts/${text(selectedScript.id)}`, 'PATCH', { name: text(selectedScript.name), source })
  }
  async function submitManagedScript(value: SyncScriptValues) {
    setBusy(true); setNotice('')
    try {
      if (manageScriptId) await request(`${base}/sync-scripts/${manageScriptId}`, 'PATCH', { name: value.name, source: value.source })
      else await request(`${base}/sync-scripts`, 'POST', { name: value.name, source: value.source })
      setModalOpen(false); setNotice(t.success); await reload()
    } catch (error) { setNotice(error instanceof Error ? error.message : t.error) } finally { setBusy(false) }
  }
  async function deleteManagedScript() {
    if (!manageScriptId) return
    setBusy(true); setNotice('')
    try { await request(`${base}/sync-scripts/${manageScriptId}`, 'DELETE'); setDeleteScriptPending(false); setModalOpen(false); setManageScriptId(''); setNotice(t.syncTriggerDeleted); await reload() }
    catch (error) { setNotice(error instanceof Error ? error.message : t.error) } finally { setBusy(false) }
  }
  const pendingDiffs = diffRows.filter(item => text(item.status) === 'pending')
  const runningRuns = runRows.filter(item => /queued|running|preview/.test(text(item.status))).length
  const failedRuns = runRows.filter(item => text(item.status) === 'failed').length
  const created = diffRows.filter(item => /create/.test(text(item.changeType))).length
  const updated = diffRows.filter(item => /update/.test(text(item.changeType))).length
  const disabled = diffRows.filter(item => /disable|delete/.test(text(item.changeType))).length
  const conflicts = diffRows.filter(item => text(item.status) === 'conflict').length
  const completedRuns = runRows.filter(item => /completed|success/.test(text(item.status))).length
  const successRate = runRows.length ? `${Math.round(completedRuns / runRows.length * 100)}%` : '—'
  const scriptName = text(selectedScript?.name) || '—'
  const actionButtons = area === 'sync/scripts'
    ? <><button className="secondary-button" disabled={!selectedScript || busy} onClick={() => setPreviewScript(selectedScript ?? null)}>↓ {t.syncRunTest}</button><button className="primary" onClick={() => { if (selectedScript) void saveScript(); else { setManageScriptId(''); setModalOpen(true) } }} disabled={busy}>{selectedScript ? t.syncSaveDraft : `＋ ${t.createSyncTrigger}`}</button></>
    : area === 'sync/runs' ? <><button className="primary" onClick={() => { setManageScriptId(''); setModalOpen(true) }}>＋ {t.createSyncTrigger}</button><button className="secondary-button" onClick={() => void reload()}>{t.refresh}</button></> : <button className="secondary-button" onClick={() => void reload()}>{t.refresh}</button>
  return <PageFrame className={area === 'sync/scripts' ? 'sync-reference-header' : undefined} title={t.syncPageTitle} eyebrow={t.syncScripts} breadcrumbTitle={area === 'sync/scripts' ? scriptName : t.syncPageTitle} breadcrumb={area === 'sync/scripts' ? <><span>目录同步</span><b>/</b><span>脚本</span><b>/</b><strong>{scriptName}</strong></> : undefined} description={area === 'sync/runs' ? t.syncTasksDescription : area === 'sync/scripts' ? undefined : t.syncScriptsDescription} actions={<span className="toolbar-actions">{actionButtons}</span>}><div className={`sync-page ${area === 'sync/scripts' ? 'sync-reference-page' : ''}`}><SyncTabs area={area} />{notice ? <p className="operation-notice" role="status">{notice}</p> : null}{scripts.error || runs.error || diffs.error || rollbacks.error ? <p className="error" role="alert">{scripts.error || runs.error || diffs.error || rollbacks.error}</p> : null}
    {area === 'sync/scripts' ? <>
      <div className="sync-script-layout"><section className="card sync-editor-card"><div className="sync-reference-script-heading"><div><div className="sync-reference-title-row"><h1>{scriptName}</h1>{selectedScript ? status(selectedScript.status) : null}</div><p>{text(selectedScript?.description) || t.syncScriptsDescription}</p></div><div className="sync-reference-meta"><span><small>{t.syncLastSaved}</small><strong>{text(selectedScript?.updatedAt || selectedScript?.createdAt) || '—'}</strong></span><span><small>{t.syncCurrentVersion}</small><strong>{text(selectedScript?.version) ? `v${text(selectedScript?.version)}` : '—'}</strong></span><span><small>{t.syncTriggerMode}</small><strong>{selectedScript ? t.syncManualTrigger : '—'}</strong></span></div></div><div className="sync-editor-shell"><div className="sync-editor-toolbar"><strong>{scriptName}</strong><span>{selectedScript ? t.scriptSource : t.noData}</span></div><textarea className="sync-code-editor" aria-label={t.scriptSource} value={source} onChange={event => setSource(event.target.value)} placeholder={t.scriptSource} /><div className="sync-editor-status"><span>{selectedScript ? `✓ ${t.success}` : '—'}</span><span>{selectedScript ? `${t.syncCurrentVersion} ${text(selectedScript.version) || '—'}` : '—'}</span></div></div><div className="sync-editor-footer"><span className="muted">{t.syncScriptFlow}</span><button className="primary" disabled={!selectedScript || busy} onClick={() => void saveScript()}>{t.syncSaveDraft}</button></div></section><aside className="sync-side-stack"><section className="card sync-side-card sync-diff-card"><div className="sync-card-heading"><h2>{t.syncTestDiff}</h2><span className="sync-run-id">{text(selectedDiff?.runId) || '—'}</span></div><div className="sync-diff-metrics"><span><strong className="tone-green">{created}</strong><small>{t.syncMetricNewMembers}</small></span><span><strong className="tone-blue">{updated}</strong><small>{t.syncMetricUpdatedMembers}</small></span><span><strong className="tone-orange">{disabled}</strong><small>{t.syncMetricDisabledMembers}</small></span><span><strong className="tone-red">{conflicts}</strong><small>{t.syncMetricConflicts}</small></span></div><div className="sync-diff-list">{pendingDiffs.slice(0, 4).map(item => <div className="sync-mini-row" key={text(item.id)}><span>{text(item.entityType) || '—'}</span><strong>{text(item.externalId) || '—'}</strong>{status(item.changeType)}</div>)}{!pendingDiffs.length ? <p className="muted">{t.noData}</p> : null}</div></section><section className="card sync-side-card sync-runs-card"><div className="sync-card-heading"><h2>{t.syncRecentRuns}</h2>{runRows.length ? <a href="/sync/runs">{t.viewAll}</a> : <span className="sync-count">0</span>}</div>{runRows.slice(0, 4).map(item => <button className="sync-mini-row sync-mini-button" key={text(item.id)} onClick={() => { setSelectedRunId(text(item.id)); window.location.assign('/sync/runs') }}><span><strong>{text(item.trigger) || t.syncManualTrigger}</strong><small>{text(item.error) || (text(item.status) || '—')}</small></span><strong>{text(item.createdAt) || '—'}</strong></button>)}{!runRows.length ? <p className="muted">{t.noData}</p> : null}{selectedRollback ? <div className="sync-rollback-row"><span>{text(selectedRollback.version) || '—'}</span><button type="button" onClick={() => void mutate(`${base}/sync-rollbacks/${text(selectedRollback.id)}`, 'POST')}>{t.restore}</button></div> : null}</section></aside></div>
      <SyncScriptModal open={modalOpen} busy={busy} onClose={() => setModalOpen(false)} onSubmit={async (value) => { setBusy(true); try { const createdScript = first(await request(`${base}/sync-scripts`, 'POST', { name: value.name, source: value.source })); const id = text(createdScript?.id); if (id) await request(`${base}/sync-scripts/${id}/test`, 'POST', JSON.parse(value.input) as Record<string, unknown>); setModalOpen(false); setNotice(t.syncPreviewReady); await reload() } catch (error) { setNotice(error instanceof Error ? error.message : t.error) } finally { setBusy(false) } }} /><SyncPreviewModal open={previewScript !== null} scriptName={text(previewScript?.name)} busy={busy} onClose={() => setPreviewScript(null)} onSubmit={async (input) => { if (previewScript) await mutate(`${base}/sync-scripts/${text(previewScript.id)}/test`, 'POST', JSON.parse(input) as Record<string, unknown>); setPreviewScript(null) }} />
    </> : area === 'sync/runs' ? <>
      <div className="sync-metrics"><SyncMetric label={t.syncMetricSchedules} value={String(scriptRows.length)} /><SyncMetric label={t.syncMetricWebhooks} value={String(scriptRows.filter(item => /webhook/i.test(text(item.name))).length)} /><SyncMetric label={t.syncMetricRunning} value={String(runningRuns)} tone="success" /><SyncMetric label={t.syncMetricRetries} value={String(failedRuns)} tone="danger" /></div><div className="sync-workspace"><section className="card sync-table-card"><div className="sync-card-heading"><div><h2>{t.syncTriggerList}</h2><p className="muted">{t.syncRunsDescription}</p></div><span className="sync-count">{scriptRows.length}</span></div><div className="sync-record-list">{scriptRows.map((item) => { const lastRun = runRows.find(run => text(run.scriptId) === text(item.id)); return <button className={`sync-record ${text(item.id) === text(selectedScript?.id) ? 'selected' : ''}`} key={text(item.id)} onClick={() => setSelectedScriptId(text(item.id))}><span><strong>{text(item.name)}</strong><small>{t.syncManualTrigger} · {text(lastRun?.createdAt) || '—'}</small></span><span>{t.syncManualTrigger}</span>{status(item.status)}</button> })}{!scriptRows.length ? <div className="empty-state compact"><strong>{t.noData}</strong></div> : null}</div></section><aside className="card sync-detail-card"><div className="sync-card-heading"><h2>{t.syncWebhookDetails}</h2>{selectedScript ? status(selectedScript.status) : null}</div><dl className="detail-list"><div><dt>{t.name}</dt><dd>{scriptName}</dd></div><div><dt>{t.syncTriggerMode}</dt><dd>{selectedScript ? t.syncManualTrigger : '—'}</dd></div><div><dt>{t.status}</dt><dd>{selectedScript ? status(selectedScript.status) : status(undefined)}</dd></div><div><dt>{t.createdAt}</dt><dd>{text(selectedScript?.createdAt) || '—'}</dd></div><div><dt>{t.error}</dt><dd>{text(selectedScriptLastRun?.error) || '—'}</dd></div></dl><div className="sync-detail-actions">{selectedScript ? <><button className="primary" disabled={busy} onClick={() => { setManageScriptId(text(selectedScript.id)); setModalOpen(true) }}>{t.manageSyncTriggers}</button><button className="secondary-button" disabled={busy} onClick={() => setPreviewScript(selectedScript)}>{t.syncRunTest}</button></> : null}</div></aside></div><SyncScriptModal open={modalOpen} busy={busy} script={managedScript} onClose={() => setModalOpen(false)} onSubmit={value => void submitManagedScript(value)} onDelete={() => setDeleteScriptPending(true)} /><SyncPreviewModal open={previewScript !== null} scriptName={text(previewScript?.name)} busy={busy} onClose={() => setPreviewScript(null)} onSubmit={async (input) => { if (previewScript) await mutate(`${base}/sync-scripts/${text(previewScript.id)}/test`, 'POST', JSON.parse(input) as Record<string, unknown>); setPreviewScript(null) }} /><ConfirmModal open={deleteScriptPending} title={t.deleteSyncTrigger} description={t.deleteSyncTriggerDescription} busy={busy} onClose={() => setDeleteScriptPending(false)} onConfirm={() => void deleteManagedScript()} />
    </> : area === 'sync/diffs' ? <>
      <div className="sync-metrics"><SyncMetric label={t.syncMetricNewMembers} value={String(created)} /><SyncMetric label={t.syncMetricUpdatedMembers} value={String(updated)} /><SyncMetric label={t.syncMetricDisabledMembers} value={String(disabled)} tone="warning" /><SyncMetric label={t.syncMetricConflicts} value={String(conflicts)} tone="danger" /></div><div className="sync-workspace"><section className="card sync-table-card"><div className="sync-card-heading"><div><h2>{t.syncChanges}</h2><p className="muted">{t.syncDiffsDescription}</p></div><button className="primary" disabled={!pendingDiffs.length || busy} onClick={() => void mutate(`${base}/sync-diffs/bulk`, 'POST', { runId: text(pendingDiffs[0]?.runId), decision: 'approved', limit: 1000 })}>{t.approveBatch}</button></div><div className="sync-record-list">{diffRows.map(item => <button className={`sync-record ${text(item.id) === text(selectedDiff?.id) ? 'selected' : ''}`} key={text(item.id)} onClick={() => setSelectedDiffId(text(item.id))}><span><strong>{text(item.entityType)} / {text(item.externalId)}</strong><small>{text(item.createdAt) || '—'}</small></span><span>{text(item.changeType)}</span>{status(item.status)}</button>)}{!diffRows.length ? <div className="empty-state compact"><strong>{t.noData}</strong></div> : null}</div></section><aside className="card sync-detail-card"><h2>{t.syncBatchDetails}</h2><dl className="detail-list"><div><dt>{t.runPreview}</dt><dd>{text(selectedDiff?.runId) || '—'}</dd></div><div><dt>{t.name}</dt><dd>{scriptName}</dd></div><div><dt>{t.changeType}</dt><dd>{text(selectedDiff?.changeType) || '—'}</dd></div><div><dt>{t.status}</dt><dd>{status(selectedDiff?.status)}</dd></div></dl><div className="sync-detail-actions">{selectedDiff && text(selectedDiff.status) === 'pending' ? <><button className="primary" disabled={busy} onClick={() => void mutate(`${base}/sync-diffs/${text(selectedDiff.id)}`, 'PATCH', { decision: 'approved', version: Number(selectedDiff.version) })}>{t.approve}</button><button className="secondary-button" disabled={busy} onClick={() => void mutate(`${base}/sync-diffs/${text(selectedDiff.id)}`, 'PATCH', { decision: 'rejected', version: Number(selectedDiff.version) })}>{t.reject}</button></> : null}</div></aside></div>
    </> : <>
      <div className="sync-metrics"><SyncMetric label={t.syncMetricRuns} value={String(runRows.length)} /><SyncMetric label={t.syncMetricSuccessRate} value={successRate} tone="success" /><SyncMetric label={t.syncMetricPartialFailures} value={String(failedRuns)} tone="warning" /><SyncMetric label={t.syncMetricRollbackVersions} value={String(rollbackRows.length)} /></div><div className="sync-workspace"><section className="card sync-table-card"><div className="sync-card-heading"><div><h2>{t.syncRunRecords}</h2><p className="muted">{t.syncHistoryDescription}</p></div></div><div className="sync-record-list">{runRows.map(item => <button className={`sync-record ${text(item.id) === text(selectedRun?.id) ? 'selected' : ''}`} key={text(item.id)} onClick={() => setSelectedRunId(text(item.id))}><span><strong>{text(item.trigger) || t.syncManualTrigger}</strong><small>{text(item.createdAt) || '—'}</small></span><span>{text(item.id).slice(0, 8)}</span>{status(item.status)}</button>)}{!runRows.length ? <div className="empty-state compact"><strong>{t.noData}</strong></div> : null}</div></section><aside className="card sync-detail-card"><h2>{t.syncRunDetails}</h2><dl className="detail-list"><div><dt>{t.name}</dt><dd>{scriptName}</dd></div><div><dt>{t.status}</dt><dd>{status(selectedRun?.status)}</dd></div><div><dt>{t.createdAt}</dt><dd>{text(selectedRun?.createdAt) || '—'}</dd></div><div><dt>{t.error}</dt><dd>{text(selectedRun?.error) || '—'}</dd></div></dl>{selectedRun && text(selectedRun.status) !== 'failed' ? <button className="primary" disabled={busy} onClick={() => void mutate(`${base}/sync-runs/${text(selectedRun.id)}/rollback`, 'POST')}>{t.restore}</button> : null}{selectedRollback ? <p className="muted sync-rollback-note">{t.restore}: {text(selectedRollback.status)}</p> : null}</aside></div>
    </>}</div></PageFrame>
}

function PluginReviewPage() {
  const data = useData('/v1/platform/plugins')
  const releases = rows(data.value)
  const pending = releases.filter(item => text(item.status) === 'awaiting_platform_review')
  const highRisk = releases.filter(item => /reject|review/.test(text(item.status))).length
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
    await request(`/v1/platform/plugins/${text(item.id)}/approve`, 'POST', { digest: text(item.digest) })
    data.reload()
  }
  async function reject(item: RecordValue) {
    await request(`/v1/platform/plugins/${text(item.id)}/reject`, 'POST', { reason: '平台审核未通过' })
    data.reload()
  }
  return <PageFrame title={t.pluginReview} breadcrumbTitle={t.plugins} description={t.pluginReviewDescription} actions={<button className="primary" onClick={() => document.getElementById('platform-plugin-upload')?.scrollIntoView({ behavior: 'smooth' })}>＋ {t.uploadPlugin}</button>}><div className="plugin-review-tabs"><a className="selected" href="/platform/plugins">{t.pluginReview}</a><a href="/platform/plugins?view=versions">{t.pluginVersionsTab}</a><a href="/platform/plugins?view=devices">{t.deviceAuthorizationTab}</a></div><MetricStrip values={[{ label: t.pendingReview, value: String(pending.length), tone: 'warning' }, { label: t.highRiskFindings, value: String(highRisk), tone: 'warning' }, { label: t.publishedThisMonth, value: String(releases.filter(item => text(item.status) === 'published').length), tone: 'success' }, { label: t.deviceAuthorizations, value: '—' }]} />{notice ? <p className="operation-notice" role="status" style={{ whiteSpace: 'pre-line' }}>{notice}</p> : null}<div className="plugin-review-layout"><section className="card plugin-release-card"><div className="card-heading"><h2>{t.pluginVersions}</h2><input aria-label={t.searchPluginPlaceholder} placeholder={t.searchPluginPlaceholder} value={pluginSearch} onChange={event => setPluginSearch(event.target.value)} /></div><DataTable data={filteredReleases} columns={[{ key: 'pluginId', label: t.pluginId }, { key: 'version', label: t.pluginVersion }, { key: 'visibility', label: t.visibility }, { key: 'status', label: t.status }, { key: 'createdAt', label: t.createdAt }]} actions={item => text(item.status) === 'awaiting_platform_review' ? <><button className="table-action" onClick={() => void approve(item)}>{t.approve}</button><button className="table-action danger" onClick={() => void reject(item)}>{t.reject}</button></> : null} /></section><section className="card plugin-upload-card"><h2>{t.uploadPlugin}</h2><p className="muted">{t.marketplaceOnlyDescription}</p><form id="platform-plugin-upload" onSubmit={upload}><label>{t.pluginPackage}<input name="package" type="file" accept=".dsh-plugin.zip" multiple required /></label><button className="primary" disabled={uploading}>{uploading ? t.loading : t.uploadAndPublishPlugin}</button></form></section></div></PageFrame>
}

const navigation = [
  { label: 'overviewGroup', items: [['overview', '/overview'], ['usage', '/platform/usage'], ['globalAudit', '/permissions/audit']] },
  { label: 'identityGroup', items: [['organizationDirectory', '/organizations/directory'], ['syncScripts', '/sync/scripts']] },
  { label: 'governanceGroup', items: [['permissionsGovernance', '/permissions/catalog']] },
  { label: 'runtimeGroup', items: [['modelRuntime', '/models/catalog'], ['plugins', '/platform/plugins'], ['platformSettingsNav', '/platform/settings']] },
] as const

function routeFromSegments(segments: string[]): Route {
  if (!segments.length) return { area: 'overview' }
  if (segments[0] === 'organizations') {
    if (segments[1] === 'members') return { area: 'organizations/members', id: segments[2] }
    if (segments[1] === 'directory' && segments[2] === 'members') return { area: 'organizations/members', sub: 'members' }
    return { area: 'organizations/directory', id: segments[2], sub: segments[2] === 'structure' ? 'structure' : undefined }
  }
  if (segments[0] === 'accounts') return { area: 'organizations/directory', id: segments[1], sub: segments[1] ? 'account' : 'accounts' }
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
  return <PageFrame title={t.overviewTitle} breadcrumbTitle={t.overview} description={t.overviewDescription}>
    <div className="overview-page"><div className="overview-tabs" role="tablist"><a className="selected" href="/overview">{t.overview}</a><a href="/platform/health">{t.systemHealth}</a></div><div className="overview-intro"><div><h1>{t.overviewTitle}</h1><p>{t.overviewDescription}</p></div><button className="secondary-button" onClick={data.reload}>▣ {t.last30Days}</button></div>
      {data.error ? <p className="error" role="alert">{data.error}</p> : null}
      <MetricStrip values={[{ label: t.organizationCount, value: Number(metrics.organizations || 0).toLocaleString('zh-CN') }, { label: t.memberCount, value: Number(metrics.members || 0).toLocaleString('zh-CN') }, { label: t.onlineRuntimes, value: Number(metrics.runtimes || 0).toLocaleString('zh-CN'), tone: 'success' }, { label: t.monthlyCost, value: `¥ ${((Number(metrics.totalCostMicrosCny) || 0) / 1_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }]} />
      <div className="overview-grid overview-grid-main"><section className="card chart-card"><div className="card-heading"><div><h2>{t.modelUsageAndCost}</h2><p className="muted">{Number(metrics.totalTokens || 0).toLocaleString('zh-CN')} {t.tokenUnit} · ¥ {((Number(metrics.totalCostMicrosCny) || 0) / 1_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div><a className="text-button" href="/platform/usage">{t.viewDetails}</a></div><OverviewBars trend={rows(snapshot?.trend)} /></section><section className="card pending-card"><div className="card-heading"><h2>{t.pendingItems}</h2><a className="text-button" href="/sync/diffs">{t.viewAll}</a></div><div className="pending-list">{pending.map(item => <div className="pending-item" key={text(item.id)}><span className={`status-dot ${statusTone(item.status)}`} /><span>{text(item.kind) === 'directory-sync' ? t.directorySync : text(item.kind) === 'plugin-review' ? t.pluginReview : text(item.kind)}</span><strong>{text(item.count) || '0'}</strong></div>)}</div></section></div>
      <div className="overview-grid overview-grid-bottom"><section className="card health-card"><div className="card-heading"><h2>{t.systemHealth}</h2><a className="text-button" href="/platform/health">{t.viewDetails}</a></div><div className="health-list">{health.map(item => <div className="health-row" key={text(item.id)}><span><i className={`status-dot ${statusTone(item.status)}`} />{text(item.label)}</span><strong>{item.availability == null ? (text(item.status) === 'ready' ? t.runningNormally : t.monitoringUnavailable) : `${Number(item.availability).toFixed(2)}%`}</strong></div>)}</div></section><section className="card audit-card"><div className="card-heading"><h2>{t.recentAudit}</h2><a className="text-button" href="/permissions/audit">{t.viewAll}</a></div><div className="audit-list">{audit.map(item => <div className="audit-row" key={text(item.id)}><strong>{text(item.action)}</strong><span>{text(item.resourceId) || '—'}</span><small>{text(item.createdAt) ? new Date(text(item.createdAt)).toLocaleString('zh-CN') : '—'}</small></div>)}</div></section></div></div>
  </PageFrame>
}

function DirectoryMetrics({ values }: { values: Array<{ label: string; value: string; tone?: 'blue' | 'red' | 'green' }> }) {
  return <div className={`directory-metrics ${values.length === 5 ? 'five' : ''}`}>{values.map((value, index) => <article className={`directory-metric ${value.tone ? `tone-${value.tone}` : ''}`} key={value.label}><span className="directory-metric-icon" aria-hidden="true">{['⌘', '♧', '⌁', '△'][index % 4]}</span><div><strong>{value.value}</strong><small>{value.label}</small></div></article>)}</div>
}

function DirectoryTabs({ active }: { active: string }) {
  const tabs = [['directory', '/organizations/directory', t.organizationDirectory], ['structure', '/organizations/directory/structure', '部门结构'], ['member', '/organizations/directory/members', t.memberDetail], ['account', '/accounts', '账号详情']] as const
  return <div className="directory-tabs" role="tablist">{tabs.map(([key, href, label]) => <a className={active === key ? 'selected' : ''} href={href} key={key}>{label}</a>)}</div>
}

function DirectoryTable({ columns, data, onSelect }: { columns: Array<{ key: string; label: string; className?: string }>
  data: RecordValue[]
  onSelect?: (item: RecordValue) => void }) {
  return <div className="directory-table-scroll"><table className="directory-table"><thead><tr>{columns.map(column => <th className={column.className} key={column.key}>{column.label}</th>)}</tr></thead><tbody>{data.map((item, index) => <tr className={onSelect ? 'directory-row-clickable' : ''} key={text(item.id) || String(index)} onClick={() => onSelect?.(item)}>{columns.map(column => <td className={column.className} key={column.key}>{column.key === 'status' ? status(item[column.key]) : text(item[column.key]) || '—'}</td>)}</tr>)}</tbody></table>{!data.length ? <div className="directory-empty">{t.noData}</div> : null}</div>
}

function DirectoryTree({ nodes, selectedId, onSelect }: { nodes: RecordValue[]
  selectedId: string
  onSelect: (item: RecordValue) => void }) {
  const [loadedChildren, setLoadedChildren] = useState<Record<string, RecordValue[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const allNodes = useMemo(() => nodes.concat(...Object.values(loadedChildren)).filter((item, index,
    list) => list.findIndex(other => text(other.id) === text(item.id)) === index), [nodes, loadedChildren])
  const roots = allNodes.filter(node => !text(node.parentId) || text(node.parentId) === 'null')
  const children = (parentId: string) => allNodes.filter(node => text(node.parentId) === parentId)
  const toggle = async (node: RecordValue) => {
    const id = text(node.id)
    if (expanded.has(id)) { setExpanded((current) => { const next = new Set(current); next.delete(id); return next }); return }
    if (!loadedChildren[id]) {
      setLoadingIds(current => new Set(current).add(id))
      try { const children = rows(await request(`/v1/platform/organizations/tree?parentId=${encodeURIComponent(id)}`)); setLoadedChildren(current => ({ ...current, [id]: children })) }
      finally { setLoadingIds((current) => { const next = new Set(current); next.delete(id); return next }) }
    }
    setExpanded(current => new Set(current).add(id))
  }
  return <div className="directory-tree">{roots.map(root => <DirectoryTreeNode key={text(root.id)} node={root} depth={0} selectedId={selectedId} expanded={expanded} loadingIds={loadingIds} childrenOf={children} onToggle={toggle} onSelect={onSelect} />)}</div>
}

function DirectoryTreeNode({ node, depth, selectedId, expanded, loadingIds, childrenOf, onToggle, onSelect }: { node: RecordValue
  depth: number
  selectedId: string
  expanded: Set<string>
  loadingIds: Set<string>
  childrenOf: (id: string) => RecordValue[]
  onToggle: (item: RecordValue) => void
  onSelect: (item: RecordValue) => void }) {
  const id = text(node.id)
  const childRows = childrenOf(text(node.id))
  const canExpand = Boolean(node.hasChildren) || childRows.length > 0
  const isExpanded = expanded.has(id)
  return <div className="directory-tree-node"><div className={`directory-tree-item ${selectedId === id ? 'selected' : ''}`} style={{ paddingLeft: `${8 + depth * 22}px` }}><button type="button" className="directory-tree-toggle" disabled={!canExpand || loadingIds.has(id)} onClick={() => onToggle(node)} aria-label={isExpanded ? '收起下级组织' : '加载下级组织'}>{loadingIds.has(id) ? '…' : isExpanded ? '⌄' : '›'}</button><button type="button" className="directory-tree-select" onClick={() => onSelect(node)}><span className="directory-tree-icon">{text(node.kind) === 'team' ? '♙' : '▦'}</span><strong>{text(node.name)}</strong><small>{text(node.memberCount) || '0'} / {text(node.childCount) || '0'}</small></button></div>{isExpanded ? childRows.map(child => <DirectoryTreeNode key={text(child.id)} node={child} depth={depth + 1} selectedId={selectedId} expanded={expanded} loadingIds={loadingIds} childrenOf={childrenOf} onToggle={onToggle} onSelect={onSelect} />) : null}</div>
}

function ReferenceOrganizationPage({ route }: { route: Route }) {
  const organizations = useData(route.sub === 'structure' ? '/v1/platform/organizations/tree?all=true' : '/v1/platform/organizations/tree?parentId=null')
  const overview = useData('/v1/platform/organizations/overview')
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all')
  const [notice, setNotice] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [createModal, setCreateModal] = useState<'organization' | 'account' | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [accountModal, setAccountModal] = useState<'edit' | 'password' | null>(null)
  const [accountBusy, setAccountBusy] = useState(false)
  const rootNodes = rows(organizations.value)
  const allNodes = useMemo(() => rootNodes.filter((node) => {
    const query = search.trim().toLowerCase()
    const matchesSearch = !query || [text(node.name), text(node.displayPath),
      text(node.email)].some(value => value.toLowerCase().includes(query))
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? text(node.status) === 'active' : text(node.status) !== 'active')
    return matchesSearch && matchesStatus
  }), [organizations.value, search, statusFilter])
  const root = allNodes.find(node => !text(node.parentId)) ?? allNodes[0]
  const [selectedId, setSelectedId] = useState(route.area === 'organizations/directory' && route.id && route.sub !== 'structure' ? route.id : text(root?.id))
  const [accountSelectionId, setAccountSelectionId] = useState(route.sub === 'account' ? text(route.id) : '')
  const [selectedNode, setSelectedNode] = useState<RecordValue | null>(null)
  useEffect(() => {
    if (!selectedId && root) setSelectedId(text(root.id))
  }, [selectedId, root])
  useEffect(() => { if (route.area === 'organizations/members') { const organizationId = new URLSearchParams(window.location.search).get('organizationId'); if (organizationId) setSelectedId(organizationId) } }, [route.area])
  useEffect(() => { setAccountSelectionId(route.sub === 'account' ? text(route.id) : '') }, [route.sub, route.id])
  const selected = selectedNode && text(selectedNode.id) === selectedId
    ? selectedNode
    : allNodes.find(node => text(node.id) === selectedId) ?? root
  const selectedNodeId = route.sub === 'account' || route.sub === 'accounts' ? '' : selectedId || text(selected?.id)
  const inviteOrganizationId = text(selected?.nodeType) === 'unit' ? text(selected?.rootId) : selectedNodeId
  const inviteUnitId = text(selected?.nodeType) === 'unit' ? selectedNodeId : ''
  const membersData = useData(selectedNodeId ? `/v1/platform/organization-nodes/${encodeURIComponent(selectedNodeId)}/members` : null)
  const accountsData = useData('/v1/platform/accounts?limit=200')
  const accountId = route.sub === 'account' ? route.id : accountSelectionId || undefined
  const accountDetail = useData(accountId ? `/v1/platform/accounts/${accountId}/organizations` : null)
  const accountRuntimes = useData(accountId ? `/v1/platform/accounts/${encodeURIComponent(accountId)}/runtimes` : null)
  const accountSessions = useData(accountId ? `/v1/platform/accounts/${encodeURIComponent(accountId)}/sessions` : null)
  const accountUsage = useData(accountId ? `/v1/platform/accounts/${encodeURIComponent(accountId)}/usage` : null)
  const accountHistory = useData(accountId ? `/v1/platform/accounts/${encodeURIComponent(accountId)}/history` : null)
  const selectedNodePayload = first(membersData.value)
  const memberRows = rows(selectedNodePayload?.members)
  const roleRows = rows(selectedNodePayload?.roles)
  const selectedRuntimeCount = selectedNodePayload?.runtimeCount
  const roleByMembership = new Map(roleRows.map(role => [text(role.membershipId), text(role.role)]))
  const accountRows = rows(accountsData.value)
  const accountRecord = first(accountDetail.value)
  const accountSummary = accountRows.find(item => text(item.id) === accountId)
  const accountBase = first(accountRecord?.account)
  const account = accountBase ? { ...accountBase, ...accountSummary } : accountSummary ?? null
  const accountMembershipRows = rows(accountRecord?.memberships)
  const accountRoleRows = rows(accountRecord?.roles)
  const accountRuntimeRows = rows(accountRuntimes.value)
  const accountSessionRows = rows(accountSessions.value)
  const accountUsageRows = rows(accountUsage.value)
  const accountHistoryRecord = first(accountHistory.value)
  const accountAuditRows = rows(accountHistoryRecord?.events)
  const accountUsageByOrganization = new Map<string, number>()
  for (const usage of accountUsageRows) {
    const organizationId = text(usage.organizationId)
    accountUsageByOrganization.set(organizationId, (accountUsageByOrganization.get(organizationId) ?? 0) + usageCostMicros(usage))
  }
  const accountOrganizationRows = accountMembershipRows.map(item => ({
    ...item,
    role: accountRoleRows.find(role => text(role.membershipId) === text(item.id))?.role,
    usage: accountUsageByOrganization.has(text(item.organizationId)) ? `¥${((accountUsageByOrganization.get(text(item.organizationId)) ?? 0) / 1_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—',
  }))
  const accountFailureCount = accountAuditRows.filter(item => /login.*fail|fail.*login/i.test(text(item.action) + ' ' + text(item.detail))).length
  const accountLastActivity = accountAuditRows.map(item => text(item.createdAt)).filter(Boolean).sort().at(-1) ?? ''
  const accountError = accountDetail.error || accountRuntimes.error || accountSessions.error || accountUsage.error || accountHistory.error
  const accountStatusLabel = account?.emailVerified == null ? '—' : account.emailVerified === true ? '已验证' : '未验证'
  const overviewRecord = first(overview.value)
  const memberDetail = route.area === 'organizations/members'
    ? memberRows.find(item => text(item.id) === route.id)
    : undefined
  const memberAccountId = route.area === 'organizations/members' ? text(memberDetail?.accountId) : ''
  const memberAccountOrganizations = useData(memberAccountId ? `/v1/platform/accounts/${encodeURIComponent(memberAccountId)}/organizations` : null)
  const memberAccountSessions = useData(memberAccountId ? `/v1/platform/accounts/${encodeURIComponent(memberAccountId)}/sessions` : null)
  const memberAccountRuntimes = useData(memberAccountId ? `/v1/platform/accounts/${encodeURIComponent(memberAccountId)}/runtimes` : null)
  const memberAccountUsage = useData(memberAccountId ? `/v1/platform/accounts/${encodeURIComponent(memberAccountId)}/usage` : null)
  const memberAccountRecord = first(memberAccountOrganizations.value)
  const memberAccount = first(memberAccountRecord?.account)
  const memberMembershipRows = rows(memberAccountRecord?.memberships)
  const memberRoleRows = rows(memberAccountRecord?.roles)
  const memberRoleByMembership = new Map(memberRoleRows.map(role => [text(role.membershipId), text(role.role)]))
  const memberSessionRows = rows(memberAccountSessions.value)
  const memberRuntimeRows = rows(memberAccountRuntimes.value)
  const memberUsageRows = rows(memberAccountUsage.value)
  const recentUsageFrom = Date.now() - 30 * 86_400_000
  const recentMemberUsageRows = memberUsageRows.filter(item => text(item.status) === 'settled' && new Date(text(item.settledAt || item.createdAt)).getTime() >= recentUsageFrom)
  const memberUsageMicros = recentMemberUsageRows.reduce((sum, item) => sum + usageCostMicros(item), 0)
  const memberTokenCount = memberUsageRows.reduce((sum, item) => sum + (Number(item.inputTokens) || 0) + (Number(item.outputTokens) || 0),
    0)
  const memberOrganizationRows = memberMembershipRows.map(item => ({
    ...item,
    role: memberRoleByMembership.get(text(item.id)),
  }))
  const memberRole = memberRoleByMembership.get(text(memberDetail?.id))
  const memberCostLabel = recentMemberUsageRows.length ? `¥${(memberUsageMicros / 1_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
  const memberTokenLabel = memberUsageRows.length ? memberTokenCount.toLocaleString('zh-CN') : '—'
  const structureRows = allNodes.filter(node => ['department', 'team'].includes(text(node.kind)))
  const activeTab = route.sub === 'structure' ? 'structure' : route.sub === 'account' || route.sub === 'accounts' || route.area === 'accounts' ? 'account' : route.area === 'organizations/members' ? 'member' : 'directory'
  const title = activeTab === 'structure' ? '部门与组织结构' : activeTab === 'member' ? `成员详情 · ${text(memberDetail?.name) || '成员'}` : activeTab === 'account' ? '全平台账号详情' : '组织目录'
  const description = activeTab === 'structure' ? '管理部门层级、跨部门成员和继承权限' : activeTab === 'member' ? '查看组织归属、角色、有效权限、会话、设备和用量' : activeTab === 'account' ? '跨组织查看账号归属、角色、设备、会话和历史' : '管理集团、公司与团队层级，检查组织结构完整性'
  const primaryLabel = activeTab === 'structure' ? '新建部门' : activeTab === 'member' ? '调整成员' : activeTab === 'account' ? '创建账号' : '新建组织'
  const secondaryLabel = activeTab === 'structure' ? '同步结构' : activeTab === 'member' ? '查看审计' : activeTab === 'account' ? '导出账号' : '导出目录'
  const directMembers = memberRows.length
  const organizationCount = Number(overviewRecord?.organizationCount ?? allNodes.filter(node => text(node.nodeType) !== 'unit').length)
  const membersCount = Number(overviewRecord?.memberCount ?? allNodes.reduce((sum, node) => sum + Number(node.memberCount || 0), 0))
  const adminCount = Number(overviewRecord?.administratorCount ?? roleRows.filter(role => /admin|owner/i.test(text(role.role))).length)
  const selectNode = (node: RecordValue) => {
    const id = text(node.id)
    setSelectedNode(node)
    setSelectedId(id)
    if (activeTab === 'directory') window.history.replaceState(null, '', `/organizations/directory/${encodeURIComponent(id)}`)
  }
  async function submitInvite(values: Record<string, string>) {
    if (!inviteOrganizationId) return
    setInviteBusy(true)
    setNotice('')
    try {
      await request(`/v1/organizations/${encodeURIComponent(inviteOrganizationId)}/invitations`, 'POST', {
        email: values.email.trim(),
        role: values.role,
        ...(inviteUnitId ? { unitId: inviteUnitId } : {}),
      })
      setInviteOpen(false)
      setNotice('邀请已发送')
      await membersData.reload()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setInviteBusy(false)
    }
  }
  async function submitAccount(values: Record<string, string>) {
    if (!accountId) return
    setAccountBusy(true)
    setNotice('')
    try {
      if (accountModal === 'edit') {
        await request(`/v1/platform/accounts/${encodeURIComponent(accountId)}`, 'PATCH', { name: values.name.trim(), email: values.email.trim() })
      } else if (accountModal === 'password') {
        await request(`/v1/platform/accounts/${encodeURIComponent(accountId)}/password`, 'POST', { password: values.password })
      }
      setAccountModal(null)
      setNotice(accountModal === 'password' ? '密码已重置' : '账号已更新')
      await Promise.all([accountsData.reload(), accountDetail.reload()])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setAccountBusy(false)
    }
  }
  const memberTableRows = memberRows.map(item => ({ ...item, department: text(selected?.name), role: roleByMembership.get(text(item.id)) || 'member', lastActive: text(item.lastActiveAt) || '—' }))
  const filteredMemberRows = memberTableRows.filter(item => statusFilter === 'all' || (statusFilter === 'active' ? text((item as RecordValue).status) === 'active' : text((item as RecordValue).status) !== 'active'))
  const filteredAccountRows = accountRows.filter((item) => {
    const query = search.trim().toLowerCase()
    return !query || [text(item.name), text(item.email), text(item.id)].some(value => value.toLowerCase().includes(query))
  })
  const accountDirectoryRows = filteredAccountRows.map(item => ({ ...item, status: item.emailVerified === true ? 'active' : 'pending' }))
  const statusLabel = statusFilter === 'all' ? '状态：全部' : statusFilter === 'active' ? '状态：正常' : '状态：停用'
  const cycleStatusFilter = () => setStatusFilter(current => current === 'all' ? 'active' : current === 'active' ? 'disabled' : 'all')
  const parentKind = text(selected?.kind)
  const organizationKinds = parentKind === 'group' || parentKind === 'enterprise'
    ? ['company', 'department']
    : parentKind === 'company'
      ? ['department']
      : parentKind === 'department'
        ? ['department', 'team']
        : ['team']
  const exportDirectory = () => {
    const payload = activeTab === 'account' ? accountRows : activeTab === 'member' ? filteredMemberRows : activeTab === 'structure' ? structureRows : allNodes
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${activeTab}-directory.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const reloadDirectory = () => void Promise.all([organizations.reload(), overview.reload(), membersData.reload(), accountsData.reload(),
    accountDetail.reload(), accountRuntimes.reload(), accountSessions.reload(), accountUsage.reload(), accountHistory.reload(),
    memberAccountOrganizations.reload(), memberAccountSessions.reload(), memberAccountRuntimes.reload(), memberAccountUsage.reload()])
  async function submitOrganization(values: { name: string; kind: string }) {
    setCreateBusy(true)
    setNotice('')
    try {
      await request('/v1/platform/organizations', 'POST', { name: values.name.trim(), kind: values.kind, parentId: selectedNodeId || null })
      setCreateModal(null)
      setNotice('组织已创建')
      await Promise.all([organizations.reload(), overview.reload(), membersData.reload()])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setCreateBusy(false)
    }
  }
  async function submitCreatedAccount(values: { name: string; email: string; password: string; organizationNodeId: string; role: string }) {
    setCreateBusy(true)
    setNotice('')
    try {
      await request('/v1/platform/accounts', 'POST', values)
      setCreateModal(null)
      setNotice('账号已创建')
      await Promise.all([accountsData.reload(), organizations.reload(), overview.reload()])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setCreateBusy(false)
    }
  }
  const secondaryAction = () => {
    if (activeTab === 'member') { window.location.assign('/permissions/audit'); return }
    if (activeTab === 'directory' || activeTab === 'account') { exportDirectory(); return }
    reloadDirectory()
  }
  useEffect(() => {
    const handleDirectoryAction = (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target.closest('.directory-page .directory-inline-actions button') : null
      if (!target) return
      const label = target.textContent?.trim() ?? ''
      if (label.includes('筛选') || label.includes('状态：')) {
        cycleStatusFilter()
      } else if (label.includes('最近 30 天')) {
        setNotice('已刷新当前目录数据')
        reloadDirectory()
      } else if (label.includes('导出目录')) {
        exportDirectory()
      }
    }
    document.addEventListener('click', handleDirectoryAction)
    return () => document.removeEventListener('click', handleDirectoryAction)
  }, [activeTab, statusFilter])
  const errorMessage = organizations.error || overview.error || membersData.error || accountsData.error || accountError ||
    memberAccountOrganizations.error || memberAccountSessions.error || memberAccountRuntimes.error || memberAccountUsage.error
  const accountActions = activeTab === 'account' && accountId ? <><button className="directory-secondary-action" type="button" onClick={() => setAccountModal('edit')}>编辑账号</button><button className="directory-secondary-action" type="button" onClick={() => setAccountModal('password')}>重置密码</button></> : null
  const primaryAction = activeTab === 'member'
    ? <a className="directory-primary-action" href={`/organizations/directory?organizationId=${encodeURIComponent(text(selected?.id))}`}>＋ {primaryLabel}</a>
    : <button className="directory-primary-action" type="button" onClick={() => setCreateModal(activeTab === 'account' ? 'account' : 'organization')} disabled={activeTab !== 'account' && !selectedNodeId}>＋ {primaryLabel}</button>
  const header = <header className="directory-topbar"><div className="directory-breadcrumb"><strong>组织与身份</strong><span>/</span><strong>{title}</strong></div><div className="directory-top-actions">{accountActions}<button className="directory-secondary-action" type="button" onClick={secondaryAction}>⇩ {secondaryLabel}</button>{primaryAction}</div></header>
  const filters = <div className="directory-filters"><button type="button" onClick={() => setSearchOpen(current => !current)}>⌕ 搜索</button><button type="button" onClick={cycleStatusFilter}>≡ {statusFilter === 'all' ? '筛选' : statusLabel}</button><button type="button" onClick={() => { setNotice('已刷新当前目录数据'); reloadDirectory() }}>▣ 最近 30 天</button></div>
  const commonContent = (content: ReactNode) => <div className="directory-page">{header}<DirectoryTabs active={activeTab} /><main className="directory-content"><div className="directory-heading"><div><h1>{title}</h1><p>{description}</p></div>{activeTab === 'member' ? null : filters}</div>{searchOpen && activeTab !== 'member' ? <div className="directory-search directory-global-search">⌕ <input autoFocus aria-label="搜索目录" placeholder="按名称、路径或邮箱搜索" value={search} onChange={event => setSearch(event.target.value)} /></div> : null}{notice ? <p className="operation-notice" role="status">{notice}</p> : null}{errorMessage ? <p className="error" role="alert">{errorMessage}</p> : null}{content}{accountId ? <><OperationModal open={accountModal === 'edit'} title="编辑账号" fields={[{ name: 'name', label: '姓名', defaultValue: text(account?.name) }, { name: 'email', label: '邮箱', type: 'email', defaultValue: text(account?.email) }]} busy={accountBusy} onClose={() => setAccountModal(null)} onSubmit={submitAccount} /><OperationModal open={accountModal === 'password'} title="重置密码" fields={[{ name: 'password', label: '新密码', type: 'password' }]} busy={accountBusy} onClose={() => setAccountModal(null)} onSubmit={submitAccount} /></> : null}</main></div>
  if (activeTab === 'member') {
    return commonContent(<><DirectoryMetrics values={[{ label: '所属组织', value: String(memberMembershipRows.length) }, { label: '有效角色', value: String(memberRoleRows.length) }, { label: '活跃会话', value: String(memberSessionRows.length) }, { label: '本月费用', value: memberCostLabel }]} /><div className="directory-two-column directory-detail-layout"><section className="directory-panel directory-table-panel"><div className="directory-panel-header"><h2>组织与角色</h2><span>共 {memberOrganizationRows.length} 条记录</span></div><DirectoryTable data={memberOrganizationRows} columns={[{ key: 'organizationName', label: '组织' }, { key: 'role', label: '角色' }, { key: 'status', label: '状态' }, { key: 'createdAt', label: '加入时间' }]} /><div className="directory-subtable"><div className="directory-panel-header"><h2>会话记录</h2><span>共 {memberSessionRows.length} 条记录</span></div><DirectoryTable data={memberSessionRows} columns={[{ key: 'id', label: '会话' }, { key: 'organizationId', label: '组织' }, { key: 'header', label: '会话头' }, { key: 'nextSeq', label: '事件序号' }, { key: 'createdAt', label: '创建时间' }]} /></div></section><aside className="directory-panel directory-summary-panel"><h2>身份信息</h2><dl><div><dt>姓名</dt><dd>{text(memberDetail?.name) || text(memberAccount?.name) || '—'}</dd></div><div><dt>邮箱</dt><dd>{text(memberDetail?.email) || text(memberAccount?.email) || '—'}</dd></div><div><dt>账号 ID</dt><dd>{text(memberAccount?.id) || text(memberDetail?.accountId) || '—'}</dd></div><div><dt>账号状态</dt><dd>{text(memberDetail?.status) || '—'}</dd></div><div><dt>成员角色</dt><dd>{memberRole || '—'}</dd></div><div><dt>加入时间</dt><dd>{text(memberDetail?.createdAt) || '—'}</dd></div><div><dt>运行时数量</dt><dd>{memberRuntimeRows.length ? String(memberRuntimeRows.length) : '—'}</dd></div><div><dt>Token 用量</dt><dd>{memberTokenLabel}</dd></div></dl></aside></div></>)
  }
  if (activeTab === 'account') {
    if (!accountId) return commonContent(<><DirectoryMetrics values={[{ label: '账号总数', value: String(accountRows.length) }, { label: '已验证账号', value: String(accountRows.filter(item => item.emailVerified === true).length) }, { label: '关联组织', value: String(accountRows.reduce((total, item) => total + Number(item.organizationCount || 0), 0) || '—') }, { label: '最近活动', value: '—' }]} /><section className="directory-panel directory-table-panel"><div className="directory-panel-header"><h2>账号目录</h2><span>共 {accountDirectoryRows.length} 条记录</span></div><DirectoryTable data={accountDirectoryRows} onSelect={item => setAccountSelectionId(text(item.id))} columns={[{ key: 'name', label: '姓名' }, { key: 'email', label: '邮箱', className: 'member-email' }, { key: 'status', label: '验证状态' }, { key: 'createdAt', label: '创建时间' }]} /></section><CreateAccountModal open={createModal === 'account'} busy={createBusy} nodes={rootNodes} onLoadChildren={async node => rows(await request(`/v1/platform/organizations/tree?parentId=${encodeURIComponent(text(node.id))}`))} onClose={() => setCreateModal(null)} onSubmit={value => void submitCreatedAccount(value)} /></>)
    return commonContent(<><DirectoryMetrics values={[{ label: '所属组织', value: String(accountMembershipRows.length) }, { label: '有效角色', value: String(accountRoleRows.length) }, { label: '关联设备', value: accountRuntimeRows.length ? String(accountRuntimeRows.length) : '—', tone: 'green' }, { label: '审计事件', value: accountAuditRows.length ? String(accountAuditRows.length) : '—', tone: accountFailureCount ? 'red' : undefined }]} /><div className="directory-two-column directory-detail-layout"><section className="directory-panel directory-table-panel"><div className="directory-panel-header"><h2>组织归属与用量</h2><span>共 {accountOrganizationRows.length} 条记录</span></div><DirectoryTable data={accountOrganizationRows} columns={[{ key: 'organizationName', label: '组织' }, { key: 'role', label: '角色' }, { key: 'status', label: '状态' }, { key: 'usage', label: '费用' }, { key: 'createdAt', label: '加入时间' }]} /><div className="directory-subtable"><div className="directory-panel-header"><h2>设备与会话</h2><span>{accountRuntimeRows.length} 台设备 · {accountSessionRows.length} 个会话</span></div><DirectoryTable data={accountRuntimeRows.map(item => ({ ...item, status: item.revokedAt ? 'revoked' : 'active', organizationName: item.organizationId }))} columns={[{ key: 'name', label: '设备' }, { key: 'type', label: '类型' }, { key: 'version', label: '版本' }, { key: 'organizationName', label: '组织' }, { key: 'status', label: '状态' }]} /></div></section><aside className="directory-panel directory-summary-panel"><h2>账号信息</h2><dl><div><dt>姓名</dt><dd>{text(account?.name) || '—'}</dd></div><div><dt>邮箱</dt><dd>{text(account?.email) || '—'}</dd></div><div><dt>账号 ID</dt><dd>{text(account?.id) || accountId}</dd></div><div><dt>账号状态</dt><dd>{accountStatusLabel}</dd></div><div><dt>最近活动</dt><dd>{accountLastActivity ? new Date(accountLastActivity).toLocaleString('zh-CN') : '—'}</dd></div><div><dt>失败登录</dt><dd className={accountFailureCount ? 'directory-risk' : ''}>{accountFailureCount ? String(accountFailureCount) : '—'}</dd></div><div><dt>累计费用</dt><dd>{accountUsageRows.length ? `¥${(accountUsageRows.reduce((sum, item) => sum + usageCostMicros(item), 0) / 1_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</dd></div><div><dt>Token 用量</dt><dd>{accountUsageRows.length ? accountUsageRows.reduce((sum, item) => sum + (Number(item.inputTokens) || 0) + (Number(item.outputTokens) || 0), 0).toLocaleString('zh-CN') : '—'}</dd></div></dl></aside></div></>)
  }
  return commonContent(<><DirectoryMetrics values={[{ label: '组织总数', value: String(organizationCount) }, { label: '成员总数', value: String(membersCount) }, { label: '管理员', value: String(adminCount), tone: 'green' }, { label: '待处理成员', value: directMembers ? String(memberRows.filter(item => text(item.status) !== 'active').length) : '—', tone: directMembers && memberRows.some(item => text(item.status) !== 'active') ? 'red' : undefined }]} /><div className="directory-two-column directory-org-layout"><section className="directory-panel directory-tree-panel"><div className="directory-panel-header"><h2>组织层级</h2><span>{allNodes.length} 个节点</span></div><DirectoryTree nodes={allNodes} selectedId={selectedId} onSelect={selectNode} /></section><section className="directory-panel directory-members-panel"><div className="directory-org-header"><div className="directory-org-title"><span className="directory-org-icon">▦</span><div><h2>{text(selected?.name) || '—'}</h2><p>{text(selected?.displayPath) || text(selected?.path) || '—'}</p></div></div><button className="directory-primary-action" type="button" onClick={() => setInviteOpen(true)} disabled={!inviteOrganizationId}>＋ 邀请成员</button></div><div className="directory-org-metrics"><span><strong>{memberRows.length}</strong><small>成员</small></span><span><strong>{selectedRuntimeCount == null ? '—' : String(selectedRuntimeCount)}</strong><small>设备</small></span><span><strong>{roleRows.length}</strong><small>角色</small></span><span><strong>{text(selected?.childCount) || '0'}</strong><small>下级组织</small></span><span><strong>{text(selected?.status) || '—'}</strong><small>状态</small></span></div><div className="directory-panel-header directory-member-heading"><div><h2>成员</h2><span>共 {filteredMemberRows.length} 条记录</span></div></div><DirectoryTable data={filteredMemberRows} onSelect={item => window.location.assign(`/organizations/members/${encodeURIComponent(text(item.id))}?organizationId=${encodeURIComponent(selectedId)}`)} columns={[{ key: 'name', label: '成员', className: 'member-name' }, { key: 'email', label: '邮箱', className: 'member-email' }, { key: 'role', label: '角色' }, { key: 'status', label: '状态' }, { key: 'lastActive', label: '最近活动' }]} /></section></div><OperationModal open={inviteOpen} title="邀请成员" description={`邀请加入 ${text(selected?.name) || '当前组织'}`} fields={[{ name: 'email', label: '邮箱', type: 'email' }, { name: 'role', label: '角色', type: 'select', defaultValue: 'member', options: [{ value: 'member', label: '成员' }, { value: 'administrator', label: '管理员' }] }]} busy={inviteBusy} onClose={() => setInviteOpen(false)} onSubmit={submitInvite} /><CreateOrganizationModal open={createModal === 'organization'} busy={createBusy} parentName={text(selected?.displayPath) || text(selected?.name)} kinds={organizationKinds} onClose={() => setCreateModal(null)} onSubmit={value => void submitOrganization(value)} /></>)
}

function OrganizationPage({ route }: { route: Route }) {
  const tree = useData('/v1/platform/organizations/tree?parentId=null')
  const [nodeCache, setNodeCache] = useState<Record<string, RecordValue[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState(route.area === 'organizations/members' ? '' : route.id ?? '')
  useEffect(() => {
    if (route.area !== 'organizations/members') return
    const organizationId = new URLSearchParams(window.location.search).get('organizationId')
    if (organizationId) setSelectedId(organizationId)
  }, [route.area])
  const rootRows = rows(tree.value)
  const allNodes = Object.values(nodeCache).flat().concat(rootRows).filter((item, index,
    list) => list.findIndex(other => text(other.id) === text(item.id)) === index)
  const selected = allNodes.find(item => text(item.id) === selectedId) ?? rootRows[0]
  const organizationId = text(selected?.id)
  const organizationRows = allNodes
  const members = useData(organizationId ? `/v1/platform/organization-nodes/${organizationId}/members` : null)
  const accounts = useData('/v1/platform/accounts?limit=200')
  const allOrganizations = useData('/v1/platform/organizations/tree?all=true')
  const accountDetail = useData(route.sub === 'account' && route.id ? `/v1/platform/accounts/${route.id}/organizations` : null)
  const memberRows = rows(first(members.value)?.members)
  const [modal, setModal] = useState<'create' | 'invite' | 'account' | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<RecordValue | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const parentKind = text(selected?.kind)
  const childKinds = parentKind === 'group' || parentKind === 'enterprise'
    ? ['company', 'department']
    : parentKind === 'company'
      ? ['department']
      : parentKind === 'department'
        ? ['department', 'team']
        : ['team']
  async function submit(values: Record<string, string>) {
    setBusy(true)
    setNotice('')
    try {
      if (modal === 'create') {
        const created = await request('/v1/platform/organizations', 'POST', { name: values.name.trim(), kind: values.kind, parentId: organizationId || null })
        const parent = organizationId || 'null'
        setNodeCache(current => ({ ...current,
          [parent]: (current[parent] ?? []).filter(item => text(item.id) !== text((created as RecordValue)?.id)) }))
        await tree.reload()
      } else if (modal === 'invite') {
        await request(`/v1/organizations/${organizationId}/invitations`, 'POST', { email: values.email.trim(), role: values.role })
        await members.reload()
      } else if (modal === 'account') {
        await request('/v1/platform/accounts', 'POST', { name: values.name.trim(), email: values.email.trim(), password: values.password, organizationNodeId: values.organizationNodeId, role: values.role })
        await accounts.reload()
      }
      setModal(null)
      setNotice(t.success)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setBusy(false)
    }
  }
  if (route.area === 'organizations/members') {
    const target = memberRows.find(item => text(item.id) === route.id)
    return <PageFrame title={t.memberDetail} description={t.memberDetailDescription} eyebrow={t.globalDirectory} actions={<button className="primary" onClick={() => setModal('account')}>＋ {t.createAccount}</button>}><div className="organization-identity-tabs" role="tablist"><a href="/organizations/directory">{t.organizationDirectory}</a><a href="/organizations/directory/structure">{t.kind}</a><a className="selected" href="/organizations/directory/members">{t.memberDetail}</a><a href="/accounts">{t.accounts}</a></div><MetricStrip values={[{ label: t.organizations, value: '—' }, { label: t.role, value: text(target?.role) || '—' }, { label: t.active, value: text(target?.status) || '—', tone: 'success' }, { label: t.lastUpdated, value: text(target?.createdAt) || '—' }]} /><section className="card organization-detail-card"><div className="detail-heading"><div><h2>{text(target?.name) || t.noSelection}</h2><p className="muted">{text(target?.email)}</p></div>{status(target?.status)}</div><div className="detail-grid"><div><dt>{t.membershipId}</dt><dd>{text(target?.id)}</dd></div><div><dt>{t.createdAt}</dt><dd>{text(target?.createdAt)}</dd></div><div><dt>{t.role}</dt><dd>{text(target?.role) || t.member}</dd></div><div><dt>{t.currentOrganization}</dt><dd>{text(first(tree.value)?.name)}</dd></div></div></section><OperationModal open={modal === 'account'} title={t.createAccount} fields={[{ name: 'name', label: t.name }, { name: 'email', label: t.email, type: 'email' }, { name: 'password', label: t.password, type: 'password' }, { name: 'organizationNodeId', label: t.organization, defaultValue: organizationId }, { name: 'role', label: t.role, defaultValue: 'member' }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /></PageFrame>
  }
  const accountView = route.sub === 'accounts' || route.sub === 'account'
  const accountDetailView = route.sub === 'account' && Boolean(route.id)
  const structureView = route.sub === 'structure'
  const accountRows = rows(accounts.value)
  const organizationOptions = rows(allOrganizations.value)
  const accountRecord = first(accountDetail.value)
  const account = first(accountRecord?.account)
  const structureRows = organizationOptions.filter(item => text(item.nodeType) === 'unit' || ['department', 'team'].includes(text(item.kind)))
  const toggleNode = async (item: RecordValue) => {
    const id = text(item.id)
    if (expanded.has(id)) { setExpanded((current) => { const next = new Set(current); next.delete(id); return next }); return }
    if (!nodeCache[id]) {
      setLoadingIds(current => new Set(current).add(id))
      try { const children = rows(await request(`/v1/platform/organizations/tree?parentId=${encodeURIComponent(id)}`)); setNodeCache(current => ({ ...current, [id]: children })) }
      finally { setLoadingIds((current) => { const next = new Set(current); next.delete(id); return next }) }
    }
    setExpanded(current => new Set(current).add(id))
  }
  return (
    <PageFrame
      title={accountDetailView ? t.accountDetail : structureView ? t.kind : accountView ? t.accounts : t.organizationDirectory}
      description={accountDetailView
        ? t.accountDetailDescription
        : structureView ? t.organizationDirectoryDescription : accountView ? t.accountsDescription : t.organizationDirectoryDescription}
      actions={<button className="primary" onClick={() => accountView ? setModal('account') : setModal('create')} disabled={!accountView && !organizationId}>＋ {accountView ? t.createAccount : t.createChildOrganization}</button>}
    >
      <div className="organization-identity-tabs" role="tablist">
        <a className={!accountView && !route.id ? 'selected' : ''} href="/organizations/directory">{t.organizationDirectory}</a>
        <a className={structureView ? 'selected' : ''} href="/organizations/directory/structure">{t.kind}</a>
        <a className={route.area === 'organizations/members' ? 'selected' : ''} href="/organizations/directory/members">{t.memberDetail}</a>
        <a className={accountView ? 'selected' : ''} href="/accounts">{t.accounts}</a>
      </div>
      {accountDetailView ? (
        <><MetricStrip values={[{ label: t.organizations, value: String(rows(accountRecord?.memberships).length) }, { label: t.memberCount, value: String(rows(accountRecord?.memberships).length) }, { label: t.active, value: text(account?.emailVerified) === 'true' ? t.active : '—', tone: 'success' }, { label: t.recentAudit, value: '—' }]} /><div className="organization-detail-layout"><section className="card organization-identity-card"><div className="card-heading"><h2>{t.organizations}</h2></div><DataTable data={rows(accountRecord?.memberships)} columns={[{ key: 'organizationName', label: t.organization }, { key: 'role', label: t.role }, { key: 'status', label: t.status }, { key: 'createdAt', label: t.createdAt }]} /></section><aside className="card organization-side-card"><h2>{t.accountDetail}</h2><dl className="detail-list"><div><dt>{t.name}</dt><dd>{text(account?.name) || '—'}</dd></div><div><dt>{t.email}</dt><dd>{text(account?.email) || route.id}</dd></div><div><dt>{t.createdAt}</dt><dd>{text(account?.createdAt) || '—'}</dd></div><div><dt>{t.status}</dt><dd>{text(account?.emailVerified) === 'true' ? t.active : t.pending}</dd></div></dl></aside></div><OperationModal open={modal === 'account'} title={t.createAccount} fields={[{ name: 'name', label: t.name }, { name: 'email', label: t.email, type: 'email' }, { name: 'password', label: t.password, type: 'password' }, { name: 'organizationNodeId', label: t.organization, defaultValue: organizationId }, { name: 'role', label: t.role, defaultValue: 'member' }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /></>
      ) : structureView ? (
        <><MetricStrip values={[{ label: t.organizations, value: String(organizationRows.length) }, { label: t.department, value: String(structureRows.length) }, { label: t.memberCount, value: String(structureRows.reduce((total, item) => total + Number(item.memberCount || 0), 0)) }, { label: t.attentionRequired, value: String(structureRows.filter(item => text(item.status) !== 'active').length), tone: 'warning' }]} /><div className="organization-detail-layout"><section className="card organization-identity-card"><div className="card-heading"><h2>{t.kind}</h2><span className="muted">{structureRows.length}</span></div><DataTable data={structureRows} columns={[{ key: 'name', label: t.name }, { key: 'displayPath', label: t.parentOrganization }, { key: 'memberCount', label: t.memberCount }, { key: 'childCount', label: t.organizations }, { key: 'status', label: t.status }]} /></section><aside className="card organization-side-card"><h2>{t.organizationDirectory}</h2><p className="muted">{t.organizationDirectoryDescription}</p><div className="organization-tree-summary">{organizationRows.slice(0, 8).map(item => <div key={text(item.id)}><strong>{text(item.name)}</strong><span>{text(item.memberCount) || '0'} {t.memberCount}</span></div>)}</div></aside></div>
        </>
      ) : accountView ? (
        <section className="card organization-identity-card">
          {accounts.error ? <p className="error" role="alert">{accounts.error}</p> : null}
          <div className="filter-bar"><span className="filter-label">{t.filters}</span><input aria-label={t.accountSearch} placeholder={t.accountSearchPlaceholder} /></div>
          <DataTable data={accountRows} columns={[{ key: 'name', label: t.name }, { key: 'email', label: t.email }, { key: 'emailVerified', label: t.status }, { key: 'createdAt', label: t.createdAt }]} onRow={item => window.location.assign(`/accounts/${text(item.id)}`)} />
        </section>
      ) : (
        <>
          <MetricStrip values={[{ label: t.organizations, value: String(organizationRows.length) }, { label: t.memberCount, value: String(memberRows.length) }, { label: t.active, value: String(memberRows.filter(item => text(item.status) === 'active').length), tone: 'success' }, { label: t.attentionRequired, value: String(memberRows.filter(item => text(item.status) !== 'active').length), tone: 'warning' }]} />
          {tree.error ? <p className="error" role="alert">{tree.error}</p> : null}
          {members.error ? <p className="error" role="alert">{members.error}</p> : null}
          {notice ? <p className="operation-notice" role="status">{notice}</p> : null}
          <div className="resource-split">
            <div className="resource-list"><OrganizationTree nodes={organizationRows} childrenByParent={nodeCache} loading={tree.loading} loadingIds={loadingIds} expanded={expanded} selected={organizationId} onToggle={item => void toggleNode(item)} onSelect={item => setSelectedId(text(item.id))} /></div>
            <div className="resource-detail">
              <div className="detail-heading"><div><h3>{text(selected?.name) || t.noSelection}</h3><p className="muted">{text(selected?.displayPath) || text(selected?.path) || text(selected?.id)}</p></div><button className="secondary-button" type="button" onClick={() => setModal('invite')} disabled={!organizationId}>{t.invite}</button></div>
              <DataTable data={memberRows} columns={[{ key: 'name', label: t.name }, { key: 'email', label: t.email }, { key: 'status', label: t.status }, { key: 'createdAt', label: t.createdAt }]} onRow={item => window.location.assign(`/organizations/members/${text(item.id)}?organizationId=${organizationId}`)} />
            </div>
          </div>
          <OperationModal open={modal === 'create'} title={t.createChildOrganization} description={`${t.parentOrganization}: ${text(selected?.displayPath) || text(selected?.name)}`} fields={[{ name: 'name', label: t.name }, { name: 'kind', label: t.kind, type: 'select', defaultValue: childKinds[0], options: childKinds.map(value => ({ value, label: t.organizationKinds[value as keyof typeof t.organizationKinds] ?? value })) }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} />
          <OperationModal open={modal === 'invite'} title={t.invite} description={t.membersDescription} fields={[{ name: 'email', label: t.email, type: 'email' }, { name: 'role', label: t.role, type: 'select', defaultValue: 'member', options: [{ value: 'member', label: t.member }, { value: 'administrator', label: t.administrator }] }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} />
          <OperationModal open={modal === 'account'} title={t.createAccount} fields={[{ name: 'name', label: t.name }, { name: 'email', label: t.email, type: 'email' }, { name: 'password', label: t.password, type: 'password' }, { name: 'organizationNodeId', label: t.organization, defaultValue: organizationId }, { name: 'role', label: t.role, defaultValue: 'member' }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} />
        </>
      )}
    </PageFrame>
  )
}

function AccountsPage({ id }: { id?: string }) {
  const accounts = useData('/v1/platform/accounts?limit=200')
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
      else if (modal === 'edit') await request(`/v1/platform/accounts/${text(selected?.id)}`, 'PATCH', { name: values.name.trim(), email: values.email.trim() })
      else await request(`/v1/platform/accounts/${text(selected?.id)}/password`, 'POST', { password: values.password })
      setModal(null); setSelected(null); setNotice(t.success); await accounts.reload(); if (id) await detail.reload()
    } catch (error) { setNotice(error instanceof Error ? error.message : t.error) } finally { setBusy(false) }
  }
  if (id) return <PageFrame title={t.accountDetail} description={t.accountDetailDescription} eyebrow={t.accounts} actions={<><button className="secondary-button" onClick={() => { setSelected(account); setModal('edit') }}>{t.edit}</button><button className="secondary-button" onClick={() => { setSelected(account); setModal('password') }}>{t.resetPassword}</button><a className="secondary-button" href="/accounts">{t.backToDirectory}</a></>}><section className="card"><div className="detail-heading"><div><h3>{text(account?.email) || id}</h3><p className="muted">{text(account?.name)}</p></div>{status(account?.emailVerified ? 'active' : 'pending')}</div><h2>{t.organizations}</h2><DataTable data={rows(detailRecord?.memberships)} columns={[{ key: 'organizationName', label: t.organization }, { key: 'status', label: t.status }, { key: 'createdAt', label: t.createdAt }]} /></section><OperationModal open={modal === 'edit'} title={t.editAccount} fields={[{ name: 'name', label: t.name, defaultValue: text(account?.name) }, { name: 'email', label: t.email, type: 'email', defaultValue: text(account?.email) }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /><OperationModal open={modal === 'password'} title={t.resetPassword} fields={[{ name: 'password', label: t.newPassword, type: 'password' }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /></PageFrame>
  const organizationOptions = rows(organizations.value)
  return <PageFrame title={t.accounts} description={t.accountsDescription} actions={<button className="primary" onClick={() => { setSelected(null); setModal('create') }}>＋ {t.createAccount}</button>}><section className="card">{notice ? <p className="operation-notice" role="status">{notice}</p> : null}<div className="filter-bar"><span className="filter-label">{t.filters}</span><input aria-label={t.accountSearch} placeholder={t.accountSearchPlaceholder} /></div><DataTable data={accountRows} columns={[{ key: 'name', label: t.name }, { key: 'email', label: t.email }, { key: 'emailVerified', label: t.status }, { key: 'createdAt', label: t.createdAt }]} actions={item => <><button className="table-action" onClick={() => { setSelected(item); setModal('edit') }}>{t.edit}</button><button className="table-action" onClick={() => { setSelected(item); setModal('password') }}>{t.resetPassword}</button></>} onRow={item => window.location.assign(`/accounts/${text(item.id)}`)} /></section><CreateAccountModal open={modal === 'create'} busy={busy} nodes={organizationOptions} onLoadChildren={async node => rows(await request(`/v1/platform/organizations/tree?parentId=${encodeURIComponent(text(node.id))}`))} onClose={() => setModal(null)} onSubmit={values => void submit(values)} /><OperationModal open={modal === 'edit'} title={t.editAccount} fields={[{ name: 'name', label: t.name, defaultValue: text(selected?.name) }, { name: 'email', label: t.email, type: 'email', defaultValue: text(selected?.email) }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /><OperationModal open={modal === 'password'} title={t.resetPassword} fields={[{ name: 'password', label: t.newPassword, type: 'password' }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /></PageFrame>
}

function OrganizationResourcePage({ area, id }: { area: string; id?: string }) {
  const orgs = useData('/v1/platform/organizations/tree?all=true')
  const organizationId = text(rows(orgs.value)[0]?.id)
  const endpoints: Record<string, string> = {
    'sync/scripts': `/v1/organizations/${organizationId}/sync-scripts`,
    'sync/runs': `/v1/organizations/${organizationId}/sync-runs`,
    'sync/diffs': `/v1/organizations/${organizationId}/sync-diffs`,
    'sync/history': `/v1/organizations/${organizationId}/sync-rollbacks`,
    'permissions/catalog': `/v1/organizations/${organizationId}/permissions`,
    'permissions/roles': `/v1/organizations/${organizationId}/roles/custom`,
    'permissions/session-approvals': `/v1/organizations/${organizationId}/session-approvals`,
    'identity/providers': `/v1/organizations/${organizationId}/identity-providers`,
    'identity/login-failures': `/v1/organizations/${organizationId}/identity-login-failures`,
    'identity/mapping': id ? `/v1/organizations/${organizationId}/identity-providers/${id}/mappings` : '',
  }
  const data = useData(organizationId ? endpoints[area] ?? null : null)
  const mapping = area === 'identity/providers' ? rows(data.value).map(item => ({ ...item, state: item.enabled ? 'active' : 'disabled' })) : rows(data.value)
  const [modalOpen, setModalOpen] = useState(false)
  const [previewScript, setPreviewScript] = useState<RecordValue | null>(null)
  const [pending, setPending] = useState<{ path: string; method: string; body?: unknown; title: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const labels: Record<string, string> = { 'sync/scripts': t.syncScripts, 'sync/runs': t.syncRuns, 'sync/diffs': t.syncDiffs, 'sync/history': t.syncHistory, 'permissions/catalog': t.permissionCatalog, 'permissions/roles': t.customRoles, 'permissions/session-approvals': t.sessionApprovals, 'identity/providers': t.identityProviders, 'identity/mapping': t.fieldMapping, 'identity/login-failures': t.loginFailures }
  const descriptions: Record<string, string> = { 'sync/scripts': t.syncScriptsDescription, 'sync/runs': t.syncRunsDescription, 'sync/diffs': t.syncDiffsDescription, 'sync/history': t.syncHistoryDescription, 'permissions/catalog': t.permissionsDescription, 'permissions/roles': t.customRolesDescription, 'permissions/session-approvals': t.sessionApprovalsDescription, 'identity/providers': t.identityProvidersDescription, 'identity/mapping': t.fieldMappingDescription, 'identity/login-failures': t.loginFailuresDescription }
  const columns = area.startsWith('sync/') ? [{ key: 'name', label: t.name }, { key: 'version', label: t.version }, { key: 'changeType', label: t.changeType }, { key: 'status', label: t.status }, { key: 'createdAt', label: t.createdAt }] : area === 'permissions/catalog' ? [{ key: 'id', label: t.permissionId }, { key: 'resource', label: t.resource }, { key: 'action', label: t.action }, { key: 'highRisk', label: t.risk }] : area === 'identity/providers' ? [{ key: 'name', label: t.name }, { key: 'protocol', label: t.protocol }, { key: 'issuer', label: t.issuer }, { key: 'state', label: t.status }] : area === 'identity/mapping' ? [{ key: 'sourceField', label: t.sourceField }, { key: 'targetField', label: t.targetField }, { key: 'transform', label: t.transform }, { key: 'required', label: t.required }] : area === 'permissions/roles' ? [{ key: 'name', label: t.name }, { key: 'role', label: t.role }, { key: 'action', label: t.action }, { key: 'enabled', label: t.status }, { key: 'createdAt', label: t.createdAt }] : [{ key: 'name', label: t.name }, { key: 'role', label: t.role }, { key: 'action', label: t.action }, { key: 'status', label: t.status }, { key: 'createdAt', label: t.createdAt }]
  const createable = ['sync/scripts', 'permissions/roles', 'identity/providers', 'permissions/session-approvals'].includes(area)
  const fields: OperationField[] = area === 'sync/scripts'
    ? [{ name: 'name', label: t.name }, { name: 'source', label: t.scriptSource, type: 'textarea' }]
    : area === 'permissions/roles'
      ? [{ name: 'name', label: t.roleName }, { name: 'description', label: t.roleDescription, type: 'textarea', required: false }, { name: 'permissionIds', label: t.permissionIds, required: false }]
      : area === 'identity/providers'
        ? [{ name: 'name', label: t.name }, { name: 'protocol', label: t.protocol, type: 'select', defaultValue: 'oidc', options: Object.entries(t.identityProtocols).map(([value, label]) => ({ value, label })) }, { name: 'issuer', label: t.issuer, type: 'url', required: false }]
        : [{ name: 'sessionId', label: t.columns.id }, { name: 'action', label: t.action, type: 'select', defaultValue: 'read', options: Object.entries(t.sessionActions).map(([value, label]) => ({ value, label })) }, { name: 'reason', label: t.purpose, type: 'textarea', required: false }]
  async function submit(values: Record<string, string>) {
    setBusy(true)
    setNotice('')
    try {
      const body = area === 'sync/scripts'
        ? { name: values.name.trim(), source: values.source }
        : area === 'permissions/roles'
          ? { name: values.name.trim(), description: values.description.trim(), permissionIds: values.permissionIds.split(',').map(value => value.trim()).filter(Boolean) }
          : area === 'identity/providers'
            ? { name: values.name.trim(), protocol: values.protocol, ...(values.issuer.trim() ? { issuer: values.issuer.trim() } : {}),
              config: {} }
            : { sessionId: values.sessionId.trim(), action: values.action, reason: values.reason.trim() }
      await request(endpoints[area], 'POST', body)
      setModalOpen(false)
      setNotice(t.success)
      await data.reload()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setBusy(false)
    }
  }
  async function submitSyncScript(value: SyncScriptValues) {
    setBusy(true)
    setNotice('')
    try {
      const created = first(await request(endpoints[area], 'POST', { name: value.name, source: value.source }))
      const scriptId = text(created?.id)
      if (!scriptId) throw new Error(t.error)
      const previewInput = JSON.parse(value.input) as Record<string, unknown>
      const preview = first(await request(`${endpoints[area]}/${scriptId}/test`, 'POST', previewInput))
      const counts = preview?.counts && typeof preview.counts === 'object' ? Object.entries(preview.counts as Record<string, unknown>).map(([key, count]) => `${key}: ${String(count)}`).join('，') : t.noData
      setModalOpen(false)
      setNotice(`${t.syncPreviewReady}：${counts}`)
      await data.reload()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setBusy(false)
    }
  }
  async function testExistingScript(input: string) {
    if (!previewScript) return
    setBusy(true)
    setNotice('')
    try {
      const parsed = JSON.parse(input) as Record<string, unknown>
      const preview = first(await request(`${endpoints['sync/scripts']}/${text(previewScript.id)}/test`, 'POST', parsed))
      const counts = preview?.counts && typeof preview.counts === 'object' ? Object.entries(preview.counts as Record<string, unknown>).map(([key, count]) => `${key}: ${String(count)}`).join('，') : t.noData
      setPreviewScript(null)
      setNotice(`${t.syncPreviewReady}：${counts}`)
      if (area === 'sync/scripts') await data.reload()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.invalidJson)
    } finally {
      setBusy(false)
    }
  }
  async function approveCurrentBatch() {
    const runId = text((mapping[0] as RecordValue | undefined)?.runId)
    if (!runId) return
    await mutate(`${endpoints['sync/diffs']}/bulk`, 'POST', { runId, decision: 'approved', limit: 1_000 })
  }
  async function mutate(path: string, method: string, body?: unknown) {
    setBusy(true)
    setNotice('')
    try {
      await request(path, method, body)
      setNotice(t.success)
      await data.reload()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setBusy(false)
    }
  }
  async function submitIdentityProvider(value: IdentityProviderForm) {
    setBusy(true)
    setNotice('')
    try {
      await request(endpoints[area], 'POST', value)
      setModalOpen(false)
      setNotice(t.success)
      await data.reload()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.error)
    } finally {
      setBusy(false)
    }
  }
  function ask(path: string, method: string, title: string, body?: unknown) {
    setPending({ path, method, body, title })
  }
  const rowActions = (item: RecordValue) => {
    const itemId = text(item.id)
    if (area === 'sync/scripts') return <><button className="table-action" disabled={busy} onClick={() => setPreviewScript(item)}>{t.testSyncScript}</button>{item.status === 'draft' ? <button className="table-action" disabled={busy} onClick={() => ask(`${endpoints[area]}/${itemId}/approve`, 'POST', t.approve)}>{t.approve}</button> : null}{item.status === 'approved' ? <button className="table-action" disabled={busy} onClick={() => ask(`${endpoints[area]}/${itemId}/publish`, 'POST', t.publish)}>{t.publish}</button> : null}</>
    if (area === 'sync/runs' && item.status !== 'failed') return <button className="table-action" disabled={busy} onClick={() => ask(`/v1/organizations/${organizationId}/sync-runs/${itemId}/rollback`, 'POST', t.restore)}>{t.restore}</button>
    if (area === 'sync/diffs' && item.status === 'pending') return <><button className="table-action" disabled={busy} onClick={() => ask(`/v1/organizations/${organizationId}/sync-diffs/${itemId}`, 'PATCH', t.approve, { decision: 'approved', version: Number(item.version) })}>{t.approve}</button><button className="table-action danger" disabled={busy} onClick={() => ask(`/v1/organizations/${organizationId}/sync-diffs/${itemId}`, 'PATCH', t.reject, { decision: 'rejected', version: Number(item.version) })}>{t.reject}</button></>
    if (area === 'permissions/roles' && item.enabled !== false) return <button className="table-action danger" disabled={busy} onClick={() => ask(`${endpoints[area]}/${itemId}`, 'DELETE', t.disabled)}>{t.disabled}</button>
    if (area === 'permissions/session-approvals' && item.status === 'pending') return <><button className="table-action" disabled={busy} onClick={() => ask(`/v1/organizations/${organizationId}/session-approvals/${itemId}`, 'PATCH', t.approve, { decision: 'approved', version: Number(item.version) })}>{t.approve}</button><button className="table-action danger" disabled={busy} onClick={() => ask(`/v1/organizations/${organizationId}/session-approvals/${itemId}`, 'PATCH', t.reject, { decision: 'rejected', version: Number(item.version) })}>{t.reject}</button></>
    if (area === 'identity/providers') return <><button className="table-action" disabled={busy} onClick={() => ask(`/v1/organizations/${organizationId}/identity-providers/${itemId}`, 'PATCH', item.enabled ? t.disabled : t.enabled, { enabled: !item.enabled })}>{item.enabled ? t.disabled : t.enabled}</button><a className="table-action" href={`/identity/providers/${itemId}/mapping`}>{t.fieldMapping}</a></>
    return null
  }
  const pageActions = createable ? <button className="primary" onClick={() => setModalOpen(true)}>＋ {t.create}</button> : area === 'sync/diffs' && Boolean((mapping[0] as RecordValue | undefined)?.runId) ? <span className="toolbar-actions"><button className="primary" disabled={busy} onClick={() => void approveCurrentBatch()}>{t.approveBatch}</button><button className="secondary-button" onClick={data.reload}>{t.refresh}</button></span> : <button className="secondary-button" onClick={data.reload}>{t.refresh}</button>
  return <PageFrame title={labels[area] ?? t.resourceList} description={descriptions[area]} actions={pageActions}>{area.startsWith('identity/') ? <PlatformSettingTabs area={area} /> : area.startsWith('permissions/') ? <GovernanceTabs area={area} /> : null}<div className={area.startsWith('identity/') || area.startsWith('permissions/') ? 'platform-setting-page' : ''}><MetricStrip values={[{ label: t.total, value: String(mapping.length) }, { label: t.pending, value: String(mapping.filter(item => /pending|draft|preview/.test(text(item.status))).length), tone: 'warning' }, { label: t.approved, value: String(mapping.filter(item => /approved|published|completed/.test(text(item.status))).length), tone: 'success' }, { label: t.failed, value: String(mapping.filter(item => /failed|rejected/.test(text(item.status))).length), tone: 'warning' }]} />{data.error ? <p className="error" role="alert">{data.error}</p> : null}{notice ? <p className="operation-notice" role="status">{notice}</p> : null}<section className="card"><div className="filter-bar"><span className="filter-label">{t.filters}</span><select aria-label={t.status}><option>{t.filterAll}</option></select><button type="button" onClick={data.reload}>{t.refresh}</button></div><DataTable data={mapping} columns={columns} actions={rowActions} /></section></div>{area === 'identity/providers' ? <IdentityProviderModal open={modalOpen} busy={busy} onClose={() => setModalOpen(false)} onSubmit={submitIdentityProvider} /> : area === 'sync/scripts' ? <><SyncScriptModal open={modalOpen} busy={busy} onClose={() => setModalOpen(false)} onSubmit={value => void submitSyncScript(value)} /><SyncPreviewModal open={previewScript !== null} scriptName={text(previewScript?.name)} busy={busy} onClose={() => setPreviewScript(null)} onSubmit={value => void testExistingScript(value)} /></> : <OperationModal open={modalOpen} title={labels[area] ?? t.create} description={descriptions[area]} fields={fields} busy={busy} onClose={() => setModalOpen(false)} onSubmit={submit} />}<ConfirmModal open={pending !== null} title={pending?.title ?? t.operation} description={t.confirmTitle} busy={busy} onClose={() => setPending(null)} onConfirm={() => { const action = pending; setPending(null); if (action) void mutate(action.path, action.method, action.body) }} /></PageFrame>
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
  return <PageFrame title={t.systemHealthPageTitle} breadcrumbTitle={t.systemHealthPageTitle} eyebrow={t.overview} description={t.systemHealthPageDescription} actions={<button className="primary" onClick={onRefresh}>＋ {t.healthRefresh}</button>}><div className="health-page"><div className="overview-tabs" role="tablist"><a href="/overview">{t.healthOverviewTab}</a><a className="selected" href="/platform/health">{t.systemHealth}</a></div><div className="health-heading"><div><h1>{t.systemHealthPageTitle}</h1><p>{t.systemHealthPageDescription}</p></div><div className="health-filters"><button type="button" onClick={() => setSearchOpen(current => !current)}>⌕ {t.healthSearch}</button><button type="button" onClick={cycleFilter}>≡ {statusFilter === 'all' ? t.healthFilter : '仅看告警'}</button><button type="button" onClick={onRefresh}>▣ {t.healthLast30Days}</button></div></div>{searchOpen ? <div className="health-search"><span>⌕</span><input autoFocus aria-label={t.healthSearch} placeholder="按服务名称搜索" value={search} onChange={event => setSearch(event.target.value)} /></div> : null}{error ? <p className="error" role="alert">{error}</p> : null}<div className="health-metrics"><HealthMetric icon="♡" value={`${healthyCount} / ${services.length}`} label={t.healthServices} tone="info" /><HealthMetric icon="♧" value={String(criticalAlerts.length)} label={t.healthCriticalAlerts} tone="danger" /><HealthMetric icon="⚙" value="—" label={t.healthTodayErrors} tone="info" /><HealthMetric icon="↻" value="—" label={t.healthAverageRecovery} tone="info" /></div><div className="health-layout"><section className="health-service-panel"><div className="health-panel-heading"><h2>{t.healthServiceStatus}</h2><span># {filteredServices.length} {t.healthRecordCount}</span></div><div className="health-table-scroll"><table className="health-service-table"><thead><tr><th>{t.healthService}</th><th>{t.healthAvailability}</th><th>{t.healthLatency}</th><th>{t.healthErrorRate}</th><th>{t.healthLastCheck}</th><th>{t.healthStatus}</th></tr></thead><tbody>{filteredServices.map(item => <tr key={text(item.id)}><td>{text(item.label)}</td><td>{availability(item)}</td><td>{latency(item)}</td><td>{text(item.errorRate) || '—'}</td><td>{displayTime}</td><td>{status(item.status)}</td></tr>)}</tbody></table>{!filteredServices.length ? <div className="health-empty">{t.noData}</div> : null}</div></section><aside className="health-alert-panel"><div className="health-panel-heading"><h2>{t.healthAlertDetails}</h2></div>{activeAlert ? <dl className="health-alert-details"><div><dt>{t.healthSeverity}</dt><dd className={text(activeAlert.status) === 'failed' ? 'health-danger' : 'health-warning'}>{text(activeAlert.status) === 'failed' ? '严重' : '警告'}</dd></div><div><dt>{t.healthCurrentService}</dt><dd>{text(activeAlert.label)}</dd></div><div><dt>{t.healthCurrentStatus}</dt><dd>{status(activeAlert.status)}</dd></div><div><dt>{t.healthCheckedAt}</dt><dd>{displayTime}</dd></div><div><dt>{t.healthLatency}</dt><dd>{latency(activeAlert)}</dd></div><div><dt>{t.healthAvailability}</dt><dd>{availability(activeAlert)}</dd></div></dl> : <div className="health-alert-empty"><strong>{t.healthNoActiveAlerts}</strong><span>{t.healthNoActiveAlertsDescription}</span></div>}</aside></div></div></PageFrame>
}

function PlatformPage({ area }: { area: string }) {
  const data = useData(area === 'health' ? '/v1/platform/health' : area === 'settings' ? '/v1/platform/policy' : area === 'redemptions' ? '/v1/platform/redemption-codes?limit=100' : area === 'audit' ? '/v1/platform/audit?limit=200' : area === 'adapters' ? '/v1/platform/model-adapters' : area === 'runtimes' ? '/v1/platform/runtimes' : '/v1/platform/models')
  const payload = first(data.value)
  const tableRows = area === 'adapters' ? rows(data.value).map((item) => {
    const configuration = item.configuration && typeof item.configuration === 'object' ? item.configuration as Record<string, unknown> : {}
    return { ...item, mode: configuration.mode ?? 'asynchronous', billing: configuration.billing ?? 'provider-usage' }
  }) : rows(data.value)
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
    const result = await mutate(path, editingModel ? 'PATCH' : 'POST', value)
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
  const columns = area === 'settings' ? [{ key: 'registration', label: t.registrationPolicy }, { key: 'mode', label: t.mode }, { key: 'domains', label: t.domains }] : area === 'redemptions' ? [{ key: 'batchId', label: t.batchId }, { key: 'codeHint', label: t.code }, { key: 'amountMicrosCny', label: t.amountCny }, { key: 'redeemedAt', label: t.redeemed }, { key: 'expiresAt', label: t.expired }] : area === 'audit' ? [{ key: 'createdAt', label: t.createdAt }, { key: 'action', label: t.action }, { key: 'resourceId', label: t.resource }, { key: 'actorId', label: t.account }] : area === 'adapters' ? [{ key: 'publicModel', label: t.model }, { key: 'operation', label: t.operation }, { key: 'mode', label: t.executionMode }, { key: 'billing', label: t.billingMode }, { key: 'version', label: t.version }, { key: 'enabled', label: t.status }] : area === 'runtimes' ? [{ key: 'name', label: t.name }, { key: 'type', label: t.columns.type }, { key: 'version', label: t.version }, { key: 'leaseUntil', label: t.columns.leaseUntil }, { key: 'revokedAt', label: t.columns.revokedAt }] : [{ key: 'name', label: t.name }, { key: 'baseUrl', label: t.baseUrl }, { key: 'upstreamModel', label: t.upstreamModel }, { key: 'enabled', label: t.status }]
  const tableActions = (item: RecordValue) => area === 'redemptions' ? <button className="table-action danger" disabled={Boolean(item.redeemedAt) || Boolean(item.revokedAt) || busy} onClick={() => void mutate(`/v1/platform/redemption-codes/${text(item.id)}/revoke`, 'POST')}>{t.revoke}</button> : area === 'models' ? <><button className="table-action" disabled={busy} onClick={() => { setEditingModel(item); setModelEditorOpen(true) }}>{t.edit}</button><button className="table-action" disabled={busy} onClick={() => void mutate(`/v1/platform/models/${text(item.id)}`, 'PATCH', { enabled: !item.enabled })}>{item.enabled ? t.disabled : t.enabled}</button></> : null
  const policy = area === 'settings' ? payload : null
  const settingsPage = ['settings', 'redemptions'].includes(area)
  const action = area === 'settings' ? <button className="primary" onClick={() => setModal('settings')}>＋ {t.configure}</button> : area === 'redemptions' ? <button className="primary" onClick={() => setModal('redemptions')}>＋ {t.create}</button> : area === 'models' ? <button className="primary" onClick={() => { setEditingModel(null); setModelEditorOpen(true) }}>＋ {t.create}</button> : area === 'adapters' ? <button className="primary" onClick={() => setAdapterEditorOpen(true)}>＋ {t.create}</button> : <button className="secondary-button" onClick={data.reload}>{t.refresh}</button>
  return <PageFrame title={labels[area] ?? t.resourceList} description={descriptions[area]} actions={action}>{settingsPage ? <PlatformSettingTabs area={area} /> : area === 'audit' ? <GovernanceTabs area="permissions/audit" /> : null}<div className={settingsPage ? 'platform-setting-page' : ''}><section className="card">{data.error ? <p className="error" role="alert">{data.error}</p> : null}{notice ? <p className="operation-notice" role="status">{notice}</p> : null}<div className="detail-grid"><div><dt>{t.total}</dt><dd>{tableRows.length || (payload ? 1 : 0)}</dd></div><div><dt>{t.lastUpdated}</dt><dd>{text(payload?.lastUpdated) || new Date().toLocaleString('zh-CN')}</dd></div></div><DataTable data={tableRows} columns={columns} onRow={area === 'runtimes' ? item => window.location.assign(`/models/runtimes/${text(item.id)}`) : undefined} actions={['redemptions', 'models'].includes(area) ? tableActions : undefined} /></section></div>{generatedCodes ? <section className="card generated-codes"><div className="card-heading"><h2>{t.redemptionCreated}</h2><button className="secondary-button" onClick={() => setGeneratedCodes(null)}>{t.close}</button></div><p><strong>{t.batchId}:</strong> {text(generatedCodes.batchId)}</p><pre>{Array.isArray(generatedCodes.codes) ? generatedCodes.codes.join('\n') : ''}</pre></section> : null}<OperationModal open={modal === 'settings'} title={t.platformSettings} description={t.platformSettingsDescription} fields={[{ name: 'registration', label: t.registrationPolicy, type: 'select', defaultValue: text(policy?.registration) || 'open', options: Object.entries(t.registrationPolicies).map(([value, label]) => ({ value, label })) }, { name: 'domains', label: t.domains, defaultValue: Array.isArray(policy?.domains) ? policy.domains.join(', ') : '', required: false }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /><OperationModal open={modal === 'redemptions'} title={t.createRedemptionBatch} description={t.redemptionCodesDescription} fields={[{ name: 'amountCny', label: t.amountCny, type: 'number', defaultValue: '100' }, { name: 'count', label: t.redemptionCount, type: 'number', defaultValue: '1' }, { name: 'expiresAt', label: t.redemptionExpiresAt, type: 'datetime-local', required: false }, { name: 'note', label: t.redemptionNote, required: false }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /><ModelEditorModal open={modelEditorOpen} model={editingModel} busy={busy} onClose={() => { setModelEditorOpen(false); setEditingModel(null) }} onSubmit={value => void saveModel(value)} /><HeterogeneousModelEditorModal open={adapterEditorOpen} busy={busy} onClose={() => setAdapterEditorOpen(false)} onSubmit={value => void saveAdapter(value)} /></PageFrame>
}

function RuntimeDetail({ id }: { id?: string }) {
  const data = useData(id ? `/v1/platform/runtimes/${id}` : null)
  const record = first(data.value)
  const runtime = first(record?.runtime)
  const fields: Array<[string, string]> = [['id', t.columns.id], ['organizationId', t.organizationId], ['accountId', t.columns.accountId], ['leaseUntil', t.columns.leaseUntil], ['createdAt', t.createdAt]]
  return <PageFrame title={t.runtimeDetail} description={t.runtimeDetailDescription} eyebrow={t.runtimeDevices}><section className="card"><div className="detail-heading"><div><h3>{text(runtime?.name) || id}</h3><p className="muted">{text(runtime?.type)} · {text(runtime?.version)}</p></div>{status(runtime?.revokedAt ? 'revoked' : 'active')}</div><div className="detail-grid">{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{text(runtime?.[key]) || '—'}</dd></div>)}</div></section><section className="card"><h2>{t.recentAudit}</h2><DataTable data={rows(record?.audit)} columns={[{ key: 'action', label: t.action }, { key: 'resourceId', label: t.resource }, { key: 'createdAt', label: t.createdAt }]} /></section></PageFrame>
}

function ShellContent({ route }: { route: Route }) {
  if (route.area === 'overview') return <OverviewPage />
  if (route.area === 'platform/usage') return <UsageReferenceWorkspace />
  if (route.area === 'platform/plugins') return <PluginReviewPage />
  if (['identity/providers', 'identity/mapping', 'identity/login-failures', 'platform/settings', 'platform/redemptions'].includes(route.area)) return <PlatformSettingsWorkspace area={route.area as Parameters<typeof PlatformSettingsWorkspace>[0]['area']} id={route.id} />
  if (route.area === 'organizations/directory' || route.area === 'organizations/members') return <ReferenceOrganizationPage route={route} />
  if (route.area === 'accounts') return <ReferenceOrganizationPage route={{ area: 'organizations/directory', id: route.id, sub: route.id ? 'account' : 'accounts' }} />
  if (route.area === 'permissions/audit') return <PlatformPage area="audit" />
  if (route.area.startsWith('models/')) return <ModelRuntimeWorkspace view={route.area === 'models/adapters' ? 'adapters' : route.area === 'models/runtimes' ? 'runtimes' : 'models'} runtimeId={route.id} />
  if (route.area.startsWith('sync/')) return <SyncResourcePage area={route.area} />
  if (route.area.startsWith('permissions/') || route.area.startsWith('identity/')) return <OrganizationResourcePage area={route.area} id={route.id} />
  if (route.area.startsWith('platform/')) return <PlatformPage area={route.area.slice('platform/'.length)} />
  return <OverviewPage />
}

export default function AdminShell({ segments }: { segments: string[] }) {
  const route = useMemo(() => routeFromSegments(segments), [segments])
  const me = useData('/v1/me')
  const [navOpen, setNavOpen] = useState(false)
  if (me.loading) return <main className="auth-loading"><span className="brand-mark">智</span><strong>{t.adminBrand}</strong><span>{t.loading}</span></main>
  if (me.error) {
    if (me.errorStatus === 401 ||
      /login|required|verified/i.test(me.error)) return <LoginGate error={me.error} onAuthenticated={me.reload} />
    return <main className="auth-loading"><strong>{t.error}</strong><span>{me.error}</span><button className="primary" onClick={me.reload}>{t.refresh}</button></main>
  }
  return <div className="shell"><button className="mobile-nav-toggle" onClick={() => setNavOpen(value => !value)} aria-label={t.openNavigation}>☰</button>{navOpen ? <button className="mobile-nav-scrim" onClick={() => setNavOpen(false)} aria-label={t.closeNavigation} /> : null}<aside className={navOpen ? 'nav-open' : ''}><div className="brand-lockup"><span className="brand-mark">智</span><span className="wordmark">{t.adminBrand}<small>{t.administration}</small></span></div><div className="scope-switcher"><small>{t.currentScope}</small><strong>{t.globalScope}</strong><span>⌄</span></div><nav aria-label={t.navigation}>{navigation.map(group => <div className="nav-group" key={group.label}><span className="nav-label">{message(group.label)}</span>{group.items.map(([key, href]) => { const itemArea = key === 'overview' ? 'overview' : key === 'usage' ? 'platform/usage' : key === 'globalAudit' ? 'permissions/audit' : key === 'organizationDirectory' ? 'organizations/directory' : key === 'modelRuntime' ? 'models/catalog' : key === 'permissionsGovernance' ? 'permissions/catalog' : key === 'platformSettingsNav' ? 'platform/settings' : key === 'syncScripts' ? 'sync/scripts' : key; const selected = key === 'platformSettingsNav' ? ['platform/settings', 'platform/redemptions', 'identity/providers', 'identity/mapping', 'identity/login-failures'].includes(route.area) : key === 'modelRuntime' ? route.area.startsWith('models/') : key === 'permissionsGovernance' ? route.area.startsWith('permissions/') : route.area === itemArea; return <a className={selected ? 'selected' : ''} href={href} key={key} onClick={() => setNavOpen(false)}><span className="nav-icon" aria-hidden="true">{key === 'overview' ? '▦' : key === 'usage' ? '⌁' : key.includes('organization') ? '♙' : key.includes('sync') ? '⟳' : key.includes('permission') || key === 'permissionsGovernance' ? '◇' : key.includes('model') || key === 'modelRuntime' ? '▣' : '⚙'}</span>{message(key)}</a> })}</div>)}</nav><div className="sidebar-health"><strong>{t.systemHealth}</strong><span><i /><span>{t.monitoringUnavailable}</span></span><small>{t.lastHealthCheck}</small></div><div className="account"><span className="account-avatar">{text(first(me.value)?.name).slice(0, 1) || '智'}</span><span><strong>{text(first(me.value)?.name) || t.platformAdministrator}</strong><small>{text(first(me.value)?.email)}</small></span></div></aside><main><ShellContent route={route} /></main></div>
}
