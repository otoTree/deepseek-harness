'use client'

/** Administrator-only enterprise identity and directory workflows, scoped to explicit team membership. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { request } from './client-api'
import { useActivityRevision } from './activity-refresh'
import { IdentityProviderModal, type IdentityProviderForm } from './enterprise-identity-form'
import { zh } from './messages'

const t = zh.enterpriseAdmin
type Row = Record<string, unknown>
const rowList = z.array(z.record(z.string(), z.unknown()))
const text = (value: unknown) => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const rows = (value: unknown): Row[] => value == null ? [] : rowList.parse(value)
const label = (value: unknown) => t.values[text(value) as keyof typeof t.values]
  ?? zh.statusLabels[text(value) as keyof typeof zh.statusLabels] ?? text(value)
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}

function useResource(path: string | null) {
  const activity = useActivityRevision(), [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ path: string | null; data: unknown; error: string; loading: boolean }>({ path, data: null, error: '', loading: Boolean(path) })
  useEffect(() => {
    if (!path) return
    let disposed = false
    setState(previous => ({ path, data: previous.path === path ? previous.data : null, error: '', loading: true }))
    void request(path).then((data) => {
      if (!disposed) setState({ path, data, error: '', loading: false })
    }, (error) => {
      if (!disposed) setState({ path, data: null, error: error instanceof Error ? error.message : zh.error, loading: false })
    })
    return () => { disposed = true }
  }, [path, revision, activity])
  return { ...(state.path === path && path ? state : { data: null, error: '', loading: Boolean(path) }),
    reload: () => setRevision(value => value + 1) }
}

function ResourceNotice({ resource }: { resource: ReturnType<typeof useResource> }) {
  return <>{resource.error && <p role="alert" className="error">{resource.error}</p>}{resource.loading && resource.data === null && <p role="status">{zh.loading}</p>}</>
}

function Table({ columns, items, actions }: { columns: Array<[string, string]>; items: Row[]; actions?: (row: Row) => ReactNode }) {
  return <div className="table-scroll"><table><thead><tr>{columns.map(([key, title]) => <th key={key}>{title}</th>)}{actions && <th>{zh.action}</th>}</tr></thead><tbody>{items.map((item, index) => <tr key={text(item.id) || index}>{columns.map(([key]) => <td key={key}>{key === 'status' ? <span className={`status-badge ${/failed|rejected|disabled/.test(text(item[key])) ? 'danger' : /draft|preview|pending|queued/.test(text(item[key])) ? 'warning' : 'success'}`}>{label(item[key])}</span> : ['entityType', 'changeType'].includes(key) ? label(item[key]) : text(item[key]) || '—'}</td>)}{actions && <td><div className="actions">{actions(item)}</div></td>}</tr>)}</tbody></table>{!items.length && <p className="empty">{zh.noData}</p>}</div>
}

function Dialog({ title, busy, close, error, children }: {
  title: string
  busy: boolean
  close: () => void
  error?: string
  children: ReactNode
}) {
  return <div className="modal-backdrop"><section className="modal modal-wide" role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><h2>{title}</h2><button type="button" disabled={busy} data-dialog-close onClick={close}>{zh.cancel}</button></div>{error && <p className="error" role="alert">{error}</p>}{children}</section></div>
}

function EnterpriseContent({ area, providerId, organizationId }: { area: string; providerId?: string; organizationId: string }) {
  const prefix = '/v1/organizations/' + encodeURIComponent(organizationId)
  const identity = area.startsWith('identity/')
  const capability = useResource(prefix + '/capabilities')
  const permissions = capability.data ? z.object({ permissions: z.array(z.string()) }).parse(capability.data).permissions : []
  const allowed = permissions.includes(identity ? 'identity.manage' : 'directory.sync')
  const data = useResource(!allowed ? null : prefix + (area === 'identity/login-failures' ? '/identity-login-failures' : identity ? '/identity-providers' : area === 'sync/runs' || area === 'sync/history' ? '/sync-runs' : area === 'sync/diffs' ? '/sync-diffs?limit=100' : '/sync-scripts'))
  const history = useResource(allowed && area === 'sync/history' ? prefix + '/sync-rollbacks' : null)
  const items = rows(data.data)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [providerEditor, setProviderEditor] = useState<Row | 'new'>()
  const [scriptEditor, setScriptEditor] = useState<Row | 'new'>()
  const [previewScript, setPreviewScript] = useState<Row>()
  const [preview, setPreview] = useState<unknown>()
  const [confirm, setConfirm] = useState<{ title: string; work: () => Promise<void> }>()
  const [checked, setChecked] = useState(false)
  const link = (path: string) => path + '?organizationId=' + encodeURIComponent(organizationId)
  async function perform(work: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await work(); data.reload(); history.reload(); setConfirm(undefined); setNotice(t.saved) }
    catch (value) { setError(value instanceof Error ? value.message : zh.error) }
    finally { setBusy(false) }
  }
  const ask = (title: string, work: () => Promise<void>) => { setChecked(false); setConfirm({ title, work }) }
  const mutation = async (path: string, method: string, body?: unknown) => { await request(prefix + path, method, body) }
  const saveProvider = (values: IdentityProviderForm) => void perform(async () => {
    const provider = providerEditor === 'new' ? undefined : providerEditor
    const config = { ...(provider?.protocol === values.protocol ? record(provider.config) : {}), ...values.config }
    await mutation('/identity-providers' + (provider ? '/' + encodeURIComponent(text(provider.id)) : ''), provider ? 'PATCH' : 'POST', {
      ...values, config, ...(provider ? { expectedVersion: provider.version } : {}),
    })
    setProviderEditor(undefined)
  })
  const tabs: Array<[string, string]> = identity ? [['identity/providers', zh.identityProviders], ['identity/mapping', zh.fieldMapping], ['identity/login-failures', zh.loginFailures]] : [['sync/scripts', t.scriptList], ['sync/runs', t.runs], ['sync/diffs', zh.syncDiffs], ['sync/history', t.history]]
  return <><ResourceNotice resource={capability} />{capability.data && !allowed && <p className="error" role="alert">{t.noPermission}</p>}
    <div className="reference-tabs" role="tablist">{tabs.map(([key, title]) => <a key={key} className={key === area ? 'selected' : ''} href={link('/' + key)}>{title}</a>)}</div>
    <ResourceNotice resource={data} />{error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {allowed && data.data !== null && <>
      {area === 'identity/providers' && <><div className="stat-strip"><article className="metric-card"><span>{zh.identityProviders}</span><strong>{items.length}</strong></article><article className="metric-card"><span>{zh.enabled}</span><strong>{items.filter(item => item.enabled).length}</strong></article></div><section className="card"><div className="card-heading"><h2>{zh.identityProviders}</h2><button className="primary" disabled={busy} onClick={() => setProviderEditor('new')}>{zh.configure}</button></div><p className="muted">{t.loginSupport}</p><Table columns={[['name', zh.name], ['protocol', zh.protocol], ['issuer', zh.issuer], ['status', zh.status], ['version', zh.version]]} items={items.map(item => ({ ...item, status: item.enabled ? 'active' : 'disabled' }))} actions={item => <><button disabled={busy} onClick={() => setProviderEditor(item)}>{zh.edit}</button><a href={link('/identity/providers/' + encodeURIComponent(text(item.id)) + '/mapping')}>{zh.fieldMapping}</a><button disabled={busy} onClick={() => ask(text(item.name) + ' · ' + (item.enabled ? zh.disabled : zh.enabled), () => mutation('/identity-providers/' + encodeURIComponent(text(item.id)), 'PATCH', { expectedVersion: item.version, enabled: !item.enabled }))}>{item.enabled ? zh.disabled : zh.enabled}</button></>} /></section></>}
      {area === 'identity/mapping' && <MappingEditor key={providerId ?? 'choose'} prefix={prefix} providers={items} providerId={providerId} organizationId={organizationId} />}
      {area === 'identity/login-failures' && <section className="card"><h2>{zh.loginFailures}</h2><p className="muted">{t.recentFailures}</p><Table columns={[['occurredAt', zh.createdAt], ['providerId', t.provider], ['subjectHint', t.subject], ['reasonCode', t.reason]]} items={items} actions={item => <details><summary>{zh.detailPanel}</summary><pre>{JSON.stringify(item.detail, null, 2)}</pre></details>} /></section>}
      {area === 'sync/scripts' && <section className="card"><div className="card-heading"><h2>{t.scriptList}</h2><button className="primary" disabled={busy} onClick={() => setScriptEditor('new')}>{t.createScript}</button></div><p className="muted">{t.scriptHelp}</p><Table columns={[['name', zh.name], ['version', zh.version], ['status', zh.status], ['updatedAt', zh.lastUpdated]]} items={items} actions={item => <><button disabled={busy} onClick={() => setScriptEditor(item)}>{zh.edit}</button><button disabled={busy} onClick={() => { setPreview(undefined); setPreviewScript(item) }}>{zh.testSyncScript}</button>{item.status === 'draft' && <button disabled={busy} onClick={() => ask(text(item.name) + ' · ' + t.approveScript, () => mutation('/sync-scripts/' + encodeURIComponent(text(item.id)) + '/approve', 'POST'))}>{t.approveScript}</button>}{item.status === 'approved' && <button disabled={busy} onClick={() => ask(text(item.name) + ' · ' + zh.publish, () => mutation('/sync-scripts/' + encodeURIComponent(text(item.id)) + '/publish', 'POST'))}>{zh.publish}</button>}</>} /></section>}
      {area === 'sync/runs' && <section className="card"><h2>{t.runs}</h2><p className="muted">{t.runHelp}</p><Table columns={[['id', t.runId], ['scriptName', zh.name], ['scriptVersion', zh.version], ['status', zh.status], ['createdAt', zh.createdAt]]} items={items} actions={item => <details><summary>{zh.detailPanel}</summary><pre>{JSON.stringify({ preview: item.preview, error: item.error }, null, 2)}</pre></details>} /></section>}
      {area === 'sync/diffs' && <section className="card"><h2>{zh.syncDiffs}</h2><p className="muted">{t.diffHelp}</p><Table columns={[['runId', t.runId], ['entityType', zh.type], ['externalId', t.externalId], ['changeType', t.changes], ['status', zh.status]]} items={items} actions={item => <><details><summary>{zh.detailPanel}</summary><h3>{t.before}</h3><pre>{JSON.stringify(item.before, null, 2)}</pre><h3>{t.after}</h3><pre>{JSON.stringify(item.after, null, 2)}</pre></details>{item.status === 'pending' && <>{(['approved', 'rejected'] as const).map(decision => <button key={decision} disabled={busy} onClick={() => ask(text(item.externalId) + ' · ' + (decision === 'approved' ? t.approveDiff : zh.reject), () => mutation('/sync-diffs/' + encodeURIComponent(text(item.id)), 'PATCH', { decision, version: item.version }))}>{decision === 'approved' ? t.approveDiff : zh.reject}</button>)}</>}</>} /></section>}
      {area === 'sync/history' && <><section className="card"><h2>{zh.syncHistory}</h2><p className="muted">{t.historyHelp}</p><Table columns={[['id', t.runId], ['scriptName', zh.name], ['status', zh.status], ['createdAt', zh.createdAt]]} items={items} actions={item => <button disabled={busy || item.status === 'failed' || item.trigger === 'rollback'} onClick={() => ask(text(item.id) + ' · ' + t.rollback, () => mutation('/sync-runs/' + encodeURIComponent(text(item.id)) + '/rollback', 'POST'))}>{t.rollback}</button>} /></section><section className="card"><h2>{t.history}</h2><ResourceNotice resource={history} /><Table columns={[['sourceRunId', t.sourceRun], ['compensatingRunId', t.compensatingRun], ['status', zh.status], ['createdAt', zh.createdAt]]} items={rows(history.data)} /></section></>}
      <IdentityProviderModal open={Boolean(providerEditor)} busy={busy} submitError={error} provider={providerEditor === 'new' ? undefined : providerEditor} onClose={() => { if (!busy) setProviderEditor(undefined) }} onSubmit={saveProvider} />
      {scriptEditor && <ScriptEditor key={scriptEditor === 'new' ? 'new' : text(scriptEditor.id)} error={error} script={scriptEditor === 'new' ? undefined : scriptEditor} busy={busy} close={() => setScriptEditor(undefined)} save={(name, source) => void perform(async () => { await mutation('/sync-scripts' + (scriptEditor === 'new' ? '' : '/' + encodeURIComponent(text(scriptEditor.id))), scriptEditor === 'new' ? 'POST' : 'PATCH', { name, source }); setScriptEditor(undefined) })} />}
      {previewScript && <Dialog title={zh.testSyncScript + ' · ' + text(previewScript.name)} busy={busy} error={error} close={() => setPreviewScript(undefined)}><p>{zh.syncPreviewDescription}</p><form className="enterprise-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void perform(async () => { const input: unknown = JSON.parse(String(form.get('input'))); const result = await request(prefix + '/sync-scripts/' + encodeURIComponent(text(previewScript.id)) + '/test', 'POST', z.record(z.string(), z.unknown()).parse(input)); setPreview(result); if (record(result).accepted !== true) throw new Error(text(record(result).error) || zh.error) }) }}><fieldset disabled={busy}><label>{t.input}<textarea name="input" rows={12} required defaultValue={'{ "departments": [], "users": [], "memberships": [] }'} /></label><button className="primary">{zh.runPreview}</button></fieldset></form>{preview !== undefined && <section><h3>{t.preview}</h3><pre>{JSON.stringify(preview, null, 2)}</pre><a href={link('/sync/diffs')}>{zh.syncDiffs}</a></section>}</Dialog>}
      {confirm && <Dialog title={confirm.title} busy={busy} error={error} close={() => setConfirm(undefined)}><p>{t.confirmHelp}</p><label className="governance-check"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />{t.confirmCheck}</label><div className="modal-actions"><button className="primary" disabled={busy || !checked} onClick={() => void perform(confirm.work)}>{t.confirm}</button></div></Dialog>}
    </>}
  </>
}

function ScriptEditor({ script, busy, close, save, error }: {
  script?: Row
  busy: boolean
  close: () => void
  save: (name: string, source: string) => void
  error?: string
}) {
  return <Dialog title={script ? t.editScript : t.createScript} busy={busy} error={error} close={close}><p className="muted">{t.scriptHelp}</p><form className="enterprise-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); save(String(data.get('name')), String(data.get('source'))) }}><fieldset disabled={busy}><label>{zh.name}<input name="name" required maxLength={120} defaultValue={text(script?.name)} /></label><label>{t.sourceCode}<textarea className="enterprise-code" name="source" required maxLength={256000} rows={16} defaultValue={text(script?.source) || 'module.exports = input => ({ departments: input.departments ?? [], users: input.users ?? [], memberships: input.memberships ?? [] })'} /></label><button className="primary">{zh.save}</button></fieldset></form></Dialog>
}

type Mapping = { sourceField: string; targetField: string; transform: keyof typeof t.transforms; required: boolean; version?: number }
function MappingEditor({ prefix, providers, providerId, organizationId }: {
  prefix: string
  providers: Row[]
  providerId?: string
  organizationId: string
}) {
  const provider = providers.find(item => item.id === providerId)
  const data = useResource(provider ? prefix + '/identity-providers/' + encodeURIComponent(providerId!) + '/mappings' : null)
  const dirty = useRef(false)
  const [mapping, setMapping] = useState<Mapping[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false)
  useEffect(() => {
    if (data.data && !dirty.current) setMapping(z.array(z.object({ sourceField: z.string(), targetField: z.string(), transform: z.enum(['direct', 'lowercase', 'uppercase', 'split', 'join']), required: z.boolean(), version: z.number().int().positive() })).parse(data.data))
  }, [data.data])
  const update = (index: number, change: Partial<Mapping>) => {
    dirty.current = true
    setMapping(items => items.map((item, i) => i === index ? { ...item, ...change } : item))
  }
  return <section className="card"><h2>{zh.fieldMapping}</h2><label>{t.provider}<select value={providerId ?? ''} onChange={(event) => { if (event.target.value) window.location.assign('/identity/providers/' + encodeURIComponent(event.target.value) + '/mapping?organizationId=' + encodeURIComponent(organizationId)) }}><option value="">{t.selectProvider}</option>{providers.map(item => <option key={text(item.id)} value={text(item.id)}>{text(item.name)}</option>)}</select></label><ResourceNotice resource={data} />{error && <p className="error" role="alert">{error}</p>}{saved && <p role="status">{t.saved}</p>}{provider && data.data !== null && <form className="enterprise-form" onSubmit={(event) => { event.preventDefault(); setBusy(true); setError(''); setSaved(false); void request(prefix + '/identity-providers/' + encodeURIComponent(providerId!) + '/mappings', 'PUT', mapping).then(() => { dirty.current = false; setSaved(true); data.reload() }, error => setError(error instanceof Error ? error.message : zh.error)).finally(() => setBusy(false)) }}><fieldset disabled={busy}>{mapping.map((item, index) => <div key={index} className="enterprise-mapping-row"><label>{t.source}<input value={item.sourceField} required maxLength={160} onChange={event => update(index, { sourceField: event.target.value })} /></label><label>{t.target}<input value={item.targetField} required maxLength={160} onChange={event => update(index, { targetField: event.target.value })} /></label><label>{t.transform}<select value={item.transform} onChange={event => update(index, { transform: event.target.value as Mapping['transform'] })}>{Object.entries(t.transforms).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label><label className="governance-check"><input type="checkbox" checked={item.required} onChange={event => update(index, { required: event.target.checked })} />{t.required}</label><button type="button" onClick={() => { dirty.current = true; setMapping(items => items.filter((_, i) => i !== index)) }}>{t.removeMapping}</button></div>)}<div className="actions"><button type="button" disabled={mapping.length >= 100} onClick={() => { dirty.current = true; setMapping(items => [...items, { sourceField: '', targetField: '', transform: 'direct', required: false }]) }}>{t.addMapping}</button><button className="primary">{zh.save}</button></div></fieldset></form>}</section>
}

/** Render enterprise configuration only inside the platform Admin shell and a private deployment. */
export default function EnterpriseWorkspace({ area, providerId }: { area: string; providerId?: string }) {
  const identity = area.startsWith('identity/')
  const policy = useResource('/v1/platform/policy')
  const mode = policy.data ? z.object({ mode: z.enum(['open', 'private']) }).parse(policy.data).mode : undefined
  const teams = useResource(mode === 'private' ? '/v1/organizations' : null)
  const available = rows(teams.data)
  const [organizationId, setOrganizationId] = useState('')
  useEffect(() => { setOrganizationId(new URLSearchParams(window.location.search).get('organizationId') ?? '') }, [])
  const valid = available.some(item => item.id === organizationId)
  return <div className="enterprise-workspace"><header className="page-header"><div className="page-heading"><h1>{identity ? t.identityTitle : t.syncTitle}</h1><p className="page-description">{identity ? t.identityIntro : t.syncIntro}</p></div><button onClick={() => { policy.reload(); teams.reload() }}>{zh.refresh}</button></header><ResourceNotice resource={policy} />{mode === 'open' && <section className="card"><p>{t.privateOnly}</p></section>}{mode === 'private' && <><section className="card enterprise-scope"><label>{t.chooseTeam}<select value={valid ? organizationId : ''} onChange={(event) => { const id = event.target.value; setOrganizationId(id); const url = new URL(window.location.href); if (id) url.searchParams.set('organizationId', id); else url.searchParams.delete('organizationId'); window.history.replaceState(null, '', url) }}><option value="">{t.chooseTeam}</option>{available.map(item => <option key={text(item.id)} value={text(item.id)}>{text(item.name)}</option>)}</select></label><p className="muted">{t.selectionHelp}</p><ResourceNotice resource={teams} />{Boolean(teams.data) && available.length === 0 && <p>{t.noTeam}</p>}</section>{valid && <EnterpriseContent key={organizationId + ':' + area} area={area} providerId={providerId} organizationId={organizationId} />}</>}</div>
}
