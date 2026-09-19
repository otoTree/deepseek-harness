/** Enterprise account and governed-plugin sections for the existing Web settings shell. */
import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import {
  Button,
  IconArchiveOutline20,
  IconChevronLeftOutline14,
  IconCordisPluginOutline14,
  Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import {
  enterpriseDashboard,
  enterpriseModelSelection,
  enterprisePluginCatalog,
  enterprisePluginInstallations,
  pluginEnableInput,
  pluginInstallationInput,
  pluginUploadInput,
  enterpriseTeam,
  enterpriseUsagePage,
  enterpriseWallet,
  enterpriseWalletLedger,
  inviteMemberInput,
  memberUsageInput,
  redeemCodeInput,
  revokeInvitationInput,
  revokeRuntimeInput,
  setModelInput,
  teamUsageRangeInput,
  type EnterpriseDashboard,
  type EnterpriseModelSelection,
  type EnterprisePluginCatalog,
  type EnterprisePluginInstallations,
  type EnterpriseTeam,
  type EnterpriseUsagePage,
  type EnterpriseWallet,
  type EnterpriseWalletLedger,
} from '../wire.ts'
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
  loadPluginInstallations: () => Promise<EnterprisePluginInstallations>
  uploadPlugin: (visibility: 'private' | 'organization' | 'platform', bytes: Uint8Array) => Promise<unknown>
  installPlugin: (releaseId: string) => Promise<unknown>
  setPluginEnabled: (installationId: string, enabled: boolean) => Promise<unknown>
  openConversation: () => void
  revokeRuntime: (runtimeId: string) => Promise<void>
  loadWallet: () => Promise<EnterpriseWallet>
  loadWalletLedger: () => Promise<EnterpriseWalletLedger>
  loadOwnUsage: () => Promise<EnterpriseUsagePage>
  redeem: (code: string) => Promise<EnterpriseWallet>
  loadTeam: (from?: string, to?: string) => Promise<EnterpriseTeam>
  loadMemberUsage: (accountId: string, cursor?: string, from?: string, to?: string) => Promise<EnterpriseUsagePage>
  inviteMember: (email: string, role: 'member' | 'administrator') => Promise<void>
  revokeInvitation: (invitationId: string) => Promise<void>
  switchOrganization: () => void
  logout: () => void
}

type AccountProps = PropsRuntime<'settings.section'> & PropsLocale<'enterprise'> & InjectFace<EnterpriseInjected>
type PluginsProps = PropsRuntime<'settings.section'> & PropsLocale<'enterprise'> & InjectFace<EnterpriseInjected>
type PluginMarketProps = PropsRuntime<'main.surface'> & PropsLocale<'enterprise'> & InjectFace<EnterpriseInjected>
type PluginMarketActionProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'enterprise'> & InjectFace<{
  navigation: { get(): 'conversation' | 'plugin-market'; subscribe(listener: () => void): () => void }
  open: () => void
}>
type TeamProps = PropsRuntime<'settings.section'> & PropsLocale<'enterprise'> & InjectFace<EnterpriseInjected>
type AsyncState<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: T }

function moneyCny(micros: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micros / 1_000_000)
}

function calendarDate(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function shiftCalendarDate(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10)
}

function zonedDateStart(value: string, timeZone: string): string {
  const [year, month, day] = value.split('-').map(Number)
  const wanted = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)
  let candidate = wanted
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(candidate))
    const number = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find(item => item.type === type)?.value)
    const observed = Date.UTC(number('year'), number('month') - 1, number('day'), number('hour'), number('minute'), number('second'))
    candidate += wanted - observed
  }
  return new Date(candidate).toISOString()
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
      <section className="dse-card"><h3>{t('roles')}</h3><div className="dse-tags">{data.roles.map(role => <span className="dse-tag" key={`${role.role}:${role.unitId ?? 'organization'}`}>{role.role}</span>)}</div></section>
      <section className="dse-card dse-card-wide"><h3>{t('usage')}</h3><p className="dse-value">{`${data.usage.calls.toLocaleString()} ${t('calls')}`}</p><p className="dse-meta">{`${(data.usage.inputTokens + data.usage.outputTokens).toLocaleString()} ${t('tokens')} · ${moneyCny(data.usage.totalCostMicrosCny)} ${t('billed')}`}</p>{data.usage.unpricedCalls > 0 ? <p className="dse-meta">{t('unpricedCalls', { count: data.usage.unpricedCalls })}</p> : null}</section>
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

function PluginMarketAction({ wide, navigation, open, t }: PluginMarketActionProps): ReactNode {
  const active = useSyncExternalStore(
    navigation.subscribe.bind(navigation),
    navigation.get.bind(navigation),
    () => 'conversation' as const,
  ) === 'plugin-market'
  return <button type="button" className="dse-market-action" data-wide={wide || undefined} data-active={active || undefined} aria-label={t('pluginMarket')} aria-pressed={active} onClick={open}>
    <IconCordisPluginOutline14 size={wide ? 16 : 18} />{wide ? <span className="dse-market-action-label">{t('pluginMarket')}</span> : null}
  </button>
}

function PluginMarket({
  loadPlugins,
  loadPluginInstallations,
  uploadPlugin,
  installPlugin,
  setPluginEnabled,
  openConversation,
  t,
}: PluginMarketProps): ReactNode {
  const [plugins, setPlugins] = useState<EnterprisePluginCatalog>([])
  const [installations, setInstallations] = useState<EnterprisePluginInstallations>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [visibility, setVisibility] = useState<'private' | 'organization' | 'platform'>('private')
  const [busy, setBusy] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string>()
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>()
  const fileInput = useRef<HTMLInputElement>(null)
  const reload = (): void => {
    setState('loading')
    void Promise.all([loadPlugins(), loadPluginInstallations()]).then(([catalog, installed]) => {
      setPlugins(catalog); setInstallations(installed); setState('ready')
    }, () => { setState('error') })
  }
  useEffect(() => { reload() }, [])
  if (state === 'loading') return <div className="dse-status">{t('loading')}</div>
  if (state === 'error') return <div className="dse-status dse-error">{t('error')} <Button size="sm" onClick={reload}>{t('retry')}</Button></div>
  const installedFor = (releaseId: string) => installations.find(item => item.releaseId === releaseId)
  const onUpload = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    setSelectedFile(file.name); setBusy(true); setNotice(undefined)
    void file.arrayBuffer().then(buffer => uploadPlugin(visibility, new Uint8Array(buffer))).then(() => {
      setNotice({ kind: 'success', text: t(visibility === 'private' ? 'uploadPrivateComplete' : 'uploadReviewComplete') }); reload()
    }, (error: unknown) => {
      const message = error instanceof Error ? error.message : ''
      const text = message.startsWith('Invalid plugin package:')
        ? t('invalidPluginPackage')
        : t('requestFailed')
      setNotice({ kind: 'error', text })
    }).finally(() => {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    })
  }
  const onInstall = (releaseId: string): void => {
    setBusy(true); void installPlugin(releaseId).then(() => { setNotice({ kind: 'success', text: t('installComplete') }); reload() }, () => { setNotice({ kind: 'error', text: t('requestFailed') }) }).finally(() => { setBusy(false) })
  }
  const onToggle = (installationId: string, enabled: boolean): void => {
    setBusy(true); void setPluginEnabled(installationId, enabled).then(reload, () => { setNotice({ kind: 'error', text: t('requestFailed') }) }).finally(() => { setBusy(false) })
  }
  const targetLabel = (target: string): string => {
    if (target === 'client') return t('clientTarget')
    if (target === 'host') return t('hostTarget')
    if (target === 'browser') return t('browserTarget')
    if (target === 'desktop') return t('desktopTarget')
    return t('cloudTarget')
  }
  return <main className="dse-market">
    <header className="dse-market-header">
      <Button size="sm" variant="ghost" icon={<IconChevronLeftOutline14 />} onClick={openConversation}>{t('backToConversation')}</Button>
      <div><h2 className="dse-market-title">{t('pluginMarket')}</h2><p className="dse-market-intro">{t('pluginMarketIntro')}</p></div>
    </header>
    <section className="dse-market-upload" aria-labelledby="dse-market-upload-title">
      <span className="dse-market-upload-icon" aria-hidden="true"><IconArchiveOutline20 /></span>
      <div className="dse-market-upload-body">
        <div><h3 id="dse-market-upload-title">{t('uploadPlugin')}</h3><p>{t('uploadPluginHelp')}</p></div>
        <div className="dse-market-upload-controls">
          <label className="dse-market-visibility"><span>{t('visibility')}</span><select value={visibility} disabled={busy} onChange={(event) => { setVisibility(event.currentTarget.value as typeof visibility) }}><option value="private">{t('privateVisibility')}</option><option value="organization">{t('organizationVisibility')}</option><option value="platform">{t('platformVisibility')}</option></select></label>
          <input ref={fileInput} className="dse-file-input" aria-label={t('pluginPackageFile')} type="file" accept=".dsh-plugin.zip,application/zip" disabled={busy} onChange={onUpload} />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => { fileInput.current?.click() }}>{busy ? t('uploadingPlugin') : t('selectPluginPackage')}</Button>
          {selectedFile ? <span className="dse-market-filename" title={selectedFile}>{selectedFile}</span> : null}
        </div>
        {notice ? <p className={notice.kind === 'error' ? 'dse-market-notice dse-error' : 'dse-market-notice'} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p> : null}
      </div>
    </section>
    <section className="dse-market-catalog" aria-labelledby="dse-market-catalog-title">
      <div className="dse-market-catalog-heading"><h3 id="dse-market-catalog-title">{t('availablePlugins')}</h3><span>{t('pluginCount', { count: plugins.length })}</span></div>
      {plugins.length === 0 ? <div className="dse-market-empty"><IconCordisPluginOutline14 size={20} /><p>{t('noPlugins')}</p></div> : <div className="dse-market-grid">{plugins.map((plugin) => { const installation = installedFor(plugin.id); return <article className="dse-market-plugin" key={plugin.id}><div className="dse-market-plugin-head"><div className="dse-market-plugin-name"><span aria-hidden="true"><IconCordisPluginOutline14 size={16} /></span><h4>{plugin.pluginId}</h4></div><Pill active>{t('available')}</Pill></div><p className="dse-market-plugin-version">{t('version')} {plugin.version}</p><div className="dse-tags">{plugin.targets.map(target => <span className="dse-tag" key={target}>{targetLabel(target)}</span>)}</div><div className="dse-market-plugin-action">{installation ? <Button size="sm" variant="outline" disabled={busy} onClick={() => { onToggle(installation.id, !installation.enabled) }}>{installation.enabled ? t('disablePlugin') : t('enablePlugin')}</Button> : <Button size="sm" variant="outline" disabled={busy} onClick={() => { onInstall(plugin.id) }}>{t('installPlugin')}</Button>}</div></article> })}</div>}
    </section>
  </main>
}

function TeamSection({
  loadDashboard, loadWallet, loadWalletLedger, loadOwnUsage, redeem, loadTeam, loadMemberUsage,
  inviteMember, revokeInvitation, t,
}: TeamProps): ReactNode {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<AsyncState<{
    dashboard: EnterpriseDashboard
    wallet: EnterpriseWallet
    ledger: EnterpriseWalletLedger
    usage: EnterpriseUsagePage
    team?: EnterpriseTeam
  }>>({ status: 'loading' })
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'administrator'>('member')
  const [busy, setBusy] = useState(false)
  const [operationError, setOperationError] = useState<string>()
  const [selectedMember, setSelectedMember] = useState<string>()
  const [memberUsage, setMemberUsage] = useState<EnterpriseUsagePage>()
  const [requestedRange, setRequestedRange] = useState<{ from: string; to: string }>()
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void Promise.all([loadDashboard(), loadWallet(), loadWalletLedger(), loadOwnUsage()]).then(async (
      [dashboard, wallet, ledger, usage],
    ) => {
      const canManage = dashboard.roles.some(item => item.role === 'owner' || item.role === 'administrator')
      const team = canManage ? await loadTeam(requestedRange?.from, requestedRange?.to) : undefined
      if (current) {
        if (team !== undefined) {
          setFromDate(value => value || calendarDate(team.range.from, team.range.timeZone))
          setToDate(value => value || calendarDate(new Date(new Date(team.range.to).getTime() - 1).toISOString(), team.range.timeZone))
        }
        setState({ status: 'ready', value: {
          dashboard, wallet, ledger, usage, ...(team === undefined ? {} : { team }),
        } })
      }
    }, () => { if (current) setState({ status: 'error' }) })
    return () => { current = false }
  }, [loadDashboard, loadOwnUsage, loadTeam, loadWallet, loadWalletLedger, requestedRange, revision])
  if (state.status === 'loading') return <div className="dse-status">{t('loading')}</div>
  if (state.status === 'error') return <div className="dse-status dse-error">{t('error')} <Button size="sm" onClick={() => { setRevision(value => value + 1) }}>{t('retry')}</Button></div>
  const data = state.value
  const submitRedeem = (): void => {
    setBusy(true); setOperationError(undefined)
    void redeem(code).then(() => { setCode(''); setBusy(false); setRevision(value => value + 1) }, (error: unknown) => {
      setBusy(false); setOperationError(error instanceof Error ? error.message : 'UNKNOWN')
    })
  }
  const submitInvite = (): void => {
    setBusy(true); setOperationError(undefined)
    void inviteMember(email, role).then(() => { setEmail(''); setBusy(false); setRevision(value => value + 1) }, () => {
      setBusy(false); setOperationError('UNKNOWN')
    })
  }
  const selectMember = (accountId: string): void => {
    setSelectedMember(accountId); setMemberUsage(undefined); setOperationError(undefined)
    void loadMemberUsage(accountId, undefined, requestedRange?.from, requestedRange?.to)
      .then(setMemberUsage, () => { setOperationError('UNKNOWN') })
  }
  const applyRange = (): void => {
    if (!data.team || !fromDate || !toDate || fromDate > toDate) return
    const next = teamUsageRangeInput.parse({
      from: zonedDateStart(fromDate, data.team.range.timeZone),
      to: zonedDateStart(shiftCalendarDate(toDate, 1), data.team.range.timeZone),
    })
    setSelectedMember(undefined)
    setMemberUsage(undefined)
    setRequestedRange(next as { from: string; to: string })
  }
  const loadMoreMemberUsage = (): void => {
    if (!selectedMember || !memberUsage?.nextCursor) return
    setBusy(true)
    void loadMemberUsage(selectedMember, memberUsage.nextCursor, requestedRange?.from, requestedRange?.to).then((next) => {
      setMemberUsage({ ...next, items: [...memberUsage.items, ...next.items] })
      setBusy(false)
    }, () => { setBusy(false); setOperationError('UNKNOWN') })
  }
  const errorKey = operationError === 'INVALID_REDEMPTION_CODE' ? 'invalidCode'
    : operationError === 'REDEMPTION_CODE_REVOKED' ? 'revokedCode'
      : operationError === 'REDEMPTION_CODE_REDEEMED' ? 'usedCode'
        : operationError === 'REDEMPTION_CODE_EXPIRED' ? 'expiredCode' : 'requestFailed'
  return <div className="dse-section">
    <header><h2 className="dse-title">{t('teamNav')}</h2><p className="dse-subtle">{t('teamIntro')}</p></header>
    {operationError ? <p className="dse-subtle dse-error" role="alert">{t(errorKey)}</p> : null}
    <div className="dse-grid">
      <section className="dse-card"><h3>{t('teamBalance')}</h3><p className="dse-value">{moneyCny(data.wallet.balanceMicrosCny)}</p><p className="dse-meta">{t('sharedBalance')}</p></section>
      <section className="dse-card"><h3>{t('monthlyUsage')}</h3><p className="dse-value">{data.usage.items.length.toLocaleString()} {t('calls')}</p><p className="dse-meta">{data.usage.items.reduce((sum, item) => sum + (item.totalTokens ?? 0), 0).toLocaleString()} {t('tokens')} · {moneyCny(data.usage.items.reduce((sum, item) => sum + (item.status === 'settled' && item.currency === 'CNY' ? item.totalCostMicrosCny ?? 0 : 0), 0))}</p></section>
      <section className="dse-card dse-card-wide"><h3>{t('redeemCode')}</h3><div className="dse-inline-form"><input aria-label={t('redeemCode')} value={code} disabled={busy} onChange={(event) => { setCode(event.currentTarget.value) }} placeholder={t('redeemPlaceholder')} /><Button size="sm" disabled={busy || !redeemCodeInput.safeParse({ code }).success} onClick={submitRedeem}>{t('redeem')}</Button></div></section>
      <section className="dse-card dse-card-wide"><h3>{t('walletLedger')}</h3>{data.ledger.items.length === 0 ? <p className="dse-meta">{t('noLedger')}</p> : <ul className="dse-list">{data.ledger.items.map(item => <li className="dse-row" key={item.id}><span className="dse-row-main"><strong className="dse-row-title">{t(item.kind === 'redemption_credit' ? 'redemptionCredit' : 'modelUsageDebit')}</strong><span className="dse-row-note">{new Date(item.createdAt).toLocaleString()} · {t('balanceAfter')} {moneyCny(item.balanceAfterMicrosCny)}</span></span><span className="dse-money">{item.amountMicrosCny > 0 ? '+' : ''}{moneyCny(item.amountMicrosCny)}</span></li>)}</ul>}</section>
    </div>
    {data.team ? <>
      <section className="dse-card dse-card-wide"><h3>{t('inviteMember')}</h3><div className="dse-inline-form"><input aria-label={t('memberEmail')} type="email" value={email} disabled={busy} onChange={(event) => { setEmail(event.currentTarget.value) }} placeholder={t('memberEmail')} /><select aria-label={t('memberRole')} value={role} disabled={busy} onChange={(event) => { setRole(event.currentTarget.value as 'member' | 'administrator') }}><option value="member">{t('member')}</option>{data.team.canInviteAdministrator ? <option value="administrator">{t('administrator')}</option> : null}</select><Button size="sm" disabled={busy || !inviteMemberInput.safeParse({ email, role }).success} onClick={submitInvite}>{t('invite')}</Button></div></section>
      <section className="dse-card dse-card-wide"><h3>{t('directory')}</h3><div className="dse-inline-form"><label>{t('usageFrom')}<input type="date" value={fromDate} max={toDate} onChange={(event) => { setFromDate(event.currentTarget.value) }} /></label><label>{t('usageTo')}<input type="date" value={toDate} min={fromDate} onChange={(event) => { setToDate(event.currentTarget.value) }} /></label><Button size="sm" disabled={!fromDate || !toDate || fromDate > toDate} onClick={applyRange}>{t('applyRange')}</Button></div><ul className="dse-list">{data.team.members.map(member => <li className="dse-row" key={member.membershipId}><button className="dse-member" type="button" onClick={() => { selectMember(member.accountId) }}><span className="dse-row-main"><strong className="dse-row-title">{member.name || member.email}</strong><span className="dse-row-note">{member.email} · {member.roles.join(', ')} · {member.status}</span></span><span className="dse-row-note">{member.calls.toLocaleString()} {t('calls')} · {member.totalTokens.toLocaleString()} {t('tokens')} · {moneyCny(member.settledCostMicrosCny)}</span></button></li>)}</ul>{selectedMember ? <div className="dse-member-usage"><h3>{t('memberUsage')}</h3>{memberUsage ? <><ul className="dse-list">{memberUsage.items.map(item => <li className="dse-row" key={item.id}><span className="dse-row-main"><strong className="dse-row-title">{item.modelId}</strong><span className="dse-row-note">{new Date(item.occurredAt).toLocaleString()} · {item.purpose} · {item.status}</span></span><span className="dse-row-note">{(item.totalTokens ?? 0).toLocaleString()} {t('tokens')} · {moneyCny(item.totalCostMicrosCny ?? 0)}</span></li>)}</ul>{memberUsage.nextCursor ? <Button size="sm" variant="outline" disabled={busy} onClick={loadMoreMemberUsage}>{t('loadMore')}</Button> : null}</> : <p className="dse-meta">{t('loading')}</p>}</div> : null}</section>
      <section className="dse-card dse-card-wide"><h3>{t('pendingInvitations')}</h3>{data.team.invitations.length === 0 ? <p className="dse-meta">{t('noInvitations')}</p> : <ul className="dse-list">{data.team.invitations.map(invitation => <li className="dse-row" key={invitation.id}><span className="dse-row-main"><strong className="dse-row-title">{invitation.email}</strong><span className="dse-row-note">{invitation.role} · {t('expires')} {new Date(invitation.expiresAt).toLocaleString()}</span></span><Button size="sm" variant="outline" onClick={() => { void revokeInvitation(invitation.id).then(() => { setRevision(value => value + 1) }, () => { setOperationError('UNKNOWN') }) }}>{t('revokeInvitation')}</Button></li>)}</ul>}</section>
    </> : null}
  </div>
}

export const inject = ['slots', 'locale', 'connection', 'mainNavigation']

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
    loadPluginInstallations: async () => enterprisePluginInstallations.parse(await call('plugin-installations', {})),
    uploadPlugin: async (visibility, bytes) => {
      const input = pluginUploadInput.parse({ visibility, bytes: [...bytes] })
      return call('plugin-upload', input)
    },
    installPlugin: async releaseId => call('plugin-install', pluginInstallationInput.parse({ releaseId })),
    setPluginEnabled: async (installationId, enabled) => call('plugin-enable', pluginEnableInput.parse({ installationId, enabled })),
    openConversation: () => { ctx.mainNavigation.openConversation() },
    revokeRuntime: async (runtimeId) => { revokeRuntimeInput.parse({ runtimeId }); await call('revoke-runtime', { runtimeId }) },
    loadWallet: async () => enterpriseWallet.parse(await call('wallet', {})),
    loadWalletLedger: async () => enterpriseWalletLedger.parse(await call('wallet-ledger', {})),
    loadOwnUsage: async () => enterpriseUsagePage.parse(await call('own-usage', {})),
    redeem: async (code) => { const input = redeemCodeInput.parse({ code }); return enterpriseWallet.parse(await call('redeem', input)) },
    loadTeam: async (from, to) => { const input = teamUsageRangeInput.parse({ from, to }); return enterpriseTeam.parse(await call('team', input)) },
    loadMemberUsage: async (accountId, cursor, from, to) => { const input = memberUsageInput.parse({ accountId, cursor, from, to }); return enterpriseUsagePage.parse(await call('member-usage', input)) },
    inviteMember: async (email, role) => { const input = inviteMemberInput.parse({ email, role }); await call('invite-member', input) },
    revokeInvitation: async (invitationId) => { const input = revokeInvitationInput.parse({ invitationId }); await call('revoke-invitation', input) },
    switchOrganization: () => { void native()?.switchOrganization() },
    logout: () => { void native()?.logout() },
  })
  const t = ctx.locale.bind('enterprise')
  const marketInjected = injected
  ctx.slots.inject('settings.section', function* () {
    yield ctx.slots.register({ name: 'settings.section', id: 'enterprise', order: 5, label: () => t('accountNav'), locale: 'enterprise', inject: injected }, AccountSection)
    yield ctx.slots.register({ name: 'settings.section', id: 'enterprise-models', order: 10, label: () => t('modelsNav'), locale: 'enterprise', inject: injected }, ModelSection)
    yield ctx.slots.register({ name: 'settings.section', id: 'enterprise-team', order: 15, label: () => t('teamNav'), locale: 'enterprise', inject: injected }, TeamSection)
    yield ctx.slots.register({ name: 'settings.section', id: 'plugins', order: 20, label: () => t('pluginsNav'), locale: 'enterprise', inject: injected }, PluginsSection)
  })
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'plugin-market', order: 20, locale: 'enterprise',
    inject: () => ({ navigation: ctx.mainNavigation, open: () => { ctx.mainNavigation.openPluginMarket() } }),
  }, PluginMarketAction))
  ctx.slots.inject('main.surface', () => ctx.slots.register({
    name: 'main.surface', locale: 'enterprise', inject: marketInjected,
  }, PluginMarket))
}
