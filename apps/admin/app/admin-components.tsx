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
        <tbody>{data.map((item, index) => (
          <tr key={text(item.id) || index}>{keys.map(key => <td key={key}>{text(item[key])}</td>)}</tr>
        ))}</tbody>
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
  const render = (items: AdminRow[], depth = 0): ReactNode => items.map((item) => {
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
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
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
  const [values, setValues] = useState<Record<string, string>>({ name: '', baseUrl: '', upstreamModel: '', apiKey: '', inputPrice: '0', cachedInputPrice: '0', outputPrice: '0', contextTokens: '8192', outputTokens: '4096', protocol: 'openai-completions', inputModalities: 'text', videoAudioMode: 'visual-only', fileInputPolicy: 'unsupported', maxFileBytes: '10485760', maxRequestBytes: '33554432', filesTtlSeconds: '604800', fileUploadTimeoutMs: '120000', fileUploadMaxRetries: '1', fileRefreshMarginSeconds: '60', fileQuotaCleanupBatch: '0', modelCallTimeoutMs: '300000' })
  useEffect(() => {
    if (!open) return
    setValues({
      name: text(model?.name), baseUrl: text(model?.baseUrl), upstreamModel: text(model?.upstreamModel), apiKey: '',
      inputPrice: text(model?.inputPriceCnyPerMillion ?? 0),
      cachedInputPrice: text(model?.cachedInputPriceCnyPerMillion ?? 0),
      outputPrice: text(model?.outputPriceCnyPerMillion ?? 0),
      contextTokens: text(model?.contextTokens || 8192), outputTokens: text(model?.maxOutputTokens || 4096),
      protocol: text(model?.protocol || 'openai-completions'),
      inputModalities: Array.isArray(model?.inputModalities) ? model.inputModalities.join(',') : (model?.images ? 'text,image' : 'text'),
      videoAudioMode: text(model?.videoAudioMode || 'visual-only'),
      fileInputPolicy: text(model?.fileInputPolicy || 'unsupported'),
      maxFileBytes: text(model?.maxFileBytes || 10 * 1024 * 1024),
      maxRequestBytes: text(model?.maxRequestBytes || 32 * 1024 * 1024),
      filesTtlSeconds: text(model?.filesTtlSeconds || 7 * 24 * 60 * 60),
      fileUploadTimeoutMs: text(model?.fileUploadTimeoutMs || 120_000),
      fileUploadMaxRetries: text(model?.fileUploadMaxRetries ?? 1),
      fileRefreshMarginSeconds: text(model?.fileRefreshMarginSeconds ?? 60),
      fileQuotaCleanupBatch: text(model?.fileQuotaCleanupBatch ?? 0),
      modelCallTimeoutMs: text(model?.modelCallTimeoutMs || 300_000),
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
    onSubmit({
      name: values.name.trim(),
      baseUrl: values.baseUrl.trim(),
      upstreamModel: values.upstreamModel.trim(),
      ...(values.apiKey ? { apiKey: values.apiKey } : {}),
      inputPriceCnyPerMillion: Number(values.inputPrice),
      cachedInputPriceCnyPerMillion: Number(values.cachedInputPrice),
      outputPriceCnyPerMillion: Number(values.outputPrice),
      contextTokens: Number(values.contextTokens),
      maxOutputTokens: Number(values.outputTokens),
      protocol: values.protocol,
      inputModalities: values.inputModalities.split(',').map(value => value.trim()).filter(Boolean),
      videoAudioMode: values.videoAudioMode,
      fileInputPolicy: values.fileInputPolicy,
      maxFileBytes: Number(values.maxFileBytes),
      maxRequestBytes: Number(values.maxRequestBytes),
      filesTtlSeconds: Number(values.filesTtlSeconds),
      fileUploadTimeoutMs: Number(values.fileUploadTimeoutMs),
      fileUploadMaxRetries: Number(values.fileUploadMaxRetries),
      fileRefreshMarginSeconds: Number(values.fileRefreshMarginSeconds),
      fileQuotaCleanupBatch: Number(values.fileQuotaCleanupBatch),
      modelCallTimeoutMs: Number(values.modelCallTimeoutMs),
    })
  }
  const fields = [['name', t.name, 'text'], ['baseUrl', t.baseUrl, 'url'], ['upstreamModel', t.upstreamModel, 'text'], ['apiKey', t.apiKey, 'password'], ['inputPrice', t.inputPrice, 'number'], ['cachedInputPrice', t.cachedInputPrice, 'number'], ['outputPrice', t.outputPrice, 'number'], ['contextTokens', t.contextTokens, 'number'], ['outputTokens', t.outputTokens, 'number'], ['modelCallTimeoutMs', t.modelCallTimeoutMs, 'number'], ['maxFileBytes', t.maxFileBytes, 'number'], ['maxRequestBytes', t.maxRequestBytes, 'number'], ['filesTtlSeconds', t.filesTtlSeconds, 'number'], ['fileUploadTimeoutMs', t.fileUploadTimeoutMs, 'number'], ['fileUploadMaxRetries', t.fileUploadMaxRetries, 'number'], ['fileRefreshMarginSeconds', t.fileRefreshMarginSeconds, 'number'], ['fileQuotaCleanupBatch', t.fileQuotaCleanupBatch, 'number']] as const
  const modalities = new Set(values.inputModalities.split(',').filter(Boolean))
  const toggleModality = (modality: string, checked: boolean) => {
    const next = new Set(modalities)
    if (checked) next.add(modality)
    else next.delete(modality)
    next.add('text')
    update('inputModalities', ['text', 'image', 'video', 'audio', 'document'].filter(value => next.has(value)).join(','))
    if (modality === 'video' && !checked) update('videoAudioMode', 'visual-only')
  }
  const hasNativeFiles = [...modalities].some(modality => modality === 'video' || modality === 'audio' || modality === 'document')
  const limitsValid = Number(values.maxRequestBytes) >= Number(values.maxFileBytes)
    && Number(values.fileRefreshMarginSeconds) < Number(values.filesTtlSeconds)
    && Number(values.modelCallTimeoutMs) >= 1_000
    && Number(values.modelCallTimeoutMs) <= 30 * 60 * 1_000
  const capabilityValid = !hasNativeFiles || values.fileInputPolicy !== 'unsupported'
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="model-editor-title"><div className="modal-heading"><div><p className="eyebrow">{t.modelConfiguration}</p><h2 id="model-editor-title">{model ? t.edit : t.create}</h2></div><button className="icon-button" onClick={onClose} aria-label={t.close}>×</button></div><form className="grid-form" onSubmit={submit}>{fields.map(([key, label, type]) => <label key={key}>{label}<input type={type} value={values[key]} onChange={event => update(key, event.target.value)} {...(key === 'contextTokens' || key === 'outputTokens' ? { max: MODEL_TOKEN_LIMIT } : key === 'modelCallTimeoutMs' ? { min: 1_000, max: 30 * 60 * 1_000 } : key.endsWith('Price') ? { min: 0, step: '0.000001' } : {})} required={key !== 'apiKey'} /></label>)}<label>{t.protocol}<select value={values.protocol} onChange={event => update('protocol', event.target.value)}>{Object.entries(t.protocols).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>{t.fileInputPolicy}<select value={values.fileInputPolicy} onChange={event => update('fileInputPolicy', event.target.value)}>{Object.entries(t.filePolicies).map(([value, label]) => <option key={value} value={value} disabled={value === 'signed-url'}>{value === 'signed-url' ? t.signedUrlUnavailable : label}</option>)}</select></label><fieldset><legend>{t.inputModalities}</legend>{Object.entries(t.modalities).map(([modality, label]) => <label key={modality}><input type="checkbox" checked={modalities.has(modality)} disabled={modality === 'text'} onChange={event => toggleModality(modality, event.target.checked)} />{label}</label>)}</fieldset><label>{t.videoAudioMode}<select value={values.videoAudioMode} disabled={!modalities.has('video')} onChange={event => update('videoAudioMode', event.target.value)}>{Object.entries(t.videoAudioModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="modal-actions"><button type="button" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy || !values.name.trim() || !limitsValid || !capabilityValid}>{t.confirm}</button></div></form></section></div>
}

type HeterogeneousOperation = 'embedding.create' | 'image.generate' | 'video.generate' | 'audio.synthesize' | 'audio.transcribe'
const heterogeneousPresets: Record<HeterogeneousOperation, { usage: string; prices: string; resultUrl: string; resultContent: string }> = {
  'embedding.create': { usage: '[\n  { "key": "input_tokens", "unit": "token", "path": "usage.input_tokens" }\n]', prices: '{\n  "input_tokens": "1000000"\n}', resultUrl: '', resultContent: '' },
  'image.generate': { usage: '[\n  { "key": "generated_images", "unit": "image", "path": "usage.images" }\n]', prices: '{\n  "generated_images": "1000000"\n}', resultUrl: 'url', resultContent: '' },
  'video.generate': { usage: '[\n  { "key": "video_seconds", "unit": "second", "path": "usage.seconds" }\n]', prices: '{\n  "video_seconds": "1000000"\n}', resultUrl: 'url', resultContent: '' },
  'audio.synthesize': { usage: '[\n  { "key": "input_characters", "unit": "character", "path": "usage.characters" }\n]', prices: '{\n  "input_characters": "1000000"\n}', resultUrl: 'url', resultContent: '' },
  'audio.transcribe': { usage: '[\n  { "key": "audio_seconds", "unit": "second", "path": "usage.seconds" }\n]', prices: '{\n  "audio_seconds": "1000000"\n}', resultUrl: '', resultContent: 'text' },
}

/** Configure a provider-neutral non-text model adapter. */
export function HeterogeneousModelEditorModal({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean
  busy: boolean
  onClose: () => void
  onSubmit: (value: Record<string, unknown>) => void
}) {
  const [operation, setOperation] = useState<HeterogeneousOperation>('image.generate')
  const [values, setValues] = useState({
    publicModel: '', baseUrl: '', apiKey: '', reserveCny: '0.10',
    failureBilling: 'free', submitMethod: 'POST', queryMethod: 'POST',
    submitPath: '/v1/generations', queryPath: '/v1/generations/{{providerTaskId}}',
    submitBody: '{\n  "model": "{{model}}",\n  "input": "{{input}}",\n  "parameters": "{{parameters}}",\n  "idempotency_key": "{{idempotencyKey}}"\n}',
    queryBody: '{\n  "task_id": "{{providerTaskId}}"\n}',
    statusPath: 'status',
    statusValues: '{\n  "queued": "processing",\n  "processing": "processing",\n  "succeeded": "succeeded",\n  "failed": "failed",\n  "cancelled": "cancelled"\n}',
    providerTaskId: 'id', resultPath: 'data', resultKind: 'image', resultUrl: 'url', resultContent: '',
    usage: '[\n  { "key": "generated_images", "unit": "image", "path": "usage.images" }\n]',
    prices: '{\n  "generated_images": "1000000"\n}',
    parameters: '{}',
  })
  const [parseError, setParseError] = useState('')
  useEffect(() => {
    if (!open) return
    setOperation('image.generate')
    setParseError('')
    setValues(value => ({ ...value, publicModel: '', apiKey: '' }))
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])
  if (!open) return null
  const update = (key: keyof typeof values, value: string) => setValues(previous => ({ ...previous, [key]: value }))
  const changeOperation = (next: HeterogeneousOperation) => {
    setOperation(next)
    setValues(previous => ({ ...previous, ...heterogeneousPresets[next] }))
  }
  const resultKind = operation === 'embedding.create' ? 'embedding' : operation === 'audio.transcribe' ? 'transcript' : operation.startsWith('audio.') ? 'audio' : operation.startsWith('video.') ? 'video' : 'image'
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const submitBody = JSON.parse(values.submitBody) as unknown
      const queryBody = JSON.parse(values.queryBody) as unknown
      const statusValues = JSON.parse(values.statusValues) as unknown
      const usage = JSON.parse(values.usage) as unknown
      const prices = JSON.parse(values.prices) as unknown
      const parameters = JSON.parse(values.parameters) as unknown
      setParseError('')
      onSubmit({
        publicModel: values.publicModel.trim(), operation, apiKey: values.apiKey,
        configuration: {
          baseUrl: values.baseUrl.trim(), failureBilling: values.failureBilling, parameters,
          submit: { method: values.submitMethod, path: values.submitPath.trim(), headers: {}, body: submitBody },
          query: { method: values.queryMethod, path: values.queryPath.trim(), headers: {}, body: queryBody },
          response: {
            status: values.statusPath.trim(), statusValues, providerTaskId: values.providerTaskId.trim(),
            results: values.resultPath.trim(), resultKind, ...(values.resultUrl.trim() ? { resultUrl: values.resultUrl.trim() } : {}),
            ...(values.resultContent.trim() ? { resultContent: values.resultContent.trim() } : {}), usage,
          },
        },
        prices,
        reserveMicrosCny: Math.round(Number(values.reserveCny) * 1_000_000),
      })
    } catch (error) {
      setParseError(error instanceof Error ? error.message : t.invalidJson)
    }
  }
  const jsonField = (key: keyof typeof values, label: string, rows = 4) => <label className="full-width">{label}<textarea rows={rows} value={values[key]} onChange={event => update(key, event.target.value)} required /></label>
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="heterogeneous-model-editor-title"><div className="modal-heading"><div><p className="eyebrow">{t.heterogeneousModel}</p><h2 id="heterogeneous-model-editor-title">{t.create}</h2></div><button className="icon-button" onClick={onClose} aria-label={t.close}>×</button></div><p className="muted">{t.heterogeneousModelDescription}</p><form className="grid-form" onSubmit={submit}>
    <label>{t.modelCapability}<select value={operation} onChange={event => changeOperation(event.target.value as HeterogeneousOperation)}>{Object.entries(t.modelCapabilities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>{t.publicModel}<input value={values.publicModel} onChange={event => update('publicModel', event.target.value)} required /></label>
    <label>{t.baseUrl}<input type="url" value={values.baseUrl} onChange={event => update('baseUrl', event.target.value)} required /></label>
    <label>{t.apiKey}<input type="password" value={values.apiKey} onChange={event => update('apiKey', event.target.value)} required autoComplete="new-password" /></label>
    <label>{t.reserveCny}<input type="number" min="0" step="0.000001" value={values.reserveCny} onChange={event => update('reserveCny', event.target.value)} required /></label>
    <label>{t.failureBilling}<select value={values.failureBilling} onChange={event => update('failureBilling', event.target.value)}><option value="free">{t.failureBillingFree}</option><option value="usage">{t.failureBillingUsage}</option></select></label>
    <label>{t.submitMethod}<select value={values.submitMethod} onChange={event => update('submitMethod', event.target.value)}><option value="POST">POST</option><option value="GET">GET</option></select></label>
    <label>{t.queryMethod}<select value={values.queryMethod} onChange={event => update('queryMethod', event.target.value)}><option value="POST">POST</option><option value="GET">GET</option></select></label>
    <label>{t.submitPath}<input value={values.submitPath} onChange={event => update('submitPath', event.target.value)} required /></label>
    <label>{t.queryPath}<input value={values.queryPath} onChange={event => update('queryPath', event.target.value)} required /></label>
    <label>{t.statusPath}<input value={values.statusPath} onChange={event => update('statusPath', event.target.value)} required /></label>
    <label>{t.providerTaskIdPath}<input value={values.providerTaskId} onChange={event => update('providerTaskId', event.target.value)} required /></label>
    <label>{t.resultPath}<input value={values.resultPath} onChange={event => update('resultPath', event.target.value)} /></label>
    <label>{t.resultUrlPath}<input value={values.resultUrl} onChange={event => update('resultUrl', event.target.value)} /></label>
    {resultKind === 'transcript' && <label>{t.resultContentPath}<input value={values.resultContent} onChange={event => update('resultContent', event.target.value)} /></label>}
    {jsonField('parameters', t.parameterSchema)}{jsonField('statusValues', t.statusMapping)}{jsonField('usage', t.usageMapping)}{jsonField('prices', t.usagePrices)}{jsonField('submitBody', t.submitBody)}{jsonField('queryBody', t.queryBody)}
    {parseError && <p className="error full-width" role="alert">{parseError}</p>}
    <div className="modal-actions full-width"><button type="button" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy || !values.publicModel.trim() || !values.baseUrl.trim() || !values.apiKey || ((operation === 'image.generate' || operation === 'video.generate') && Number(values.reserveCny) <= 0)}>{t.confirm}</button></div>
  </form></section></div>
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
        <div className="drawer-toolbar"><input aria-label={t.search} placeholder={t.search} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} /><span className="muted">{filtered.length}</span></div>
        <div className="drawer-content"><Table data={filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)} /></div>
        <div className="drawer-pagination"><button disabled={currentPage <= 1} onClick={() => setPage(value => value - 1)}>‹</button><span>{currentPage} / {pageCount}</span><button disabled={currentPage >= pageCount} onClick={() => setPage(value => value + 1)}>›</button></div>
      </aside>
    </>
  )
}
