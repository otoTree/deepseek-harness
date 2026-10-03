/* oxlint-disable @stylistic/max-len -- Enterprise panels keep their RPC and presentation contracts together. */
/** Enterprise account and governed-plugin sections for the existing Web settings shell. */
import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from 'react'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DshWindow } from '@deepseek-ai/dsh-client-modules/client'
import type { PluginCapabilityTransport, PluginClientContribution } from '@deepseek-ai/dsh-plugin-protocol'
import { mountPluginTarget, type PluginTargetModule } from '@deepseek-ai/dsh-plugin-runtime'
import { createPluginSdk } from '@deepseek-ai/dsh-plugin-sdk'
import {
  Button,
  IconCloseOutline16,
  IconArchiveOutline20,
  IconCordisPluginOutline14,
  IconDownloadOutline16,
  IconEditOutline16,
  IconFolderOpenOutline16,
  IconAlarmClockOutline16,
  IconPlayOutline16,
  IconTrashOutline16,
  Modal,
  Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MainSurface } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import {
  enterpriseDashboard,
  enterpriseModelSelection,
  enterpriseWorkspaces,
  enterprisePluginCatalog,
  enterprisePluginInstallations,
  enterprisePluginDeviceTargets,
  pluginEnableInput,
  pluginInstallationInput,
  pluginUpgradeInput,
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
  driveSpaces,
  driveFilePage,
  driveCreateFolderInput,
  driveUploadSession,
  triggerRule,
  triggerRuleSaveInput,
  triggerSnapshot,
  type DriveSpaces,
  type DriveFilePage,
  type DriveFile,
  type DriveVersion,
  type DriveDescription,
  type TriggerRule,
  type TriggerRuleSaveInput,
  type TriggerSnapshot,
  type EnterpriseDashboard,
  type EnterpriseModelSelection,
  type EnterpriseWorkspaces,
  type EnterprisePluginCatalog,
  type EnterprisePluginInstallations,
  type EnterprisePluginDeviceTargets,
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
  readonly runtimeStorageIdentity: string
  switchOrganization: () => Promise<unknown>
  logout: () => Promise<unknown>
  createDriveEditSession?: (value: { sessionId: string; downloadUrl: string; fileName: string; versionId: string }) => Promise<{ sessionId: string; path: string; versionId: string }>
  openDriveFile?: (value: { sessionId: string }) => Promise<unknown>
  getDriveEditStatus?: (value: { sessionId: string }) => Promise<{ changed: boolean; size: number; modifiedAt: number }>
  uploadDriveEdit?: (value: { sessionId: string }) => Promise<{ contentBase64: string; size: number }>
  cancelDriveEditSession?: (value: { sessionId: string }) => Promise<unknown>
  closeDriveEditSession?: (value: { sessionId: string }) => Promise<unknown>
}

interface EnterpriseWindow extends Window {
  __dshNative?: NativeEnterpriseActions
}

interface EnterpriseClientTarget {
  installationId: string
  releaseId: string
  pluginId: string
  version: string
  activationId: string
  moduleId: string
  source: string
  contributions: readonly PluginClientContribution[]
}

const enterpriseClientTargets = z.array(z.object({
  installationId: z.string().min(1), releaseId: z.string().min(1), pluginId: z.string().min(1),
  version: z.string().min(1), activationId: z.uuid(), moduleId: z.string().min(1), source: z.string(),
  contributions: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('slot'), id: z.string(), slot: z.string(), multiplicity: z.enum(['one', 'many']) }).strict(),
    z.object({ kind: z.literal('window'), id: z.string(), surface: z.string(), multiplicity: z.enum(['many', 'singleton']), titleKey: z.string(), shell: z.enum(['standard', 'minimal']), defaultBounds: z.object({ width: z.number(), height: z.number() }).strict().optional() }).strict(),
  ])).default([]),
}).strict())

const enterpriseClientRuntimeSnapshot = z.object({
  targets: enterpriseClientTargets,
  activationTimeoutMs: z.number().int().positive(),
  cleanupTimeoutMs: z.number().int().positive(),
}).strict()

async function loadClientTarget(target: EnterpriseClientTarget): Promise<void> {
  if ((window as unknown as DshWindow).__ModuleLoader__ === undefined) {
    throw new Error('Plugin Client bundle cannot load because the page module loader is unavailable')
  }
  const script = document.createElement('script')
  const nonce = document.querySelector('meta[name="dsh-csp-nonce"]')?.getAttribute('content')
  if (nonce !== null && nonce !== undefined) script.setAttribute('nonce', nonce)
  script.textContent = target.source
  document.head.append(script)
  script.remove()
}

async function boundedCleanup(operation: Promise<void>, timeoutMs: number, moduleId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(`Plugin Client ${moduleId} cleanup timed out after ${timeoutMs}ms`)) }, timeoutMs)
  })
  try { await Promise.race([operation, deadline]) }
  finally { if (timer !== undefined) clearTimeout(timer) }
}

async function untilAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Plugin Client activation aborted'))
    signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([operation, cancelled]) }
  finally { if (abort !== undefined) signal.removeEventListener('abort', abort) }
}

function removeClientTargetStyles(moduleId: string): void {
  for (const element of document.querySelectorAll('style[data-plugin]')) {
    if (element.getAttribute('data-plugin') === moduleId) element.remove()
  }
}

/** Browser-side target reconciler backed by the authenticated Host relay. */
export class EnterpriseClientPluginRuntime {
  private readonly mountedTargets = new Map<string, { activationId: string; moduleId: string; dispose: () => Promise<void> }>()
  private readonly cleanupFailures = new Map<string, { activationId: string; moduleId: string; dispose: () => Promise<void> }>()
  private reconcileTail = Promise.resolve()
  private activationTimeoutMs = 30_000
  private cleanupTimeoutMs = 10_000
  private readonly windowId: string

  constructor(private readonly options: {
    readonly ctx: Context
    readonly call: (endpoint: string, payload: unknown) => Promise<unknown>
    readonly loadTarget?: (target: EnterpriseClientTarget) => Promise<void>
    readonly activationTimeoutMs?: number
    readonly cleanupTimeoutMs?: number
    readonly windowId?: string
  }) {
    const nativeWindowId = (window as typeof window & { __dshWindowId?: unknown }).__dshWindowId
    this.windowId = this.options.windowId ?? (typeof nativeWindowId === 'string' ? nativeWindowId : `web-${Math.random().toString(36).slice(2)}`)
  }

  private async unmount(target: { moduleId: string; dispose: () => Promise<void> }): Promise<void> {
    try { await boundedCleanup(target.dispose(), this.cleanupTimeoutMs, target.moduleId) }
    finally {
      this.options.ctx.modules.invalidate(target.moduleId)
      removeClientTargetStyles(target.moduleId)
    }
  }

  /** Load current Client targets and release contributions absent from the Host result. */
  reconcile(): Promise<void> {
    const next = this.reconcileTail.then(async () => {
      const snapshot = enterpriseClientRuntimeSnapshot.parse(await this.options.call('plugin-runtime-targets', {}))
      this.activationTimeoutMs = this.options.activationTimeoutMs ?? snapshot.activationTimeoutMs
      this.cleanupTimeoutMs = this.options.cleanupTimeoutMs ?? snapshot.cleanupTimeoutMs
      const targets = snapshot.targets
      const wanted = new Set(targets.map(target => target.installationId))
      await Promise.allSettled([...this.cleanupFailures].map(async ([installationId, failed]) => {
        try {
          await this.unmount(failed)
          this.cleanupFailures.delete(installationId)
        } catch (error) {
          this.options.ctx.logger('enterprise-plugin-client').error(error)
        }
      }))
      await Promise.allSettled([...this.mountedTargets].filter(([installationId]) => !wanted.has(installationId)).map(async ([installationId, mounted]) => {
        this.mountedTargets.delete(installationId)
        try { await this.unmount(mounted) }
        catch (error) {
          this.cleanupFailures.set(installationId, mounted)
          this.options.ctx.logger('enterprise-plugin-client').error(error)
        }
      }))
      await Promise.allSettled(targets.map(target => this.reconcileTarget({
        ...target,
        contributions: target.contributions.map((contribution) => {
          if (contribution.kind !== 'window' || contribution.defaultBounds !== undefined) return contribution
          const { defaultBounds: _defaultBounds, ...withoutBounds } = contribution
          return withoutBounds
        }),
      })))
    })
    this.reconcileTail = next.catch(() => {})
    return next
  }

  private async reconcileTarget(target: EnterpriseClientTarget): Promise<void> {
    try {
      if (this.cleanupFailures.has(target.installationId)) return
      const current = this.mountedTargets.get(target.installationId)
      if (current?.activationId === target.activationId) return
      if (current !== undefined) {
        this.mountedTargets.delete(target.installationId)
        try { await this.unmount(current) }
        catch (error) {
          this.cleanupFailures.set(target.installationId, current)
          throw error
        }
      }
      const relay = this.options.call
      const transport: PluginCapabilityTransport = {
        call: async <T,>(operation: string, input: unknown, signal?: AbortSignal): Promise<T> => {
          signal?.throwIfAborted()
          const value = await relay('plugin-sdk-call', { activationId: target.activationId, operation, input })
          signal?.throwIfAborted()
          return value as T
        },
        stream: async function* <T>(operation: string, input: unknown, signal?: AbortSignal): AsyncIterable<T> {
          signal?.throwIfAborted()
          const chunks = z.array(z.unknown()).parse(await relay('plugin-sdk-stream', { activationId: target.activationId, operation, input }))
          for (const chunk of chunks) { signal?.throwIfAborted(); yield chunk as T }
        },
      }
      let dispose: (() => Promise<void>) | undefined
      const activationSignal = AbortSignal.timeout(this.activationTimeoutMs)
      try {
        this.options.ctx.modules.invalidate(target.moduleId)
        removeClientTargetStyles(target.moduleId)
        await untilAbort((this.options.loadTarget ?? loadClientTarget)(target), activationSignal)
        const module = await untilAbort(this.options.ctx.modules.import(target.moduleId, '', {}), activationSignal) as PluginTargetModule
        dispose = await mountPluginTarget(this.options.ctx, module, createPluginSdk(transport), {
          signal: activationSignal,
          scopeName: `pluginSdk:${target.installationId}:${target.activationId}`,
        })
        await untilAbort(this.options.call('plugin-client-window-state', {
          activationId: target.activationId, windowId: this.windowId, state: 'active', error: null,
        }), activationSignal)
        this.mountedTargets.set(target.installationId, { activationId: target.activationId, moduleId: target.moduleId, dispose })
      } catch (error) {
        await dispose?.().catch(() => {})
        this.options.ctx.modules.invalidate(target.moduleId)
        removeClientTargetStyles(target.moduleId)
        await this.options.call('plugin-client-window-state', {
          activationId: target.activationId, windowId: this.windowId, state: 'failed',
          error: error instanceof Error ? error.message : 'Plugin Client activation failed',
        }).catch(() => {})
        throw error
      }
    } catch (error) {
      this.options.ctx.logger('enterprise-plugin-client').error(error)
    }
  }

  /** Wait for reconciliation and release every mounted Client contribution. */
  async dispose(): Promise<void> {
    await this.reconcileTail
    await Promise.allSettled([...this.mountedTargets.entries()].map(async ([installationId, target]) => {
      try { await this.unmount(target) }
      catch { this.cleanupFailures.set(installationId, target) }
    }))
    this.mountedTargets.clear()
  }

  /** Report a page teardown before the connection disappears. */
  async disconnect(): Promise<void> {
    await Promise.allSettled([...this.mountedTargets.values()].map(target => this.options.call('plugin-client-window-state', {
      activationId: target.activationId, windowId: this.windowId, state: 'disconnected', error: null,
    })))
  }
}

interface EnterpriseInjected {
  loadDashboard: () => Promise<EnterpriseDashboard>
  loadModelSelection: () => Promise<EnterpriseModelSelection>
  saveModel: (model: string) => Promise<EnterpriseModelSelection>
  loadPlugins: () => Promise<EnterprisePluginCatalog>
  loadPluginInstallations: () => Promise<EnterprisePluginInstallations>
  loadPluginDeviceTargets?: () => Promise<EnterprisePluginDeviceTargets>
  uploadPlugin: (visibility: 'private' | 'organization' | 'platform', bytes: Uint8Array) => Promise<unknown>
  installPlugin: (releaseId: string) => Promise<unknown>
  upgradePlugin: (installationId: string, releaseId: string) => Promise<unknown>
  uninstallPlugin: (installationId: string) => Promise<unknown>
  forceRemovePlugin: (installationId: string) => Promise<unknown>
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
  loadWorkspaces: () => Promise<EnterpriseWorkspaces>
  createWorkspace: (name: string, image: string) => Promise<unknown>
  changeWorkspace: (id: string, action: 'start' | 'stop' | 'lease' | 'delete') => Promise<unknown>
}

type AccountProps = PropsRuntime<'settings.section'> & PropsLocale<'enterprise'> & InjectFace<EnterpriseInjected>
type PluginsProps = PropsRuntime<'settings.section'> & PropsLocale<'enterprise'> & InjectFace<EnterpriseInjected>
type PluginMarketProps = PropsRuntime<'main.surface'> & PropsLocale<'enterprise'> & InjectFace<EnterpriseInjected>
type PluginMarketActionProps = PropsRuntime<'sidebar.rail.item'> & PropsLocale<'enterprise'> & InjectFace<{
  navigation: { get(): MainSurface; subscribe(listener: () => void): () => void; openTriggers?: () => void }
  open: () => void
}> & { wide?: boolean }
interface CloudDriveInjected {
  loadSpaces: () => Promise<DriveSpaces>
  loadFiles: (spaceId: string, parentId: string | null, cursor?: string) => Promise<DriveFilePage>
  searchFiles: (spaceId: string, query: string, cursor?: string) => Promise<DriveFilePage>
  createFolder: (spaceId: string, parentId: string | null, name: string) => Promise<void>
  createUpload: (input: { spaceId: string; nodeId?: string; parentId: string | null; name: string; size: number; contentType: string; checksum?: string }) => Promise<{ uploadId: string; uploadUrl: string; name: string }>
  commitUpload: (uploadId: string, baseVersionId?: string) => Promise<void>
  downloadFile: (nodeId: string) => Promise<{ url: string; versionId: string; checksum: string }>
  updateNode: (nodeId: string, input: { spaceId: string; name?: string; parentId?: string | null; baseVersionId?: string | null }) => Promise<void>
  deleteNode: (nodeId: string) => Promise<void>
  restoreNode: (nodeId: string) => Promise<void>
  loadVersions: (nodeId: string) => Promise<DriveVersion[]>
  loadDescriptions: (nodeId: string, includeHistory?: boolean) => Promise<DriveDescription[]>
}
type CloudDriveProps = PropsRuntime<'main.surface'> & PropsLocale<'enterprise'> & InjectFace<CloudDriveInjected>
interface TriggerInjected {
  loadTriggers: () => Promise<TriggerSnapshot>
  saveTrigger: (input: TriggerRuleSaveInput) => Promise<TriggerRule>
  setTriggerEnabled: (ruleId: string, enabled: boolean) => Promise<TriggerRule>
  removeTrigger: (ruleId: string) => Promise<void>
  retryTrigger: (batchId: string) => Promise<void>
  testTriggerMatch: (path: string, includes: string[], excludes: string[]) => Promise<boolean>
  loadSpaces: () => Promise<DriveSpaces>
  openSession: (sessionId: string) => Promise<void>
}
type TriggerProps = PropsRuntime<'main.surface'> & PropsLocale<'enterprise'> & InjectFace<TriggerInjected> & {
  useSessions: UseSessions
}
type TeamProps = PropsRuntime<'settings.section'> & PropsLocale<'enterprise'> & InjectFace<EnterpriseInjected>
type WorkspaceProps = PropsRuntime<'settings.section'> & PropsLocale<'enterprise'> & InjectFace<EnterpriseInjected>
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

function PluginMarketAction({ navigation, open, t, wide }: PluginMarketActionProps): ReactNode {
  const active = useSyncExternalStore(
    navigation.subscribe.bind(navigation),
    navigation.get.bind(navigation),
    () => 'conversation' as 'conversation' | 'plugin-market' | 'cloud-drive' | 'triggers',
  ) === 'plugin-market'
  return <button type="button" className="dse-market-action" data-active={active || undefined} aria-label={t('pluginMarket')} aria-pressed={active} onClick={open}>
    <IconCordisPluginOutline14 size={wide ? 16 : 18} />{wide ? <span className="dse-market-action-label">{t('pluginMarket')}</span> : null}
  </button>
}

function CloudDriveAction({ navigation, open, t, wide }: PluginMarketActionProps): ReactNode {
  const active = useSyncExternalStore(navigation.subscribe.bind(navigation), navigation.get.bind(navigation), () => 'conversation' as 'conversation' | 'plugin-market' | 'cloud-drive' | 'triggers') === 'cloud-drive'
  return <button type="button" className="dse-market-action" data-active={active || undefined} aria-label={t('cloudDrive')} aria-pressed={active} onClick={open}>
    <IconFolderOpenOutline16 size={wide ? 16 : 18} />{wide ? <span className="dse-market-action-label">{t('cloudDrive')}</span> : null}
  </button>
}

function TriggerAction({ navigation, open, t, wide }: PluginMarketActionProps): ReactNode {
  const active = useSyncExternalStore(navigation.subscribe.bind(navigation), navigation.get.bind(navigation), () => 'conversation' as 'conversation' | 'plugin-market' | 'cloud-drive' | 'triggers') === 'triggers'
  return <button type="button" className="dse-market-action" data-active={active || undefined} aria-label={t('triggers')} aria-pressed={active} onClick={open}>
    <IconAlarmClockOutline16 size={wide ? 16 : 18} />{wide ? <span className="dse-market-action-label">{t('triggers')}</span> : null}
  </button>
}

function CloudDrive({ loadSpaces, loadFiles, searchFiles, createFolder, createUpload, commitUpload, downloadFile, updateNode, deleteNode, loadVersions, loadDescriptions, t }: CloudDriveProps): ReactNode {
  const [spaces, setSpaces] = useState<DriveSpaces>([])
  const [spaceId, setSpaceId] = useState<string>()
  const [parentId, setParentId] = useState<string | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string | null; name: string }>>([{ id: null, name: 'Root' }])
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [page, setPage] = useState<DriveFilePage>()
  const [error, setError] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<DriveFile>()
  const [renameName, setRenameName] = useState('')
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [versions, setVersions] = useState<DriveVersion[]>([])
  const [descriptions, setDescriptions] = useState<DriveDescription[]>([])
  const [textContent, setTextContent] = useState<string>()
  const fileInput = useRef<HTMLInputElement>(null)
  const reload = (nextSpace: string, nextParent: string | null, cursor?: string): void => {
    void loadFiles(nextSpace, nextParent, cursor).then((value) => { setPage(cursor ? current => current ? { ...value, items: [...current.items, ...value.items] } : value : value); setError(false) }, () => { setError(true) })
  }
  useEffect(() => { void loadSpaces().then((value) => { setSpaces(value); const first = value[0]?.id; if (first !== undefined) { setSpaceId(first); reload(first, null) } }, () => { setError(true) }) }, [])
  const selectSpace = (id: string): void => { setSpaceId(id); setParentId(null); setBreadcrumbs([{ id: null, name: t('rootFolder') }]); reload(id, null) }
  const submitFolder = (): void => {
    if (!spaceId || !folderName.trim()) return
    setBusy(true); void createFolder(spaceId, parentId, folderName.trim()).then(() => { setFolderName(''); reload(spaceId, parentId) }, () => { setError(true) }).finally(() => { setBusy(false) })
  }
  const submitUpload = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0]
    if (!file || !spaceId) return
    setBusy(true)
    void file.arrayBuffer().then(async (bytes) => {
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const checksum = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
      return createUpload({ spaceId, parentId, name: file.name, size: file.size, contentType: file.type || 'application/octet-stream', checksum })
    }).then(async (session) => {
      const response = await fetch(session.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
      if (!response.ok) throw new Error('Upload failed')
      await commitUpload(session.uploadId)
      reload(spaceId, parentId)
    }).catch(() => { setError(true) }).finally(() => { setBusy(false); if (fileInput.current) fileInput.current.value = '' })
  }
  const submitSearch = (): void => {
    if (!spaceId || !query.trim()) { if (spaceId) reload(spaceId, parentId); return }
    void searchFiles(spaceId, query.trim()).then(setPage, () => { setError(true) })
  }
  const selectFile = (file: DriveFile): void => {
    setSelected(file); setRenameName(file.name)
    if (file.kind === 'file') {
      void Promise.all([loadVersions(file.id), loadDescriptions(file.id, true)]).then(([nextVersions, nextDescriptions]) => { setVersions(nextVersions); setDescriptions(nextDescriptions) }, () => { setError(true) })
      if (/^(text\/|application\/(json|javascript|typescript)|application\/xml$)/u.test(file.contentType) || /\.(md|txt|json|ts|tsx|js|css|html)$/iu.test(file.name)) void downloadFile(file.id).then(result => fetch(result.url).then(response => response.text()).then(setTextContent), () => { setError(true) })
      else setTextContent(undefined)
    }
  }
  const saveText = (): void => {
    const currentSpace = spaceId
    if (!selected || selected.kind !== 'file' || textContent === undefined || currentSpace === undefined) return
    const bytes = new TextEncoder().encode(textContent)
    void crypto.subtle.digest('SHA-256', bytes).then((digest) => {
      const checksum = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
      return createUpload({ spaceId: currentSpace, nodeId: selected.id, parentId: selected.parentId, name: selected.name, size: bytes.byteLength, contentType: selected.contentType, checksum })
    }).then(async (session) => { const response = await fetch(session.uploadUrl, { method: 'PUT', headers: { 'Content-Type': selected.contentType }, body: bytes }); if (!response.ok) throw new Error('Upload failed'); await commitUpload(session.uploadId, selected.versionId ?? undefined); reload(currentSpace, parentId) }).catch(() => { setError(true) })
  }
  const openOffice = (): void => {
    if (!selected || selected.kind !== 'file' || textContent !== undefined) return
    const host = (window as EnterpriseWindow).__dshNative
    const sessionId = `drive-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    void downloadFile(selected.id).then(result => host?.createDriveEditSession?.({ sessionId, downloadUrl: result.url, fileName: selected.name, versionId: result.versionId }).then(session => host.openDriveFile?.({ sessionId: session.sessionId })), () => { setError(true) })
  }
  const saveRename = (): void => {
    const currentSpace = spaceId
    if (!selected || !renameName.trim() || currentSpace === undefined) return
    setBusy(true); void updateNode(selected.id, { spaceId: currentSpace, name: renameName.trim(), baseVersionId: selected.versionId }).then(() => { setRenameDialogOpen(false); setSelected(undefined); reload(currentSpace, parentId) }, () => { setError(true) }).finally(() => { setBusy(false) })
  }
  const removeSelected = (): void => {
    if (!selected) return
    const currentSpace = spaceId
    if (currentSpace === undefined) return
    setBusy(true); void deleteNode(selected.id).then(() => { setDeleteDialogOpen(false); setSelected(undefined); reload(currentSpace, parentId) }, () => { setError(true) }).finally(() => { setBusy(false) })
  }
  const downloadSelected = (): void => {
    if (!selected || selected.kind !== 'file') return
    void downloadFile(selected.id).then((result) => {
      const anchor = document.createElement('a')
      anchor.href = result.url
      anchor.download = selected.name
      anchor.target = '_blank'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    }, () => { setError(true) })
  }
  const closeDetails = (): void => {
    if (renameDialogOpen || deleteDialogOpen) return
    setSelected(undefined)
    setTextContent(undefined)
  }
  return <main className="dse-drive">
    <header className="dse-drive-header"><div><h2 className="dse-market-title">{t('cloudDrive')}</h2><p className="dse-market-intro">{t('cloudDriveIntro')}</p></div><div className="dse-drive-tabs" role="tablist">{spaces.map(space => <button type="button" role="tab" aria-selected={space.id === spaceId} key={space.id} onClick={() => { selectSpace(space.id) }}>{space.kind === 'personal' ? t('personalSpace') : t('organizationSpace')}</button>)}</div></header>
    {error ? <div className="dse-status dse-error" role="alert">{t('requestFailed')}</div> : null}
    <nav className="dse-drive-breadcrumbs" aria-label={t('breadcrumbs')}>{breadcrumbs.map((crumb, index) => <button type="button" key={crumb.id ?? 'root'} disabled={index === breadcrumbs.length - 1} onClick={() => { if (spaceId) { setParentId(crumb.id); setBreadcrumbs(breadcrumbs.slice(0, index + 1)); reload(spaceId, crumb.id) } }}>{crumb.name}</button>)}</nav>
    <section className="dse-drive-toolbar"><span>{page?.summary.parentId ? t('folderContents') : t('rootFolder')}</span><div className="dse-inline-form"><input aria-label={t('searchFiles')} value={query} disabled={busy} placeholder={t('searchFiles')} onChange={(event) => { setQuery(event.currentTarget.value) }} onKeyDown={(event) => { if (event.key === 'Enter') submitSearch() }} /><Button size="sm" disabled={busy || !query.trim()} onClick={submitSearch}>{t('search')}</Button><Button size="sm" variant="outline" onClick={() => { setViewMode(viewMode === 'list' ? 'grid' : 'list') }}>{viewMode === 'list' ? t('gridView') : t('listView')}</Button><input ref={fileInput} className="dse-file-input" type="file" aria-label={t('uploadFile')} disabled={busy} onChange={submitUpload} /><Button size="sm" disabled={busy || !spaceId} onClick={() => { fileInput.current?.click() }}>{t('uploadFile')}</Button><input aria-label={t('newFolder')} value={folderName} disabled={busy} placeholder={t('newFolder')} onChange={(event) => { setFolderName(event.currentTarget.value) }} /><Button size="sm" disabled={busy || !folderName.trim()} onClick={submitFolder}>{t('createFolder')}</Button></div></section>
    <section className="dse-drive-list" data-view={viewMode} aria-label={t('files')}>
      {page?.items.length ? page.items.map(file => <button type="button" className="dse-drive-row" data-selected={selected?.id === file.id || undefined} key={file.id} onClick={() => { if (file.kind === 'folder' && spaceId) { setParentId(file.id); setBreadcrumbs([...breadcrumbs, { id: file.id, name: file.name }]); setSelected(undefined); reload(spaceId, file.id) } else selectFile(file) }}><span className="dse-drive-name"><IconFolderOpenOutline16 size={18} /><strong>{file.name}</strong></span><span className="dse-row-note">{file.kind === 'folder' ? t('folder') : `${file.contentType} · ${file.size.toLocaleString()} B`}</span></button>) : <p className="dse-status">{t('emptyFolder')}</p>}
      {page?.nextCursor && spaceId ? <Button size="sm" variant="outline" onClick={() => { reload(spaceId, parentId, page.nextCursor ?? undefined) }}>{t('loadMore')}</Button> : null}
    </section>
    {selected ? <><button type="button" className="dse-drive-drawer-overlay" aria-label={t('closeDetails')} onClick={closeDetails} /><aside className="dse-drive-details" aria-label={t('details')} onClick={(event) => { event.stopPropagation() }}><div className="dse-drive-detail-head"><div className="dse-drive-detail-title"><IconFolderOpenOutline16 size={18} /><strong title={selected.name}>{selected.name}</strong></div><button type="button" className="dse-drive-icon-button" aria-label={t('closeDetails')} onClick={closeDetails}><IconCloseOutline16 size={16} /></button></div><div className="dse-drive-detail-meta"><span>{selected.kind === 'folder' ? t('folder') : selected.contentType}</span>{selected.kind === 'file' ? <span>{selected.size.toLocaleString()} B</span> : null}</div><div className="dse-drive-detail-actions">{selected.kind === 'file' && textContent === undefined ? <Button size="sm" onClick={openOffice}>{t('openFile')}</Button> : null}{selected.kind === 'file' ? <Button size="sm" variant="outline" icon={<IconDownloadOutline16 size={14} />} onClick={downloadSelected}>{t('downloadFile')}</Button> : null}<Button size="sm" variant="outline" icon={<IconEditOutline16 size={14} />} disabled={busy} onClick={() => { setRenameName(selected.name); setRenameDialogOpen(true) }}>{t('rename')}</Button><Button size="sm" variant="outline" icon={<IconTrashOutline16 size={14} />} disabled={busy} onClick={() => { setDeleteDialogOpen(true) }}>{t('deleteFile')}</Button></div>{selected.kind === 'file' ? <><h3>{t('fileInfo')}</h3><dl className="dse-drive-detail-facts"><div><dt>{t('fileType')}</dt><dd>{selected.contentType}</dd></div><div><dt>{t('fileSize')}</dt><dd>{selected.size.toLocaleString()} B</dd></div><div><dt>{t('modifiedAt')}</dt><dd>{selected.updatedAt}</dd></div></dl><h3>{t('versions')}</h3><ul className="dse-drive-detail-list">{versions.map(version => <li key={version.id}><span>{version.id === selected.versionId ? t('currentVersion') : t('version')} · {version.contentType} · {version.size.toLocaleString()} B</span></li>)}</ul>{textContent !== undefined ? <><textarea className="dse-drive-editor" value={textContent} onChange={(event) => { setTextContent(event.currentTarget.value) }} /><Button size="sm" onClick={saveText}>{t('save')}</Button></> : null}<h3>{t('descriptions')}</h3>{descriptions.length ? <ul className="dse-drive-detail-list">{descriptions.map(description => <li key={description.id}>{description.type}: {description.content}{description.versionId !== selected.versionId ? ` (${t('staleDescription')})` : ''}</li>)}</ul> : <p className="dse-status">{t('noDescriptions')}</p>}</> : null}</aside></> : null}
    <Modal open={renameDialogOpen && selected !== undefined} onClose={() => { if (!busy) setRenameDialogOpen(false) }} title={t('renameFile')} description={t('renameFileMessage')} closeLabel={t('closeDetails')} footer={<><Button size="sm" variant="outline" disabled={busy} onClick={() => { setRenameDialogOpen(false) }}>{t('cancel')}</Button><Button size="sm" disabled={busy || !renameName.trim()} onClick={saveRename}>{t('save')}</Button></>}><input className="dse-modal-input" autoFocus value={renameName} disabled={busy} aria-label={t('rename')} onChange={(event) => { setRenameName(event.currentTarget.value) }} /></Modal>
    <Modal open={deleteDialogOpen && selected !== undefined} onClose={() => { if (!busy) setDeleteDialogOpen(false) }} title={t('confirmDelete')} {...(selected === undefined ? {} : { description: t('confirmDeleteMessage', { name: selected.name }) })} closeLabel={t('closeDetails')} footer={<><Button size="sm" variant="outline" disabled={busy} onClick={() => { setDeleteDialogOpen(false) }}>{t('cancel')}</Button><Button size="sm" disabled={busy} onClick={removeSelected}>{t('deleteFile')}</Button></>} />
  </main>
}

function PluginMarket({
  loadPlugins,
  loadPluginInstallations,
  loadPluginDeviceTargets,
  uploadPlugin,
  installPlugin,
  upgradePlugin,
  uninstallPlugin,
  forceRemovePlugin,
  setPluginEnabled,
  t,
}: PluginMarketProps): ReactNode {
  const [plugins, setPlugins] = useState<EnterprisePluginCatalog>([])
  const [installations, setInstallations] = useState<EnterprisePluginInstallations>([])
  const [deviceTargets, setDeviceTargets] = useState<EnterprisePluginDeviceTargets>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [visibility, setVisibility] = useState<'private' | 'organization' | 'platform'>('private')
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set())
  const [selectedFile, setSelectedFile] = useState<string>()
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>()
  const fileInput = useRef<HTMLInputElement>(null)
  const reload = (showLoading = false): void => {
    if (showLoading) setState('loading')
    const targetState = loadPluginDeviceTargets === undefined
      ? Promise.resolve<EnterprisePluginDeviceTargets>([])
      : loadPluginDeviceTargets().catch(() => [] as EnterprisePluginDeviceTargets)
    void Promise.all([loadPlugins(), loadPluginInstallations(), targetState]).then(([catalog, installed, targets]) => {
      setPlugins(catalog); setInstallations(installed); setDeviceTargets(targets); setState('ready')
    }, () => { setState('error') })
  }
  useEffect(() => { reload(true) }, [])
  if (state === 'loading') return <div className="dse-status">{t('loading')}</div>
  if (state === 'error') return <div className="dse-status dse-error">{t('error')} <Button size="sm" onClick={() => { reload(true) }}>{t('retry')}</Button></div>
  const installedFor = (plugin: EnterprisePluginCatalog[number]) => installations.find(item => item.releaseId === plugin.id || item.pluginId === plugin.pluginId)
  const beginBusy = (key: string): void => {
    setBusyKeys((current) => {
      const next = new Set(current)
      next.add(key)
      return next
    })
  }
  const endBusy = (key: string): void => {
    setBusyKeys((current) => {
      const next = new Set(current)
      next.delete(key)
      return next
    })
  }
  const busy = busyKeys.has('upload')
  const pluginBusy = (key: string): boolean => busyKeys.has(key)
  const onUpload = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    setSelectedFile(file.name); beginBusy('upload'); setNotice(undefined)
    void file.arrayBuffer().then(buffer => uploadPlugin(visibility, new Uint8Array(buffer))).then(() => {
      setNotice({ kind: 'success', text: t(visibility === 'private' ? 'uploadPrivateComplete' : 'uploadReviewComplete') }); reload()
    }, (error: unknown) => {
      const message = error instanceof Error ? error.message : ''
      const text = message.startsWith('Invalid plugin package:')
        ? t('invalidPluginPackage')
        : t('requestFailed')
      setNotice({ kind: 'error', text })
    }).finally(() => {
      endBusy('upload')
      if (fileInput.current) fileInput.current.value = ''
    })
  }
  const onInstall = (releaseId: string): void => {
    const key = `release:${releaseId}`
    beginBusy(key)
    void installPlugin(releaseId).then(() => { setNotice({ kind: 'success', text: t('installComplete') }); reload() }, () => { setNotice({ kind: 'error', text: t('requestFailed') }) }).finally(() => { endBusy(key) })
  }
  const onToggle = (installationId: string, enabled: boolean): void => {
    beginBusy(installationId)
    void setPluginEnabled(installationId, enabled).then(() => { reload() }, () => { setNotice({ kind: 'error', text: t('requestFailed') }) }).finally(() => { endBusy(installationId) })
  }
  const onUpgrade = (installationId: string, releaseId: string): void => {
    beginBusy(installationId); setNotice(undefined)
    void upgradePlugin(installationId, releaseId).then(() => {
      setNotice({ kind: 'success', text: t('upgradeComplete') }); reload()
    }, () => { setNotice({ kind: 'error', text: t('requestFailed') }) }).finally(() => { endBusy(installationId) })
  }
  const onUninstall = (installationId: string): void => {
    beginBusy(installationId); setNotice(undefined)
    void uninstallPlugin(installationId).then(() => { setNotice({ kind: 'success', text: t('uninstallStarted') }); reload() }, () => { setNotice({ kind: 'error', text: t('requestFailed') }) }).finally(() => { endBusy(installationId) })
  }
  const onForceRemove = (installationId: string): void => {
    if (!window.confirm(t('forceRemovePluginConfirm'))) return
    beginBusy(installationId); setNotice(undefined)
    void forceRemovePlugin(installationId).then(() => { setNotice({ kind: 'success', text: t('forceRemovePluginComplete') }); reload() }, () => { setNotice({ kind: 'error', text: t('requestFailed') }) }).finally(() => { endBusy(installationId) })
  }
  const targetLabel = (target: string): string => {
    if (target === 'client') return t('clientTarget')
    if (target === 'host') return t('hostTarget')
    if (target === 'browser') return t('browserTarget')
    if (target === 'desktop') return t('desktopTarget')
    return t('cloudTarget')
  }
  const stateLabel = (state: string): string => {
    if (state === 'unknown') return t('stateUnknown')
    if (state === 'active') return t('stateActive')
    if (state === 'preparing') return t('statePreparing')
    if (state === 'stopping') return t('stateStopping')
    if (state === 'disabled') return t('stateDisabled')
    if (state === 'failed') return t('stateFailed')
    if (state === 'revoked') return t('stateRevoked')
    if (state === 'stale') return t('stateStale')
    if (state === 'cleanup-failed') return t('stateCleanupFailed')
    return t('stateNotInstalled')
  }
  const availablePlugins = [...new Map([...plugins]
    .sort((left, right) => left.version.localeCompare(right.version, undefined, { numeric: true }))
    .map(plugin => [plugin.pluginId, plugin] as const)).values()]
  return <main className="dse-market">
    <header className="dse-market-header">
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
      <div className="dse-market-catalog-heading"><h3 id="dse-market-catalog-title">{t('availablePlugins')}</h3><span>{t('pluginCount', { count: availablePlugins.length })}</span></div>
      {availablePlugins.length === 0 ? <div className="dse-market-empty"><IconCordisPluginOutline14 size={20} /><p>{t('noPlugins')}</p></div> : <div className="dse-market-grid">{availablePlugins.map((plugin) => { const installation = installedFor(plugin); const newer = installation !== undefined && installation.releaseId !== plugin.id; const operationKey = installation?.id ?? `release:${plugin.id}`; const targets = installation === undefined ? [] : deviceTargets.filter(target => target.installationId === installation.id); const currentState = targets.find(target => target.observedState === 'active')?.observedState ?? installation?.observedState; const changing = installation?.observedState === 'stopping' || targets.some(target => target.observedState === 'stopping' || target.observedState === 'preparing'); const enabled = installation?.desiredState === 'enabled'; const lastError = targets.find(target => target.lastError)?.lastError ?? installation?.lastError; const operationBusy = pluginBusy(operationKey); return <article className="dse-market-plugin" key={plugin.pluginId}><div className="dse-market-plugin-head"><div className="dse-market-plugin-name"><span aria-hidden="true"><IconCordisPluginOutline14 size={16} /></span><h4>{plugin.pluginId}</h4></div><Pill active>{installation ? stateLabel(currentState ?? 'unknown') : t('available')}</Pill></div><p className="dse-market-plugin-version">{t('version')} {plugin.version}</p><div className="dse-tags">{plugin.targets.map(target => <span className="dse-tag" key={target}>{targetLabel(target)}</span>)}</div><p>{t('permissions')}: {plugin.permissions.length ? plugin.permissions.join(', ') : t('none')}</p>{installation ? <p>{installation.ownerKind === 'organization' ? t('organizationInstall') : t('personalInstall')} · {t('pluginState')}: {stateLabel(currentState ?? 'unknown')}{targets[0]?.leaseExpiresAt ? ` · ${t('leaseUntil')} ${new Date(targets[0].leaseExpiresAt).toLocaleTimeString()}` : ''}</p> : null}{lastError ? <p className="dse-row-note dse-error" role="alert">{t('pluginActivationError')}: {lastError}</p> : null}<div className="dse-market-plugin-action">{installation ? newer ? <Button size="sm" variant="outline" disabled={operationBusy || changing} onClick={() => { onUpgrade(installation.id, plugin.id) }}>{t('upgradePlugin')}</Button> : <><Button size="sm" variant="outline" disabled={operationBusy || changing} onClick={() => { onToggle(installation.id, !enabled) }}>{enabled ? t('disablePlugin') : t('enablePlugin')}</Button><Button size="sm" variant="outline" disabled={operationBusy || changing} onClick={() => { onUninstall(installation.id) }}>{t('uninstallPlugin')}</Button><Button size="sm" variant="outline" disabled={operationBusy} onClick={() => { onForceRemove(installation.id) }}>{t('forceRemovePlugin')}</Button></> : <Button size="sm" variant="outline" disabled={operationBusy} onClick={() => { onInstall(plugin.id) }}>{t('installPlugin')}</Button>}</div>{newer ? <p className="dse-row-note">{t('version')} {installation.version ?? '—'} → {plugin.version}</p> : null}</article> })}</div>}
    </section>
  </main>
}

interface TriggerDraft {
  readonly id?: string
  readonly name: string
  readonly enabled: boolean
  readonly sourceKind: 'timer' | 'local-file' | 'cloud-file'
  readonly timerKind: 'at' | 'every'
  readonly timerAt: string
  readonly everySeconds: string
  readonly roots: string
  readonly spaceId: string
  readonly includes: string
  readonly excludes: string
  readonly maxDepth: string
  readonly stabilityMs: string
  readonly maxEventsPerMinute: string
  readonly windowMs: string
  readonly targetKind: 'existing-session' | 'new-session'
  readonly sessionId: string
  readonly workspacePath: string
  readonly agentPreset: string
  readonly permissionPreset: string
  readonly titleTemplate: string
  readonly instruction: string
  readonly templateVersion: number
}

function localDateTime(value: string): string {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function freshTriggerDraft(prompt: string): TriggerDraft {
  return {
    name: '', enabled: true, sourceKind: 'timer', timerKind: 'every',
    timerAt: localDateTime(new Date(Date.now() + 3_600_000).toISOString()), everySeconds: '3600',
    roots: '', spaceId: '', includes: '**/*', excludes: '', maxDepth: '20',
    stabilityMs: '500', maxEventsPerMinute: '1000', windowMs: '1000',
    targetKind: 'existing-session', sessionId: '', workspacePath: '', agentPreset: 'default',
    permissionPreset: 'workspace-write', titleTemplate: '{{rule.name}}',
    instruction: prompt,
    templateVersion: 1,
  }
}

function draftFromRule(rule: TriggerRule): TriggerDraft {
  const file = rule.source.kind === 'timer' ? undefined : rule.source
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    sourceKind: rule.source.kind,
    timerKind: rule.source.kind === 'timer' ? rule.source.schedule.kind : 'every',
    timerAt: rule.source.kind === 'timer'
      ? localDateTime(rule.source.schedule.kind === 'at' ? rule.source.schedule.at : rule.source.schedule.anchorAt)
      : localDateTime(new Date(Date.now() + 3_600_000).toISOString()),
    everySeconds: rule.source.kind === 'timer' && rule.source.schedule.kind === 'every'
      ? String(rule.source.schedule.everySeconds)
      : '3600',
    roots: rule.source.kind === 'local-file' ? rule.source.roots.join('\n') : '',
    spaceId: rule.source.kind === 'cloud-file' ? rule.source.spaceId : '',
    includes: file?.filter.includes.join('\n') ?? '**/*',
    excludes: file?.filter.excludes.join('\n') ?? '',
    maxDepth: String(file?.filter.maxDepth ?? 20),
    stabilityMs: rule.source.kind === 'local-file' ? String(rule.source.stabilityMs) : '500',
    maxEventsPerMinute: rule.source.kind === 'local-file' ? String(rule.source.maxEventsPerMinute) : '1000',
    windowMs: rule.delivery.kind === 'batch-window' ? String(rule.delivery.windowMs) : '1000',
    targetKind: rule.target.kind,
    sessionId: rule.target.kind === 'existing-session' ? rule.target.sessionId : '',
    workspacePath: rule.target.kind === 'new-session' ? rule.target.workspacePath : '',
    agentPreset: rule.target.kind === 'new-session' ? rule.target.agentPreset : 'default',
    permissionPreset: rule.target.kind === 'new-session' ? rule.target.permissionPreset : 'workspace-write',
    titleTemplate: rule.target.kind === 'new-session' ? rule.target.titleTemplate : '{{rule.name}}',
    instruction: rule.instructionTemplate.text,
    templateVersion: rule.instructionTemplate.version + 1,
  }
}

function splitTriggerLines(value: string): string[] {
  return value.split(/\r?\n/u).map(item => item.trim()).filter(Boolean)
}

function TriggerSurface({
  loadTriggers, saveTrigger, setTriggerEnabled, removeTrigger, retryTrigger, testTriggerMatch,
  loadSpaces, openSession, useSessions, t,
}: TriggerProps): ReactNode {
  const sessions = useSessions(value => value)
  const [snapshot, setSnapshot] = useState<TriggerSnapshot>()
  const [spaces, setSpaces] = useState<DriveSpaces>([])
  const [draft, setDraft] = useState<TriggerDraft>(() => freshTriggerDraft(t('triggerDefaultPrompt')))
  const [editorOpen, setEditorOpen] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [surfaceError, setSurfaceError] = useState(false)
  const [editorError, setEditorError] = useState(false)
  const [matchPath, setMatchPath] = useState('')
  const [matchResult, setMatchResult] = useState<boolean>()
  const reload = (): void => {
    setState('loading')
    void Promise.all([loadTriggers(), loadSpaces().catch(() => [] as DriveSpaces)]).then(([next, nextSpaces]) => {
      setSnapshot(next); setSpaces(nextSpaces); setState('ready')
    }, () => { setState('error') })
  }
  useEffect(() => { reload() }, [])
  const patchDraft = <K extends keyof TriggerDraft>(key: K, value: TriggerDraft[K]): void => {
    setDraft(current => ({ ...current, [key]: value }))
  }
  const buildInput = (): TriggerRuleSaveInput => {
    const includes = splitTriggerLines(draft.includes)
    const excludes = splitTriggerLines(draft.excludes)
    const filter = { includes, excludes, maxDepth: Number(draft.maxDepth) }
    const source = draft.sourceKind === 'timer'
      ? { kind: 'timer' as const, schedule: draft.timerKind === 'at'
        ? { kind: 'at' as const, at: new Date(draft.timerAt).toISOString() }
        : { kind: 'every' as const, everySeconds: Number(draft.everySeconds), anchorAt: new Date(draft.timerAt).toISOString() } }
      : draft.sourceKind === 'local-file'
        ? { kind: 'local-file' as const, roots: splitTriggerLines(draft.roots), filter, stabilityMs: Number(draft.stabilityMs), maxEventsPerMinute: Number(draft.maxEventsPerMinute) }
        : { kind: 'cloud-file' as const, spaceId: draft.spaceId, filter }
    const fallbackSession = sessions.current ?? sessions.ids[0]
    const target = draft.targetKind === 'existing-session'
      ? { kind: 'existing-session' as const, sessionId: draft.sessionId || fallbackSession || '' }
      : { kind: 'new-session' as const, workspacePath: draft.workspacePath, agentPreset: draft.agentPreset, permissionPreset: draft.permissionPreset, titleTemplate: draft.titleTemplate }
    return triggerRuleSaveInput.parse({
      ...(draft.id === undefined ? {} : { id: draft.id }), name: draft.name, enabled: draft.enabled,
      source, delivery: draft.sourceKind === 'timer' ? { kind: 'queue-each' } : { kind: 'batch-window', windowMs: Number(draft.windowMs) },
      target, instructionTemplate: { version: draft.templateVersion, text: draft.instruction },
    })
  }
  const submit = (): void => {
    setEditorError(false)
    let input: TriggerRuleSaveInput
    try { input = buildInput() } catch { setEditorError(true); return }
    setBusy(true)
    void saveTrigger(input).then(() => {
      setEditorOpen(false); setDraft(freshTriggerDraft(t('triggerDefaultPrompt'))); reload()
    }, () => { setEditorError(true) }).finally(() => { setBusy(false) })
  }
  const mutate = (operation: () => Promise<unknown>): void => {
    setBusy(true); setSurfaceError(false)
    void operation().then(reload, () => { setSurfaceError(true) }).finally(() => { setBusy(false) })
  }
  const runMatch = (): void => {
    const includes = splitTriggerLines(draft.includes)
    const excludes = splitTriggerLines(draft.excludes)
    setBusy(true); setMatchResult(undefined)
    void testTriggerMatch(matchPath, includes, excludes).then(setMatchResult, () => { setEditorError(true) }).finally(() => { setBusy(false) })
  }
  if (state === 'loading') return <div className="dse-status">{t('loading')}</div>
  if (state === 'error' || snapshot === undefined) return <div className="dse-status dse-error">{t('error')} <Button size="sm" onClick={reload}>{t('retry')}</Button></div>
  const providerFor = (ruleId: string) => snapshot.providers.find(item => item.ruleId === ruleId)
  const queued = snapshot.batches.filter(batch => batch.state === 'queued' || batch.state === 'delivering' || batch.state === 'processing')
  const history = snapshot.batches.filter(batch => !queued.includes(batch)).slice(-50).reverse()
  const sourceLabel = (rule: TriggerRule): string => t(rule.source.kind === 'timer' ? 'triggerTimer' : rule.source.kind === 'local-file' ? 'triggerLocalFiles' : 'triggerCloudFiles')
  const stateLabel = (value: TriggerSnapshot['batches'][number]['state']): string => t(`triggerBatch${value[0]?.toUpperCase() ?? ''}${value.slice(1)}` as EnterpriseLocaleKey)
  return <main className="dse-triggers">
    <header className="dse-trigger-header"><div><h2 className="dse-market-title">{t('triggers')}</h2><p className="dse-market-intro">{t('triggerIntro')}</p></div><Button size="sm" variant="outline" onClick={() => { setDraft(freshTriggerDraft(t('triggerDefaultPrompt'))); setMatchResult(undefined); setEditorError(false); setEditorOpen(true) }}>{t('triggerNewRule')}</Button></header>
    {surfaceError ? <p className="dse-status dse-error" role="alert">{t('requestFailed')}</p> : null}
    <section className="dse-trigger-column" aria-label={t('triggerRules')}>
      <h3>{t('triggerRules')}</h3>
      {snapshot.rules.length === 0 ? <p className="dse-status">{t('triggerNoRules')}</p> : snapshot.rules.map((rule) => { const provider = providerFor(rule.id); return <article className="dse-trigger-rule" key={rule.id}><div className="dse-trigger-rule-head"><div><strong>{rule.name}</strong><span>{sourceLabel(rule)} · v{rule.version}</span></div><div className="dse-tags"><span className="dse-tag">{rule.enabled ? t('triggerEnabled') : t('triggerDisabled')}</span><span className="dse-tag">{provider?.state === 'watching' ? t('triggerListening') : provider?.state === 'failed' ? t('triggerListenerFailed') : provider?.state === 'missed' ? t('triggerMissed') : t('triggerNotListening')}</span></div></div><p>{rule.target.kind === 'existing-session' ? `${t('triggerExistingSession')}: ${rule.target.sessionId}` : `${t('triggerNewSession')}: ${rule.target.workspacePath}`}</p>{provider?.message ? <p className="dse-row-note">{provider.message}</p> : null}<div className="dse-actions"><Button size="sm" variant="outline" disabled={busy} onClick={() => { setDraft(draftFromRule(rule)); setMatchResult(undefined); setEditorError(false); setEditorOpen(true) }}>{t('triggerEdit')}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { mutate(() => setTriggerEnabled(rule.id, !rule.enabled)) }}>{rule.enabled ? t('disablePlugin') : t('enablePlugin')}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { mutate(() => removeTrigger(rule.id)) }}>{t('triggerRemove')}</Button></div></article> })}
    </section>
    <Modal open={editorOpen} onClose={() => { if (!busy) setEditorOpen(false) }} title={draft.id ? t('triggerEditRule') : t('triggerCreateRule')} description={t('triggerPromptDelivery')} closeLabel={t('triggerCloseEditor')} className="dse-trigger-modal" contentClassName="dse-trigger-modal-content" footer={<><Button size="sm" variant="outline" disabled={busy} onClick={() => { setEditorOpen(false) }}>{t('cancel')}</Button><Button size="sm" disabled={busy} onClick={submit}>{busy ? t('saving') : t('save')}</Button></>}>
      <div className="dse-trigger-editor">
        <label><span>{t('triggerRuleName')}</span><input value={draft.name} onChange={(event) => { patchDraft('name', event.currentTarget.value) }} /></label>
        <label><span>{t('triggerSource')}</span><select value={draft.sourceKind} onChange={(event) => { patchDraft('sourceKind', event.currentTarget.value as TriggerDraft['sourceKind']) }}><option value="timer">{t('triggerTimer')}</option><option value="local-file">{t('triggerLocalFiles')}</option><option value="cloud-file">{t('triggerCloudFiles')}</option></select></label>
        {draft.sourceKind === 'timer' ? <div className="dse-trigger-fields"><label><span>{t('triggerSchedule')}</span><select value={draft.timerKind} onChange={(event) => { patchDraft('timerKind', event.currentTarget.value as TriggerDraft['timerKind']) }}><option value="every">{t('triggerRecurring')}</option><option value="at">{t('triggerOneTime')}</option></select></label><label><span>{t('triggerStartAt')}</span><input type="datetime-local" value={draft.timerAt} onChange={(event) => { patchDraft('timerAt', event.currentTarget.value) }} /></label>{draft.timerKind === 'every' ? <label><span>{t('triggerEverySeconds')}</span><input type="number" min="1" value={draft.everySeconds} onChange={(event) => { patchDraft('everySeconds', event.currentTarget.value) }} /></label> : null}</div> : <><div className="dse-trigger-fields">{draft.sourceKind === 'local-file' ? <label className="dse-trigger-wide"><span>{t('triggerRoots')}</span><textarea value={draft.roots} onChange={(event) => { patchDraft('roots', event.currentTarget.value) }} placeholder={t('triggerRootsHelp')} /></label> : <label className="dse-trigger-wide"><span>{t('triggerCloudSpace')}</span><select value={draft.spaceId} onChange={(event) => { patchDraft('spaceId', event.currentTarget.value) }}><option value="">{t('triggerSelectSpace')}</option>{spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>}<label><span>{t('triggerIncludes')}</span><textarea value={draft.includes} onChange={(event) => { patchDraft('includes', event.currentTarget.value) }} /></label><label><span>{t('triggerExcludes')}</span><textarea value={draft.excludes} onChange={(event) => { patchDraft('excludes', event.currentTarget.value) }} /></label><label><span>{t('triggerBatchWindow')}</span><input type="number" min="50" value={draft.windowMs} onChange={(event) => { patchDraft('windowMs', event.currentTarget.value) }} /></label>{draft.sourceKind === 'local-file' ? <><label><span>{t('triggerStabilityWindow')}</span><input type="number" min="50" value={draft.stabilityMs} onChange={(event) => { patchDraft('stabilityMs', event.currentTarget.value) }} /></label><label><span>{t('triggerRateLimit')}</span><input type="number" min="1" value={draft.maxEventsPerMinute} onChange={(event) => { patchDraft('maxEventsPerMinute', event.currentTarget.value) }} /></label></> : null}</div><div className="dse-inline-form"><input aria-label={t('triggerTestPath')} placeholder={t('triggerTestPath')} value={matchPath} onChange={(event) => { setMatchPath(event.currentTarget.value) }} /><Button size="sm" variant="outline" disabled={busy || !matchPath} onClick={runMatch}>{t('triggerTestMatch')}</Button>{matchResult !== undefined ? <span className="dse-row-note">{matchResult ? t('triggerMatches') : t('triggerDoesNotMatch')}</span> : null}</div></>}
        <label><span>{t('triggerTarget')}</span><select value={draft.targetKind} onChange={(event) => { patchDraft('targetKind', event.currentTarget.value as TriggerDraft['targetKind']) }}><option value="existing-session">{t('triggerExistingSession')}</option><option value="new-session">{t('triggerNewSession')}</option></select></label>
        {draft.targetKind === 'existing-session' ? <label><span>{t('triggerSession')}</span><select value={draft.sessionId || sessions.current || ''} onChange={(event) => { patchDraft('sessionId', event.currentTarget.value) }}><option value="">{t('triggerSelectSession')}</option>{sessions.ids.map(id => <option value={id} key={id}>{sessions.byId[id]?.displayTitle ?? id}</option>)}</select></label> : <div className="dse-trigger-fields"><label className="dse-trigger-wide"><span>{t('triggerWorkspacePath')}</span><input value={draft.workspacePath} onChange={(event) => { patchDraft('workspacePath', event.currentTarget.value) }} /></label><label><span>{t('triggerAgentPreset')}</span><input value={draft.agentPreset} onChange={(event) => { patchDraft('agentPreset', event.currentTarget.value) }} /></label><label><span>{t('triggerPermissionPreset')}</span><input value={draft.permissionPreset} onChange={(event) => { patchDraft('permissionPreset', event.currentTarget.value) }} /></label><label className="dse-trigger-wide"><span>{t('triggerTitleTemplate')}</span><input value={draft.titleTemplate} onChange={(event) => { patchDraft('titleTemplate', event.currentTarget.value) }} /></label></div>}
        <label><span>{t('triggerPrompt')}</span><textarea aria-label={t('triggerPrompt')} className="dse-trigger-instruction" value={draft.instruction} onChange={(event) => { patchDraft('instruction', event.currentTarget.value) }} /><small className="dse-trigger-field-help">{t('triggerPromptVariables')}</small></label>
        {editorError ? <p className="dse-status dse-error" role="alert">{t('requestFailed')}</p> : null}
      </div>
    </Modal>
    <section className="dse-trigger-runs"><h3>{t('triggerQueue')}</h3>{queued.length === 0 ? <p className="dse-status">{t('triggerQueueEmpty')}</p> : <ul className="dse-list">{queued.map(batch => <li className="dse-row" key={batch.id}><span className="dse-row-main"><strong className="dse-row-title">{snapshot.rules.find(rule => rule.id === batch.ruleId)?.name ?? batch.ruleId}</strong><span className="dse-row-note">{stateLabel(batch.state)} · {batch.resources.length} {t('triggerResources')} · {new Date(batch.createdAt).toLocaleString()}</span></span>{batch.sessionId ? <Button size="sm" variant="outline" onClick={() => { void openSession(batch.sessionId as string) }}>{t('triggerOpenSession')}</Button> : null}</li>)}</ul>}</section>
    <section className="dse-trigger-runs"><h3>{t('triggerHistory')}</h3>{history.length === 0 ? <p className="dse-status">{t('triggerHistoryEmpty')}</p> : <ul className="dse-list">{history.map(batch => <li className="dse-row" key={batch.id}><span className="dse-row-main"><strong className="dse-row-title">{snapshot.rules.find(rule => rule.id === batch.ruleId)?.name ?? batch.ruleSnapshot.name}</strong><span className="dse-row-note">{stateLabel(batch.state)} · v{batch.ruleVersion} · {batch.resources.length} {t('triggerResources')} · {new Date(batch.createdAt).toLocaleString()}{batch.error ? ` · ${batch.error}` : ''}</span></span><span className="dse-actions">{batch.sessionId ? <Button size="sm" variant="outline" onClick={() => { void openSession(batch.sessionId as string) }}>{t('triggerOpenSession')}</Button> : null}{batch.state === 'failed' || batch.state === 'unknown' ? <Button size="sm" variant="outline" icon={<IconPlayOutline16 size={14} />} disabled={busy} onClick={() => { mutate(() => retryTrigger(batch.id)) }}>{t('triggerRetry')}</Button> : null}</span></li>)}</ul>}</section>
  </main>
}

function EnterpriseMainSurface(props: PluginMarketProps & CloudDriveProps & TriggerProps): ReactNode {
  if (props.surface === 'cloud-drive') return <CloudDrive {...props} />
  if ((props.surface as MainSurface) === 'triggers') return <TriggerSurface {...props} />
  return <PluginMarket {...props} />
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

function WorkspaceSection({ loadWorkspaces, createWorkspace, changeWorkspace, t }: WorkspaceProps): ReactNode {
  const [items, setItems] = useState<EnterpriseWorkspaces>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const reload = (): void => { void loadWorkspaces().then(setItems, () => setError(true)) }
  useEffect(reload, [loadWorkspaces])
  const mutate = (work: () => Promise<unknown>): void => { setBusy(true); setError(false); void work().then(reload, () => setError(true)).finally(() => setBusy(false)) }
  return <div className="dse-section"><header><h2 className="dse-title">{t('cloudWorkspaces')}</h2><p className="dse-subtle">{t('cloudWorkspacesIntro')}</p></header>
    {error ? <p className="dse-subtle dse-error" role="alert">{t('requestFailed')}</p> : null}
    <section className="dse-card dse-card-wide"><div className="dse-inline-form"><input aria-label={t('workspaceName')} value={name} disabled={busy} placeholder={t('workspaceName')} onChange={event => setName(event.currentTarget.value)} /><Button size="sm" disabled={busy || !name.trim()} onClick={() => mutate(async () => { await createWorkspace(name.trim(), 'dsh-base'); setName('') })}>{t('createWorkspace')}</Button></div></section>
    <section className="dse-card dse-card-wide"><ul className="dse-list">{items.map(item => <li className="dse-row" key={item.id}><span className="dse-row-main"><strong className="dse-row-title">{item.name}</strong><span className="dse-row-note">{item.status} · {item.image}{item.leaseUntil ? ` · ${new Date(item.leaseUntil).toLocaleString()}` : ''}</span></span><span className="dse-actions">{item.status === 'running' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => mutate(() => changeWorkspace(item.id, 'stop'))}>{t('stopWorkspace')}</Button> : <Button size="sm" variant="outline" disabled={busy} onClick={() => mutate(() => changeWorkspace(item.id, 'start'))}>{t('startWorkspace')}</Button>}<Button size="sm" variant="outline" disabled={busy || item.status !== 'running'} onClick={() => mutate(() => changeWorkspace(item.id, 'lease'))}>{t('renewWorkspace')}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => mutate(() => changeWorkspace(item.id, 'delete'))}>{t('deleteWorkspace')}</Button></span></li>)}</ul>{items.length === 0 ? <p className="dse-status">{t('noWorkspaces')}</p> : null}</section>
  </div>
}

export const inject = ['slots', 'locale', 'connection', 'mainNavigation', 'modules']

/** Register enterprise pages into the original Web settings shell. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('enterprise', { zh, en }), 'enterprise-client: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  const sessions = ctx.get('sessions') as ISessions
  const call = async (endpoint: string, payload: unknown): Promise<unknown> => {
    const result = await connection.rpc.call('/enterprise', endpoint, { args: payload })
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const nativeWindowId = (window as EnterpriseWindow & { __dshWindowId?: string }).__dshWindowId
  const pluginRuntime = new EnterpriseClientPluginRuntime({
    ctx,
    call,
    ...(nativeWindowId === undefined ? {} : { windowId: nativeWindowId }),
  })
  ctx.effect(() => {
    const reconcile = (): void => {
      void pluginRuntime.reconcile().catch((error: unknown) => { console.error('[enterprise] plugin Client reconciliation failed', error instanceof Error ? error.message : error) })
    }
    const onGeneration = (): void => {
      if (connection.generation.getSnapshot() !== undefined) reconcile()
    }
    const unsubscribe = connection.generation.subscribe(onGeneration)
    onGeneration()
    const onPageHide = (): void => { void pluginRuntime.disconnect() }
    window.addEventListener('pagehide', onPageHide)
    return async () => {
      window.removeEventListener('pagehide', onPageHide)
      await pluginRuntime.disconnect()
      unsubscribe()
      await pluginRuntime.dispose()
    }
  }, 'enterprise-client: browser plugin targets')
  const native = (): NativeEnterpriseActions | undefined => (window as EnterpriseWindow).__dshNative
  const injected = (): EnterpriseInjected => ({
    loadDashboard: async () => enterpriseDashboard.parse(await call('dashboard', {})),
    loadWorkspaces: async () => enterpriseWorkspaces.parse(await call('workspaces', {})),
    createWorkspace: async (name, image) => call('workspace-create', { name, image }),
    changeWorkspace: async (id, action) => call(`workspace-${action}`, { id }),
    loadModelSelection: async () => enterpriseModelSelection.parse(await call('model-selection', {})),
    saveModel: async (model) => { const input = setModelInput.parse({ model }); return enterpriseModelSelection.parse(await call('set-model', input)) },
    loadPlugins: async () => enterprisePluginCatalog.parse(await call('plugins', {})),
    loadPluginInstallations: async () => enterprisePluginInstallations.parse(await call('plugin-installations', {})),
    loadPluginDeviceTargets: async () => enterprisePluginDeviceTargets.parse(await call('plugin-device-targets', {})),
    uploadPlugin: async (visibility, bytes) => {
      const input = pluginUploadInput.parse({ visibility, bytes: [...bytes] })
      return call('plugin-upload', input)
    },
    installPlugin: async releaseId => call('plugin-install', pluginInstallationInput.parse({ releaseId })),
    upgradePlugin: async (installationId, releaseId) => {
      const value = await call('plugin-upgrade', pluginUpgradeInput.parse({ installationId, releaseId, confirmPermissions: true }))
      await pluginRuntime.reconcile()
      return value
    },
    uninstallPlugin: async (installationId) => {
      const value = await call('plugin-uninstall', { installationId })
      void pluginRuntime.reconcile().catch((error: unknown) => {
        console.error('[enterprise] plugin uninstall reconciliation failed', error instanceof Error ? error.message : error)
      })
      return value
    },
    forceRemovePlugin: async installationId => call('plugin-force-remove', { installationId }),
    setPluginEnabled: async (installationId, enabled) => {
      const value = await call('plugin-enable', pluginEnableInput.parse({ installationId, enabled }))
      await pluginRuntime.reconcile()
      return value
    },
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
  const marketInjected = (): EnterpriseInjected & CloudDriveInjected => ({ ...injected(), ...driveInjected() })
  const driveInjected = (): CloudDriveInjected => ({
    loadSpaces: async () => driveSpaces.parse(await call('drive-spaces', {})),
    loadFiles: async (spaceId, parentId, cursor) => driveFilePage.parse(await call('drive-files', { spaceId, parentId, cursor })),
    searchFiles: async (spaceId, query, cursor) => driveFilePage.parse(await call('drive-search', { spaceId, query, cursor })),
    createFolder: async (spaceId, parentId, name) => { await call('drive-create-folder', driveCreateFolderInput.parse({ spaceId, parentId, name })) },
    createUpload: async (input) => {
      const value = driveUploadSession.parse(await call('drive-create-upload', input))
      return { uploadId: value.uploadId, uploadUrl: value.uploadUrl, name: value.name }
    },
    commitUpload: async (uploadId, baseVersionId) => { await call('drive-commit-upload', { uploadId, ...(baseVersionId === undefined ? {} : { baseVersionId }) }) },
    downloadFile: async nodeId => z.object({ url: z.url(), versionId: z.string(), checksum: z.string() }).strict().parse(await call('drive-download', { nodeId })),
    updateNode: async (nodeId, input) => { await call('drive-node-update', { nodeId, ...input }) },
    deleteNode: async (nodeId) => { await call('drive-node-delete', { nodeId }) },
    restoreNode: async (nodeId) => { await call('drive-node-restore', { nodeId }) },
    loadVersions: async nodeId => z.array(z.object({ id: z.string(), nodeId: z.string(), size: z.number(), contentType: z.string(), checksum: z.string(), createdBy: z.string(), createdAt: z.string() }).strict()).parse(await call('drive-versions', { nodeId })),
    loadDescriptions: async (nodeId, includeHistory) => z.array(z.object({ id: z.string(), nodeId: z.string(), versionId: z.string().nullable(), type: z.string(), content: z.string(), fields: z.record(z.string(), z.json()).nullable(), source: z.enum(['user', 'agent', 'import']), status: z.enum(['active', 'superseded', 'deleted']), createdBy: z.string(), createdAt: z.string(), updatedAt: z.string() }).loose()).parse(await call('drive-descriptions', { nodeId, includeHistory })),
  })
  const triggerInjected = (): TriggerInjected => ({
    loadTriggers: async () => triggerSnapshot.parse(await call('trigger-snapshot', {})),
    saveTrigger: async input => triggerRule.parse(await call('trigger-save', triggerRuleSaveInput.parse(input))),
    setTriggerEnabled: async (ruleId, enabled) => triggerRule.parse(await call('trigger-enable', { ruleId, enabled })),
    removeTrigger: async (ruleId) => { await call('trigger-remove', { ruleId }) },
    retryTrigger: async (batchId) => { await call('trigger-retry', { batchId }) },
    testTriggerMatch: async (path, includes, excludes) => z.object({ matched: z.boolean() }).parse(await call('trigger-test-match', { path, includes, excludes })).matched,
    loadSpaces: async () => driveSpaces.parse(await call('drive-spaces', {})),
    openSession: async (sessionId) => {
      await sessions.refresh()
      sessions.open(sessionId as SessionId)
      ctx.mainNavigation.openConversation()
    },
  })
  ctx.slots.inject('settings.section', function* () {
    yield ctx.slots.register({ name: 'settings.section', id: 'enterprise', order: 5, label: () => t('accountNav'), locale: 'enterprise', inject: injected }, AccountSection)
    yield ctx.slots.register({ name: 'settings.section', id: 'enterprise-models', order: 10, label: () => t('modelsNav'), locale: 'enterprise', inject: injected }, ModelSection)
    yield ctx.slots.register({ name: 'settings.section', id: 'enterprise-team', order: 15, label: () => t('teamNav'), locale: 'enterprise', inject: injected }, TeamSection)
    yield ctx.slots.register({ name: 'settings.section', id: 'enterprise-workspaces', order: 18, label: () => t('cloudWorkspaces'), locale: 'enterprise', inject: injected }, WorkspaceSection)
    yield ctx.slots.register({ name: 'settings.section', id: 'plugins', order: 20, label: () => t('pluginsNav'), locale: 'enterprise', inject: injected }, PluginsSection)
  })
  ctx.slots.inject('sidebar.rail.item', () => ctx.slots.register({
    name: 'sidebar.rail.item', id: 'plugin-market', order: 20, locale: 'enterprise',
    inject: () => ({ navigation: ctx.mainNavigation, open: () => { ctx.mainNavigation.openPluginMarket() } }),
  } as never, PluginMarketAction as never))
  ctx.slots.inject('sidebar.rail.item', () => ctx.slots.register({
    name: 'sidebar.rail.item', id: 'cloud-drive', order: 25, locale: 'enterprise',
    inject: () => ({ navigation: ctx.mainNavigation, open: () => { ctx.mainNavigation.openCloudDrive() } }),
  } as never, CloudDriveAction as never))
  ctx.slots.inject('sidebar.rail.item', () => ctx.slots.register({
    name: 'sidebar.rail.item', id: 'triggers', order: 30, locale: 'enterprise',
    inject: () => ({ navigation: ctx.mainNavigation, open: () => { ctx.mainNavigation.openTriggers() } }),
  } as never, TriggerAction as never))
  ctx.slots.inject('main.surface', () => ctx.slots.register({
    name: 'main.surface', locale: 'enterprise', inject: () => ({ ...marketInjected(), ...triggerInjected() }),
  }, EnterpriseMainSurface))
}
