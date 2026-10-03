'use client'

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { request } from './client-api'
import { HeterogeneousModelEditorModal, ModelEditorModal } from './admin-components'
import { CreateAccountModal, OrganizationTree } from './admin-components'
import { zh as t } from './messages'

type RecordValue = Record<string, unknown>
type Route = { area: string; id?: string; sub?: string }

const text = (value: unknown): string => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const rows = (value: unknown): RecordValue[] => Array.isArray(value) ? value.filter((item): item is RecordValue => Boolean(item) && typeof item === 'object') : value && typeof value === 'object' ? [value as RecordValue] : []
const first = (value: unknown): RecordValue | null => rows(value)[0] ?? null
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
  return <main className="login"><section className="login-brand"><div className="brand-lockup"><span className="brand-mark">智</span><div className="wordmark">{t.adminBrand}</div></div><div className="login-hero"><h1>{t.loginHeroTitle}</h1><p>{t.loginHeroDescription}</p></div><p className="login-note">{t.adminLoginOnly}</p></section><section className="login-form-panel"><h2>{t.signInHeading}</h2><p className="muted">{t.subtitle}</p><form onSubmit={signIn}><label>{t.email}<input name="email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label><label>{t.password}<input name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label><button className="primary" disabled={busy}>{busy ? t.loading : t.login}</button></form><p className="login-note">{t.adminLoginOnly}</p><p className="login-error" role="alert">{notice}</p></section></main>
}

function DataTable({ data, columns, onRow, actions }: { data: RecordValue[]; columns: Array<{ key: string; label: string }>; onRow?: (item: RecordValue) => void; actions?: (item: RecordValue) => ReactNode }) {
  if (!data.length) return <div className="empty-state compact"><strong>{t.noData}</strong><span>{t.noSelection}</span></div>
  return <div className="table-scroll"><table><thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}{actions ? <th>{t.operation}</th> : null}</tr></thead><tbody>{data.map((item, index) => <tr key={text(item.id) || String(index)} onClick={() => onRow?.(item)} className={onRow ? 'clickable-row' : ''}>{columns.map(column => <td key={column.key}>{column.key === 'status' || column.key === 'state' || column.key === 'enabled' ? status(item[column.key]) : column.key === 'kind' || column.key === 'unitType' ? (t.organizationKinds[text(item[column.key]) as keyof typeof t.organizationKinds] ?? text(item[column.key])) : localizedValue(item[column.key], column.key) || '—'}</td>)}{actions ? <td className="actions-cell" onClick={event => event.stopPropagation()}>{actions(item)}</td> : null}</tr>)}</tbody></table></div>
}

type OperationField = { name: string; label: string; type?: 'text' | 'email' | 'password' | 'url' | 'number' | 'datetime-local' | 'textarea' | 'select'; required?: boolean; defaultValue?: string; options?: Array<{ value: string; label: string }> }

function OperationModal({ open, title, description, fields, busy, onClose, onSubmit }: { open: boolean; title: string; description?: string; fields: OperationField[]; busy: boolean; onClose: () => void; onSubmit: (values: Record<string, string>) => void }) {
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

function SyncScriptModal({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (value: SyncScriptValues) => void }) {
  const [template, setTemplate] = useState<SyncTemplateKey>('rest')
  const [name, setName] = useState('企业目录分页同步')
  const [source, setSource] = useState(syncTemplates.rest.source)
  useEffect(() => {
    if (open) {
      setTemplate('rest')
      setName('企业目录分页同步')
      setSource(syncTemplates.rest.source)
    }
  }, [open])
  if (!open) return null
  const selected = syncTemplates[template]
  const chooseTemplate = (value: SyncTemplateKey) => {
    setTemplate(value)
    setSource(syncTemplates[value].source)
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="modal modal-wide sync-script-modal" role="dialog" aria-modal="true" aria-labelledby="sync-script-modal-title"><div className="modal-heading"><div><p className="eyebrow">{t.syncScripts}</p><h2 id="sync-script-modal-title">{t.createSyncScript}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label={t.close}>×</button></div><p className="muted">{t.syncScriptFlow}</p><div className="sync-flow"><span>读取源系统</span><b>→</b><span>分页拉取</span><b>→</b><span>字段转换</span><b>→</b><span>预览审批</span><b>→</b><span>分批应用</span></div><form className="operation-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ name: name.trim(), source, input: selected.input }) }}><label>{t.name}<input autoFocus value={name} onChange={event => setName(event.target.value)} required /></label><label>{t.templateType}<select value={template} onChange={event => chooseTemplate(event.target.value as SyncTemplateKey)}>{Object.entries(syncTemplates).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label><p className="muted sync-template-help">{selected.description}</p><label>{t.scriptSource}<textarea rows={16} value={source} onChange={event => setSource(event.target.value)} required /></label><details className="sync-example" open><summary>{t.syncInputExample}</summary><pre>{selected.input}</pre></details><div className="sync-standard-note"><strong>{t.syncOutputStandard}</strong><span>{t.syncOutputStandardDescription}</span><code>organizations[] · users[] · memberships[] · page.nextCursor</code></div><div className="modal-actions"><button type="button" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy || !name.trim() || !source.trim()}>{busy ? t.loading : t.saveAndPreview}</button></div></form></section></div>
}

function SyncPreviewModal({ open, scriptName, busy, onClose, onSubmit }: { open: boolean; scriptName: string; busy: boolean; onClose: () => void; onSubmit: (input: string) => void }) {
  const [input, setInput] = useState(syncTemplates.rest.input)
  useEffect(() => { if (open) setInput(syncTemplates.rest.input) }, [open])
  if (!open) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="sync-preview-title"><div className="modal-heading"><div><p className="eyebrow">{t.syncScripts}</p><h2 id="sync-preview-title">{t.testSyncScript}: {scriptName}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label={t.close}>×</button></div><p className="muted">{t.syncPreviewDescription}</p><label>{t.syncInputJson}<textarea rows={13} value={input} onChange={event => setInput(event.target.value)} /></label><div className="sync-standard-note"><strong>{t.syncLargeData}</strong><span>{t.syncLargeDataDescription}</span></div><div className="modal-actions"><button type="button" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy} onClick={() => onSubmit(input)}>{busy ? t.loading : t.runPreview}</button></div></section></div>
}

function ConfirmModal({ open, title, description, busy, onClose, onConfirm }: { open: boolean; title: string; description: string; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  if (!open) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-operation-title"><div className="modal-heading"><h2 id="confirm-operation-title">{title}</h2><button className="icon-button" type="button" onClick={onClose} aria-label={t.close}>×</button></div><p className="muted">{description}</p><div className="modal-actions"><button type="button" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy} onClick={onConfirm}>{busy ? t.loading : t.confirm}</button></div></section></div>
}

type IdentityProtocol = keyof typeof t.identityProtocols
type IdentityProviderForm = { name: string; protocol: IdentityProtocol; issuer?: string; config: Record<string, string> }

function IdentityProviderModal({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (value: IdentityProviderForm) => void }) {
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

function PageFrame({ title, description, eyebrow, actions, children }: { title: string; description?: string; eyebrow?: string; actions?: ReactNode; children: ReactNode }) {
  return <><header><div className="page-heading"><div className="breadcrumb"><span>{eyebrow ?? t.platformManagement}</span><b>›</b><strong>{title}</strong></div><h1>{title}</h1>{description ? <p className="page-description">{description}</p> : null}</div><div className="header-actions">{actions}</div></header>{children}</>
}

const navigation = [
  { label: 'overviewGroup', items: [['overview', '/overview'], ['globalAudit', '/permissions/audit']] },
  { label: 'identityGroup', items: [['organizationDirectory', '/organizations/directory'], ['accounts', '/accounts'], ['syncScripts', '/sync/scripts'], ['identityProviders', '/identity/providers']] },
  { label: 'governanceGroup', items: [['permissions', '/permissions/catalog'], ['sessions', '/permissions/session-approvals']] },
  { label: 'runtimeGroup', items: [['models', '/models/catalog'], ['runtimes', '/models/runtimes'], ['platform', '/platform/settings'], ['redemptionCodes', '/platform/redemptions'], ['systemHealth', '/platform/health']] },
] as const

function routeFromSegments(segments: string[]): Route {
  if (!segments.length) return { area: 'overview' }
  if (segments[0] === 'organizations') return { area: `organizations/${segments[1] ?? 'directory'}`, id: segments[2] }
  if (segments[0] === 'accounts') return { area: 'accounts', id: segments[1] }
  if (segments[0] === 'sync') return { area: `sync/${segments[1] ?? 'scripts'}` }
  if (segments[0] === 'permissions') return { area: `permissions/${segments[1] ?? 'catalog'}` }
  if (segments[0] === 'models') return { area: `models/${segments[1] ?? 'catalog'}`, id: segments[2] }
  if (segments[0] === 'identity') return { area: segments[1] === 'providers' && segments[2] ? 'identity/mapping' : `identity/${segments[1] ?? 'providers'}`, id: segments[2] }
  if (segments[0] === 'platform') return { area: `platform/${segments[1] ?? 'settings'}` }
  return { area: 'overview' }
}

function OverviewPage() {
  const data = useData('/v1/platform/overview')
  const snapshot = first(data.value)
  const metrics = snapshot?.metrics && typeof snapshot.metrics === 'object' ? snapshot.metrics as RecordValue : {}
  const health = rows(snapshot?.health)
  return <PageFrame title={t.overview} description={t.overviewDescription} actions={<a className="primary-button" href="/organizations/directory">{t.globalDirectory}</a>}>
    {data.error ? <p className="error" role="alert">{data.error}</p> : null}
    <MetricStrip values={[{ label: t.organizationCount, value: text(metrics.organizations) || '0' }, { label: t.memberCount, value: text(metrics.members) || '0' }, { label: t.onlineRuntimes, value: text(metrics.runtimes) || '0', tone: 'success' }, { label: t.monthlyCost, value: `¥ ${((Number(metrics.totalCostMicrosCny) || 0) / 1_000_000).toFixed(2)}` }]} />
    <div className="overview-grid overview-grid-bottom"><section className="card health-card"><div className="card-heading"><h2>{t.systemHealth}</h2><a className="text-button" href="/platform/health">{t.viewDetails}</a></div>{data.loading ? <p className="muted">{t.loading}</p> : health.map(item => <div className="health-row" key={text(item.id)}><span><i className={`status-dot ${statusTone(item.status)}`} />{text(item.label)}</span>{status(item.status)}</div>)}</section><section className="card"><div className="card-heading"><h2>{t.pendingItems}</h2><a className="text-button" href="/sync/diffs">{t.viewAll}</a></div><p className="muted">{t.pendingItemsDescription}</p><div className="detail-grid"><div><dt>{t.directorySync}</dt><dd>{text(snapshot?.pending)}</dd></div><div><dt>{t.recentAudit}</dt><dd>{rows(snapshot?.audit).length}</dd></div></div></section></div>
  </PageFrame>
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
  const allNodes = Object.values(nodeCache).flat().concat(rootRows).filter((item, index, list) => list.findIndex(other => text(other.id) === text(item.id)) === index)
  const selected = allNodes.find(item => text(item.id) === selectedId) ?? rootRows[0]
  const organizationId = text(selected?.id)
  const organizationRows = allNodes
  const members = useData(organizationId ? `/v1/platform/organization-nodes/${organizationId}/members` : null)
  const memberRows = rows(first(members.value)?.members)
  const [modal, setModal] = useState<'create' | 'invite' | null>(null)
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
        setNodeCache(current => ({ ...current, [parent]: (current[parent] ?? []).filter(item => text(item.id) !== text((created as RecordValue)?.id)) }))
        await tree.reload()
      } else if (modal === 'invite') {
        await request(`/v1/organizations/${organizationId}/invitations`, 'POST', { email: values.email.trim(), role: values.role })
        await members.reload()
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
    return <PageFrame title={t.memberDetail} description={t.memberDetailDescription} eyebrow={t.globalDirectory} actions={<a className="secondary-button" href="/organizations/directory">{t.backToDirectory}</a>}><section className="card"><div className="detail-heading"><div><h3>{text(target?.name) || t.noSelection}</h3><p className="muted">{text(target?.email)}</p></div>{status(target?.status)}</div><div className="detail-grid"><div><dt>{t.membershipId}</dt><dd>{text(target?.id)}</dd></div><div><dt>{t.createdAt}</dt><dd>{text(target?.createdAt)}</dd></div><div><dt>{t.role}</dt><dd>{text(target?.role) || t.member}</dd></div><div><dt>{t.currentOrganization}</dt><dd>{text(first(tree.value)?.name)}</dd></div></div></section></PageFrame>
  }
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
  return <PageFrame title={t.organizationDirectory} description={t.organizationDirectoryDescription} actions={<button className="primary" onClick={() => setModal('create')} disabled={!organizationId}>＋ {t.createChildOrganization}</button>}><MetricStrip values={[{ label: t.organizations, value: String(organizationRows.length) }, { label: t.memberCount, value: String(memberRows.length) }, { label: t.active, value: String(memberRows.filter(item => text(item.status) === 'active').length), tone: 'success' }, { label: t.attentionRequired, value: String(memberRows.filter(item => text(item.status) !== 'active').length), tone: 'warning' }]} />{tree.error ? <p className="error" role="alert">{tree.error}</p> : null}{members.error ? <p className="error" role="alert">{members.error}</p> : null}{notice ? <p className="operation-notice" role="status">{notice}</p> : null}<div className="resource-split"><div className="resource-list"><OrganizationTree nodes={organizationRows} childrenByParent={nodeCache} loading={tree.loading} loadingIds={loadingIds} expanded={expanded} selected={organizationId} onToggle={item => void toggleNode(item)} onSelect={item => setSelectedId(text(item.id))} /></div><div className="resource-detail"><div className="detail-heading"><div><h3>{text(selected?.name) || t.noSelection}</h3><p className="muted">{text(selected?.displayPath) || text(selected?.path) || text(selected?.id)}</p></div><button className="secondary-button" type="button" onClick={() => setModal('invite')} disabled={!organizationId}>{t.invite}</button></div><DataTable data={memberRows} columns={[{ key: 'name', label: t.name }, { key: 'email', label: t.email }, { key: 'status', label: t.status }, { key: 'createdAt', label: t.createdAt }]} onRow={item => window.location.assign(`/organizations/members/${text(item.id)}?organizationId=${organizationId}`)} /></div></div><OperationModal open={modal === 'create'} title={t.createChildOrganization} description={`${t.parentOrganization}: ${text(selected?.displayPath) || text(selected?.name)}`} fields={[{ name: 'name', label: t.name }, { name: 'kind', label: t.kind, type: 'select', defaultValue: childKinds[0], options: childKinds.map(value => ({ value, label: t.organizationKinds[value as keyof typeof t.organizationKinds] ?? value })) }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /><OperationModal open={modal === 'invite'} title={t.invite} description={t.membersDescription} fields={[{ name: 'email', label: t.email, type: 'email' }, { name: 'role', label: t.role, type: 'select', defaultValue: 'member', options: [{ value: 'member', label: t.member }, { value: 'administrator', label: t.administrator }] }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /></PageFrame>
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
  const columns = area.startsWith('sync/') ? [{ key: 'name', label: t.name }, { key: 'version', label: t.version }, { key: 'changeType', label: t.changeType }, { key: 'status', label: t.status }, { key: 'createdAt', label: t.createdAt }] : area === 'permissions/catalog' ? [{ key: 'id', label: t.permissionId }, { key: 'resource', label: t.resource }, { key: 'action', label: t.action }, { key: 'highRisk', label: t.risk }] : area === 'identity/providers' ? [{ key: 'name', label: t.name }, { key: 'protocol', label: t.protocol }, { key: 'issuer', label: t.issuer }, { key: 'state', label: t.status }] : area === 'identity/mapping' ? [{ key: 'sourceField', label: t.sourceField }, { key: 'targetField', label: t.targetField }, { key: 'transform', label: t.transform }, { key: 'required', label: t.required }] : [{ key: 'name', label: t.name }, { key: 'role', label: t.role }, { key: 'action', label: t.action }, { key: 'status', label: t.status }, { key: 'createdAt', label: t.createdAt }]
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
            ? { name: values.name.trim(), protocol: values.protocol, ...(values.issuer.trim() ? { issuer: values.issuer.trim() } : {}), config: {} }
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
  return <PageFrame title={labels[area] ?? t.resourceList} description={descriptions[area]} actions={pageActions}><MetricStrip values={[{ label: t.total, value: String(mapping.length) }, { label: t.pending, value: String(mapping.filter(item => /pending|draft|preview/.test(text(item.status))).length), tone: 'warning' }, { label: t.approved, value: String(mapping.filter(item => /approved|published|completed/.test(text(item.status))).length), tone: 'success' }, { label: t.failed, value: String(mapping.filter(item => /failed|rejected/.test(text(item.status))).length), tone: 'warning' }]} />{data.error ? <p className="error" role="alert">{data.error}</p> : null}{notice ? <p className="operation-notice" role="status">{notice}</p> : null}<section className="card"><div className="filter-bar"><span className="filter-label">{t.filters}</span><select aria-label={t.status}><option>{t.filterAll}</option></select><button type="button" onClick={data.reload}>{t.refresh}</button></div><DataTable data={mapping} columns={columns} actions={rowActions} /></section>{area === 'identity/providers' ? <IdentityProviderModal open={modalOpen} busy={busy} onClose={() => setModalOpen(false)} onSubmit={submitIdentityProvider} /> : area === 'sync/scripts' ? <><SyncScriptModal open={modalOpen} busy={busy} onClose={() => setModalOpen(false)} onSubmit={value => void submitSyncScript(value)} /><SyncPreviewModal open={previewScript !== null} scriptName={text(previewScript?.name)} busy={busy} onClose={() => setPreviewScript(null)} onSubmit={value => void testExistingScript(value)} /></> : <OperationModal open={modalOpen} title={labels[area] ?? t.create} description={descriptions[area]} fields={fields} busy={busy} onClose={() => setModalOpen(false)} onSubmit={submit} />}<ConfirmModal open={pending !== null} title={pending?.title ?? t.operation} description={t.confirmTitle} busy={busy} onClose={() => setPending(null)} onConfirm={() => { const action = pending; setPending(null); if (action) void mutate(action.path, action.method, action.body) }} /></PageFrame>
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
  if (area === 'health') return <PageFrame title={t.systemHealth} description={t.systemHealthDescription} actions={<button className="secondary-button" onClick={data.reload}>{t.refresh}</button>}><MetricStrip values={[{ label: t.services, value: String(rows(payload?.services).length) }, { label: t.healthy, value: String(rows(payload?.services).filter(item => item.status === 'ready').length), tone: 'success' }, { label: t.unknown, value: String(rows(payload?.services).filter(item => item.status === 'unknown').length), tone: 'warning' }, { label: t.lastUpdated, value: text(payload?.checkedAt) }]} />{notice ? <p className="operation-notice" role="status">{notice}</p> : null}<section className="card"><DataTable data={rows(payload?.services)} columns={[{ key: 'label', label: t.service }, { key: 'status', label: t.status }, { key: 'latencyMs', label: t.latency }, { key: 'availability', label: t.availability }]} /></section></PageFrame>
  const labels: Record<string, string> = { settings: t.platformSettings, redemptions: t.redemptionCodes, models: t.modelCatalog, adapters: t.modelAdapters, runtimes: t.runtimeDevices, audit: t.globalAudit }
  const descriptions: Record<string, string> = { settings: t.platformSettingsDescription, redemptions: t.redemptionCodesDescription, models: `${t.modelCatalogDescription} ${t.modelAdaptersDescription}`, adapters: t.modelAdaptersDescription, runtimes: t.runtimeDevicesDescription, audit: t.globalAuditDescription }
  const columns = area === 'settings' ? [{ key: 'registration', label: t.registrationPolicy }, { key: 'mode', label: t.mode }, { key: 'domains', label: t.domains }] : area === 'redemptions' ? [{ key: 'batchId', label: t.batchId }, { key: 'codeHint', label: t.code }, { key: 'amountMicrosCny', label: t.amountCny }, { key: 'redeemedAt', label: t.redeemed }, { key: 'expiresAt', label: t.expired }] : area === 'audit' ? [{ key: 'createdAt', label: t.createdAt }, { key: 'action', label: t.action }, { key: 'resourceId', label: t.resource }, { key: 'actorId', label: t.account }] : area === 'adapters' ? [{ key: 'publicModel', label: t.model }, { key: 'operation', label: t.operation }, { key: 'mode', label: t.executionMode }, { key: 'billing', label: t.billingMode }, { key: 'version', label: t.version }, { key: 'enabled', label: t.status }] : area === 'runtimes' ? [{ key: 'name', label: t.name }, { key: 'type', label: t.columns.type }, { key: 'version', label: t.version }, { key: 'leaseUntil', label: t.columns.leaseUntil }, { key: 'revokedAt', label: t.columns.revokedAt }] : [{ key: 'name', label: t.name }, { key: 'baseUrl', label: t.baseUrl }, { key: 'upstreamModel', label: t.upstreamModel }, { key: 'enabled', label: t.status }]
  const tableActions = (item: RecordValue) => area === 'redemptions' ? <button className="table-action danger" disabled={Boolean(item.redeemedAt) || Boolean(item.revokedAt) || busy} onClick={() => void mutate(`/v1/platform/redemption-codes/${text(item.id)}/revoke`, 'POST')}>{t.revoke}</button> : area === 'models' ? <><button className="table-action" disabled={busy} onClick={() => { setEditingModel(item); setModelEditorOpen(true) }}>{t.edit}</button><button className="table-action" disabled={busy} onClick={() => void mutate(`/v1/platform/models/${text(item.id)}`, 'PATCH', { enabled: !item.enabled })}>{item.enabled ? t.disabled : t.enabled}</button></> : null
  const policy = area === 'settings' ? payload : null
  return <PageFrame title={labels[area] ?? t.resourceList} description={descriptions[area]} actions={area === 'settings' ? <button className="primary" onClick={() => setModal('settings')}>{t.configure}</button> : area === 'redemptions' ? <button className="primary" onClick={() => setModal('redemptions')}>＋ {t.create}</button> : area === 'models' ? <button className="primary" onClick={() => { setEditingModel(null); setModelEditorOpen(true) }}>＋ {t.create}</button> : area === 'adapters' ? <button className="primary" onClick={() => setAdapterEditorOpen(true)}>＋ {t.create}</button> : <button className="secondary-button" onClick={data.reload}>{t.refresh}</button>}><section className="card">{data.error ? <p className="error" role="alert">{data.error}</p> : null}{notice ? <p className="operation-notice" role="status">{notice}</p> : null}<div className="detail-grid"><div><dt>{t.total}</dt><dd>{tableRows.length || (payload ? 1 : 0)}</dd></div><div><dt>{t.lastUpdated}</dt><dd>{text(payload?.lastUpdated) || new Date().toLocaleString('zh-CN')}</dd></div></div><DataTable data={tableRows} columns={columns} onRow={area === 'runtimes' ? item => window.location.assign(`/models/runtimes/${text(item.id)}`) : undefined} actions={['redemptions', 'models'].includes(area) ? tableActions : undefined} /></section>{generatedCodes ? <section className="card generated-codes"><div className="card-heading"><h2>{t.redemptionCreated}</h2><button className="secondary-button" onClick={() => setGeneratedCodes(null)}>{t.close}</button></div><p><strong>{t.batchId}:</strong> {text(generatedCodes.batchId)}</p><pre>{Array.isArray(generatedCodes.codes) ? generatedCodes.codes.join('\n') : ''}</pre></section> : null}<OperationModal open={modal === 'settings'} title={t.platformSettings} description={t.platformSettingsDescription} fields={[{ name: 'registration', label: t.registrationPolicy, type: 'select', defaultValue: text(policy?.registration) || 'open', options: Object.entries(t.registrationPolicies).map(([value, label]) => ({ value, label })) }, { name: 'domains', label: t.domains, defaultValue: Array.isArray(policy?.domains) ? policy.domains.join(', ') : '', required: false }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /><OperationModal open={modal === 'redemptions'} title={t.createRedemptionBatch} description={t.redemptionCodesDescription} fields={[{ name: 'amountCny', label: t.amountCny, type: 'number', defaultValue: '100' }, { name: 'count', label: t.redemptionCount, type: 'number', defaultValue: '1' }, { name: 'expiresAt', label: t.redemptionExpiresAt, type: 'datetime-local', required: false }, { name: 'note', label: t.redemptionNote, required: false }]} busy={busy} onClose={() => setModal(null)} onSubmit={submit} /><ModelEditorModal open={modelEditorOpen} model={editingModel} busy={busy} onClose={() => { setModelEditorOpen(false); setEditingModel(null) }} onSubmit={value => void saveModel(value)} /><HeterogeneousModelEditorModal open={adapterEditorOpen} busy={busy} onClose={() => setAdapterEditorOpen(false)} onSubmit={value => void saveAdapter(value)} /></PageFrame>
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
  if (route.area === 'organizations/directory' || route.area === 'organizations/members') return <OrganizationPage route={route} />
  if (route.area === 'accounts') return <AccountsPage id={route.id} />
  if (route.area === 'permissions/audit') return <PlatformPage area="audit" />
  if (route.area === 'models/runtimes' && route.id) return <RuntimeDetail id={route.id} />
  if (route.area.startsWith('sync/') || route.area.startsWith('permissions/') || route.area.startsWith('identity/')) return <OrganizationResourcePage area={route.area} id={route.id} />
  if (route.area.startsWith('models/')) return <PlatformPage area="models" />
  if (route.area.startsWith('platform/')) return <PlatformPage area={route.area.slice('platform/'.length)} />
  return <OverviewPage />
}

export default function AdminShell({ segments }: { segments: string[] }) {
  const route = useMemo(() => routeFromSegments(segments), [segments])
  const me = useData('/v1/me')
  const [navOpen, setNavOpen] = useState(false)
  if (me.loading) return <main className="auth-loading"><span className="brand-mark">智</span><strong>{t.adminBrand}</strong><span>{t.loading}</span></main>
  if (me.error) {
    if (me.errorStatus === 401 || /login|required|verified/i.test(me.error)) return <LoginGate error={me.error} onAuthenticated={me.reload} />
    return <main className="auth-loading"><strong>{t.error}</strong><span>{me.error}</span><button className="primary" onClick={me.reload}>{t.refresh}</button></main>
  }
  return <div className="shell"><button className="mobile-nav-toggle" onClick={() => setNavOpen(value => !value)} aria-label={t.openNavigation}>☰</button>{navOpen ? <button className="mobile-nav-scrim" onClick={() => setNavOpen(false)} aria-label={t.closeNavigation} /> : null}<aside className={navOpen ? 'nav-open' : ''}><div className="brand-lockup"><span className="brand-mark">智</span><span className="wordmark">{t.adminBrand}<small>{t.administration}</small></span></div><div className="scope-switcher"><small>{t.currentScope}</small><strong>{t.globalScope}</strong><span>⌄</span></div><nav aria-label={t.navigation}>{navigation.map(group => <div className="nav-group" key={group.label}><span className="nav-label">{message(group.label)}</span>{group.items.map(([key, href]) => <a className={route.area === (key === 'overview' ? 'overview' : key === 'systemHealth' ? 'platform/health' : key === 'globalAudit' ? 'permissions/audit' : key === 'organizationDirectory' ? 'organizations/directory' : key === 'identityProviders' ? 'identity/providers' : key === 'redemptionCodes' ? 'platform/redemptions' : key === 'sessions' ? 'permissions/session-approvals' : key === 'runtimes' ? 'models/runtimes' : key === 'models' ? 'models/catalog' : key === 'permissions' ? 'permissions/catalog' : key === 'platform' ? 'platform/settings' : key === 'syncScripts' ? 'sync/scripts' : key === 'accounts' ? 'accounts' : key) ? 'selected' : ''} href={href} key={key} onClick={() => setNavOpen(false)}><span className="nav-icon" aria-hidden="true">{key === 'overview' ? '▦' : key.includes('organization') || key === 'accounts' ? '♙' : key.includes('sync') ? '⟳' : key.includes('permission') || key === 'sessions' ? '◇' : key.includes('model') || key === 'runtimes' ? '▣' : key === 'systemHealth' ? '♥' : '⚙'}</span>{message(key)}</a>)}</div>)}</nav><div className="sidebar-health"><strong>{t.systemHealth}</strong><span><i />{t.monitoringUnavailable}</span><small>{t.lastHealthCheck}</small></div><div className="account"><span className="account-avatar">{text(first(me.value)?.name).slice(0, 1) || '智'}</span><span><strong>{text(first(me.value)?.name) || t.platformAdministrator}</strong><small>{text(first(me.value)?.email)}</small></span></div></aside><main><ShellContent route={route} /></main></div>
}
