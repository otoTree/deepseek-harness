'use client'

/** Platform subscription catalog editor; mutations retain failed form values. */
import { useEffect, useState, type FormEvent } from 'react'
import { z } from 'zod'
import { subscriptionPlan, subscriptionPlanInput } from '@deepseek-ai/dsh-enterprise-api/contracts'
import { request } from './client-api'
import { useActivityRevision } from './activity-refresh'
import { zh } from './messages'

const t = zh.planCatalog
type Plan = z.infer<typeof subscriptionPlan>

/** Render plan defaults, reference counts and versioned create/edit/delete controls. */
export default function SubscriptionPlansWorkspace() {
  const activity = useActivityRevision()
  const [plans, setPlans] = useState<Plan[]>(), [editing, setEditing] = useState<Plan | 'new'>()
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0), [withPolicy, setWithPolicy] = useState(false)
  useEffect(() => {
    let disposed = false
    void request('/v1/platform/plans').then((value) => { if (!disposed) { setPlans(z.array(subscriptionPlan).parse(value)); setError('') } })
      .catch((value) => { if (!disposed) setError(value instanceof Error ? value.message : zh.error) })
    return () => { disposed = true }
  }, [revision, activity])
  const edit = (plan: Plan | 'new') => { setEditing(plan); setWithPolicy(plan !== 'new' && Boolean(plan.resourcePolicy)); setError(''); setNotice('') }
  const current = editing === 'new' ? undefined : editing
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true); setError(''); setNotice('')
    try {
      const values = subscriptionPlanInput.parse({ name: data.get('name'), description: data.get('description'),
        seats: Number(data.get('seats')), priceMicrosCny: Math.round(Number(data.get('price')) * 1_000_000), enabled: data.has('enabled'),
        resourcePolicy: withPolicy ? { defaultBudget: data.get('budgetMode') === 'unlimited' ? { mode: 'unlimited' }
          : { mode: 'limited', amountMicrosCny: Math.round(Number(data.get('budget')) * 1_000_000) }, timeZone: 'Asia/Shanghai',
        storageBytes: Math.round(Number(data.get('storage')) * 1024 ** 3), personalStorageBytes: Math.round(Number(data.get('personalStorage')) * 1024 ** 3) } : null })
      await request('/v1/platform/plans' + (current ? '/' + encodeURIComponent(current.code) : ''), current ? 'PATCH' : 'POST', {
        ...(current ? { expectedVersion: current.version } : { code: data.get('code') }), reason: data.get('reason'), values,
      })
      setEditing(undefined); setRevision(value => value + 1); setNotice(t.saved)
    } catch (value) { setError(value instanceof Error ? value.message : zh.error) }
    finally { setBusy(false) }
  }
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!current) return
    const data = new FormData(event.currentTarget)
    setBusy(true); setError('')
    try {
      await request('/v1/platform/plans/' + encodeURIComponent(current.code), 'DELETE', { expectedVersion: current.version, reason: data.get('reason') })
      setEditing(undefined); setRevision(value => value + 1)
    } catch (value) { setError(value instanceof Error ? value.message : zh.error) }
    finally { setBusy(false) }
  }
  return <div className="governance-page">
    <header className="page-header"><div className="page-heading">
      <h1>{t.title}</h1><p className="page-description">{t.intro}</p>
    </div><div className="governance-actions">
      <button className="primary" disabled={busy} onClick={() => edit('new')}>{t.create}</button>
      <button disabled={busy} onClick={() => setRevision(value => value + 1)}>{zh.refresh}</button>
    </div>
    </header>
    {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <section className="card governance-table"><table><thead><tr><th>{t.name}</th><th>{t.code}</th><th>{t.seats}</th><th>{t.price}</th><th>{t.assigned}</th><th>{t.enabled}</th><th>{zh.action}</th></tr></thead>
      <tbody>{plans?.map(plan => <tr key={plan.code}>
        <td>{plan.name}</td><td>{plan.code}</td><td>{plan.seats}</td><td>{plan.priceMicrosCny / 1_000_000}</td>
        <td>{plan.assignedTeams}</td><td>{plan.enabled ? zh.enabled : zh.disabled}</td>
        <td><button disabled={busy} onClick={() => edit(plan)}>{t.edit}</button></td>
      </tr>)}</tbody></table>
    {!plans ? <p role="status">{error ? zh.error : zh.loading}</p> : plans.length === 0 && <p>{zh.noData}</p>}
    </section>
    {editing && <div className="modal-backdrop"><section className="modal modal-wide" role="dialog" aria-modal="true" aria-label={current ? t.edit : t.create} key={current?.code ?? 'new'}><div className="card-heading"><h2>{current ? t.edit + ' · ' + current.name : t.create}</h2><button disabled={busy} data-dialog-close onClick={() => setEditing(undefined)}>{t.cancel}</button></div>
      <form onSubmit={event => void save(event)}><fieldset className="governance-form" disabled={busy}>
        <label>{t.code}<input name="code" required maxLength={60} pattern={current ? undefined : '[a-z0-9][a-z0-9_-]{0,59}'} readOnly={Boolean(current)} defaultValue={current?.code} /></label>
        <label>{t.name}<input name="name" required maxLength={120} defaultValue={current?.name} /></label>
        <label>{t.description}<textarea name="description" maxLength={1000} defaultValue={current?.description} /></label>
        <label>{t.seats}<input name="seats" required type="number" min="1" max="100000" step="1" defaultValue={current?.seats ?? 1} /></label>
        <label>{t.price}<input name="price" required type="number" min="0" step="0.000001" defaultValue={(current?.priceMicrosCny ?? 0) / 1_000_000} /></label>
        <label className="governance-check"><input type="checkbox" name="enabled" defaultChecked={current?.enabled ?? true} />{t.enabled}</label>
        <label className="governance-check"><input type="checkbox" checked={withPolicy} onChange={event => setWithPolicy(event.target.checked)} />{t.policy}</label>
        {withPolicy && <><p className="governance-full">{t.policyHelp}</p><label>{zh.teamAdministration.defaultBudget}<select name="budgetMode" defaultValue={current?.resourcePolicy?.defaultBudget.mode ?? 'limited'}><option value="limited">{zh.teamAdministration.limited}</option><option value="unlimited">{zh.teamAdministration.unlimited}</option></select></label>
          <label>{zh.teamAdministration.budget}<input type="number" name="budget" required min="0" step="0.000001" defaultValue={current?.resourcePolicy?.defaultBudget.mode === 'limited' ? current.resourcePolicy.defaultBudget.amountMicrosCny / 1_000_000 : 0} /></label>
          <label>{zh.storageGiB}<input type="number" required name="storage" min="0" step="any" defaultValue={(current?.resourcePolicy?.storageBytes ?? 0) / 1024 ** 3} /></label>
          <label>{zh.personalStorageGiB}<input type="number" required name="personalStorage" min="0" step="any" defaultValue={(current?.resourcePolicy?.personalStorageBytes ?? 0) / 1024 ** 3} /></label></>}
        <label>{t.reason}<input name="reason" required maxLength={1000} /></label><div className="governance-actions"><button className="primary">{t.save}</button></div>
      </fieldset></form>
      {current && <details className="governance-danger"><summary>{t.remove}</summary><form onSubmit={event => void remove(event)}><fieldset className="governance-form" disabled={busy || current.assignedTeams > 0 || ['team', 'private', 'enterprise'].includes(current.code)}><label>{t.reason}<input required name="reason" maxLength={1000} /></label><label className="governance-check"><input type="checkbox" required />{t.removeConfirm}</label><button className="danger">{t.remove}</button></fieldset></form></details>}
    </section></div>}
  </div>
}
