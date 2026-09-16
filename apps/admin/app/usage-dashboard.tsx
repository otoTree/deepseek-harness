'use client'

import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { request } from './client-api'
import { zh as t } from './messages'
import type { AdminRow } from './admin-components'
import { shanghaiDate, shiftCalendarDate, usageRange } from './usage-range'

const aggregate = z.object({
  calls: z.number(),
  pricedCalls: z.number(),
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
  reasoningTokens: z.number(),
  totalTokens: z.number(),
  totalCostMicrosCny: z.number(),
  fileUploadCount: z.number(),
  uploadedBytes: z.number(),
  fileUploadFailures: z.number(),
})
const summarySchema = aggregate.extend({ from: z.string(), to: z.string(), currency: z.literal('CNY') })
const breakdownItem = aggregate.extend({ id: z.string(), label: z.string() })
const breakdownSchema = z.object({
  groupBy: z.enum(['model', 'account', 'organization', 'purpose']),
  values: z.array(breakdownItem),
  currency: z.literal('CNY'),
})
const trendSchema = z.object({
  values: z.array(aggregate.extend({ day: z.string() })),
  timezone: z.string(),
  currency: z.literal('CNY'),
})
const recordSchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  settledAt: z.string().nullable(),
  organizationId: z.string(),
  organizationName: z.string(),
  accountId: z.string(),
  accountEmail: z.string(),
  runtimeId: z.string().nullable(),
  modelId: z.string(),
  modelName: z.string(),
  purpose: z.string(),
  status: z.string(),
  protocol: z.enum(['openai-completions', 'openai-responses']),
  inputModalities: z.array(z.string()),
  fileUploadCount: z.number(),
  uploadedBytes: z.number(),
  fileUploadFailures: z.number(),
  reconciliationReason: z.string().nullable(),
  failureReason: z.string().nullable(),
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  uncachedInputTokens: z.number(),
  outputTokens: z.number(),
  reasoningTokens: z.number(),
  totalTokens: z.number(),
  totalCostMicrosCny: z.number().nullable(),
  durationMs: z.number().nullable(),
  upstreamRequestId: z.string().nullable(),
  currency: z.string().nullable(),
  pricingVersion: z.number().nullable(),
  inputPriceMicrosCnyPerMillion: z.number().nullable(),
  cachedInputPriceMicrosCnyPerMillion: z.number().nullable(),
  outputPriceMicrosCnyPerMillion: z.number().nullable(),
  inputCostMicrosCny: z.number().nullable(),
  cachedInputCostMicrosCny: z.number().nullable(),
  outputCostMicrosCny: z.number().nullable(),
})
const recordsSchema = z.object({ items: z.array(recordSchema), nextCursor: z.string().nullable(), currency: z.literal('CNY') })
const directorySchema = z.array(z.record(z.string(), z.unknown()))

type Summary = z.infer<typeof summarySchema>
type Breakdown = z.infer<typeof breakdownSchema>
type TrendPoint = z.infer<typeof trendSchema>['values'][number]
type UsageRecord = z.infer<typeof recordSchema>
type GroupBy = Breakdown['groupBy']
type TrendMetric = 'cost' | 'tokens' | 'calls'

const number = new Intl.NumberFormat('zh-CN')
const currency = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 6 })
const dateTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
const text = (value: unknown): string => value == null ? '' : String(value)
const formatCny = (micros: number | null): string => currency.format((micros ?? 0) / 1_000_000)
function purposeLabel(value: string): string {
  return t.purposes[value as keyof typeof t.purposes] ?? value
}

function optionRows(value: unknown): AdminRow[] {
  const parsed = directorySchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

/** Platform-wide settled model usage dashboard. */
export function UsageDashboard({ organizations, revision }: { organizations: AdminRow[]; revision: number }) {
  const today = useMemo(() => shanghaiDate(new Date()), [])
  const [from, setFrom] = useState(shiftCalendarDate(today, -29) ?? today)
  const [to, setTo] = useState(today)
  const [organizationId, setOrganizationId] = useState('')
  const [modelId, setModelId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [accountSearch, setAccountSearch] = useState('')
  const [purpose, setPurpose] = useState('')
  const [protocol, setProtocol] = useState('')
  const [modality, setModality] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [breakdowns, setBreakdowns] = useState<Record<GroupBy, Breakdown['values']>>({ model: [], account: [], organization: [], purpose: [] })
  const [records, setRecords] = useState<UsageRecord[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<GroupBy>('model')
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('cost')
  const [models, setModels] = useState<AdminRow[]>([])
  const [accounts, setAccounts] = useState<AdminRow[]>([])

  const query = useMemo(() => {
    const range = usageRange(from, to)
    if (!range) return null
    const parameters = new URLSearchParams({
      from: range.from,
      to: range.to,
    })
    if (organizationId) parameters.set('organizationId', organizationId)
    if (modelId) parameters.set('modelId', modelId)
    if (accountId) parameters.set('accountId', accountId)
    if (purpose) parameters.set('purpose', purpose)
    if (protocol) parameters.set('protocol', protocol)
    if (modality) parameters.set('modality', modality)
    return parameters.toString()
  }, [from, to, organizationId, modelId, accountId, purpose, protocol, modality])

  useEffect(() => {
    let disposed = false
    void request('/v1/platform/models')
      .then((value) => { if (!disposed) setModels(optionRows(value)) })
      .catch(() => { if (!disposed) setModels([]) })
    return () => { disposed = true }
  }, [revision])

  useEffect(() => {
    let disposed = false
    const parameters = new URLSearchParams({ limit: '50' })
    if (accountSearch.trim()) parameters.set('query', accountSearch.trim())
    if (organizationId) parameters.set('organizationId', organizationId)
    void request('/v1/platform/accounts?' + parameters.toString())
      .then((value) => { if (!disposed) setAccounts(optionRows(value)) })
      .catch(() => { if (!disposed) setAccounts([]) })
    return () => { disposed = true }
  }, [accountSearch, organizationId, revision])

  useEffect(() => {
    let disposed = false
    if (query === null) {
      setLoading(false)
      setError(t.usageDateError)
      setSummary(null)
      setTrend([])
      setBreakdowns({ model: [], account: [], organization: [], purpose: [] })
      setRecords([])
      setNextCursor(null)
      return () => { disposed = true }
    }
    setLoading(true)
    setError('')
    const base = '/v1/platform/usage/'
    void Promise.all([
      request(base + 'summary?' + query),
      request(base + 'timeseries?' + query),
      ...(['model', 'account', 'organization', 'purpose'] as GroupBy[])
        .map(value => request(base + 'breakdown?groupBy=' + value + '&' + query)),
      request(base + 'records?limit=50&' + query),
    ]).then(([summaryValue, trendValue, ...rest]) => {
      if (disposed) return
      const recordValue = rest.pop()
      const parsedBreakdowns = rest.map(value => breakdownSchema.parse(value))
      const parsedRecords = recordsSchema.parse(recordValue)
      setSummary(summarySchema.parse(summaryValue))
      setTrend(trendSchema.parse(trendValue).values)
      setBreakdowns(Object.fromEntries(parsedBreakdowns.map(value => [value.groupBy, value.values])) as Record<GroupBy, Breakdown['values']>)
      setRecords(parsedRecords.items)
      setNextCursor(parsedRecords.nextCursor)
      setLoading(false)
    }).catch(() => {
      if (!disposed) { setError(t.usageLoadError); setLoading(false) }
    })
    return () => { disposed = true }
  }, [query, revision])

  async function loadMore(): Promise<void> {
    if (!nextCursor || query === null) return
    setLoading(true)
    try {
      const page = recordsSchema.parse(await request('/v1/platform/usage/records?limit=50&cursor=' + encodeURIComponent(nextCursor) + '&' + query))
      setRecords(value => [...value, ...page.items])
      setNextCursor(page.nextCursor)
    } catch {
      setError(t.usageLoadError)
    } finally {
      setLoading(false)
    }
  }

  const trendValue = (point: TrendPoint): number => trendMetric === 'cost'
    ? point.totalCostMicrosCny
    : trendMetric === 'tokens' ? point.totalTokens : point.calls
  const trendMax = Math.max(1, ...trend.map(trendValue))
  const cards = summary === null ? [] : [
    [t.totalCost, formatCny(summary.totalCostMicrosCny)],
    [t.totalCalls, number.format(summary.calls)],
    [t.inputTokens, number.format(summary.inputTokens)],
    [t.cachedInputTokens, number.format(summary.cachedInputTokens)],
    [t.usageOutputTokens, number.format(summary.outputTokens)],
    [t.fileUploads, number.format(summary.fileUploadCount)],
    [t.uploadedBytes, number.format(summary.uploadedBytes)],
    [t.fileUploadFailures, number.format(summary.fileUploadFailures)],
  ]

  return (
    <div className="usage-dashboard">
      <section className="usage-filter-panel" aria-label={t.usageFilters}>
        <div className="usage-presets">
          <button onClick={() => { setFrom(today); setTo(today) }}>{t.today}</button>
          <button onClick={() => { setFrom(shiftCalendarDate(today, -6) ?? today); setTo(today) }}>{t.last7Days}</button>
          <button onClick={() => { setFrom(shiftCalendarDate(today, -29) ?? today); setTo(today) }}>{t.last30Days}</button>
        </div>
        <div className="usage-filter-grid">
          <label>{t.fromDate}<input data-testid="usage-from" type="date" required value={from} max={to} onChange={event => setFrom(event.target.value)} /></label>
          <label>{t.toDate}<input data-testid="usage-to" type="date" required value={to} min={from} onChange={event => setTo(event.target.value)} /></label>
          <label>{t.organization}<select value={organizationId} onChange={(event) => { setOrganizationId(event.target.value); setAccountId('') }}><option value="">{t.all}</option>{organizations.map(item => <option key={text(item.id)} value={text(item.id)}>{text(item.name)}</option>)}</select></label>
          <label>{t.model}<select value={modelId} onChange={event => setModelId(event.target.value)}><option value="">{t.all}</option>{models.map(item => <option key={text(item.id)} value={text(item.id)}>{text(item.name)}</option>)}</select></label>
          <label>{t.accountSearch}<input data-testid="usage-account-search" type="search" value={accountSearch} placeholder={t.accountSearchPlaceholder} onChange={event => setAccountSearch(event.target.value)} /></label>
          <label>{t.account}<select data-testid="usage-account" value={accountId} onChange={event => setAccountId(event.target.value)}><option value="">{t.all}</option>{accounts.map(item => <option key={text(item.id)} value={text(item.id)}>{text(item.email)}</option>)}</select></label>
          <label>{t.protocol}<select value={protocol} onChange={event => setProtocol(event.target.value)}><option value="">{t.all}</option>{Object.entries(t.protocols).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>{t.modality}<select value={modality} onChange={event => setModality(event.target.value)}><option value="">{t.all}</option>{Object.entries(t.modalities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>{t.purpose}<select value={purpose} onChange={event => setPurpose(event.target.value)}><option value="">{t.all}</option>{Object.entries(t.purposes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
      </section>

      {error && <p className="error" role="alert">{error}</p>}
      {loading && summary === null && <p className="muted" role="status">{t.loading}</p>}
      {summary && <>
        {summary.pricedCalls < summary.calls && <p className="usage-legacy-notice">{t.legacyUsageNotice.replace('{count}', number.format(summary.calls - summary.pricedCalls))}</p>}
        <section className="usage-metrics" aria-label={t.usageOverview}>{cards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
        <section className="usage-grid-two">
          <article className="usage-panel">
            <div className="card-heading"><div><h2>{t.usageTrend}</h2><p className="muted">{t.shanghaiTimezone}</p></div><div className="usage-tabs">{(['cost', 'tokens', 'calls'] as TrendMetric[]).map(value => <button key={value} className={trendMetric === value ? 'selected' : ''} onClick={() => setTrendMetric(value)}>{t.trendMetrics[value]}</button>)}</div></div>
            {trend.length === 0 ? <p className="muted">{t.noUsageInRange}</p> : <div className="usage-chart" aria-label={t.usageTrend}>{trend.map(point => <div className="usage-bar-column" key={point.day} title={`${point.day} · ${trendMetric === 'cost' ? formatCny(point.totalCostMicrosCny) : number.format(trendValue(point))}`}><span>{trendMetric === 'cost' ? formatCny(point.totalCostMicrosCny) : number.format(trendValue(point))}</span><div className="usage-bar-track"><i style={{ height: `${Math.max(3, trendValue(point) / trendMax * 100)}%` }} /></div><small>{point.day.slice(5)}</small></div>)}</div>}
          </article>
          <article className="usage-panel">
            <div className="card-heading"><h2>{t.usageBreakdown}</h2><div className="usage-tabs">{(['model', 'account', 'organization', 'purpose'] as GroupBy[]).map(value => <button key={value} className={groupBy === value ? 'selected' : ''} onClick={() => setGroupBy(value)}>{t.breakdownGroups[value]}</button>)}</div></div>
            {breakdowns[groupBy].length === 0 ? <p className="muted">{t.noUsageInRange}</p> : <div className="usage-ranking">{breakdowns[groupBy].slice(0, 10).map(item => <div key={item.id}><span>{groupBy === 'purpose' ? purposeLabel(item.label) : item.label}</span><b>{formatCny(item.totalCostMicrosCny)}</b><small>{number.format(item.calls)} {t.callsUnit} · {number.format(item.totalTokens)} {t.tokenUnit}</small><i style={{ width: `${summary.totalCostMicrosCny === 0 ? 0 : item.totalCostMicrosCny / summary.totalCostMicrosCny * 100}%` }} /></div>)}</div>}
          </article>
        </section>
        <section className="usage-panel usage-records">
          <div className="card-heading"><div><h2>{t.usageRecords}</h2><p className="muted">{t.usageRecordDescription}</p></div><span className="muted">{number.format(records.length)} {t.recordsUnit}</span></div>
          {records.length === 0 ? <p className="muted">{t.noUsageInRange}</p> : <div className="table-scroll"><table><thead><tr><th>{t.completedAt}</th><th>{t.status}</th><th>{t.organization}</th><th>{t.account}</th><th>{t.model}</th><th>{t.protocol}</th><th>{t.modality}</th><th>{t.fileUploads}</th><th>{t.purpose}</th><th>{t.inputTokens}</th><th>{t.cachedInputTokens}</th><th>{t.usageOutputTokens}</th><th>{t.reasoningTokens}</th><th>{t.totalCost}</th></tr></thead><tbody>{records.map(item => <tr key={item.id}><td>{dateTime.format(new Date(item.occurredAt))}</td><td>{t.usageStatuses[item.status as keyof typeof t.usageStatuses] ?? item.status}</td><td>{item.organizationName}</td><td>{item.accountEmail}</td><td>{item.modelName}</td><td>{t.protocols[item.protocol]}</td><td>{item.inputModalities.map(value => t.modalities[value as keyof typeof t.modalities] ?? value).join(' · ')}</td><td>{number.format(item.fileUploadCount)} / {number.format(item.uploadedBytes)} {t.byteUnit}</td><td>{purposeLabel(item.purpose)}</td><td>{number.format(item.inputTokens ?? 0)}</td><td>{number.format(item.cachedInputTokens ?? 0)}</td><td>{number.format(item.outputTokens ?? 0)}</td><td>{number.format(item.reasoningTokens ?? 0)}</td><td>{item.status !== 'settled' ? <details><summary>{t.usageStatuses.pending_reconciliation}</summary><div className="usage-cost-detail"><span>{t.reconciliationReason}: {item.reconciliationReason ?? '—'}</span><span>{t.failureReason}: {item.failureReason ?? '—'}</span><span>{t.fileUploadFailures}: {number.format(item.fileUploadFailures)}</span></div></details> : item.currency !== 'CNY' || item.totalCostMicrosCny === null ? <span className="muted">{t.unpricedLegacyUsage}</span> : <details><summary>{formatCny(item.totalCostMicrosCny)}</summary><div className="usage-cost-detail"><span>{t.uncachedInputTokens}: {number.format(item.uncachedInputTokens ?? 0)} · {formatCny(item.inputCostMicrosCny)}</span><span>{t.cachedInputTokens}: {number.format(item.cachedInputTokens ?? 0)} · {formatCny(item.cachedInputCostMicrosCny)}</span><span>{t.usageOutputTokens}: {number.format(item.outputTokens ?? 0)} · {formatCny(item.outputCostMicrosCny)}</span><span>{t.fileUploadFailures}: {number.format(item.fileUploadFailures)}</span><span>{t.duration}: {item.durationMs === null ? '—' : number.format(item.durationMs) + ' ' + t.millisecondsUnit}</span><span>{t.runtime}: {item.runtimeId ?? '—'}</span><span>{t.upstreamRequest}: {item.upstreamRequestId ?? '—'}</span><span>{t.priceSnapshot}: {formatCny(item.inputPriceMicrosCnyPerMillion)} / {formatCny(item.cachedInputPriceMicrosCnyPerMillion)} / {formatCny(item.outputPriceMicrosCnyPerMillion)}</span></div></details>}</td></tr>)}</tbody></table></div>}
          {nextCursor && <div className="usage-load-more"><button disabled={loading} onClick={() => void loadMore()}>{loading ? t.loading : t.loadMore}</button></div>}
        </section>
      </>}
    </div>
  )
}
