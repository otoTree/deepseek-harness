'use client'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { request } from './client-api'
import { useActivityRevision } from './activity-refresh'
import { zh as t } from './messages'

type Row = Record<string, unknown>
type SettingsArea = 'platform/settings' | 'platform/redemptions'

const asRows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === 'object') : []
const asRow = (value: unknown): Row | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null
const value = (item: Row | null | undefined, key: string): string => item?.[key] == null ? '' : String(item[key])
const objectValue = (item: Row | null | undefined, key: string): Row => item?.[key] && typeof item[key] === 'object' && !Array.isArray(item[key]) ? item[key] as Row : {}
const formatNumber = (item: unknown): string => Number(item || 0).toLocaleString('zh-CN')
const formatCny = (micros: unknown): string => `¥ ${((Number(micros) || 0) / 1_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function useWorkspaceData(path: string | null) {
  const activityRevision = useActivityRevision()
  const [data, setData] = useState<unknown>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(path))
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!path) { setData(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError('')
    void request(path)
      .then((result) => { if (!cancelled) setData(result) })
      .catch((errorValue) => { if (!cancelled) setError(errorValue instanceof Error ? errorValue.message : t.error) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [path, revision, activityRevision])
  return { data, error, loading, reload: () => setRevision(current => current + 1) }
}

function WorkspaceMetric({ label, value: metricValue, icon, tone }: { label: string; value: string; icon: string; tone?: 'red' | 'green' }) {
  return <article className={`reference-metric ${tone ? `reference-metric-${tone}` : ''}`}><span className="reference-metric-icon" aria-hidden="true">{icon}</span><div><strong>{metricValue}</strong><small>{label}</small></div></article>
}

function ReferenceTable({ columns, rows, onSelect, actions }: { columns: Array<{ key: string
  label: string }>
rows: Row[]
onSelect?: (row: Row) => void
actions?: (row: Row) => ReactNode }) {
  return <div className="reference-table-wrap"><table className="reference-table"><thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}{actions && <th>{t.operation}</th>}</tr></thead><tbody>{rows.map((row, index) => <tr className={onSelect ? 'reference-row-clickable' : ''} key={value(row, 'id') || String(index)} onClick={() => onSelect?.(row)}>{columns.map(column => <td key={column.key}>{column.key === 'status' ? <span className={`reference-status ${row.statusTone === 'danger' || /fail|error|reject|revok|expired|disabled/.test(value(row, column.key)) ? 'danger' : row.statusTone === 'warning' || /pending|waiting|await/.test(value(row, column.key)) ? 'warning' : 'success'}`}>{value(row, column.key) || t.noData}</span> : value(row, column.key) || '—'}</td>)}{actions && <td>{actions(row)}</td>}</tr>)}</tbody></table>{rows.length === 0 ? <div className="reference-empty">{t.noData}</div> : null}</div>
}

function WorkspaceFrame({ area, title, description, action, showFilters = false, mappingProviderId, children }: { area: SettingsArea
  title: string
  description: string
  action?: ReactNode
  showFilters?: boolean
  mappingProviderId?: string
  children: ReactNode }) {
  const tabs: Array<[SettingsArea, string, string]> = [
    ['platform/settings', '/platform/settings', t.platformSettings],
    ['platform/redemptions', '/platform/redemptions', t.redemptionCodes],
  ]
  return <div className="reference-page"><header className="reference-topbar"><div className="page-heading"><h1>{title}</h1><p>{description}</p></div><div className="reference-top-actions">{action}</div></header><div className="reference-tabs" role="tablist">{tabs.map(([key, href, label]) => <a className={area === key ? 'selected' : ''} href={href} key={key}>{label}</a>)}</div><main className="reference-content"><div className="reference-heading">{showFilters ? <div className="reference-filters"><button type="button">⌕ {t.search}</button><button type="button">≡ {t.filters}</button><button type="button">▣ {t.last30Days}</button></div> : null}</div>{children}</main></div>
}

function PolicyView({ policy, onReload }: { policy: Row | null; onReload: () => void }) {
  const [registration, setRegistration] = useState(value(policy, 'registration') || 'open')
  const [domains, setDomains] = useState(Array.isArray(policy?.domains) ? (policy?.domains as unknown[]).join(', ') : '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => { setRegistration(value(policy, 'registration') || 'open'); setDomains(Array.isArray(policy?.domains) ? (policy?.domains as unknown[]).join(', ') : '') }, [policy?.registration, JSON.stringify(policy?.domains)])
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setNotice(''); try { await request('/v1/platform/policy', 'PUT', { registration, domains: domains.split(',').map(item => item.trim()).filter(Boolean) }); setNotice(t.success); onReload() } catch (error) { setNotice(error instanceof Error ? error.message : t.error) } finally { setBusy(false) } }
  const configured = (field: string): string => value(policy, field) ? t.platformConfigured : '—'
  const categories: Array<[string, string]> = [
    [t.platformRegistrationStrategy, configured('registration')],
    [t.platformAllowedDomains, Array.isArray(policy?.domains) && policy.domains.length > 0 ? t.platformConfigured : '—'],
    [t.platformPlanAndBudget, '—'],
    [t.platformMailService, '—'],
    [t.platformObjectStorage, '—'],
    [t.platformRedis, '—'],
    [t.platformDataRetention, '—'],
    [t.platformSecurityPolicy, '—'],
  ]
  const policyValue = (field: string): string => value(policy, field) || '—'
  return <WorkspaceFrame area="platform/settings" title={t.platformPolicyTitle} description={t.platformPolicyDescription} action={<button className="reference-primary-action" form="platform-policy-form">＋ {t.save}</button>}><div className="reference-metrics"><WorkspaceMetric label={t.platformRegistrationStrategy} value={t.registrationPolicies[registration as keyof typeof t.registrationPolicies] || registration || '—'} icon="♙" /><WorkspaceMetric label={t.platformDefaultPlan} value={policyValue('defaultPlan')} icon="$" /><WorkspaceMetric label={t.platformAuditRetention} value={policyValue('auditRetention')} icon="▣" /><WorkspaceMetric label={t.platformAdministrators} value={policyValue('administrators')} icon="◇" /></div><div className="reference-two-column policy"><section className="reference-panel reference-category-panel"><div className="reference-panel-heading"><h2>{t.platformSettingsCategories}</h2><span>{categories.length} {t.recordsUnit}</span></div>{categories.map(([label, state]) => <div className="reference-category-row" key={label}><strong>{label}</strong><span className={state === t.platformNeedsAttention ? 'reference-warning' : state === t.platformNormal ? 'reference-positive' : ''}>{state}</span></div>)}</section><section className="reference-panel reference-policy-panel"><div className="reference-panel-heading"><h2>{t.platformRegistrationStrategy}</h2></div><form id="platform-policy-form" className="reference-policy-form" onSubmit={save}><div className="reference-policy-row"><span>{t.platformPolicyRegistration}</span><select value={registration} onChange={event => setRegistration(event.target.value)}>{Object.entries(t.registrationPolicies).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><div className="reference-policy-row"><span>{t.platformAllowedDomains}</span><input value={domains} onChange={event => setDomains(event.target.value)} placeholder="example.com" /></div>{notice ? <p className="reference-notice" role="status">{notice}</p> : null}<button className="reference-primary-action" disabled={busy}>{busy ? t.loading : t.save}</button></form></section></div></WorkspaceFrame>
}

function RedemptionsView({ data, onReload }: { data: unknown; onReload: () => void }) {
  const rows = asRows(asRow(data)?.items)
  const [amount, setAmount] = useState('100')
  const [note, setNote] = useState('')
  const [count, setCount] = useState('10')
  const [expiresAt, setExpiresAt] = useState('')
  const [notice, setNotice] = useState('')
  const [generatedCodes, setGeneratedCodes] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  async function create(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setNotice(''); try { const result = await request('/v1/platform/redemption-code-batches', 'POST', { amountCny: amount, count: Number(count), ...(note.trim() ? { note: note.trim() } : {}), ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}) }); const codes = asRow(result); if (codes?.codes) { setGeneratedCodes(codes); setNotice(`${t.redemptionCreated} ${String(codes.batchId)}`) } onReload() } catch (error) { setNotice(error instanceof Error ? error.message : t.error) } finally { setBusy(false) } }
  async function revoke(item: Row) {
    setBusy(true); setNotice('')
    try { await request(`/v1/platform/redemption-codes/${value(item, 'id')}/revoke`, 'POST'); onReload(); setNotice(t.success) }
    catch (error) { setNotice(error instanceof Error ? error.message : t.error) }
    finally { setBusy(false) }
  }
  const available = rows.filter(item => !item.redeemedAt && !item.revokedAt && (!item.expiresAt || new Date(value(item, 'expiresAt')) > new Date())).length
  const redeemed = rows.filter(item => item.redeemedAt).length
  const expired = rows.filter(item => item.expiresAt && new Date(value(item, 'expiresAt')) <= new Date() && !item.redeemedAt && !item.revokedAt).length
  return <WorkspaceFrame area="platform/redemptions" title={t.redemptionCodes} description={t.redemptionCodesDescription} action={<button className="reference-primary-action" form="redemption-batch-form">＋ {t.platformCreateBatch}</button>}><div className="reference-metrics"><WorkspaceMetric label={t.platformBatchCount} value={formatNumber(new Set(rows.map(item => value(item, 'batchId'))).size)} icon="▤" /><WorkspaceMetric label={t.available} value={formatNumber(available)} icon="✓" tone="green" /><WorkspaceMetric label={t.redeemed} value={formatNumber(redeemed)} icon="↗" /><WorkspaceMetric label={t.expired} value={formatNumber(expired)} icon="!" tone="red" /></div><div className="reference-two-column redemption"><section className="reference-panel reference-table-panel"><div className="reference-panel-heading"><h2>{t.platformRedemptionList}</h2><span>{rows.length} {t.recordsUnit}</span></div><ReferenceTable actions={item => <button type="button" className="table-action danger" disabled={busy || Boolean(item.revokedAt) || Boolean(item.redeemedAt)} onClick={() => void revoke(item)}>{t.revoke}</button>} columns={[{ key: 'batchId', label: t.batchId }, { key: 'codeHint', label: t.code }, { key: 'amountMicrosCny', label: t.amountCny }, { key: 'expiresAt', label: t.expired }, { key: 'status', label: t.platformRedeemStatus }]} rows={rows.map(item => ({ ...item, amountMicrosCny: formatCny(item.amountMicrosCny), statusTone: item.revokedAt ? 'danger' : item.expiresAt && new Date(value(item, 'expiresAt')) <= new Date() ? 'warning' : 'success', status: item.revokedAt ? t.revoked : item.redeemedAt ? t.redeemed : item.expiresAt && new Date(value(item, 'expiresAt')) <= new Date() ? t.expired : t.available }))} /></section><aside className="reference-panel reference-summary-panel"><h2>{t.platformCreateBatch}</h2><p className="muted">{t.redemptionPlaintextWarning}</p><form id="redemption-batch-form" className="reference-policy-form" onSubmit={create}><label>{t.amountCny}<input type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} required /></label><label>{t.redemptionCount}<input type="number" min="1" max="1000" value={count} onChange={event => setCount(event.target.value)} required /></label><label>{t.redemptionExpiresAt}<input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label><label>{t.redemptionNote}<textarea value={note} maxLength={1000} onChange={event => setNote(event.target.value)} /></label>{notice ? <p className="reference-notice" role="status">{notice}</p> : null}<button className="reference-primary-action" disabled={busy}>{busy ? t.loading : t.generateRedemptionCodes}</button></form></aside></div>{generatedCodes ? <section className="reference-panel generated-codes-panel"><div className="reference-panel-heading"><h2>{t.redemptionCreated}</h2><button type="button" className="reference-secondary-action" onClick={() => setGeneratedCodes(null)}>{t.close}</button></div><p className="muted">{t.redemptionPlaintextWarning}</p><pre>{Array.isArray(generatedCodes.codes) ? generatedCodes.codes.join('\n') : ''}</pre></section> : null}</WorkspaceFrame>
}

export default function PlatformSettingsWorkspace({ area, id }: { area: SettingsArea; id?: string }) {

  const policyData = useWorkspaceData(area === 'platform/settings' ? '/v1/platform/policy' : null)
  const redemptionData = useWorkspaceData(area === 'platform/redemptions' ? '/v1/platform/redemption-codes?limit=200' : null)
  const resource = area === 'platform/settings' ? policyData : redemptionData
  return <>{resource.error && <p className="error" role="alert">{resource.error}</p>}{resource.loading && resource.data === null && <p role="status">{t.loading}</p>}{area === 'platform/settings' ? <PolicyView policy={asRow(policyData.data)} onReload={policyData.reload} /> : <RedemptionsView data={redemptionData.data} onReload={redemptionData.reload} />}</>
}
