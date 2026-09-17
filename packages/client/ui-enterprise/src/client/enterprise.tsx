/** Enterprise account and governed-plugin sections for the existing Web settings shell. */
import { useEffect, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { Button, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import { enterpriseDashboard, enterpriseModelSelection, enterprisePluginCatalog, revokeRuntimeInput, setModelInput, type EnterpriseDashboard, type EnterprisePluginCatalog, type EnterpriseModelSelection } from '../wire.ts'
import { en, zh, type EnterpriseLocaleKey } from './locales.ts'
import './styles.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Enterprise account and governed-plugin copy. */
    enterprise: EnterpriseLocaleKey
  }
}

interface NativeEnterpriseActions {
  switchOrganization: () => Promise<unknown>
  logout: () => Promise<unknown>
}

interface EnterpriseWindow extends Window {
  __dshNative?: NativeEnterpriseActions
}

interface EnterpriseInjected {
  loadDashboard: () => Promise<EnterpriseDashboard>
  loadModelSelection: () => Promise<EnterpriseModelSelection>
  saveModel: (model: string) => Promise<EnterpriseModelSelection>
  loadPlugins: () => Promise<EnterprisePluginCatalog>
  revokeRuntime: (runtimeId: string) => Promise<void>
  switchOrganization: () => void
  logout: () => void
}

type AccountProps = PropsRuntime<'settings.section'> & PropsLocale<'enterprise'> & InjectFace<EnterpriseInjected>
type PluginsProps = PropsRuntime<'settings.section'> & PropsLocale<'enterprise'> & InjectFace<EnterpriseInjected>
type AsyncState<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: T }

function money(micros: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(micros / 1_000_000)
}

function AccountSection({ loadDashboard, revokeRuntime, switchOrganization, logout, t }: AccountProps): ReactNode {
  const [revision, setRevision] = useState(0)
  const [confirmRuntime, setConfirmRuntime] = useState<string | null>(null)
  const [operationError, setOperationError] = useState(false)
  const [state, setState] = useState<AsyncState<EnterpriseDashboard>>({ status: 'loading' })
  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void loadDashboard().then(
      (value) => { if (current) setState({ status: 'ready', value }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [loadDashboard, revision])
  if (state.status === 'loading') return <div className="dse-status">{t('loading')}</div>
  if (state.status === 'error') return <div className="dse-status dse-error">{t('error')} <Button size="sm" onClick={() => { setRevision(value => value + 1) }}>{t('retry')}</Button></div>
  const data = state.value
  const revoke = (id: string): void => {
    if (confirmRuntime !== id) { setConfirmRuntime(id); return }
    setOperationError(false)
    void revokeRuntime(id).then(() => {
      setConfirmRuntime(null)
      setRevision(value => value + 1)
    }, () => { setOperationError(true) })
  }
  return <div className="dse-section">
    <header className="dse-header">
      <div><p className="dse-eyebrow">{t('organization')}</p><h2 className="dse-title">{data.organization.name}</h2><p className="dse-subtle">{data.organization.kind} · {data.organization.status}</p></div>
      <div className="dse-actions"><Button size="sm" variant="outline" onClick={switchOrganization}>{t('switchOrganization')}</Button><Button size="sm" onClick={logout}>{t('logout')}</Button></div>
    </header>
    {operationError ? <p className="dse-subtle dse-error" role="alert">{t('requestFailed')}</p> : null}
    <div className="dse-grid">
      <section className="dse-card"><h3>{t('plan')}</h3><p className="dse-value">{data.subscription.plan}</p><p className="dse-meta">{String(data.subscription.seats)} {t('seats')} · {String(data.subscription.runtimes)} {t('runtimes')}</p></section>
      <section className="dse-card"><h3>{t('budget')}</h3><p className="dse-value">{money(data.subscription.spentMicros)}</p><p className="dse-meta">{money(data.subscription.reservedMicros)} {t('reserved')} · {money(data.subscription.budgetMicros)} {t('limit')}</p></section>
      <section className="dse-card"><h3>{t('usage')}</h3><p className="dse-value">{data.usage.calls.toLocaleString()} {t('calls')}</p><p className="dse-meta">{(data.usage.inputTokens + data.usage.outputTokens).toLocaleString()} {t('tokens')} · {money(data.usage.billedMicros)} {t('billed')}</p></section>
      <section className="dse-card"><h3>{t('roles')}</h3><div className="dse-tags">{data.roles.map(role => <span className="dse-tag" key={`${role.role}:${role.unitId ?? 'organization'}`}>{role.role}</span>)}</div></section>
      <section className="dse-card dse-card-wide"><h3>{t('models')}</h3><ul className="dse-list">{data.models.map(model => <li className="dse-row" key={model.id}><span className="dse-row-main"><strong className="dse-row-title">{model.name}</strong><span className="dse-row-note">{model.contextTokens.toLocaleString()} {t('context')} · {model.maxOutputTokens.toLocaleString()} {t('output')} · {model.protocol} · {model.fileInputPolicy}{model.inputModalities.includes('video') ? ` · ${t(model.videoAudioMode === 'visual-and-audio' ? 'videoWithAudio' : 'videoVisualOnly')}` : ''}</span></span><Pill>{model.inputModalities.join(' · ')}</Pill></li>)}</ul></section>
      <section className="dse-card dse-card-wide"><h3>{t('devices')}</h3><ul className="dse-list">{data.runtimes.map(runtime => <li className="dse-row" key={runtime.id}><span className="dse-row-main"><strong className="dse-row-title">{runtime.name}{runtime.current ? ` · ${t('currentDevice')}` : ''}</strong><span className="dse-row-note">{runtime.type} · {runtime.version}</span></span>{runtime.revokedAt ? <Pill>{t('revoke')}</Pill> : <Button size="sm" variant="outline" onClick={() => { revoke(runtime.id) }}>{confirmRuntime === runtime.id ? t('confirmRevoke') : t('revoke')}</Button>}</li>)}</ul></section>
    </div>
  </div>
}

function ModelSection({ loadDashboard, loadModelSelection, saveModel, t }: AccountProps): ReactNode {
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [state, setState] = useState<AsyncState<EnterpriseDashboard>>({ status: 'loading' })
  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void Promise.all([loadDashboard(), loadModelSelection()]).then(([dashboard, selection]) => {
      if (!current) return
      setSelected(selection.model)
      setState({ status: 'ready', value: dashboard })
    }, () => { if (current) setState({ status: 'error' }) })
    return () => { current = false }
  }, [loadDashboard, loadModelSelection, revision])
  if (state.status === 'loading') return <div className="dse-status">{t('loading')}</div>
  if (state.status === 'error') return <div className="dse-status dse-error">{t('error')} <Button size="sm" onClick={() => { setRevision(value => value + 1) }}>{t('retry')}</Button></div>
  const save = (model: string): void => {
    const previous = selected
    setSelected(model)
    setSaving(true)
    setError(false)
    void saveModel(model).then(
      () => { setSaving(false) },
      () => { setSelected(previous); setSaving(false); setError(true) },
    )
  }
  return <div className="dse-section">
    <header><h2 className="dse-title">{t('modelsNav')}</h2><p className="dse-subtle">{t('modelsIntro')}</p></header>
    {error ? <p className="dse-subtle dse-error" role="alert">{t('requestFailed')}</p> : null}
    <section className="dse-card dse-card-wide">
      <label className="dse-field"><span className="dse-row-title">{t('defaultModel')}</span><select value={selected ?? ''} disabled={saving} onChange={(event) => { save(event.currentTarget.value) }}>
        {state.value.models.map(model => <option value={model.id} key={model.id}>{model.name} ({model.id})</option>)}
      </select></label>
      <p className="dse-meta">{saving ? t('saving') : t('modelManaged')}</p>
    </section>
  </div>
}

function PluginsSection({ loadPlugins, t }: PluginsProps): ReactNode {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<AsyncState<EnterprisePluginCatalog>>({ status: 'loading' })
  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void loadPlugins().then(
      (value) => { if (current) setState({ status: 'ready', value }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [loadPlugins, revision])
  if (state.status === 'loading') return <div className="dse-status">{t('loading')}</div>
  if (state.status === 'error') return <div className="dse-status dse-error">{t('error')} <Button size="sm" onClick={() => { setRevision(value => value + 1) }}>{t('retry')}</Button></div>
  return <div className="dse-section">
    <header><h2 className="dse-title">{t('pluginsNav')}</h2><p className="dse-subtle">{t('pluginIntro')}</p></header>
    {state.value.length === 0 ? <div className="dse-status">{t('noPlugins')}</div> : <div className="dse-plugin-grid">{state.value.map(plugin => <article className="dse-plugin" key={plugin.id}><div className="dse-plugin-head"><h3>{plugin.pluginId}</h3><Pill active>{t('available')}</Pill></div><p>{t('version')} {plugin.version}</p><div className="dse-tags">{plugin.targets.map(target => <span className="dse-tag dse-tag-accent" key={target}>{t(target === 'browser' ? 'browserTarget' : target === 'desktop' ? 'desktopTarget' : 'cloudTarget')}</span>)}</div><p>{t('permissions')}: {plugin.permissions.length ? plugin.permissions.join(', ') : t('none')} · {t('tools')}: {String(plugin.tools.length)}</p></article>)}</div>}
  </div>
}

export const inject = ['slots', 'locale', 'connection']

/** Register enterprise pages into the original Web settings shell. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('enterprise', { zh, en }), 'enterprise-client: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  const call = async (endpoint: string, payload: unknown): Promise<unknown> => {
    const result = await connection.rpc.call('/enterprise', endpoint, { args: payload })
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const native = (): NativeEnterpriseActions | undefined => (window as EnterpriseWindow).__dshNative
  const injected = (): EnterpriseInjected => ({
    loadDashboard: async () => enterpriseDashboard.parse(await call('dashboard', {})),
    loadModelSelection: async () => enterpriseModelSelection.parse(await call('model-selection', {})),
    saveModel: async (model) => { const input = setModelInput.parse({ model }); return enterpriseModelSelection.parse(await call('set-model', input)) },
    loadPlugins: async () => enterprisePluginCatalog.parse(await call('plugins', {})),
    revokeRuntime: async (runtimeId) => { revokeRuntimeInput.parse({ runtimeId }); await call('revoke-runtime', { runtimeId }) },
    switchOrganization: () => { void native()?.switchOrganization() },
    logout: () => { void native()?.logout() },
  })
  const t = ctx.locale.bind('enterprise')
  ctx.slots.inject('settings.section', function* () {
    yield ctx.slots.register({ name: 'settings.section', id: 'enterprise', order: 5, label: () => t('accountNav'), locale: 'enterprise', inject: injected }, AccountSection)
    yield ctx.slots.register({ name: 'settings.section', id: 'enterprise-models', order: 10, label: () => t('modelsNav'), locale: 'enterprise', inject: injected }, ModelSection)
    yield ctx.slots.register({ name: 'settings.section', id: 'plugins', order: 15, label: () => t('pluginsNav'), locale: 'enterprise', inject: injected }, PluginsSection)
  })
}
