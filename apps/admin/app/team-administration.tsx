'use client'

/** Platform team provisioning and lifecycle operations use explicit platform endpoints. */
import { useEffect, useState, type FormEvent } from 'react'
import { z } from 'zod'
import { governanceRequest, governanceSummary, teamResourcePolicy, platformTeamPage, subscriptionPlan } from '@deepseek-ai/dsh-enterprise-api/contracts'
import { request } from './client-api'
import { useActivityRevision } from './activity-refresh'
import { zh } from './messages'

const t = zh.teamAdministration
const teamPage = platformTeamPage
const teamList = platformTeamPage.shape.items
type State = z.infer<typeof governanceSummary>

/**
 * Render global team state without assuming membership in any customer team.
 * @param props Optional team selected by the detail route.
 * @returns Platform team directory, provisioning, resource and lifecycle forms.
 */
export default function TeamAdministration({ teamId }: { teamId?: string }) {
  const activityRevision = useActivityRevision()
  const [teams, setTeams] = useState<z.infer<typeof teamList>>([])
  const selected = teamId ?? ''
  const [state, setState] = useState<State>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(''), [draftQuery, setDraftQuery] = useState(''), [cursor, setCursor] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [revision, setRevision] = useState(0), [editing, setEditing] = useState<State>()
  const [creating, setCreating] = useState(false)
  const [plans, setPlans] = useState<z.infer<typeof subscriptionPlan>[]>([])
  useEffect(() => {
    let disposed = false
    void request('/v1/platform/plans').then((value) => { if (!disposed) setPlans(z.array(subscriptionPlan).parse(value)) })
      .catch((value) => { if (!disposed) setError(value instanceof Error ? value.message : t.failed) })
    return () => { disposed = true }
  }, [revision, activityRevision])
  useEffect(() => {
    let disposed = false
    const parameters = new URLSearchParams({ query, ...(status ? { status } : {}) })
    void request('/v1/platform/organizations?' + parameters).then((value) => {
      if (!disposed) { const page = teamPage.parse(value); setTeams(page.items); setCursor(page.nextCursor) }
    }).catch((value) => { if (!disposed) setError(value instanceof Error ? value.message : t.failed) })
    return () => { disposed = true }
  }, [revision, query, status, activityRevision])
  useEffect(() => {
    if (!selected) { setState(undefined); return }
    const controller = new AbortController()
    const refresh = () => {
      void request(`/v1/platform/organizations/${selected}/governance`).then((value) => {
        if (!controller.signal.aborted) setState(governanceSummary.parse(value))
      }).catch((value) => { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : t.failed) })
    }
    setState(undefined); setEditing(undefined); refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('enterprise-admin-refresh', refresh)
    return () => { controller.abort(); window.removeEventListener('focus', refresh); window.removeEventListener('enterprise-admin-refresh', refresh) }
  }, [selected, revision])
  async function perform(work: () => Promise<void>) {
    setBusy(true); setError('')
    try { await work(); setRevision(value => value + 1) }
    catch (value) { setError(value instanceof Error ? value.message : t.failed) }
    finally { setBusy(false) }
  }
  function mutation(event: FormEvent<HTMLFormElement>, change: (data: FormData) => unknown) {
    event.preventDefault()
    if (!editing) return
    const data = new FormData(event.currentTarget)
    void perform(async () => {
      if (data.get('budgetMode') === 'limited' && data.get('budget') === '') throw new Error(t.budgetRequired)
      const input = governanceRequest.parse({ expectedVersion: editing.version, reason: data.get('reason'), change: change(data) })
      setState(governanceSummary.parse(await request(`/v1/platform/organizations/${selected}/governance/actions`, 'POST', input)))
      setEditing(undefined)
    })
  }
  const reason = <label>
    {t.reason}<input required name="reason" maxLength={1000} /></label>
  const member = <label>
    {t.member}<select name="membershipId" required><option value="">{t.choose}</option>{editing?.members.map(item => <option key={item.id} value={item.id}>{item.name} · {item.email}</option>)}</select></label>
  return <section className="governance-page"><header className="page-header"><div><h1>{teamId ? state?.name || zh.teamDetailTitle : t.title}</h1><p>{t.intro}</p></div><div className="header-actions">{teamId ? <a className="secondary-button" href="/organizations/directory">{zh.backToDirectory}</a> : <button className="primary" onClick={() => setCreating(true)}>{t.create}</button>}<button onClick={() => setRevision(value => value + 1)} disabled={busy}>{t.refresh}</button></div></header>
    {error && <p className="error" role="alert">{error}</p>}
    {!teamId && <section className="card team-directory-card"><form className="filter-bar" onSubmit={(event) => { event.preventDefault(); setQuery(draftQuery) }}><label>{zh.search}<input value={draftQuery} onChange={event => setDraftQuery(event.target.value)} /></label><label>{t.status}<select value={status} onChange={event => setStatus(event.target.value)}><option value="">{zh.filterAll}</option><option value="active">{t.restore}</option><option value="suspended">{t.suspend}</option><option value="closed">{t.close}</option></select></label><button>{zh.search}</button></form>
      <div className="governance-table"><table><thead><tr><th>{t.team}</th><th>{t.owner}</th><th>{t.subscription}</th><th>{t.member}</th><th>{t.balance}</th></tr></thead><tbody>{teams.map(team => <tr key={team.id}><td><a href={`/organizations/directory/${encodeURIComponent(team.id)}`} className="team-name">{team.name}<small>{team.id}</small></a><span className={`status-badge ${team.status === 'active' ? 'success' : 'warning'}`}>{zh.statusLabels[team.status as keyof typeof zh.statusLabels] ?? team.status}</span></td><td>{team.owners.map(owner => owner.email).join(', ')}</td><td>{team.plan} · {team.seats}</td><td>{team.members}</td><td>{team.balanceMicrosCny === null ? t.unavailable : team.balanceMicrosCny / 1_000_000}</td></tr>)}</tbody></table></div>
      {cursor && <button disabled={busy} onClick={() => { setBusy(true); void request('/v1/platform/organizations?' + new URLSearchParams({ cursor, query, ...(status ? { status } : {}) })).then((value) => { const page = teamPage.parse(value); setTeams(previous => [...previous, ...page.items]); setCursor(page.nextCursor) }).catch(value => setError(value instanceof Error ? value.message : t.failed)).finally(() => setBusy(false)) }}>{zh.loadMore}</button>}
    </section>}
    <section className="modal-backdrop" hidden={!creating}><section className="modal modal-wide" role="dialog" aria-modal="true" aria-label={t.create}><div className="modal-heading"><h2>{t.create}</h2><button type="button" disabled={busy} data-dialog-close onClick={() => setCreating(false)} aria-label={zh.close}>×</button></div><form onSubmit={(event) => {
      event.preventDefault(); const data = new FormData(event.currentTarget)
      void perform(async () => {
        if (data.get('budgetMode') === 'limited' && data.get('budget') === '') throw new Error(t.budgetRequired)
        const resourcePolicy = teamResourcePolicy.parse({ defaultBudget: data.get('budgetMode') === 'unlimited' ? { mode: 'unlimited' }
          : { mode: 'limited', amountMicrosCny: Math.round(Number(data.get('budget')) * 1_000_000) }, timeZone: 'Asia/Shanghai',
        storageBytes: Math.round(Number(data.get('storage')) * 1024 ** 3), personalStorageBytes: Math.round(Number(data.get('personalStorage')) * 1024 ** 3) })
        await request('/v1/platform/organizations', 'POST', { name: data.get('name'), ownerAccountId: data.get('owner'), resourcePolicy }); setCreating(false) })
    }}><fieldset className="governance-form" disabled={busy}><label>{t.name}<input name="name" required maxLength={120} /></label><label>{t.owner}<input name="owner" required /></label>
        <label>{t.defaultBudget}<select name="budgetMode" required><option value="">{t.choose}</option><option value="limited">{t.limited}</option><option value="unlimited">{t.unlimited}</option></select></label>
        <label>{t.budget}<input type="number" name="budget" min="0" step="0.000001" /></label><p>{t.period}</p>
        <label>{zh.storageGiB}<input required type="number" name="storage" min="0" step="any" /></label><label>{zh.personalStorageGiB}<input required type="number" name="personalStorage" min="0" step="any" /></label><button className="primary">{t.create}</button>
      </fieldset></form></section></section>
    {teamId && !state && !error && <p role="status">{zh.loading}</p>}
    {state && <><section className="card"><div className="card-heading"><h2>{state.name}</h2><span className="status-badge">{zh.statusLabels[state.status as keyof typeof zh.statusLabels] ?? state.status}</span></div><dl className="detail-grid"><div><dt>{t.balance}</dt><dd>{state.balanceMicrosCny === null ? t.unavailable : state.balanceMicrosCny / 1_000_000}</dd></div><div><dt>{t.tasks}</dt><dd>{state.unfinishedTasks} / {state.unsettledTasks}</dd></div><div><dt>{t.storage}</dt><dd>{state.storage.usedBytes} / {state.policy?.storageBytes ?? t.unavailable}</dd></div><div><dt>{t.uploads}</dt><dd>{state.storage.uploadBytes}</dd></div><div><dt>{t.period}</dt><dd>{state.month} · {state.policy?.timeZone ?? t.unavailable}</dd></div><div><dt>{t.updated}</dt><dd>{new Date(state.updatedAt).toLocaleString()}</dd></div></dl></section><div className="team-details-layout"><section className="card"><h2>{t.readiness}</h2><ul className="readiness-list">{Object.entries(state.readiness).map(([key,
      ready]) => <li key={key}>{t.checks[key as keyof typeof t.checks] ?? key}: {ready ? t.ready : t.missing}</li>)}</ul></section><aside className="card"><h2>{t.subscription}</h2><dl className="model-runtime-fields"><div><dt>{t.plan}</dt><dd>{state.subscription?.plan ?? t.unavailable}</dd></div><div><dt>{t.seats}</dt><dd>{state.subscription?.seats ?? t.unavailable}</dd></div><div><dt>{zh.expired}</dt><dd>{state.subscription?.expiresAt ? new Date(state.subscription.expiresAt).toLocaleString() : zh.perpetual}</dd></div></dl><p className="muted">{t.retention}</p><button className="primary" disabled={busy || Boolean(editing)} onClick={() => setEditing(state)}>{t.edit}</button></aside></div><section className="card"><div className="card-heading"><h2>{t.member}</h2><span>{state.members.length} / {state.subscription?.seats ?? t.unavailable}</span></div><div className="governance-table"><table><thead><tr><th>{t.member}</th><th>{t.status}</th><th>{t.budget}</th><th>{t.spent}</th></tr></thead><tbody>{state.members.map(item => <tr key={item.id}><td>{item.email}</td><td><span className="status-badge">{zh.statusLabels[item.status as keyof typeof zh.statusLabels] ?? item.status}</span></td><td>{item.budget.mode === 'limited' ? item.budget.amountMicrosCny / 1_000_000 : item.budget.mode === 'inherit' ? t.inherit : t.unlimited}</td><td>{item.spentMicrosCny === null ? t.unavailable : item.spentMicrosCny / 1_000_000}</td></tr>)}</tbody></table></div>
    </section>
    {editing && <section className="card team-operation-panel"><h2>{t.edit} · {editing.name} · v{editing.version}</h2><p>{t.retention}</p><button onClick={() => setEditing(undefined)} disabled={busy}>{t.cancel}</button>
      <details className="governance-operation" name="team-operation"><summary>{t.credit}</summary><form onSubmit={event => mutation(event, data => ({ action: 'credit', amountMicrosCny: Math.round(Number(data.get('amount')) * 1_000_000) }))}><fieldset className="governance-form" disabled={busy}><h3>{t.credit}</h3><label>{t.amount}<input name="amount" required type="number" step="0.000001" /></label>{reason}<button>{t.save}</button></fieldset></form></details>
      <details className="governance-operation" name="team-operation"><summary>{t.resources}</summary><form onSubmit={event => mutation(event, data => ({ action: 'resources', policy: { defaultBudget: data.get('budgetMode') === 'unlimited' ? { mode: 'unlimited' } : { mode: 'limited', amountMicrosCny: Math.round(Number(data.get('budget')) * 1_000_000) },
        timeZone: data.get('zone'), storageBytes: Math.round(Number(data.get('storage')) * 1024 ** 3), personalStorageBytes: Math.round(Number(data.get('personalStorage')) * 1024 ** 3) } }))}><fieldset className="governance-form" disabled={busy}><h3>{t.resources}</h3>
          <label>{t.defaultBudget}<select name="budgetMode" required defaultValue={editing.policy?.defaultBudget.mode ?? ''}><option value="">{t.choose}</option><option value="limited">{t.limited}</option><option value="unlimited">{t.unlimited}</option></select></label>
          <label>{t.budget}<input name="budget" type="number" min="0" step="0.000001" defaultValue={editing.policy?.defaultBudget.mode === 'limited' ? editing.policy.defaultBudget.amountMicrosCny / 1_000_000 : 0} /></label>
          <label>{t.zone}<input name="zone" required defaultValue={editing.policy?.timeZone ?? 'Asia/Shanghai'} /></label><label>{zh.storageGiB}<input name="storage" type="number" min="0" step="any" required defaultValue={(editing.policy?.storageBytes ?? 0) / 1024 ** 3} /></label>
          <label>{zh.personalStorageGiB}<input name="personalStorage" type="number" min="0" step="any" required defaultValue={(editing.policy?.personalStorageBytes ?? 0) / 1024 ** 3} /></label>{reason}<button>{t.save}</button></fieldset></form></details>
      <details className="governance-operation" name="team-operation"><summary>{t.subscription}</summary><form onSubmit={event => mutation(event, data => ({ action: 'subscription', plan: data.get('plan'), planVersion: plans.find(plan => plan.code === data.get('plan'))?.version, seats: Number(data.get('seats')), expiresAt: data.get('expiresAt') ? new Date(String(data.get('expiresAt'))).toISOString() : null }))}><fieldset className="governance-form" disabled={busy}><h3>{t.subscription}</h3><p className="governance-full">{zh.planCatalog.selectionHelp} <a href="/platform/plans">{zh.plans}</a></p><label>{t.plan}<select required name="plan" defaultValue={editing.subscription?.plan ?? ''} onChange={(event) => {
        const plan = plans.find(plan => plan.code === event.target.value)
        const input = event.currentTarget.form?.elements.namedItem('seats')
        if (plan && input instanceof HTMLInputElement) input.value = String(plan.seats)
      }}><option value="">{t.choose}</option>{plans.map(plan => <option key={plan.code} value={plan.code} disabled={!plan.enabled}>{plan.name} · {plan.priceMicrosCny / 1_000_000}</option>)}</select></label><label>{t.seats}<input required name="seats" type="number" min="1" max="100000" step="1" defaultValue={editing.subscription?.seats} /></label><label>{t.expiresAt}<input name="expiresAt" type="datetime-local" defaultValue={editing.subscription?.expiresAt ? new Date(new Date(editing.subscription.expiresAt).getTime() - new Date(editing.subscription.expiresAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} /></label>{reason}<button>{t.save}</button></fieldset></form></details>
      <details className="governance-operation" name="team-operation"><summary>{t.ownerRecovery}</summary><form onSubmit={event => mutation(event, data => ({ action: 'owner-transfer', membershipId: data.get('membershipId') }))}><fieldset className="governance-form" disabled={busy}><h3>{t.ownerRecovery}</h3><p>{t.ownerRecoveryHelp}</p>{member}{reason}<button>{t.save}</button></fieldset></form></details>
      <details className="governance-operation" name="team-operation"><summary>{t.memberState}</summary><form onSubmit={event => mutation(event, data => ({ action: 'member-state', membershipId: data.get('membershipId'), status: data.get('status') }))}><fieldset className="governance-form" disabled={busy}><h3>{t.memberState}</h3>{member}<select name="status"><option value="suspended">{t.suspend}</option><option value="active">{t.restore}</option><option value="removed">{t.remove}</option></select>{reason}<button>{t.save}</button></fieldset></form></details>
      <details className="governance-operation" name="team-operation"><summary>{t.teamState}</summary><form onSubmit={event => mutation(event, data => ({ action: 'team-state', status: data.get('status'), ...(data.get('status') === 'closed' ? { closureReview: { tasks: true, balance: true, assets: true, exports: true } } : {}) }))}><fieldset className="governance-form" disabled={busy}><h3>{t.teamState}</h3><select name="status"><option value="suspended">{t.suspend}</option><option value="active">{t.restore}</option><option value="closed">{t.close}</option></select><label><input type="checkbox" required />{t.closeReview}</label>{reason}<button>{t.save}</button></fieldset></form></details>
    </section>}
    </>}
  </section>
}
