'use client'

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { z } from 'zod'
import { zh as t } from './messages'
import { request } from './client-api'
import { AccountDrawer, CreateOrganizationModal, ModelEditorModal, OrganizationTree } from './admin-components'

const row = z.record(z.string(), z.unknown())
const rows = z.array(row)
type Row = z.infer<typeof row>
type Section = 'organizationDirectory' | 'accounts' | 'globalAudit' | 'overview' | 'units' | 'members' | 'models' | 'runtimes' | 'sessions' | 'plugins' | 'usage' | 'audit' | 'modelConfig' | 'platform'
type NavigationLabel = 'global' | 'workspace' | 'controls' | 'records' | 'system'
type PageDescriptionKey = `${Section}Description`
const descriptions: Record<Section, PageDescriptionKey> = {
  organizationDirectory: 'organizationDirectoryDescription', accounts: 'accountsDescription', globalAudit: 'globalAuditDescription',
  overview: 'overviewDescription', units: 'unitsDescription', members: 'membersDescription',
  models: 'modelsDescription', runtimes: 'runtimesDescription', sessions: 'sessionsDescription',
  plugins: 'pluginsDescription', usage: 'usageDescription', audit: 'auditDescription', modelConfig: 'modelConfigDescription', platform: 'platformDescription',
}
const navigation: Array<{ label: NavigationLabel; items: Section[] }> = [
  { label: 'global', items: ['organizationDirectory', 'accounts', 'globalAudit'] },
  { label: 'workspace', items: ['overview', 'units', 'members'] },
  { label: 'controls', items: ['models', 'runtimes', 'plugins'] },
  { label: 'records', items: ['sessions', 'usage', 'audit'] },
  { label: 'system', items: ['modelConfig', 'platform'] },
]
const text = (value: unknown) =>
  value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const message = (key: string): string => {
  const value = (t as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : key
}
const parseRow = (value: unknown): Row | null => {
  const result = row.safeParse(value)
  return result.success ? result.data : null
}
const parseRows = (value: unknown): Row[] => {
  const result = rows.safeParse(value)
  return result.success ? result.data : []
}
const subscriptionRows = (value: unknown): Row[] => {
  const overview = parseRow(value)
  const subscription = overview ? parseRow(overview.subscription) : null
  return subscription ? [subscription] : []
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
    key => !['secret', 'tokenHash', 'organizationId', 'header', 'manifest', 'review'].includes(key),
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
                <td key={key}>{text(item[key])}</td>
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

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
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
  const [accountDetail, setAccountDetail] = useState<Row | null>(null)
  const [accountTab, setAccountTab] = useState<'organizations' | 'roles' | 'runtimes' | 'sessions' | 'usage' | 'audit'>('organizations')
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
  const prefix = '/v1/organizations/' + organization

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
    if (!me || (!organization && !['platform', 'organizationDirectory', 'accounts', 'globalAudit', 'modelConfig'].includes(section))) return
    let disposed = false
    setData(null)
    setDetail(null)
    setNotice('')
    const path = section === 'modelConfig'
      ? '/v1/platform/models'
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
          setPageState(Array.isArray(value) && value.length === 0 ? 'empty' : 'ready')
          if (section === 'organizationDirectory') setPlatformOrganizations(parseRows(value))
          if (section === 'accounts') setPlatformAccounts(parseRows(value))
        }
      })
      .catch(() => {
        if (!disposed) { setNotice(t.error); setPageState('error') }
      })
    return () => {
      disposed = true
    }
  }, [organization, section, revision, me, prefix, sessionQuery, accountQuery])
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
    void request('/v1/platform/organizations/' + selectedDirectoryOrganization + '/members')
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
    if (typeof window !== 'undefined') window.history.replaceState(null, '', '?organizationId=' + encodeURIComponent(id))
  }
  function openAccount(item: Row) {
    void request('/v1/platform/accounts/' + text(item.id) + '/organizations').then((value) => {
      setAccountDetail(parseRow(value))
      setAccountTab('organizations')
      setAccountResource(null)
    }).catch(() => setNotice(t.error))
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

  if (!me)
    return (
      <main className="login">
        <div className="wordmark">{t.brand}</div>
        <h1>{t.signInHeading}</h1>
        <p className="muted">{t.subtitle}</p>
        <form
          onSubmit={form(async (data) => {
            await action('/auth/sign-in/email', 'POST', {
              email: string(data, 'email'),
              password: string(data, 'password'),
            })
            await loadIdentity()
          })}
        >
          <Field name="email" label={t.email} type="email" />
          <Field name="password" label={t.password} type="password" />
          <button className="primary" disabled={busy}>
            {t.login}
          </button>
        </form>
        <p className="muted">{t.adminLoginOnly}</p>
        <a href={process.env.NEXT_PUBLIC_ENTERPRISE_PORTAL_URL ?? 'http://127.0.0.1:3001'}>{t.userPortal}</a>
        <p role="status">{notice}</p>
      </main>
    )

  return (
    <div className="shell">
      <aside>
        <div className="wordmark">{t.brand}</div>
        <small>{t.administration}</small>
        <nav aria-label={t.navigation}>
          {navigation.map(group => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{t[group.label]}</span>
              {group.items.map(item => (
                <button key={item} className={section === item ? 'selected' : ''} onClick={() => setSection(item)}>
                  {message(item)}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="account">
          <span>{text(me.email)}</span>
          <button onClick={() => void action('/auth/sign-out', 'POST', {}).then(loadIdentity)}>{t.logout}</button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <h1>{message(section)}</h1>
            <p className="page-description">{message(descriptions[section])}</p>
          </div>
          <button onClick={() => setRevision(value => value + 1)}>{t.refresh}</button>
        </header>
        <p className="status-line" role="status">{notice}</p>
        {!['organizationDirectory', 'accounts', 'modelConfig', 'platform'].includes(section) && <PageState state={pageState} />}
        {section === 'organizationDirectory' && (
          <section className="split-layout">
            <div className="card tree-panel">
              <div className="card-heading"><h2>{t.organizationTree}</h2><button onClick={() => setRevision(value => value + 1)}>{t.refresh}</button></div>
              <OrganizationTree roots={platformOrganizations} children={organizationChildren}
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
                  <div className="subnav-tabs" role="tablist"><button onClick={() => setSection('accounts')}>{t.accounts}</button><button onClick={() => setSection('members')}>{t.members}</button></div>
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
          <section className="card">
            <form className="inline" onSubmit={form(async (form) => { setAccountQuery(string(form, 'query')); setRevision(value => value + 1) })}>
              <Field name="query" label={t.search} value={accountQuery} onChange={event => setAccountQuery(event.currentTarget.value)} required={false} />
              <button disabled={busy}>{t.search}</button>
            </form>
            <Table data={platformAccounts} actions={item => <button onClick={() => openAccount(item)}>{t.accountOverview}</button>} />
          </section>
        )}
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
            <ModelEditorModal open={modelEditorOpen} model={editingModel} busy={busy}
              onClose={() => { setModelEditorOpen(false); setEditingModel(null) }} onSubmit={value => void saveModel(value)} />
          </section>
        )}
        {section === 'overview' && data != null && (
          <section className="card">
            <p>{t.snapshot}</p>
            <Table data={subscriptionRows(data)} />
          </section>
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
              <Field name="unitType" label={t.unitType} value="department" />
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
        {section === 'runtimes' && (
          <section className="card">
            <Table
              data={parseRows(data)}
              actions={item => (
                <button
                  disabled={Boolean(item.revokedAt)}
                  onClick={() => void action(prefix + '/runtimes/' + text(item.id), 'DELETE')}
                >
                  {t.revoke}
                </button>
              )}
            />
          </section>
        )}
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
        {section === 'plugins' && organization && (
          <section className="card">
            <p>{t.pluginReview}</p>
            <form
              className="grid-form"
              onSubmit={form(form =>
                action(prefix + '/plugins', 'POST', {
                  manifest: {
                    pluginId: string(form, 'pluginId'),
                    version: string(form, 'pluginVersion'),
                    targets: [string(form, 'pluginTarget')],
                    permissions: string(form, 'pluginPermissions').split(',').map(value => value.trim()).filter(Boolean),
                    tools: [],
                  },
                  clientCode: string(form, 'pluginCode'),
                }, t.submitPlugin),
              )}
            >
              <Field name="pluginId" label={t.pluginId} />
              <Field name="pluginVersion" label={t.pluginVersion} value="1.0.0" />
              <label>
                {t.pluginTarget}
                <select name="pluginTarget">
                  <option value="desktop">desktop</option>
                  <option value="browser">browser</option>
                  <option value="cloud">cloud</option>
                </select>
              </label>
              <Field name="pluginPermissions" label={t.pluginPermissions} required={false} />
              <Field name="pluginCode" label={t.pluginCode} multiline />
              <button disabled={busy}>{t.submitPlugin}</button>
            </form>
            <Table
              data={parseRows(data)}
              actions={(item) => {
                const status = text(item.status)
                if (status === 'awaiting_ai') {
                  return (
                    <form
                      className="inline"
                      onSubmit={form(form =>
                        action(prefix + '/plugins/' + text(item.id) + '/ai-review', 'POST', {
                          runtimeId: string(form, 'runtimeId'),
                        }, t.aiReview),
                      )}
                    >
                      <Field name="runtimeId" label={t.reviewRuntime} />
                      <button disabled={busy}>{t.aiReview}</button>
                    </form>
                  )
                }
                if (status === 'awaiting_human') {
                  return (
                    <button
                      disabled={busy}
                      onClick={() => void action(prefix + '/plugins/' + text(item.id) + '/approve', 'POST', { digest: text(item.digest) }, t.approve)}
                    >
                      {t.approve}
                    </button>
                  )
                }
                if (status === 'published') {
                  return (
                    <button
                      disabled={busy}
                      onClick={() => void action(prefix + '/plugins/' + text(item.id) + '/revoke', 'POST', undefined, t.revoke)}
                    >
                      {t.revoke}
                    </button>
                  )
                }
                return null
              }}
            />
          </section>
        )}
        {(section === 'audit' || section === 'usage') && (
          <section className="card">
            <Table data={parseRows(data)} />
          </section>
        )}
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
                    budgetMicros: number(form, 'budget'),
                  }),
                )}
              >
                {(['organizationId', 'plan', 'seats', 'runtimeLimit', 'budget'] as const).map(key => (
                  <Field
                    key={key}
                    name={key}
                    label={t[key]}
                    type={['seats', 'runtimeLimit', 'budget'].includes(key) ? 'number' : 'text'}
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
                    {['open', 'domain_restricted', 'invite_only', 'disabled'].map(value => (
                      <option key={value}>{value}</option>
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
          onClose={() => { setAccountDetail(null); setAccountResource(null) }} onTabChange={setAccountTab} />
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
