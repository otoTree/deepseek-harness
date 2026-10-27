'use client'

import { useEffect, useMemo, useState } from 'react'
import CostTrend from './cost-trend'
import { request } from './client-api'
import { useActivityRevision } from './activity-refresh'
import { zh as t } from './messages'

type Row = Record<string, unknown>
type UsageView = 'overview' | 'ranking' | 'reconciliation'
const rows = (input: unknown): Row[] => Array.isArray(input) ? input.filter((item): item is Row => Boolean(item) && typeof item === 'object') : []
const first = (input: unknown): Row | null => input && typeof input === 'object' && !Array.isArray(input) ? input as Row : null
const value = (item: Row | null | undefined, key: string): string => item?.[key] == null ? '' : String(item[key])
const number = (input: unknown): string => Number(input || 0).toLocaleString('zh-CN')
const money = (input: unknown): string => `¥ ${((Number(input) || 0) / 1_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
const day = (offset: number): string => { const current = new Date(); current.setHours(0, 0, 0, 0); current.setDate(current.getDate() + offset); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(current) }
const range = (from: string, to: string): string => {
  // The API accepts RFC 3339 UTC values; date inputs remain Shanghai calendar dates.
  const start = new Date(`${from}T00:00:00+08:00`).toISOString()
  const end = new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 24 * 60 * 60 * 1000).toISOString()
  return `from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`
}

function Metric({ label, metric, icon }: { label: string; metric: string; icon: string }) { return <article className="usage-reference-metric"><div><span>{label}</span><strong>{metric}</strong></div><b aria-hidden="true">{icon}</b></article> }

function Ranking({ title, items }: { title: string; items: Row[] }) {
  const max = Math.max(1, ...items.map(item => Number(item.totalCostMicrosCny) || 0))
  return <section className="usage-reference-card usage-ranking-card"><div className="usage-reference-card-heading"><h2>{title}</h2><span>{items.length} {t.recordsUnit}</span></div>{items.slice(0, 5).map((item, index) => <div className="usage-reference-rank" key={value(item, 'id') || `${title}-${index}`}><div><strong>{value(item, 'label') || value(item, 'name') || '—'}</strong><small>{number(item.calls)} {t.callsUnit} · {number(item.totalTokens)} {t.tokenUnit}</small></div><b>{money(item.totalCostMicrosCny)}</b><i style={{ width: `${Math.max(3, (Number(item.totalCostMicrosCny) || 0) / max * 100)}%` }} /></div>)}{items.length === 0 ? <p className="muted">{t.noUsageInRange}</p> : null}</section>
}

function Trend({ items }: { items: Row[] }) {
  return <section className="usage-reference-card usage-trend-card"><div className="usage-reference-card-heading"><div><h2>{t.platformCostTrend}</h2><span>{t.shanghaiTimezone}</span></div></div><CostTrend items={items} /></section>
}

function RecordsTable({ records, pending, onReconcile }: { records: Row[]; pending: Row[]; onReconcile: (item: Row, outcome: 'failed' | 'settled') => void }) {
  return <><section className="usage-reference-card usage-details-card"><div className="usage-reference-card-heading"><div><h2>{t.platformPendingReconciliation}</h2><span>{t.usageRecordDescription}</span></div><strong>{pending.length} {t.recordsUnit}</strong></div><div className="reference-table-wrap"><table className="reference-table"><thead><tr><th>{t.completedAt}</th><th>{t.organization}</th><th>{t.account}</th><th>{t.model}</th><th>{t.reconciliationReason}</th><th>{t.totalCost}</th><th>{t.operation}</th></tr></thead><tbody>{pending.map((item, index) => <tr key={value(item, 'id') || `pending-${index}`}><td>{value(item, 'occurredAt')}</td><td>{value(item, 'organizationName')}</td><td>{value(item, 'accountEmail')}</td><td>{value(item, 'modelName')}</td><td>{value(item, 'reconciliationReason') || '—'}</td><td>{money(item.totalCostMicrosCny)}</td><td><button className="table-action" onClick={() => onReconcile(item, 'settled')}>{t.platformReconcile}</button><button className="table-action danger" onClick={() => onReconcile(item, 'failed')}>{t.reject}</button></td></tr>)}</tbody></table>{pending.length === 0 ? <div className="reference-empty">{t.noData}</div> : null}</div></section><section className="usage-reference-card usage-records-reference"><div className="usage-reference-card-heading"><div><h2>{t.platformCostDetails}</h2><span>{t.usageRecordDescription}</span></div><strong>{records.length} {t.recordsUnit}</strong></div><div className="reference-table-wrap"><table className="reference-table"><thead><tr><th>{t.completedAt}</th><th>{t.status}</th><th>{t.organization}</th><th>{t.account}</th><th>{t.model}</th><th>{t.inputTokens}</th><th>{t.cachedInputTokens}</th><th>{t.usageOutputTokens}</th><th>{t.totalCost}</th></tr></thead><tbody>{records.map((item, index) => <tr key={value(item, 'id') || `record-${index}`}><td>{value(item, 'occurredAt')}</td><td>{value(item, 'status') === 'settled' ? t.usageStatuses.settled : t.usageStatuses.pending_reconciliation}</td><td>{value(item, 'organizationName')}</td><td>{value(item, 'accountEmail')}</td><td>{value(item, 'modelName')}</td><td>{number(item.inputTokens)}</td><td>{number(item.cachedInputTokens)}</td><td>{number(item.outputTokens)}</td><td>{money(item.totalCostMicrosCny)}</td></tr>)}</tbody></table></div></section></>
}

export default function UsageReferenceWorkspace() {
  const activityRevision = useActivityRevision()
  const today = useMemo(() => day(0), [])
  const [from, setFrom] = useState(day(-29)); const [to, setTo] = useState(today)
  const [view, setView] = useState<UsageView>(() => { const current = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('view'); return current === 'ranking' || current === 'reconciliation' ? current : 'overview' })
  const [summary, setSummary] = useState<Row | null>(null)
  const [trend, setTrend] = useState<Row[]>([])
  const [models, setModels] = useState<Row[]>([])
  const [modelCatalog, setModelCatalog] = useState<Row[]>([])
  const [organizations, setOrganizations] = useState<Row[]>([])
  const [organizationRanking, setOrganizationRanking] = useState<Row[]>([])
  const [records, setRecords] = useState<Row[]>([])
  const [organizationId, setOrganizationId] = useState(''); const [modelId, setModelId] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [page, setPage] = useState<{ query: string; cursor?: string; previous: (string | undefined)[] }>({ query: '', previous: [] })
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const query = useMemo(() => `${range(from, to)}${organizationId ? `&organizationId=${encodeURIComponent(organizationId)}` : ''}${modelId ? `&modelId=${encodeURIComponent(modelId)}` : ''}`, [from, to, organizationId, modelId])
  const cursor = page.query === query ? page.cursor : undefined
  useEffect(() => { let cancelled = false; setLoading(true); setError(''); setNextCursor(null); void Promise.all([request(`/v1/platform/usage/summary?${query}`), request(`/v1/platform/usage/timeseries?${query}`), request(`/v1/platform/usage/breakdown?groupBy=model&${query}`), request(`/v1/platform/usage/breakdown?groupBy=organization&${query}`), request(`/v1/platform/usage/records?limit=100&${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), request('/v1/platform/models'), request('/v1/platform/organizations/tree?all=true')]).then(([summaryValue, trendValue, modelValue, organizationValue, recordsValue, modelList, organizationList]) => { if (cancelled) return; setSummary(first(summaryValue)); setTrend(rows(first(trendValue)?.values)); setModels(rows(first(modelValue)?.values)); setModelCatalog(rows(modelList)); setOrganizationRanking(rows(first(organizationValue)?.values)); setOrganizations(Array.isArray(organizationList) ? rows(organizationList) : rows(first(organizationList)?.items)); setRecords(rows(first(recordsValue)?.items)); setNextCursor(typeof first(recordsValue)?.nextCursor === 'string' ? String(first(recordsValue)?.nextCursor) : null) }).catch((errorValue) => { if (!cancelled) setError(errorValue instanceof Error ? errorValue.message : t.usageLoadError) }).finally(() => { if (!cancelled) setLoading(false) }); return () => { cancelled = true } }, [query, cursor, activityRevision])
  const pending = records.filter(item => value(item, 'status') === 'pending_reconciliation')
  const changeView = (next: UsageView) => { setView(next); window.history.replaceState(null, '', `/platform/usage${next === 'overview' ? '' : `?view=${next}`}`) }
  const exportReport = async () => {
    setExporting(true); setError('')
    try {
      const allRecords: Row[] = []
      let exportCursor: string | null = null
      do {
        const result = first(await request(`/v1/platform/usage/records?limit=100&${query}${exportCursor ? `&cursor=${encodeURIComponent(exportCursor)}` : ''}`))
        allRecords.push(...rows(result?.items)); exportCursor = typeof result?.nextCursor === 'string' ? result.nextCursor : null
      } while (exportCursor)
      const blob = new Blob([JSON.stringify({ summary, trend, models, organizations: organizationRanking, records: allRecords }, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob), anchor = document.createElement('a')
      anchor.href = url; anchor.download = `platform-usage-${from}-${to}.json`; anchor.click(); URL.revokeObjectURL(url)
    } catch (value) { setError(value instanceof Error ? value.message : t.error) }
    finally { setExporting(false) }
  }
  const [review, setReview] = useState<{ item: Row; outcome: 'failed' | 'settled' }>()
  const [reviewBusy, setReviewBusy] = useState(false)
  function reconcile(item: Row, outcome: 'failed' | 'settled') { setReview({ item, outcome }) }
  async function submitReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!review || reviewBusy) return
    const data = new FormData(event.currentTarget)
    setReviewBusy(true); setNotice('')
    try {
      const payload = { outcome: review.outcome, evidence: data.get('evidence'), ...(review.outcome === 'settled' ? {
        inputTokens: Number(data.get('inputTokens')), outputTokens: Number(data.get('outputTokens')),
        cachedInputTokens: Number(data.get('cachedInputTokens')), reasoningTokens: Number(data.get('reasoningTokens')),
      } : {}) }
      await request(`/v1/platform/organizations/${value(review.item, 'organizationId')}/usage/${value(review.item, 'id')}/reconcile`, 'POST', payload)
      setRecords(current => current.filter(row => value(row, 'id') !== value(review.item, 'id')))
      setReview(undefined); setNotice(t.success)
    } catch (errorValue) { setNotice(errorValue instanceof Error ? errorValue.message : t.error) }
    finally { setReviewBusy(false) }
  }

  return <div className="usage-reference-page"><header className="reference-topbar"><div className="page-heading"><h1>{view === 'ranking' ? t.usageRankingTab : view === 'reconciliation' ? t.usageReconciliationTab : t.platformUsageTitle}</h1><p>{t.platformUsageDescription}</p></div><button className="reference-secondary-action" type="button" disabled={exporting || loading} onClick={() => void exportReport()}>⇩ {t.platformExportReport}</button></header><div className="reference-tabs usage-reference-tabs" role="tablist"><button className={view === 'overview' ? 'selected' : ''} onClick={() => changeView('overview')}>{t.usageOverviewTab}</button><button className={view === 'ranking' ? 'selected' : ''} onClick={() => changeView('ranking')}>{t.usageRankingTab}</button><button className={view === 'reconciliation' ? 'selected' : ''} onClick={() => changeView('reconciliation')}>{t.usageReconciliationTab}</button></div><main className="reference-content">{review && <div className="modal-backdrop"><section className="modal modal-wide" role="dialog" aria-modal="true" aria-label={t.platformReconcile}>
    <h2>{t.platformReconcile} · {value(review.item, 'accountEmail')} · {value(review.item, 'modelName')}</h2>
    <p>{review.outcome === 'failed' ? t.reconcileFreeHelp : t.reconcileUsageHelp}</p>
    <form onSubmit={event => void submitReview(event)}><fieldset disabled={reviewBusy}>
      {review.outcome === 'settled' && (['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens'] as const).map(key => <label key={key}>{{ inputTokens: t.inputTokens, outputTokens: t.usageOutputTokens, cachedInputTokens: t.cachedInputTokens, reasoningTokens: t.reasoningTokens }[key]}<input name={key} required type="number" min="0" step="1" defaultValue={typeof review.item[key] === 'number' ? Number(review.item[key]) : ''} /></label>)}
      <label>{t.reconcileEvidence}<textarea required name="evidence" maxLength={2000} /></label>
      <button type="submit">{t.confirm}</button><button type="button" data-dialog-close onClick={() => setReview(undefined)}>{t.cancel}</button>
    </fieldset></form></section></div>}<div className="reference-heading"><div className="reference-filters"><button type="button" onClick={() => { setFrom(day(-29)); setTo(today) }}>▣ {t.last30Days}</button><select aria-label={t.model} value={modelId} onChange={event => setModelId(event.target.value)}><option value="">{t.all} {t.model}</option>{modelCatalog.map(item => <option key={value(item, 'id')} value={value(item, 'id')}>{value(item, 'label') || value(item, 'name')}</option>)}</select><select aria-label={t.organization} value={organizationId} onChange={event => setOrganizationId(event.target.value)}><option value="">{t.all} {t.organization}</option>{organizations.map(item => <option key={value(item, 'id')} value={value(item, 'id')}>{value(item, 'name')}</option>)}</select></div></div><div className="usage-reference-filter-row"><label>{t.fromDate}<input type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} /></label><label>{t.toDate}<input type="date" value={to} min={from} onChange={event => setTo(event.target.value)} /></label></div>{error ? <p className="error" role="alert">{error}</p> : null}{notice ? <p className="reference-notice" role="status">{notice}</p> : null}{loading && !summary ? <p className="muted">{t.loading}</p> : null}{summary ? <><div className="usage-reference-metrics"><Metric label={t.totalCost} metric={money(summary.totalCostMicrosCny)} icon="▣" /><Metric label={t.totalCalls} metric={number(summary.calls)} icon="⌁" /><Metric label={t.usageAllTokens} metric={number(summary.totalTokens)} icon="01" /><Metric label={t.cachedInputTokens} metric={`${number(summary.cachedInputTokens)} ${t.tokenUnit}`} icon="◫" /></div>{view === 'overview' ? <><div className="usage-reference-grid"><Trend items={trend} /><Ranking title={t.platformModelRanking} items={models} /></div><div className="usage-reference-grid lower"><Ranking title={t.platformOrganizationRanking} items={organizationRanking} /><section className="usage-reference-card pending-reference-card"><div className="usage-reference-card-heading"><h2>{t.platformPendingReconciliation}</h2><strong>{pending.length} {t.recordsUnit}</strong></div>{pending.slice(0, 4).map((item, index) => <button className="usage-pending-row" key={value(item, 'id') || String(index)} onClick={() => changeView('reconciliation')}><span className="usage-pending-icon">!</span><span><strong>{value(item, 'reconciliationReason') || t.reconciliationReason}</strong><small>{value(item, 'modelName')} · {value(item, 'occurredAt')}</small></span><b>{money(item.totalCostMicrosCny)}</b></button>)}{pending.length === 0 ? <p className="muted">{t.noData}</p> : null}</section></div><section className="usage-reference-card usage-records-reference"><div className="usage-reference-card-heading"><div><h2>{t.platformCostDetails}</h2><span>{t.usageRecordDescription}</span></div><strong>{records.length} {t.recordsUnit}</strong></div><div className="reference-table-wrap"><table className="reference-table"><thead><tr><th>{t.completedAt}</th><th>{t.status}</th><th>{t.organization}</th><th>{t.account}</th><th>{t.model}</th><th>{t.inputTokens}</th><th>{t.cachedInputTokens}</th><th>{t.usageOutputTokens}</th><th>{t.totalCost}</th></tr></thead><tbody>{records.map((item, index) => <tr key={value(item, 'id') || String(index)}><td>{value(item, 'occurredAt')}</td><td>{value(item, 'status') === 'settled' ? t.usageStatuses.settled : t.usageStatuses.pending_reconciliation}</td><td>{value(item, 'organizationName')}</td><td>{value(item, 'accountEmail')}</td><td>{value(item, 'modelName')}</td><td>{number(item.inputTokens)}</td><td>{number(item.cachedInputTokens)}</td><td>{number(item.outputTokens)}</td><td>{money(item.totalCostMicrosCny)}</td></tr>)}</tbody></table></div></section></> : null}{view === 'ranking' ? <><div className="usage-reference-grid ranking-view"><Ranking title={t.platformModelRanking} items={models} /><Ranking title={t.platformOrganizationRanking} items={organizationRanking} /></div><RecordsTable records={records} pending={pending} onReconcile={(item, outcome) => void reconcile(item, outcome)} /></> : null}{view === 'reconciliation' ? <RecordsTable records={records} pending={pending} onReconcile={(item, outcome) => void reconcile(item, outcome)} /> : null}</> : null}{summary && <div className="reference-filters"><span>{t.usageCurrentPage}</span><button disabled={loading || page.query !== query || page.previous.length === 0} onClick={() => setPage(previous => ({ query, cursor: previous.previous.at(-1), previous: previous.previous.slice(0, -1) }))}>{t.previousPage}</button><button disabled={loading || !nextCursor} onClick={() => { if (nextCursor) setPage({ query, cursor: nextCursor, previous: [...(page.query === query ? page.previous : []), cursor] }) }}>{t.nextPage}</button></div>}</main></div>
}
