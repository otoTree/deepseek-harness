'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { request } from './client-api'
import { zh as t } from './messages'

type Provider = {
  id: string
  name: string
  baseUrl: string
  version: number
  enabled: boolean
  timeoutMs: number
  retryableHttpStatuses: number[]
}
type ReviewTask = {
  id: string
  publicModel: string
  organizationId: string
  status: string
  billingStatus: string
  assetStatus: string
  version: number
  reviewReason: string | null
  outstandingMicrosCny: number
}

/** Manage shared provider revisions and audited task resolutions without exposing credentials. */
export function ModelPlatformAdministration() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [tasks, setTasks] = useState<ReviewTask[]>([])
  const [providerId, setProviderId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [form, setForm] = useState({ name: '', baseUrl: '', apiKey: '', enabled: true, timeoutMs: '300000', retryableHttpStatuses: '429,500,502,503,504' })
  const [resolution, setResolution] = useState({ action: 'link_provider_task', providerTaskId: '', evidence: '', finalCny: '0' })
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const [providerRows, taskRows] = await Promise.all([request('/v1/platform/model-providers'), request('/v1/platform/model-tasks')])
    setProviders(providerRows as Provider[]); setTasks(taskRows as ReviewTask[])
  }, [])
  useEffect(() => { void load().catch(error => setNotice(error instanceof Error ? error.message : t.error)) }, [load])
  const selectProvider = (id: string) => {
    setProviderId(id)
    const provider = providers.find(row => row.id === id)
    setForm({ name: provider?.name ?? '', baseUrl: provider?.baseUrl ?? '', apiKey: '', enabled: provider?.enabled ?? true,
      timeoutMs: String(provider?.timeoutMs ?? 300000), retryableHttpStatuses: (provider?.retryableHttpStatuses ?? [429, 500, 502, 503, 504]).join(',') })
  }
  const saveProvider = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setNotice('')
    try {
      await request('/v1/platform/model-providers' + (providerId ? '/' + providerId : ''), providerId ? 'PUT' : 'POST', {
        name: form.name, baseUrl: form.baseUrl, ...(form.apiKey ? { apiKey: form.apiKey } : {}), enabled: form.enabled,
        timeoutMs: Number(form.timeoutMs), retryableHttpStatuses: form.retryableHttpStatuses.split(',').map(Number),
      })
      setForm(previous => ({ ...previous, apiKey: '' })); await load(); setNotice(t.success)
    } catch (error) { setNotice(error instanceof Error ? error.message : t.error) }
    finally { setBusy(false) }
  }
  const resolve = async (event: FormEvent) => {
    event.preventDefault()
    const task = tasks.find(row => row.id === taskId)
    if (!task) return
    setBusy(true); setNotice('')
    try {
      await request('/v1/platform/model-tasks/' + task.id + '/resolve', 'POST', {
        action: resolution.action, expectedVersion: task.version, evidence: resolution.evidence,
        ...(resolution.action === 'link_provider_task' ? { providerTaskId: resolution.providerTaskId } : {}),
        ...(resolution.action === 'adjust_charge' ? { finalMicrosCny: Math.round(Number(resolution.finalCny) * 1_000_000) } : {}),
      })
      await load(); setNotice(t.success); setResolution(previous => ({ ...previous, evidence: '' }))
    } catch (error) { setNotice(error instanceof Error ? error.message : t.error) }
    finally { setBusy(false) }
  }
  return <details className="model-runtime-card"><summary>{t.providersTitle} · {providers.length} · {t.taskReview}: {tasks.length}</summary>
    {notice ? <p role="status">{notice}</p> : null}
    <div className="model-runtime-detail-content"><form className="grid-form" onSubmit={(event) => { void saveProvider(event) }}>
      <label>{t.provider}<select value={providerId} onChange={event => selectProvider(event.target.value)}><option value="">{t.create}</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name} · v{provider.version}</option>)}</select></label>
      <label>{t.name}<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
      <label>{t.baseUrl}<input type="url" required value={form.baseUrl} onChange={event => setForm({ ...form, baseUrl: event.target.value })} /></label>
      <label>{t.apiKey}<input type="password" autoComplete="new-password" required={!providerId} value={form.apiKey} onChange={event => setForm({ ...form, apiKey: event.target.value })} /></label>
      <label>{t.providerTimeout}<input type="number" min="1000" max="1800000" required value={form.timeoutMs} onChange={event => setForm({ ...form, timeoutMs: event.target.value })} /></label>
      <label>{t.retryStatuses}<input required value={form.retryableHttpStatuses} onChange={event => setForm({
        ...form, retryableHttpStatuses: event.target.value,
      })} /></label>
      <label>{t.enabled}<input type="checkbox" checked={form.enabled} onChange={event => setForm({
        ...form, enabled: event.target.checked,
      })} /></label>
      <button type="submit" disabled={busy}>{t.save}</button>
    </form>
    <form className="grid-form" onSubmit={(event) => { void resolve(event) }}>
      <label>{t.taskReview}<select required value={taskId} onChange={event => setTaskId(event.target.value)}><option value="">—</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.publicModel} · {task.id} · {task.reviewReason} · ¥{task.outstandingMicrosCny / 1_000_000}</option>)}</select></label>
      <label>{t.resolutionAction}<select value={resolution.action} onChange={event => setResolution({
        ...resolution, action: event.target.value,
      })}>{Object.entries(t.resolutionActions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {resolution.action === 'link_provider_task' ? <label>{t.providerTaskId}<input required value={resolution.providerTaskId} onChange={event => setResolution({ ...resolution, providerTaskId: event.target.value })} /></label> : null}
      {resolution.action === 'adjust_charge' ? <label>{t.finalAmountCny}<input type="number" min="0" step="0.000001" required value={resolution.finalCny} onChange={event => setResolution({ ...resolution, finalCny: event.target.value })} /></label> : null}
      <label>{t.evidence}<textarea required minLength={10} maxLength={2000} value={resolution.evidence} onChange={event => setResolution({
        ...resolution, evidence: event.target.value,
      })} /></label>
      <button type="submit" disabled={busy || !taskId}>{t.resolveTask}</button>
    </form></div>
  </details>
}
