'use client'

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { z } from 'zod'
import { zh as t } from './messages'
import { request } from './client-api'

const row = z.record(z.string(), z.unknown())
const rows = z.array(row)
type Row = z.infer<typeof row>
type Section = 'overview' | 'units' | 'members' | 'models' | 'runtimes' | 'sessions' | 'plugins' | 'usage' | 'audit' | 'platform'
type NavigationLabel = 'workspace' | 'controls' | 'records' | 'system'
type PageDescriptionKey = `${Section}Description`
const descriptions: Record<Section, PageDescriptionKey> = {
  overview: 'overviewDescription', units: 'unitsDescription', members: 'membersDescription',
  models: 'modelsDescription', runtimes: 'runtimesDescription', sessions: 'sessionsDescription',
  plugins: 'pluginsDescription', usage: 'usageDescription', audit: 'auditDescription', platform: 'platformDescription',
}
const navigation: Array<{ label: NavigationLabel; items: Section[] }> = [
  { label: 'workspace', items: ['overview', 'units', 'members'] },
  { label: 'controls', items: ['models', 'runtimes', 'plugins'] },
  { label: 'records', items: ['sessions', 'usage', 'audit'] },
  { label: 'system', items: ['platform'] },
]
const text = (value: unknown) =>
  value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
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
  const [sessionQuery, setSessionQuery] = useState('')
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
    if (!me || (!organization && section !== 'platform')) return
    let disposed = false
    setData(null)
    setDetail(null)
    setNotice('')
    const path = section === 'platform'
      ? '/v1/platform/models'
      : section === 'sessions'
        ? prefix + '/sessions?scope=organization' + (sessionQuery.trim() ? '&q=' + encodeURIComponent(sessionQuery.trim()) : '')
        : prefix + '/' + section
    void request(path)
      .then((value) => {
        if (!disposed) setData(value)
      })
      .catch(() => {
        if (!disposed) setNotice(t.error)
      })
    return () => {
      disposed = true
    }
  }, [organization, section, revision, me, prefix, sessionQuery])

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
        <select aria-label={t.selectOrg} value={organization} onChange={event => setOrganization(event.target.value)}>
          <option value="">{t.selectOrg}</option>
          {organizations.map(item => (
            <option key={text(item.id)} value={text(item.id)}>
              {text(item.name)}
            </option>
          ))}
        </select>
        <nav aria-label={t.navigation}>
          {navigation.map(group => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{t[group.label]}</span>
              {group.items.map(item => (
                <button key={item} className={section === item ? 'selected' : ''} onClick={() => setSection(item)}>
                  {t[item]}
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
            <small>{(organizations.find(item => item.id === organization)?.name as string) ?? t.organization}</small>
            <h1>{t[section]}</h1>
            <p className="page-description">{t[descriptions[section]]}</p>
          </div>
          <button onClick={() => setRevision(value => value + 1)}>{t.refresh}</button>
        </header>
        <p className="status-line" role="status">{notice}</p>
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
        {section === 'platform' && Array.isArray(data) && (
          <>
            <section className="card">
              <h2>{t.modelConfiguration}</h2>
              <Table
                data={parseRows(data)}
                actions={item => (
                  <button
                    onClick={() =>
                      void action('/v1/platform/models/' + text(item.id), 'PATCH', { enabled: !item.enabled })
                    }
                  >
                    {item.enabled ? t.disabled : t.enabled}
                  </button>
                )}
              />
              <form
                className="grid-form"
                onSubmit={form(form =>
                  action('/v1/platform/models', 'POST', {
                    name: string(form, 'name'),
                    baseUrl: string(form, 'baseUrl'),
                    upstreamModel: string(form, 'upstreamModel'),
                    apiKey: string(form, 'apiKey'),
                    inputMicrosPerMillion: number(form, 'inputPrice'),
                    outputMicrosPerMillion: number(form, 'outputPrice'),
                    contextTokens: number(form, 'contextTokens'),
                    maxOutputTokens: number(form, 'outputTokens'),
                  }),
                )}
              >
                {(
                  [
                    'name',
                    'baseUrl',
                    'upstreamModel',
                    'apiKey',
                    'inputPrice',
                    'outputPrice',
                    'contextTokens',
                    'outputTokens',
                  ] as const
                ).map(key => (
                  <Field
                    key={key}
                    name={key}
                    label={t[key]}
                    type={
                      key === 'apiKey'
                        ? 'password'
                        : ['inputPrice', 'outputPrice', 'contextTokens', 'outputTokens'].includes(key)
                          ? 'number'
                          : 'text'
                    }
                  />
                ))}
                <button disabled={busy}>{t.create}</button>
              </form>
            </section>
            <section className="card">
              <form
                className="inline"
                onSubmit={form(form =>
                  action(
                    '/v1/platform/organizations/' +
                      string(form, 'organizationId') +
                      '/models/' +
                      string(form, 'modelId'),
                    'PUT',
                    { enabled: true },
                  ),
                )}
              >
                <Field name="organizationId" label={t.organizationId} value={organization} />
                <Field name="modelId" label={t.modelId} />
                <button disabled={busy}>{t.grant}</button>
              </form>
            </section>
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
        {detail != null && (
          <section className="card">
            <button onClick={() => setDetail(null)}>{t.close}</button>
            <pre>{JSON.stringify(detail, null, 2)}</pre>
          </section>
        )}
      </main>
    </div>
  )
}
