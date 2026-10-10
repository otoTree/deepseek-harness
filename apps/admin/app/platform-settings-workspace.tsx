'use client'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { request } from './client-api'
import { zh as t } from './messages'

type Row = Record<string, unknown>
type SettingsArea = 'identity/providers' | 'identity/mapping' | 'identity/login-failures' | 'platform/settings' | 'platform/redemptions'

const asRows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === 'object') : []
const asRow = (value: unknown): Row | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null
const value = (item: Row | null | undefined, key: string): string => item?.[key] == null ? '' : String(item[key])
const objectValue = (item: Row | null | undefined, key: string): Row => item?.[key] && typeof item[key] === 'object' && !Array.isArray(item[key]) ? item[key] as Row : {}
const formatNumber = (item: unknown): string => Number(item || 0).toLocaleString('zh-CN')
const formatCny = (micros: unknown): string => `¥ ${((Number(micros) || 0) / 1_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function useWorkspaceData(path: string | null) {
  const [data, setData] = useState<unknown>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(path))
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!path) { setData(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError('')
    void request(path).then((result) => { if (!cancelled) setData(result) }).catch((errorValue) => { if (!cancelled) setError(errorValue instanceof Error ? errorValue.message : t.error) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [path, revision])
  return { data, error, loading, reload: () => setRevision(current => current + 1) }
}

function WorkspaceMetric({ label, value: metricValue, icon, tone }: { label: string; value: string; icon: string; tone?: 'red' | 'green' }) {
  return <article className={`reference-metric ${tone ? `reference-metric-${tone}` : ''}`}><span className="reference-metric-icon" aria-hidden="true">{icon}</span><div><strong>{metricValue}</strong><small>{label}</small></div></article>
}

function ReferenceTable({ columns, rows, onSelect }: { columns: Array<{ key: string; label: string }>; rows: Row[]; onSelect?: (row: Row) => void }) {
  return <div className="reference-table-wrap"><table className="reference-table"><thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className={onSelect ? 'reference-row-clickable' : ''} key={value(row, 'id') || String(index)} onClick={() => onSelect?.(row)}>{columns.map(column => <td key={column.key}>{column.key === 'status' ? <span className={`reference-status ${/fail|error|reject|revok|expired|disabled/.test(value(row, column.key)) ? 'danger' : /pending|waiting|await/.test(value(row, column.key)) ? 'warning' : 'success'}`}>{value(row, column.key) || t.noData}</span> : value(row, column.key) || '—'}</td>)}</tr>)}</tbody></table>{rows.length === 0 ? <div className="reference-empty">{t.noData}</div> : null}</div>
}

function IdentityProviderModal({ organizationId, open, busy, onClose, onCreated }: { organizationId: string; open: boolean; busy: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [protocol, setProtocol] = useState<'oidc' | 'oauth2' | 'saml' | 'ldap'>('oidc')
  const [issuer, setIssuer] = useState('')
  const [error, setError] = useState('')
  if (!open) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="identity-provider-create-title"><div className="modal-heading"><div><p className="eyebrow">{t.platformSettings}</p><h2 id="identity-provider-create-title">{t.platformIdentityAdd}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label={t.close}>×</button></div><form className="operation-form" onSubmit={(event) => { event.preventDefault(); setError(''); void request(`/v1/organizations/${organizationId}/identity-providers`, 'POST', { name: name.trim(), protocol, ...(issuer.trim() ? { issuer: issuer.trim() } : {}), config: {} }).then(() => { onCreated(); onClose() }).catch(value => setError(value instanceof Error ? value.message : t.error)) }}><label>{t.name}<input value={name} onChange={event => setName(event.target.value)} required /></label><label>{t.protocol}<select value={protocol} onChange={event => setProtocol(event.target.value as typeof protocol)}>{Object.entries(t.identityProtocols).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>{t.issuer}<input type="url" value={issuer} onChange={event => setIssuer(event.target.value)} required={protocol !== 'ldap'} /></label>{error ? <p className="error" role="alert">{error}</p> : null}<div className="modal-actions"><button type="button" onClick={onClose}>{t.cancel}</button><button className="primary" disabled={busy || !name.trim()}>{busy ? t.loading : t.confirm}</button></div></form></section></div>
}

function WorkspaceFrame({ area, title, description, action, showFilters = false, mappingProviderId, children }: { area: SettingsArea; title: string; description: string; action?: ReactNode; showFilters?: boolean; mappingProviderId?: string; children: ReactNode }) {
  const tabs: Array<[SettingsArea, string, string]> = [
    ['identity/providers', '/identity/providers', t.identityProviders],
    ['identity/mapping', '/identity/providers/mapping', t.fieldMapping],
    ['identity/login-failures', '/identity/login-failures', t.loginFailures],
    ['platform/settings', '/platform/settings', t.platformSettings],
    ['platform/redemptions', '/platform/redemptions', t.redemptionCodes],
  ]
  return <div className="reference-page"><header className="reference-topbar"><div className="reference-breadcrumb"><strong>{t.platformSettingsBreadcrumb}</strong><span>/</span><strong>{title}</strong></div><div className="reference-top-actions">{action}</div></header><div className="reference-tabs" role="tablist">{tabs.map(([key, href, label]) => <a className={area === key ? 'selected' : ''} href={key === 'identity/mapping' && mappingProviderId ? `/identity/providers/${mappingProviderId}/mapping` : href} key={key}>{label}</a>)}</div><main className="reference-content"><div className="reference-heading"><div><h1>{title}</h1><p>{description}</p></div>{showFilters ? <div className="reference-filters"><button type="button">⌕ {t.search}</button><button type="button">≡ {t.filters}</button><button type="button">▣ {t.last30Days}</button></div> : null}</div>{children}</main></div>
}

function IdentityProviderView({ organizationId, routeId }: { organizationId: string; routeId?: string }) {
  const providersData = useWorkspaceData(organizationId ? `/v1/organizations/${organizationId}/identity-providers` : null)
  const providers = asRows(providersData.data)
  const [selectedId, setSelectedId] = useState(routeId ?? '')
  const selected = providers.find(provider => value(provider, 'id') === selectedId) ?? providers[0] ?? null
  const [draft, setDraft] = useState<Row>({})
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  useEffect(() => { if (selected) { setSelectedId(value(selected, 'id')); setDraft({ issuer: value(selected, 'issuer'), ...objectValue(selected, 'config') }) } }, [selected?.id])
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    setBusy(true); setNotice('')
    try { await request(`/v1/organizations/${organizationId}/identity-providers/${value(selected, 'id')}`, 'PATCH', { issuer: String(draft.issuer || ''), config: Object.fromEntries(Object.entries(draft).filter(([key]) => key !== 'issuer' && String(value(draft, key)).trim())) }); setNotice(t.success); providersData.reload() } catch (error) { setNotice(error instanceof Error ? error.message : t.error) } finally { setBusy(false) }
  }
  const configFields = ['clientId', 'clientSecret', 'scopes', 'redirectUri']
  const callbackUrl = String(draft.redirectUri || `${window.location.origin}/auth/callback/${value(selected, 'protocol')}/${value(selected, 'id')}`)
  return <><WorkspaceFrame area="identity/providers" title={t.platformIdentityTitle} description={t.platformIdentityDescription} showFilters={false} mappingProviderId={value(selected, 'id')} action={<button className="reference-primary-action" type="button" onClick={() => setCreateOpen(true)}>＋ {t.platformIdentityAdd}</button>}><div className="reference-provider-layout"><section className="reference-panel reference-provider-list"><div className="reference-panel-heading"><h2>{t.identityProviders}</h2><span>{providers.length} {t.platformProviderCount}</span></div>{providers.map(provider => <button className={`reference-provider-item ${value(provider, 'id') === value(selected, 'id') ? 'selected' : ''}`} key={value(provider, 'id')} onClick={() => setSelectedId(value(provider, 'id'))}><span className="reference-provider-icon">⌘</span><span><strong>{value(provider, 'name') || value(provider, 'protocol')}</strong><small>{value(provider, 'protocol')} · {provider.enabled === false ? t.disabled : t.enabled}</small></span></button>)}{providers.length === 0 ? <div className="reference-empty">{t.noData}</div> : null}</section><section className="reference-panel reference-provider-detail">{selected ? <><div className="reference-provider-header"><div className="reference-provider-title"><span className="reference-provider-icon large">⌘</span><div><h2>{value(selected, 'name') || value(selected, 'protocol')}</h2><p>{value(selected, 'protocol')} · {value(selected, 'issuer') || '—'} · {t.lastUpdated} {value(selected, 'updatedAt') || '—'}</p></div></div><button className={`reference-switch ${selected.enabled === false ? '' : 'on'}`} type="button" aria-label={selected.enabled === false ? t.enableIdentityProvider : t.disableIdentityProvider} onClick={async () => { await request(`/v1/organizations/${organizationId}/identity-providers/${value(selected, 'id')}`, 'PATCH', { enabled: selected.enabled === false }); providersData.reload() }}><i /></button></div><div className="reference-subtabs"><a className="selected" href={`/identity/providers/${value(selected, 'id')}`}>{t.platformConnection}</a><a href={`/identity/providers/${value(selected, 'id')}/mapping`}>{t.fieldMapping}</a><a href="/identity/login-failures">{t.platformFailureTab}</a></div><form className="reference-form-card" onSubmit={save}><div className="reference-form-grid"><label>{t.issuer}<input value={String(draft.issuer || '')} onChange={event => setDraft(current => ({ ...current, issuer: event.target.value }))} /></label>{configFields.map(key => <label key={key}>{(t as Record<string, unknown>)[key] as string ?? key}<input type={key === 'clientSecret' ? 'password' : 'text'} value={String(draft[key] || '')} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} /></label>)}</div><div className="reference-callout"><strong>{t.platformCallbackUrl}</strong><code>{callbackUrl}</code><button type="button" aria-label={t.copy} onClick={() => void navigator.clipboard?.writeText(callbackUrl)}>▣</button></div>{notice ? <p className="reference-notice" role="status">{notice}</p> : null}<div className="reference-form-actions"><button className="reference-primary-action" disabled={busy}>{busy ? t.loading : t.save}</button></div></form></> : <div className="reference-empty">{t.noSelection}</div>}</section></div></WorkspaceFrame><IdentityProviderModal organizationId={organizationId} open={createOpen} busy={busy} onClose={() => setCreateOpen(false)} onCreated={providersData.reload} /></>
}

function MappingView({ organizationId, providerId }: { organizationId: string; providerId?: string }) {
  const providersData = useWorkspaceData(organizationId ? `/v1/organizations/${organizationId}/identity-providers` : null)
  const providers = asRows(providersData.data)
  const selectedId = providerId || value(providers[0], 'id')
  const mappingData = useWorkspaceData(organizationId && selectedId ? `/v1/organizations/${organizationId}/identity-providers/${selectedId}/mappings` : null)
  const mappings = asRows(mappingData.data)
  const preview = mappings[0]
  const [draftMappings, setDraftMappings] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => { setDraftMappings(mappings.map(item => ({ ...item }))) }, [mappingData.data])
  const updateMapping = (index: number, key: string, next: unknown) => setDraftMappings(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: next } : item))
  const addMapping = () => setDraftMappings(current => [...current, { sourceField: '', targetField: '', transform: 'direct', required: false }])
  async function saveMappings() { if (!selectedId) return; setBusy(true); setNotice(''); try { await request(`/v1/organizations/${organizationId}/identity-providers/${selectedId}/mappings`, 'PUT', draftMappings.map(item => ({ sourceField: value(item, 'sourceField'), targetField: value(item, 'targetField'), transform: value(item, 'transform') || 'direct', required: Boolean(item.required), ...(item.version ? { version: Number(item.version) } : {}) }))); setNotice(t.success); mappingData.reload() } catch (error) { setNotice(error instanceof Error ? error.message : t.error) } finally { setBusy(false) } }
  const mappingRows = draftMappings.map(item => ({ ...item, required: item.required ? '是' : '否', status: item.status || 'active' }))
  return <WorkspaceFrame area="identity/mapping" title={t.platformMappingTitle} description={t.platformMappingDescription} mappingProviderId={selectedId} action={<button className="reference-primary-action" type="button" onClick={addMapping}>＋ {t.create}</button>}><div className="reference-metrics"><WorkspaceMetric label={t.platformMappingFields} value={formatNumber(draftMappings.length)} icon="♧" /><WorkspaceMetric label={t.platformOrganizationFields} value={formatNumber(draftMappings.filter(item => /org|department|path/i.test(value(item, 'targetField'))).length)} icon="♙" /><WorkspaceMetric label={t.platformMappingRules} value={formatNumber(draftMappings.filter(item => value(item, 'transform')).length)} icon="⌘" /><WorkspaceMetric label={t.platformMappingConflicts} value={formatNumber(draftMappings.filter(item => /conflict|warning/i.test(value(item, 'status'))).length)} icon="△" tone="red" /></div><div className="reference-two-column"><section className="reference-panel reference-table-panel"><div className="reference-panel-heading"><h2>{t.fieldMapping}</h2><span>{draftMappings.length} {t.recordsUnit}</span></div><div className="reference-table-wrap"><table className="reference-table"><thead><tr><th>{t.sourceField}</th><th>{t.targetField}</th><th>{t.transform}</th><th>{t.required}</th><th>{t.status}</th></tr></thead><tbody>{draftMappings.map((item, index) => <tr key={`${value(item, 'id') || 'draft'}-${index}`}><td><input className="reference-inline-input" value={value(item, 'sourceField')} onChange={event => updateMapping(index, 'sourceField', event.target.value)} /></td><td><input className="reference-inline-input" value={value(item, 'targetField')} onChange={event => updateMapping(index, 'targetField', event.target.value)} /></td><td><select className="reference-inline-input" value={value(item, 'transform') || 'direct'} onChange={event => updateMapping(index, 'transform', event.target.value)}><option value="direct">direct</option><option value="lowercase">lowercase</option><option value="uppercase">uppercase</option><option value="split">split</option><option value="join">join</option></select></td><td><input type="checkbox" checked={Boolean(item.required)} onChange={event => updateMapping(index, 'required', event.target.checked)} /></td><td>{value(item, 'status') || '—'}</td></tr>)}</tbody></table>{draftMappings.length === 0 ? <div className="reference-empty">{t.noData}</div> : null}</div><div className="reference-form-actions"><button className="reference-primary-action" type="button" disabled={busy || !selectedId} onClick={() => void saveMappings()}>{busy ? t.loading : t.save}</button>{notice ? <p className="reference-notice" role="status">{notice}</p> : null}</div></section><aside className="reference-panel reference-summary-panel"><h2>{t.platformMappingTitle}</h2><dl><div><dt>{t.identityProviders}</dt><dd>{value(providers.find(item => value(item, 'id') === selectedId), 'name') || '—'}</dd></div><div><dt>{t.sourceField}</dt><dd>{value(preview, 'sourceField') || '—'}</dd></div><div><dt>{t.targetField}</dt><dd>{value(preview, 'targetField') || '—'}</dd></div><div><dt>{t.transform}</dt><dd>{value(preview, 'transform') || '—'}</dd></div><div><dt>{t.platformHandlingStatus}</dt><dd>{value(preview, 'status') || '—'}</dd></div></dl><div className="reference-preview"><strong>{t.platformMappingTitle}</strong><span>{value(preview, 'sourceField') || '—'} → {value(preview, 'targetField') || '—'}</span><span>{t.platformHandlingStatus}: {value(preview, 'status') || '—'}</span></div></aside></div></WorkspaceFrame>
}

function LoginFailuresView({ organizationId }: { organizationId: string }) {
  const failuresData = useWorkspaceData(organizationId ? `/v1/organizations/${organizationId}/identity-login-failures` : null)
  const failures = asRows(failuresData.data)
  const [selected, setSelected] = useState<Row | null>(null)
  const current = selected ?? failures[0]
  return <WorkspaceFrame area="identity/login-failures" title={t.platformLoginFailuresTitle} description={t.platformLoginFailuresDescription} action={<button className="reference-secondary-action" type="button" onClick={failuresData.reload}>↻ {t.refresh}</button>}><div className="reference-metrics"><WorkspaceMetric label={t.platformFailures24h} value={formatNumber(failures.length)} icon="×" tone="red" /><WorkspaceMetric label={t.platformAffectedAccounts} value={formatNumber(new Set(failures.map(item => value(item, 'subjectHint'))).size)} icon="♙" /><WorkspaceMetric label={t.platformCertificateIssues} value={formatNumber(failures.filter(item => /KEY|CERT|JWKS/i.test(value(item, 'reasonCode'))).length)} icon="⌑" /><WorkspaceMetric label={t.platformMappingFailures} value={formatNumber(failures.filter(item => /FIELD|MAPPING/i.test(value(item, 'reasonCode'))).length)} icon="⌁" /></div><div className="reference-two-column failures"><section className="reference-panel reference-table-panel"><div className="reference-panel-heading"><h2>{t.platformFailureRecords}</h2><span>{failures.length} {t.recordsUnit}</span></div><ReferenceTable columns={[{ key: 'occurredAt', label: t.createdAt }, { key: 'subjectHint', label: t.account }, { key: 'providerId', label: t.identityProviders }, { key: 'reasonCode', label: t.platformErrorCode }]} rows={failures} onSelect={setSelected} /></section><aside className="reference-panel reference-summary-panel"><h2>{t.platformFailureDetail}</h2><dl><div><dt>{t.platformErrorCode}</dt><dd>{value(current, 'reasonCode') || '—'}</dd></div><div><dt>{t.account}</dt><dd>{value(current, 'subjectHint') || '—'}</dd></div><div><dt>{t.platformFailureStage}</dt><dd>{value(objectValue(current, 'detail'), 'stage') || '—'}</dd></div><div><dt>{t.platformRetryCount}</dt><dd>{value(objectValue(current, 'detail'), 'retryCount') || '—'}</dd></div><div><dt>{t.platformHandlingStatus}</dt><dd>—</dd></div></dl></aside></div></WorkspaceFrame>
}

function PolicyView({ policy, onReload }: { policy: Row | null; onReload: () => void }) {
  const [registration, setRegistration] = useState(value(policy, 'registration') || 'open')
  const [domains, setDomains] = useState(Array.isArray(policy?.domains) ? (policy?.domains as unknown[]).join(', ') : '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => { setRegistration(value(policy, 'registration') || 'open'); setDomains(Array.isArray(policy?.domains) ? (policy?.domains as unknown[]).join(', ') : '') }, [policy?.updatedAt])
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
  return <WorkspaceFrame area="platform/settings" title={t.platformPolicyTitle} description={t.platformPolicyDescription} action={<button className="reference-primary-action" form="platform-policy-form">＋ {t.save}</button>}><div className="reference-metrics"><WorkspaceMetric label={t.platformRegistrationStrategy} value={t.registrationPolicies[registration as keyof typeof t.registrationPolicies] || registration || '—'} icon="♙" /><WorkspaceMetric label={t.platformDefaultPlan} value={policyValue('defaultPlan')} icon="$" /><WorkspaceMetric label={t.platformAuditRetention} value={policyValue('auditRetention')} icon="▣" /><WorkspaceMetric label={t.platformAdministrators} value={policyValue('administrators')} icon="◇" /></div><div className="reference-two-column policy"><section className="reference-panel reference-category-panel"><div className="reference-panel-heading"><h2>{t.platformSettingsCategories}</h2><span>{categories.length} {t.recordsUnit}</span></div>{categories.map(([label, state]) => <div className="reference-category-row" key={label}><strong>{label}</strong><span className={state === t.platformNeedsAttention ? 'reference-warning' : state === t.platformNormal ? 'reference-positive' : ''}>{state}</span></div>)}</section><section className="reference-panel reference-policy-panel"><div className="reference-panel-heading"><h2>{t.platformRegistrationStrategy}</h2></div><form id="platform-policy-form" className="reference-policy-form" onSubmit={save}><div className="reference-policy-row"><span>{t.platformPolicyRegistration}</span><select value={registration} onChange={event => setRegistration(event.target.value)}>{Object.entries(t.registrationPolicies).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><div className="reference-policy-row"><span>{t.platformAllowedDomains}</span><input value={domains} onChange={event => setDomains(event.target.value)} placeholder="example.com" /></div>{[['platformDefaultPlan', 'defaultPlan'], ['platformSeatLimit', 'seatLimit'], ['platformDeviceLimit', 'deviceLimit'], ['platformMonthlyBudget', 'monthlyBudget'], ['platformOveragePolicy', 'overagePolicy'], ['platformAuditRetention', 'auditRetention'], ['platformDataRetention', 'dataRetention'], ['platformAdministrators', 'administrators']].map(([key, field]) => <div className="reference-policy-row" key={key}><span>{(t as Record<string, unknown>)[key] as string}</span><strong>{policyValue(field)}</strong></div>)}{notice ? <p className="reference-notice" role="status">{notice}</p> : null}<button className="reference-primary-action" disabled={busy}>{busy ? t.loading : t.save}</button></form></section></div></WorkspaceFrame>
}

function RedemptionsView({ data, onReload }: { data: unknown; onReload: () => void }) {
  const rows = asRows(asRow(data)?.items)
  const [amount, setAmount] = useState('100')
  const [count, setCount] = useState('10')
  const [expiresAt, setExpiresAt] = useState('')
  const [notice, setNotice] = useState('')
  const [generatedCodes, setGeneratedCodes] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  async function create(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setNotice(''); try { const result = await request('/v1/platform/redemption-code-batches', 'POST', { amountCny: amount, count: Number(count), ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}) }); const codes = asRow(result); if (codes?.codes) { setGeneratedCodes(codes); setNotice(`${t.redemptionCreated} ${String(codes.batchId)}`) } onReload() } catch (error) { setNotice(error instanceof Error ? error.message : t.error) } finally { setBusy(false) } }
  const available = rows.filter(item => !item.redeemedAt && !item.revokedAt && (!item.expiresAt || new Date(value(item, 'expiresAt')) > new Date())).length
  const redeemed = rows.filter(item => item.redeemedAt).length
  const expired = rows.filter(item => item.expiresAt && new Date(value(item, 'expiresAt')) <= new Date() && !item.redeemedAt && !item.revokedAt).length
  return <WorkspaceFrame area="platform/redemptions" title={t.redemptionCodes} description={t.redemptionCodesDescription} action={<button className="reference-primary-action" form="redemption-batch-form">＋ {t.platformCreateBatch}</button>}><div className="reference-metrics"><WorkspaceMetric label={t.platformBatchCount} value={formatNumber(new Set(rows.map(item => value(item, 'batchId'))).size)} icon="▤" /><WorkspaceMetric label={t.available} value={formatNumber(available)} icon="✓" tone="green" /><WorkspaceMetric label={t.redeemed} value={formatNumber(redeemed)} icon="↗" /><WorkspaceMetric label={t.expired} value={formatNumber(expired)} icon="!" tone="red" /></div><div className="reference-two-column redemption"><section className="reference-panel reference-table-panel"><div className="reference-panel-heading"><h2>{t.platformRedemptionList}</h2><span>{rows.length} {t.recordsUnit}</span></div><ReferenceTable columns={[{ key: 'batchId', label: t.batchId }, { key: 'codeHint', label: t.code }, { key: 'amountMicrosCny', label: t.amountCny }, { key: 'expiresAt', label: t.expired }, { key: 'status', label: t.platformRedeemStatus }]} rows={rows.map(item => ({ ...item, amountMicrosCny: formatCny(item.amountMicrosCny), status: item.revokedAt ? t.revoked : item.redeemedAt ? t.redeemed : item.expiresAt && new Date(value(item, 'expiresAt')) <= new Date() ? t.expired : t.available }))} /></section><aside className="reference-panel reference-summary-panel"><h2>{t.platformCreateBatch}</h2><p className="muted">{t.redemptionPlaintextWarning}</p><form id="redemption-batch-form" className="reference-policy-form" onSubmit={create}><label>{t.amountCny}<input type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} required /></label><label>{t.redemptionCount}<input type="number" min="1" max="1000" value={count} onChange={event => setCount(event.target.value)} required /></label><label>{t.redemptionExpiresAt}<input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label>{notice ? <p className="reference-notice" role="status">{notice}</p> : null}<button className="reference-primary-action" disabled={busy}>{busy ? t.loading : t.generateRedemptionCodes}</button></form></aside></div>{generatedCodes ? <section className="reference-panel generated-codes-panel"><div className="reference-panel-heading"><h2>{t.redemptionCreated}</h2><button type="button" className="reference-secondary-action" onClick={() => setGeneratedCodes(null)}>{t.close}</button></div><p className="muted">{t.redemptionPlaintextWarning}</p><pre>{Array.isArray(generatedCodes.codes) ? generatedCodes.codes.join('\n') : ''}</pre></section> : null}</WorkspaceFrame>
}

export default function PlatformSettingsWorkspace({ area, id }: { area: SettingsArea; id?: string }) {
  const organizationsData = useWorkspaceData('/v1/platform/organizations/tree?all=true')
  const organizationId = value(asRows(organizationsData.data)[0], 'id')
  const policyData = useWorkspaceData('/v1/platform/policy')
  const redemptionData = useWorkspaceData('/v1/platform/redemption-codes?limit=200')
  const providerId = id
  if (area === 'identity/providers') return <IdentityProviderView organizationId={organizationId} routeId={id} />
  if (area === 'identity/mapping') return <MappingView organizationId={organizationId} providerId={providerId} />
  if (area === 'identity/login-failures') return <LoginFailuresView organizationId={organizationId} />
  if (area === 'platform/settings') return <PolicyView policy={asRow(policyData.data)} onReload={policyData.reload} />
  return <RedemptionsView data={redemptionData.data} onReload={redemptionData.reload} />
}
