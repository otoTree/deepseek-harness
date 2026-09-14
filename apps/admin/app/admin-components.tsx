'use client'

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { zh as t } from './messages'

const MODEL_TOKEN_LIMIT = 2_000_000

export type AdminRow = Record<string, unknown>

const text = (value: unknown): string =>
  value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)

const rows = (value: unknown): AdminRow[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is AdminRow => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

function Table({ data }: { data: AdminRow[] }) {
  if (!data.length) return <p className="muted">{t.noData}</p>
  const keys = Object.keys(data[0]).filter(key => !['secret', 'tokenHash', 'organizationId', 'header', 'manifest', 'review'].includes(key))
  return (
    <div className="table-scroll">
      <table>
        <thead><tr>{keys.map(key => <th key={key}>{t.columns[key as keyof typeof t.columns] ?? t.field}</th>)}</tr></thead>
        <tbody>{data.map((item, index) => <tr key={text(item.id) || index}>{keys.map(key => <td key={key}>{text(item[key])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

export function OrganizationTree({
  roots,
  children,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  roots: AdminRow[]
  children: Record<string, AdminRow[]>
  expanded: Set<string>
  selected: string
  onToggle: (item: AdminRow) => void
  onSelect: (item: AdminRow) => void
}) {
  const render = (items: AdminRow[], depth = 0): ReactNode => items.map(item => {
    const id = text(item.id)
    const isExpanded = expanded.has(id)
    return (
      <div key={id} style={{ paddingLeft: `${depth * 16}px` }}>
        <div className={selected === id ? 'tree-row selected' : 'tree-row'}>
          {item.hasChildren ? <button className="icon-button" onClick={() => onToggle(item)} aria-label={isExpanded ? '收起' : '展开'}>{isExpanded ? '▾' : '▸'}</button> : <span className="tree-spacer" />}
          <button className="tree-node" onClick={() => onSelect(item)}>
            <span>{text(item.name)}</span>
            <small>{text(item.kind)} · {text(item.memberCount)}</small>
          </button>
          <span className={item.status === 'active' ? 'status active' : 'status'}>{item.status === 'active' ? t.active : t.disabled}</span>
        </div>
        {isExpanded && render(children[id] ?? [], depth + 1)}
      </div>
    )
  })
  return <div className="organization-tree">{render(roots)}</div>
}

export function CreateOrganizationModal({
  open,
  busy,
  parentName,
  onClose,
  onSubmit,
}: {
  open: boolean
  busy: boolean
  parentName: string
  onClose: () => void
  onSubmit: (value: { name: string; kind: string }) => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState('team')
  useEffect(() => {
    if (open) { setName(''); setKind('team') }
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])
  if (!open) return null
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (name.trim()) onSubmit({ name: name.trim(), kind })
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose() }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-organization-title">
        <div className="modal-heading"><div><p className="eyebrow">{t.organization}</p><h2 id="create-organization-title">{t.createOrganization}</h2></div><button className="icon-button" onClick={onClose} aria-label={t.close}>×</button></div>
        <p className="muted">{parentName ? `${t.parent}：${parentName}` : t.selectNode}</p>
        <form onSubmit={submit}>
          <label>{t.name}<input autoFocus value={name} onChange={event => setName(event.target.value)} required /></label>
          <label>{t.kind}<select value={kind} onChange={event => setKind(event.target.value)}><option value="team">team</option><option value="enterprise">enterprise</option><option value="department">department</option></select></label>
          <div className="modal-actions"><button type="button" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy || !name.trim()}>{t.confirm}</button></div>
        </form>
      </section>
    </div>
  )
}

export function ModelEditorModal({
  open,
  model,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean
  model: AdminRow | null
  busy: boolean
  onClose: () => void
  onSubmit: (value: Record<string, unknown>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({ name: '', baseUrl: '', upstreamModel: '', apiKey: '', inputPrice: '0', outputPrice: '0', contextTokens: '8192', outputTokens: '4096' })
  useEffect(() => {
    if (!open) return
    setValues({
      name: text(model?.name), baseUrl: text(model?.baseUrl), upstreamModel: text(model?.upstreamModel), apiKey: '',
      inputPrice: text(model?.inputMicrosPerMillion || 0), outputPrice: text(model?.outputMicrosPerMillion || 0),
      contextTokens: text(model?.contextTokens || 8192), outputTokens: text(model?.maxOutputTokens || 4096),
    })
  }, [open, model])
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])
  if (!open) return null
  const update = (key: string, value: string) => setValues(previous => ({ ...previous, [key]: value }))
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit({ name: values.name.trim(), baseUrl: values.baseUrl.trim(), upstreamModel: values.upstreamModel.trim(), ...(values.apiKey ? { apiKey: values.apiKey } : {}), inputMicrosPerMillion: Number(values.inputPrice), outputMicrosPerMillion: Number(values.outputPrice), contextTokens: Number(values.contextTokens), maxOutputTokens: Number(values.outputTokens) })
  }
  const fields = [['name', t.name, 'text'], ['baseUrl', t.baseUrl, 'url'], ['upstreamModel', t.upstreamModel, 'text'], ['apiKey', t.apiKey, 'password'], ['inputPrice', t.inputPrice, 'number'], ['outputPrice', t.outputPrice, 'number'], ['contextTokens', t.contextTokens, 'number'], ['outputTokens', t.outputTokens, 'number']] as const
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose() }}><section className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="model-editor-title"><div className="modal-heading"><div><p className="eyebrow">{t.modelConfiguration}</p><h2 id="model-editor-title">{model ? t.edit : t.create}</h2></div><button className="icon-button" onClick={onClose} aria-label={t.close}>×</button></div><form className="grid-form" onSubmit={submit}>{fields.map(([key, label, type]) => <label key={key}>{label}<input type={type} value={values[key]} onChange={event => update(key, event.target.value)} {...(key === 'contextTokens' || key === 'outputTokens' ? { max: MODEL_TOKEN_LIMIT } : {})} required={key !== 'apiKey'} /></label>)}<div className="modal-actions"><button type="button" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy || !values.name.trim()}>{t.confirm}</button></div></form></section></div>
}

type AccountTab = 'organizations' | 'roles' | 'runtimes' | 'sessions' | 'usage' | 'audit'

export function AccountDrawer({
  account,
  tab,
  resource,
  onClose,
  onTabChange,
}: {
  account: AdminRow | null
  tab: AccountTab
  resource: unknown
  onClose: () => void
  onTabChange: (tab: AccountTab) => void
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => { setQuery(''); setPage(1) }, [account, tab])
  useEffect(() => {
    if (!account) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [account, onClose])
  const record = account ? account : null
  const source = tab === 'organizations' ? record?.memberships : tab === 'roles' ? record?.roles : tab === 'audit' ? (record?.history ?? (resource && (resource as AdminRow).events)) : resource
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase()
    const result = rows(source)
    return value ? result.filter(item => JSON.stringify(item).toLowerCase().includes(value)) : result
  }, [query, source])
  const pageSize = 8
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  if (!account) return null
  const accountRecord = account.account && typeof account.account === 'object' ? account.account as AdminRow : account
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="account-drawer" aria-label={t.accountOverview}>
        <div className="drawer-heading"><div><p className="eyebrow">{t.accountOverview}</p><h2>{text(accountRecord.email)}</h2><p className="muted">{text(accountRecord.name)} · {text(accountRecord.createdAt)}</p></div><button className="icon-button" onClick={onClose} aria-label={t.close}>×</button></div>
        <div className="drawer-tabs" role="tablist">{(['organizations', 'roles', 'runtimes', 'sessions', 'usage', 'audit'] as AccountTab[]).map(value => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'selected' : ''} onClick={() => onTabChange(value)}>{String(t[`${value}Tab` as keyof typeof t] ?? value)}</button>)}</div>
        <div className="drawer-toolbar"><input aria-label={t.search} placeholder={t.search} value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} /><span className="muted">{filtered.length}</span></div>
        <div className="drawer-content"><Table data={filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)} /></div>
        <div className="drawer-pagination"><button disabled={currentPage <= 1} onClick={() => setPage(value => value - 1)}>‹</button><span>{currentPage} / {pageCount}</span><button disabled={currentPage >= pageCount} onClick={() => setPage(value => value + 1)}>›</button></div>
      </aside>
    </>
  )
}
