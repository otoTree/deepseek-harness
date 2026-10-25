/* oxlint-disable @stylistic/max-len -- Enterprise panels keep their RPC and presentation contracts together. */
/** Enterprise account and governed-plugin sections for the existing Web settings shell. */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { z } from 'zod'
import { Departments, type DepartmentActions } from './departments.tsx'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DshWindow } from '@deepseek-ai/dsh-client-modules/client'
import type { PluginCapabilityTransport, PluginClientContribution } from '@deepseek-ai/dsh-plugin-protocol'
import type { SlotEntryDef, SlotMap, SlotSpec } from '@deepseek-ai/dsh-client-ui-slots'
import { createClientWindowService, mountPluginTarget, type PluginTargetModule } from '@deepseek-ai/dsh-plugin-runtime'
import { createPluginSdk } from '@deepseek-ai/dsh-plugin-sdk'
import {
  Button,
  Input,
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconUserOutline16,
  IconWarningOutline16,
  IconDataOutline16,
  IconChecklistOutline14,
  IconListPenOutline16,
  IconArchiveOutline20,
  IconCordisPluginOutline14,
  IconDownloadOutline16,
  IconEditOutline16,
  IconFolderOpenOutline16,
  IconAlarmClockOutline16,
  IconPlayOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconTrashOutline16,
  Modal,
  Pill,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
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
  enterprisePluginCatalog,
  enterprisePluginInstallations,
  enterprisePluginDeviceTargets,
  enterprisePluginCapabilityDiagnostics,
  pluginEnableInput,
  pluginInstallationInput,
  pluginUpgradeInput,
  pluginUploadInput,
  pluginSettings,
  pluginSettingsInput,
  pluginConnectionSettings,
  pluginConnectionInput,
  enterpriseTeam,
  enterpriseUsagePage,
  enterpriseUsageSummary,
  ownUsageInput,
  walletLedgerInput,
  type EnterpriseUsageSummary,
  enterpriseWallet,
  enterpriseWalletLedger,
  enterpriseDepartments,
  createDepartmentInput,
  updateDepartmentInput,
  deleteDepartmentInput,
  memberDepartmentsInput,
  inviteMemberInput,
  memberUsageInput,
  redeemCodeInput,
  revokeInvitationInput,
  revokeRuntimeInput,
  setModelInput,
  teamUsageRangeInput,
  driveSpaces,
  driveDirectory,
  driveSharing,
  type DriveDirectory,
  type DriveSharing,
  type DriveSharingPolicy,
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
  /** Open an allow-listed external HTTP(S) URL in the host browser. */
  openExternal?: (value: { url: string }) => Promise<boolean>
  switchOrganization: () => Promise<unknown>
  logout: () => Promise<unknown>
  checkForUpdates: () => Promise<void>
  getAvailableUpdateVersion: () => Promise<string | null>
  dismissUpdateNotification: () => Promise<void>
  createDriveEditSession?: (value: { sessionId: string; downloadUrl: string; fileName: string; versionId: string }) => Promise<{ sessionId: string; path: string; versionId: string }>
  openDriveFile?: (value: { sessionId: string }) => Promise<unknown>
  getDriveEditStatus?: (value: { sessionId: string }) => Promise<{ changed: boolean; size: number; modifiedAt: number }>
  uploadDriveEdit?: (value: { sessionId: string }) => Promise<{ contentBase64: string; size: number }>
  cancelDriveEditSession?: (value: { sessionId: string }) => Promise<unknown>
  closeDriveEditSession?: (value: { sessionId: string }) => Promise<unknown>
  listLocalPluginPackages?: () => Promise<readonly { path: string; fileName: string; pluginId: string; version: string; packageDigest: string; packageSize: number }[]>
  readLocalPluginPackage?: (value: { path: string }) => Promise<number[]>
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
  diagnostics: z.array(z.unknown()).optional(),
  activationTimeoutMs: z.number().int().positive(),
  cleanupTimeoutMs: z.number().int().positive(),
}).strict()

// oxlint-disable-next-line typescript/require-await -- Script injection failures must reject the loader Promise.
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
  let abort: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () =>{  reject(signal.reason instanceof Error ? signal.reason : new Error('Plugin Client activation aborted')) }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
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
  private reconcileController: AbortController | undefined
  private disposed = false
  private activationTimeoutMs = 30_000
  private cleanupTimeoutMs = 10_000
  private readonly windowId: string

  constructor(private readonly options: {
    readonly ctx: Context
    readonly call: (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>
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
    if (this.disposed) return Promise.reject(new Error('Enterprise Client plugin runtime disposed'))
    this.reconcileController?.abort(new Error('Plugin Client reconciliation superseded'))
    const controller = new AbortController()
    this.reconcileController = controller
    const next = this.reconcileTail.then(async () => {
      controller.signal.throwIfAborted()
      const snapshot = enterpriseClientRuntimeSnapshot.parse(await untilAbort(this.options.call('plugin-runtime-targets', {}, controller.signal), controller.signal))
      this.activationTimeoutMs = this.options.activationTimeoutMs ?? snapshot.activationTimeoutMs
      this.cleanupTimeoutMs = this.options.cleanupTimeoutMs ?? snapshot.cleanupTimeoutMs
      const targets = snapshot.targets
      const keyOf = (target: Pick<EnterpriseClientTarget, 'installationId' | 'moduleId'>): string => `${target.installationId}:${target.moduleId}`
      const wanted = new Set(targets.map(keyOf))
      await Promise.allSettled([...this.cleanupFailures].map(async ([key, failed]) => {
        try {
          await this.unmount(failed)
          this.cleanupFailures.delete(key)
        } catch (error) {
          this.options.ctx.logger('enterprise-plugin-client').error(error)
        }
      }))
      await Promise.allSettled([...this.mountedTargets].filter(([key]) => !wanted.has(key)).map(async ([key, mounted]) => {
        this.mountedTargets.delete(key)
        try { await this.unmount(mounted) }
        catch (error) {
          this.cleanupFailures.set(key, mounted)
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
      }, controller.signal)))
    }).finally(() => {
      if (this.reconcileController === controller) this.reconcileController = undefined
    })
    this.reconcileTail = next.catch(() => {})
    return next
  }

  private async reconcileTarget(target: EnterpriseClientTarget, signal: AbortSignal): Promise<void> {
    try {
      signal.throwIfAborted()
      const targetKey = `${target.installationId}:${target.moduleId}`
      if (this.cleanupFailures.has(targetKey)) return
      const current = this.mountedTargets.get(targetKey)
      if (current?.activationId === target.activationId) return
      if (current !== undefined) {
        this.mountedTargets.delete(targetKey)
        try { await this.unmount(current) }
        catch (error) {
          this.cleanupFailures.set(targetKey, current)
          throw error
        }
      }
      const relay = this.options.call
      const transport: PluginCapabilityTransport = {
        call: async <T,>(operation: string, input: unknown, signal?: AbortSignal): Promise<T> => {
          signal?.throwIfAborted()
          const value = await relay('plugin-sdk-call', { activationId: target.activationId, operation, input }, signal)
          signal?.throwIfAborted()
          return value as T
        },
        stream: async function* <T>(operation: string, input: unknown, signal?: AbortSignal): AsyncIterable<T> {
          signal?.throwIfAborted()
          const chunks = z.array(z.unknown()).parse(await relay('plugin-sdk-stream', { activationId: target.activationId, operation, input }, signal))
          for (const chunk of chunks) { signal?.throwIfAborted(); yield chunk as T }
        },
      }
      let dispose: (() => Promise<void>) | undefined
      let preparation: Promise<unknown> = Promise.resolve()
      const cleanup = async (): Promise<void> => {
        // A bundle loader may finish after cancellation; retain ownership until
        // it settles so the same module id cannot be reused underneath it.
        await preparation.catch(() => {})
        await dispose?.()
      }
      const owned = { activationId: target.activationId, moduleId: target.moduleId, dispose: cleanup }
      const activationSignal = AbortSignal.timeout(this.activationTimeoutMs)
      const combined = AbortSignal.any([activationSignal, signal])
      try {
        this.options.ctx.modules.invalidate(target.moduleId)
        removeClientTargetStyles(target.moduleId)
        preparation = (this.options.loadTarget ?? loadClientTarget)(target)
        await untilAbort(preparation, combined)
        const importing = this.options.ctx.modules.import(target.moduleId, '', {})
        preparation = importing
        const module = await untilAbort(importing, combined) as PluginTargetModule
        preparation = mountPluginTarget(this.options.ctx, module, createPluginSdk(transport), {
          signal: combined,
          clientWindow: createClientWindowService(transport),
          scopeName: `pluginSdk:${target.installationId}:${target.activationId}:${target.moduleId}`,
        }).then((value) => { dispose = value })
        await untilAbort(preparation, combined)
        const slotStates = target.contributions.filter((contribution): contribution is Extract<PluginClientContribution, { kind: 'slot' }> => contribution.kind === 'slot').map((contribution) => {
          try {
            const entries = this.options.ctx.slots.entries(contribution.slot as never)
            // Market packages can contribute keys outside this module's compile-time SlotMap.
            const spec = this.options.ctx.slots.spec(contribution.slot as keyof SlotMap) as SlotSpec<SlotEntryDef> | undefined
            const keyed = spec?.kind === 'keyed'
            const present = entries.some(entry => (keyed ? entry.options.key : entry.options.id) === contribution.id)
            return present
              ? { id: contribution.id, slot: contribution.slot, present: true }
              : { id: contribution.id, slot: contribution.slot, present: false, error: `Client slot ${contribution.slot} did not register ${contribution.id}` }
          } catch (error) {
            return { id: contribution.id, slot: contribution.slot, present: false, error: error instanceof Error ? error.message : 'Client slot is unavailable' }
          }
        })
        if (slotStates.some(state => !state.present)) throw new Error(slotStates.find(state => !state.present)?.error ?? 'Client slot registration failed')
        if (slotStates.length > 0) {
          await untilAbort(this.options.call('plugin-client-slot-state', {
            activationId: target.activationId, moduleId: target.moduleId, windowId: this.windowId, slots: slotStates,
          }, AbortSignal.any([activationSignal, signal])), AbortSignal.any([activationSignal, signal]))
        }
        await untilAbort(this.options.call('plugin-client-window-state', {
          activationId: target.activationId, moduleId: target.moduleId, windowId: this.windowId, state: 'active', error: null,
        }, AbortSignal.any([activationSignal, signal])), AbortSignal.any([activationSignal, signal]))
        combined.throwIfAborted()
        this.mountedTargets.set(targetKey, owned)
      } catch (error) {
        try { await this.unmount(owned) }
        catch (cleanupError) {
          this.cleanupFailures.set(targetKey, owned)
          this.options.ctx.logger('enterprise-plugin-client').error(cleanupError)
        }
        const reportSignal = AbortSignal.timeout(this.cleanupTimeoutMs)
        try {
          await untilAbort(this.options.call('plugin-client-window-state', {
            activationId: target.activationId, moduleId: target.moduleId, windowId: this.windowId, state: 'failed',
            error: error instanceof Error ? error.message : 'Plugin Client activation failed',
          }, reportSignal), reportSignal)
        } catch (reportError) { this.options.ctx.logger('enterprise-plugin-client').error(reportError) }
        throw error
      }
    } catch (error) {
      this.options.ctx.logger('enterprise-plugin-client').error(error)
    }
  }

  /** Wait for reconciliation and release every mounted Client contribution. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.reconcileController?.abort(new Error('Enterprise Client plugin runtime disposed'))
    await this.reconcileTail
    for (const [key, target] of this.mountedTargets) this.cleanupFailures.set(key, target)
    this.mountedTargets.clear()
    const outcomes = await Promise.allSettled([...this.cleanupFailures].map(async ([key, target]) => {
      await this.unmount(target)
      this.cleanupFailures.delete(key)
    }))
    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    if (failures.length > 0) throw new AggregateError(failures.map(outcome => outcome.reason as unknown), 'Plugin Client cleanup failed')
  }

  /** Report a page teardown before the connection disappears. */
  async disconnect(): Promise<void> {
    await Promise.allSettled([...this.mountedTargets.values()].map(target => this.options.call('plugin-client-window-state', {
      activationId: target.activationId, moduleId: target.moduleId, windowId: this.windowId, state: 'disconnected', error: null,
    })))
  }
}

interface EnterpriseInjected extends DepartmentActions {
  importCloudSessions: () => Promise<{ imported: number }>
  uploadCloudSessions: () => Promise<{ uploaded: number }>
  loadDashboard: () => Promise<EnterpriseDashboard>
  loadModelSelection: () => Promise<EnterpriseModelSelection>
  saveModel: (model: string) => Promise<EnterpriseModelSelection>
  loadPlugins: () => Promise<EnterprisePluginCatalog>
  loadPluginInstallations: () => Promise<EnterprisePluginInstallations>
  loadPluginDeviceTargets?: () => Promise<EnterprisePluginDeviceTargets>
  loadPluginDiagnostics?: () => Promise<ReturnType<typeof enterprisePluginCapabilityDiagnostics.parse>>
  uploadPlugin: (visibility: 'private' | 'organization' | 'platform', bytes: Uint8Array) => Promise<unknown>
  installPlugin: (releaseId: string) => Promise<unknown>
  upgradePlugin: (installationId: string, releaseId: string) => Promise<unknown>
  uninstallPlugin: (installationId: string) => Promise<unknown>
  forceRemovePlugin: (installationId: string) => Promise<unknown>
  setPluginEnabled: (installationId: string, enabled: boolean) => Promise<unknown>
  loadPluginSettings?: (installationId: string) => Promise<z.infer<typeof pluginSettings>>
  configurePluginSettings?: (input: z.infer<typeof pluginSettingsInput>) => Promise<unknown>
  loadConnectionSettings?: (installationId: string) => Promise<z.infer<typeof pluginConnectionSettings>>
  configureConnection?: (input: z.infer<typeof pluginConnectionInput>) => Promise<unknown>
  authorizeConnection?: (installationId: string) => Promise<{ url?: string | undefined }>
  authorizationStatus?: (installationId: string, cancel?: boolean) => Promise<{ complete: boolean; error?: string | undefined }>
  openConversation: () => void
  openPluginMarket: () => void
  revokeRuntime: (runtimeId: string) => Promise<void>
  loadWallet: () => Promise<EnterpriseWallet>
  loadWalletLedger: (cursor?: string) => Promise<EnterpriseWalletLedger>
  loadOwnUsage: (cursor?: string, from?: string, to?: string) => Promise<EnterpriseUsagePage>
  loadOwnUsageSummary: (from: string, to: string) => Promise<EnterpriseUsageSummary>
  redeem: (code: string) => Promise<EnterpriseWallet>
  loadTeam: (from?: string, to?: string) => Promise<EnterpriseTeam>
  loadMemberUsage: (accountId: string, cursor?: string, from?: string, to?: string) => Promise<EnterpriseUsagePage>
  inviteMember: (email: string, role: 'member' | 'administrator') => Promise<void>
  revokeInvitation: (invitationId: string) => Promise<void>
  switchOrganization: () => void
  logout: () => void
}

type AccountProps = PropsRuntime<'settings.section'> & PropsLocale<'enterprise'> & InjectFace<EnterpriseInjected>
type DesktopUpdateProps = PropsRuntime<'settings.general.item'> & PropsLocale<'enterprise'> & InjectFace<{
  checkForUpdates: () => Promise<void>
  hooks: { nativeUpdates: HostObservable<boolean> }
}>

function DesktopUpdateSetting({ t, checkForUpdates, useNativeUpdates }: DesktopUpdateProps): ReactNode {
  const available = useNativeUpdates(value => value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!available) return null
  async function check(): Promise<void> {
    setBusy(true)
    setFailed(false)
    try { await checkForUpdates() } catch { setFailed(true) } finally { setBusy(false) }
  }
  return <div className="dse-desktop-update">
    <div className="dse-desktop-update-row">
      <div><div className="dse-desktop-update-title">{t('desktopUpdates')}</div>
        <p className="dse-subtle">{t('desktopUpdatesHelp')}</p></div>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => { void check() }}>
        {t(busy ? 'checkingForUpdates' : 'checkForUpdates')}
      </Button>
    </div>
    {failed ? <p className="dse-error" role="alert">{t('checkForUpdatesFailed')}</p> : null}
  </div>
}

type DesktopUpdateNotificationProps = PropsRuntime<'shell.overlay'> & PropsLocale<'enterprise'> & InjectFace<{
  checkForUpdates: () => Promise<void>
  dismissUpdate: () => Promise<void>
  hooks: { availableUpdate: HostObservable<string | null> }
}>

function DesktopUpdateNotification({ t, checkForUpdates, dismissUpdate, useAvailableUpdate }: DesktopUpdateNotificationProps): ReactNode {
  const version = useAvailableUpdate(value => value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  if (version === null) return null
  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setFailed(false)
    try { await action() } catch { setFailed(true) } finally { setBusy(false) }
  }
  return <aside className="dse-update-notification" role="region" aria-label={t('updateNotificationTitle')}>
    <div className="dse-update-notification-heading"><strong>{t('updateNotificationTitle')}</strong>
      <Button size="sm" variant="ghost" disabled={busy} aria-label={t('dismissUpdateNotification')}
        icon={<IconCloseOutline16 />} onClick={() => { void run(dismissUpdate) }} />
    </div>
    <p role="status">{t('updateNotificationAvailable', { version })}</p>
    <Button size="sm" disabled={busy} onClick={() => { void run(checkForUpdates) }}>{t('installUpdate')}</Button>
    {failed ? <p className="dse-error" role="alert">{t('checkForUpdatesFailed')}</p> : null}
  </aside>
}

type PluginsProps = PropsRuntime<'settings.section'> & PropsLocale<'enterprise'> & InjectFace<EnterpriseInjected>
export interface PluginMarketInjected extends Pick<EnterpriseInjected,
  'loadPlugins' | 'loadPluginInstallations' | 'loadPluginDeviceTargets' | 'loadPluginDiagnostics' | 'uploadPlugin'
  | 'installPlugin' | 'upgradePlugin' | 'uninstallPlugin' | 'forceRemovePlugin' | 'setPluginEnabled'
  | 'loadPluginSettings' | 'configurePluginSettings' | 'loadConnectionSettings' | 'configureConnection'
  | 'authorizeConnection' | 'authorizationStatus'> {
  loadDashboard: () => Promise<{ capabilities?: { manageOrganizationPlugins: boolean; publishPlugins: boolean } | undefined }>
  uploadVisibilities?: readonly ('private' | 'organization' | 'platform')[] | undefined

  hooks: { pluginRevision: HostObservable<number> }
}

type PluginMarketProps = PropsRuntime<'main.surface'> & PropsLocale<'enterprise'> & InjectFace<PluginMarketInjected>
type PluginMarketActionProps = PropsRuntime<'sidebar.rail.item'> & PropsLocale<'enterprise'> & InjectFace<{
  navigation: { get(): MainSurface; subscribe(listener: () => void): () => void; openTriggers?: () => void }
  open: () => void
}> & { wide?: boolean }
interface CloudDriveInjected {
  loadDirectory: () => Promise<DriveDirectory>
  loadSharing: (nodeId: string) => Promise<DriveSharing>
  saveSharing: (nodeId: string, policy: DriveSharingPolicy | null) => Promise<DriveSharing>
  loadSpaces: () => Promise<DriveSpaces>
  loadFiles: (spaceId: string, parentId: string | null, cursor?: string, shared?: boolean) => Promise<DriveFilePage>
  searchFiles: (spaceId: string, query: string, cursor?: string, shared?: boolean) => Promise<DriveFilePage>
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
type BillingProps = PropsRuntime<'settings.section'> & PropsLocale<'enterprise'> & InjectFace<EnterpriseInjected>
type DirectoryProps = PropsRuntime<'settings.section'> & PropsLocale<'enterprise'> & InjectFace<EnterpriseInjected>
type AsyncState<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: T }

function moneyCny(micros: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micros / 1_000_000)
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

function SettingsPageStatus({ titleKey, intro, loading, retry, t }: {
  titleKey: EnterpriseLocaleKey
  intro: EnterpriseLocaleKey
  loading: boolean
  retry: () => void
  t: AccountProps['t']
}): ReactNode {
  return <div className="dse-section">
    <header><h2 className="dse-title">{t(titleKey)}</h2><p className="dse-subtle">{t(intro)}</p></header>
    <div className="dse-settings-status" role={loading ? 'status' : 'alert'}>
      <div className="dse-settings-status-icon" aria-hidden="true">{loading ? <IconRefreshOutline16 /> : <IconWarningOutline16 />}</div>
      <div className="dse-settings-status-copy"><strong>{t(loading ? 'loading' : 'error')}</strong>{!loading && <p className="dse-subtle">{t('settingsRetryHelp')}</p>}</div>
      {!loading && <Button size="sm" variant="outline" onClick={retry}><IconRefreshOutline16 />{t('retry')}</Button>}
    </div>
  </div>
}

function AccountSection({ importCloudSessions, uploadCloudSessions, loadDashboard, revokeRuntime, switchOrganization, logout, t }: AccountProps): ReactNode {
  const [revision, setRevision] = useState(0)
  const [transferring, setTransferring] = useState<'upload' | 'download'>()
  const [transferred, setTransferred] = useState<{ key: 'sessionsImported' | 'sessionsUploaded'; count: number }>()
  const [transferError, setTransferError] = useState<'sessionSyncFailed' | 'sessionSyncConflict' | 'sessionSyncBusy'>()
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
  if (state.status !== 'ready') return <SettingsPageStatus titleKey="accountNav" intro="accountIntro" loading={state.status === 'loading'} retry={() => { setRevision(value => value + 1) }} t={t} />
  const data = state.value
  const transfer = (direction: 'upload' | 'download'): void => {
    setTransferring(direction); setTransferred(undefined); setTransferError(undefined)
    const operation = direction === 'upload'
      ? uploadCloudSessions().then(result => ({ key: 'sessionsUploaded' as const, count: result.uploaded }))
      : importCloudSessions().then(result => ({ key: 'sessionsImported' as const, count: result.imported }))
    void operation.then(setTransferred, (error: unknown) => {
      setTransferError(error instanceof Error && error.message === 'SESSION_SYNC_CONFLICT' ? 'sessionSyncConflict'
        : error instanceof Error && error.message === 'SESSION_SYNC_BUSY' ? 'sessionSyncBusy' : 'sessionSyncFailed')
    }).finally(() => { setTransferring(undefined) })
  }
  const revoke = (id: string): void => {
    if (confirmRuntime !== id) { setConfirmRuntime(id); return }
    setOperationError(false)
    void revokeRuntime(id).then(() => {
      setConfirmRuntime(null)
      setRevision(value => value + 1)
    }, () => { setOperationError(true) })
  }
  return <div className="dse-section">
    <header><h2 className="dse-title">{t('accountNav')}</h2><p className="dse-subtle">{t('accountIntro')}</p></header>
    <section className="dse-card dse-header dse-organization">
      <div className="dse-identity"><span className="dse-avatar" aria-hidden="true">{Array.from(data.organization.name).slice(0, 2).join('').toLocaleUpperCase()}</span><div><p className="dse-eyebrow">{t('organization')}</p><h3 className="dse-value">{data.organization.name}</h3><p className="dse-subtle">{data.organization.kind} · {data.organization.status}</p></div></div>
      <div className="dse-actions"><Button size="sm" variant="outline" onClick={switchOrganization}>{t('switchOrganization')}</Button><Button size="sm" onClick={logout}>{t('logout')}</Button></div>
    </section>
    {operationError ? <p className="dse-subtle dse-error" role="alert">{t('requestFailed')}</p> : null}
    <div className="dse-grid">
      <section className="dse-card dse-stat"><h3>{t('plan')}</h3><p className="dse-value">{data.subscription.plan}</p><p className="dse-meta">{String(data.subscription.seats)} {t('seats')}</p></section>
      <section className="dse-card dse-stat"><h3>{t('roles')}</h3><div className="dse-tags">{data.roles.map(role => <span className="dse-tag" key={`${role.role}:${role.unitId ?? 'organization'}`}>{role.role}</span>)}</div></section>
      <section className="dse-card dse-card-wide"><h3>{t('localSessions')}</h3><p className="dse-subtle">{t('localSessionsHelp')}</p>
        <div className="dse-actions"><Button size="sm" variant="outline" disabled={transferring !== undefined} onClick={() => { transfer('upload') }}>{t(transferring === 'upload' ? 'uploadingSessions' : 'uploadCloudSessions')}</Button>
          <Button size="sm" variant="outline" disabled={transferring !== undefined} onClick={() => { transfer('download') }}>{t(transferring === 'download' ? 'importingSessions' : 'importCloudSessions')}</Button></div>
        {transferred === undefined ? null : <p role="status">{t(transferred.key)} {transferred.count}</p>}
        {transferError === undefined ? null : <p className="dse-subtle dse-error" role="alert">{t(transferError)}</p>}
      </section>
      <section className="dse-card dse-card-wide"><h3>{t('devices')}</h3><ul className="dse-list">{data.runtimes.map(runtime => <li className="dse-row" key={runtime.id}><span className="dse-identity"><span className="dse-item-icon" aria-hidden="true"><IconDataOutline16 /></span><span className="dse-row-main"><strong className="dse-row-title">{runtime.name}</strong><span className="dse-row-note">{runtime.type} · {runtime.version}</span></span>{runtime.current ? <span className="dse-tag dse-tag-accent">{t('currentDevice')}</span> : null}</span>{runtime.revokedAt ? <Pill>{t('revoke')}</Pill> : <Button size="sm" variant="outline" onClick={() => { revoke(runtime.id) }}>{confirmRuntime === runtime.id ? t('confirmRevoke') : t('revoke')}</Button>}</li>)}</ul></section>
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
  if (state.status !== 'ready') return <SettingsPageStatus titleKey="modelsNav" intro="modelsIntro" loading={state.status === 'loading'} retry={() => { setRevision(value => value + 1) }} t={t} />
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
      <label className="dse-field"><span className="dse-row-title">{t('defaultModel')}</span><select value={state.value.models.some(model => model.id === selected) ? selected : ''} disabled={saving || state.value.models.length === 0} onChange={(event) => { save(event.currentTarget.value) }}>
        {!state.value.models.some(model => model.id === selected) ? <option value="" disabled>{t('selectModel')}</option> : null}
        {state.value.models.map(model => <option value={model.id} key={model.id}>{model.name}</option>)}
      </select></label>
      <p className="dse-meta">{saving ? t('saving') : t('modelManaged')}</p>
    </section>
    <section className="dse-card dse-card-wide">
      <h3>{t('models')}</h3>
      {state.value.models.length === 0 ? <p className="dse-meta">{t('noModels')}</p> : <ul className="dse-list">{state.value.models.map(model => <li className="dse-model-row" key={model.id}>
        <div className="dse-plugin-head"><strong className="dse-row-title">{model.name}</strong>{selected === model.id ? <Pill active>{t('defaultModel')}</Pill> : null}</div>
        <p className="dse-row-note dse-model-id">{model.id}</p>
        <div className="dse-tags">{model.inputModalities.map(modality => <span className="dse-tag" key={modality}>{modality}</span>)}</div>
        <dl className="dse-model-limits"><div><dt>{t('context')}</dt><dd>{model.contextTokens.toLocaleString()}</dd></div><div><dt>{t('output')}</dt><dd>{model.maxOutputTokens.toLocaleString()}</dd></div></dl>
        {model.inputModalities.includes('video') ? <p className="dse-meta">{t(model.videoAudioMode === 'visual-and-audio' ? 'videoWithAudio' : 'videoVisualOnly')}</p> : null}
      </li>)}</ul>}
    </section>
  </div>
}

function PluginIcon({ name, icon }: { name: string; icon: string | undefined }): ReactNode {
  const [failed, setFailed] = useState(false)
  return <span className="dse-market-plugin-icon" aria-hidden="true">
    {icon && !failed
      ? <img src={icon} alt="" width={32} height={32} onError={() => { setFailed(true) }} />
      : <span>{Array.from(name.trim()).slice(0, 2).join('').toLocaleUpperCase()}</span>}
  </span>
}

function PluginsSection({ openPluginMarket, close, t }: PluginsProps): ReactNode {
  return <div className="dse-section">
    <header><h2 className="dse-title">{t('pluginsNav')}</h2><p className="dse-subtle">{t('pluginIntro')}</p></header>
    <section className="dse-card dse-plugin-destination">
      <span className="dse-destination-icon" aria-hidden="true"><IconCordisPluginOutline14 size={24} /></span>
      <div><h3>{t('pluginMarket')}</h3><p className="dse-subtle">{t('pluginSettingsHelp')}</p></div>
      <Button size="sm" onClick={() => { openPluginMarket(); close() }}>{t('openPluginMarket')}</Button>
    </section>
  </div>
}

export function PluginMarketAction({ navigation, open, t, slotEntry = {}, defaultIcon, wide }: PluginMarketActionProps): ReactNode {
  const active = useSyncExternalStore(
    navigation.subscribe.bind(navigation),
    navigation.get.bind(navigation),
    () => 'conversation',
  ) === 'plugin-market'
  const label = slotEntry.label ?? t('pluginMarket')
  const icon = slotEntry.icon ?? defaultIcon
  return <Tooltip label={label} delayMs={500}><button type="button" className="dse-market-action" data-active={active || undefined} data-wide={wide || undefined} aria-label={label} aria-pressed={active} onClick={open}>
    {icon({ size: wide ? 16 : 18 })}{wide ? <span className="dse-market-action-label">{label}</span> : null}
  </button></Tooltip>
}

function CloudDriveAction({ navigation, open, t, slotEntry = {}, defaultIcon, wide }: PluginMarketActionProps): ReactNode {
  const active = useSyncExternalStore(navigation.subscribe.bind(navigation), navigation.get.bind(navigation), () => 'conversation') === 'cloud-drive'
  const label = slotEntry.label ?? t('cloudDrive')
  const icon = slotEntry.icon ?? defaultIcon
  return <Tooltip label={label} delayMs={500}><button type="button" className="dse-market-action" data-active={active || undefined} data-wide={wide || undefined} aria-label={label} aria-pressed={active} onClick={open}>
    {icon({ size: wide ? 16 : 18 })}{wide ? <span className="dse-market-action-label">{label}</span> : null}
  </button></Tooltip>
}

function TriggerAction({ navigation, open, t, slotEntry = {}, defaultIcon, wide }: PluginMarketActionProps): ReactNode {
  const active = useSyncExternalStore(navigation.subscribe.bind(navigation), navigation.get.bind(navigation), () => 'conversation') === 'triggers'
  const label = slotEntry.label ?? t('triggers')
  const icon = slotEntry.icon ?? defaultIcon
  return <Tooltip label={label} delayMs={500}><button type="button" className="dse-market-action" data-active={active || undefined} data-wide={wide || undefined} aria-label={label} aria-pressed={active} onClick={open}>
    {icon({ size: wide ? 16 : 18 })}{wide ? <span className="dse-market-action-label">{label}</span> : null}
  </button></Tooltip>
}

function CloudDrive({ loadDirectory, loadSharing, saveSharing, loadSpaces, loadFiles, searchFiles, createFolder, createUpload, commitUpload, downloadFile, updateNode, deleteNode, loadVersions, loadDescriptions, t }: CloudDriveProps): ReactNode {
  const [spaces, setSpaces] = useState<DriveSpaces>([])
  const [directory, setDirectory] = useState<DriveDirectory>()
  const [sharing, setSharing] = useState<DriveSharing>()
  const [sharingDraft, setSharingDraft] = useState<DriveSharingPolicy>()
  const [sharingOpen, setSharingOpen] = useState(false)
  const [recipientQuery, setRecipientQuery] = useState('')
  const [sharedView, setSharedView] = useState(false)
  const [inheritSharing, setInheritSharing] = useState(false)
  const [spaceId, setSpaceId] = useState<string>()
  const [parentId, setParentId] = useState<string | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string | null; name: string }>>([{ id: null, name: t('rootFolder') }])
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
  const pageRequest = useRef(0)
  const [activeQuery, setActiveQuery] = useState('')
  const loadPage = (nextSpace: string, nextParent: string | null, cursor?: string, shared = false, search = ''): void => {
    const request = ++pageRequest.current
    if (!cursor) setPage(undefined)
    const pending = search ? searchFiles(nextSpace, search, cursor, shared) : loadFiles(nextSpace, nextParent, cursor, shared)
    void pending.then((value) => {
      if (request !== pageRequest.current) return
      setPage(cursor ? current => current ? { ...value, items: [...current.items, ...value.items] } : value : value)
      setError(false)
    }, () => { if (request === pageRequest.current) setError(true) })
  }
  const reload = (nextSpace: string, nextParent: string | null, cursor?: string): void => {
    loadPage(nextSpace, nextParent, cursor, sharedView && nextParent === null, activeQuery)
  }
  useEffect(() => {
    let current = true
    void loadSpaces().then((value) => {
      if (!current) return
      setSpaces(value)
      const first = value[0]?.id
      if (first !== undefined) { setSpaceId(first); loadPage(first, null) }
    }, () => { if (current) setError(true) })
    return () => { current = false; pageRequest.current++ }
  }, [])
  useEffect(() => {
    let current = true
    void loadDirectory().then((value) => { if (current) setDirectory(value) }, () => { if (current) setError(true) })
    return () => { current = false }
  }, [])
  useEffect(() => {
    let current = true
    setSharing(undefined)
    setSharingDraft(undefined)
    setSharingOpen(false)
    setRecipientQuery('')
    setVersions([]); setDescriptions([]); setTextContent(undefined)
    if (selected?.kind === 'file') {
      void Promise.all([loadVersions(selected.id), loadDescriptions(selected.id, true)]).then(([nextVersions, nextDescriptions]) => {
        if (current) { setVersions(nextVersions); setDescriptions(nextDescriptions) }
      }, () => { if (current) setError(true) })
      if (/^(text\/|application\/(json|javascript|typescript)|application\/xml$)/u.test(selected.contentType) || /\.(md|txt|json|ts|tsx|js|css|html)$/iu.test(selected.name)) {
        void downloadFile(selected.id).then(result => fetch(result.url)).then((response) => {
          if (!response.ok) throw new Error('File preview failed')
          return response.text()
        }).then((value) => { if (current) setTextContent(value) }, () => { if (current) setError(true) })
      }
    }
    if (selected) void loadSharing(selected.id).then((value) => {
      if (current) { setSharing(value); setSharingDraft(value.policy); setInheritSharing(value.inheritedFrom !== null) }
    }, () => { if (current) setError(true) })
    return () => { current = false }
  }, [selected?.id])
  const submitSharing = (): void => {
    if (!selected || !sharingDraft || !sharing?.canManage) return
    const id = selected.id
    setBusy(true)
    void saveSharing(id, inheritSharing ? null : sharingDraft).then((value) => {
      setSharing(value); setSharingOpen(false)
      if (spaceId) reload(spaceId, parentId)
    }, () => { setError(true) }).finally(() => { setBusy(false) })
  }
  const changeSharingScope = (scope: DriveSharingPolicy['scope']): void => {
    setInheritSharing(false)
    setSharingDraft(current => current ? { ...current, scope, memberIds: [], departments: [] } : current)
  }
  const showShared = (): void => {
    const organization = spaces.find(space => space.kind === 'organization')
    if (!organization) return
    setSharedView(true); setSpaceId(organization.id); setParentId(null); setSelected(undefined); setQuery(''); setActiveQuery('')
    setBreadcrumbs([{ id: null, name: t('sharedWithMe') }])
    loadPage(organization.id, null, undefined, true)
  }
  const otherOrganizationSharing = sharing !== undefined && directory !== undefined && sharing.policy.organizationId !== directory.organizationId
  const canWrite = sharing !== undefined && sharing.role !== 'viewer'
  const recipientSearch = recipientQuery.trim().toLocaleLowerCase()
  const matchingDepartments = directory?.departments.filter(department => department.name.toLocaleLowerCase().includes(recipientSearch)) ?? []
  const matchingMembers = directory?.members.filter(member => member.name.toLocaleLowerCase().includes(recipientSearch)) ?? []
  const selectSpace = (id: string): void => { setSharedView(false); setSelected(undefined); setQuery(''); setActiveQuery(''); setSpaceId(id); setParentId(null); setBreadcrumbs([{ id: null, name: t('rootFolder') }]); loadPage(id, null) }
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
    if (!spaceId) return
    setActiveQuery(query.trim()); setSelected(undefined)
    loadPage(spaceId, parentId, undefined, sharedView, query.trim())
  }
  const selectFile = (file: DriveFile): void => {
    setSelected(file); setRenameName(file.name)
  }
  const saveText = (): void => {
    const currentSpace = selected?.spaceId
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
    const currentSpace = selected?.spaceId
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
    if (busy || renameDialogOpen || deleteDialogOpen || sharingOpen) return
    setSelected(undefined)
    setTextContent(undefined)
  }
  return <main className="dse-drive">
    <header className="dse-drive-header"><div><h2 className="dse-market-title">{t('cloudDrive')}</h2><p className="dse-market-intro">{t('cloudDriveIntro')}</p></div><div className="dse-drive-tabs" role="tablist">{spaces.map(space => <button type="button" role="tab" disabled={busy} aria-selected={!sharedView && space.id === spaceId} key={space.id} onClick={() => { selectSpace(space.id) }}>{space.kind === 'personal' ? t('personalSpace') : t('organizationSpace')}</button>)}<button type="button" role="tab" disabled={busy} aria-selected={sharedView} onClick={showShared}>{t('sharedWithMe')}</button></div></header>
    <p className="dse-drive-context dse-row-note">{directory?.organizationName} · {sharedView ? t('sharedWithMeHelp') : spaces.find(space => space.id === spaceId)?.kind === 'organization' ? t('organizationDriveHelp') : t('personalDriveHelp')}</p>
    {error ? <div className="dse-status dse-error" role="alert">{t('requestFailed')}</div> : null}
    <nav className="dse-drive-breadcrumbs" aria-label={t('breadcrumbs')}>{breadcrumbs.map((crumb, index) => <button type="button" key={crumb.id ?? 'root'} disabled={busy || index === breadcrumbs.length - 1} onClick={() => { if (spaceId) { if (sharedView && crumb.id === null) { showShared(); return }; setParentId(crumb.id); setBreadcrumbs(breadcrumbs.slice(0, index + 1)); reload(spaceId, crumb.id) } }}>{crumb.name}</button>)}</nav>
    <section className="dse-drive-toolbar"><span>{page?.summary.parentId ? t('folderContents') : t('rootFolder')}</span><div className="dse-inline-form"><input aria-label={t('searchFiles')} value={query} disabled={busy} placeholder={t('searchFiles')} onChange={(event) => { setQuery(event.currentTarget.value) }} onKeyDown={(event) => { if (event.key === 'Enter') submitSearch() }} /><Button size="sm" disabled={busy || !query.trim()} onClick={submitSearch}>{t('search')}</Button><Button size="sm" variant="outline" onClick={() => { setViewMode(viewMode === 'list' ? 'grid' : 'list') }}>{viewMode === 'list' ? t('gridView') : t('listView')}</Button><input ref={fileInput} className="dse-file-input" type="file" aria-label={t('uploadFile')} disabled={busy} onChange={submitUpload} /><Button size="sm" disabled={busy || !spaceId || sharedView} onClick={() => { fileInput.current?.click() }}>{t('uploadFile')}</Button><input aria-label={t('newFolder')} value={folderName} disabled={busy} placeholder={t('newFolder')} onChange={(event) => { setFolderName(event.currentTarget.value) }} /><Button size="sm" disabled={busy || !folderName.trim() || sharedView} onClick={submitFolder}>{t('createFolder')}</Button></div></section>
    <section className="dse-drive-list" data-view={viewMode} aria-label={t('files')}>
      {page?.items.length ? page.items.map(file => <div key={file.id} className="dse-drive-item"><button type="button" className="dse-drive-row" disabled={busy} data-selected={selected?.id === file.id || undefined} key={file.id} onClick={() => { if (file.kind === 'folder' && spaceId) { setSpaceId(file.spaceId); setParentId(file.id); setBreadcrumbs([...breadcrumbs, { id: file.id, name: file.name }]); setSelected(undefined); reload(file.spaceId, file.id) } else selectFile(file) }}><span className="dse-drive-name"><IconFolderOpenOutline16 size={18} /><strong>{file.name}</strong></span><span className="dse-row-note">{file.sharing === null ? (file.parentId === null ? t('privateSharing') : t('inheritedSharing')) : file.sharing.scope === 'organization' ? t('wholeOrganization') : file.sharing.scope === 'selected' ? t('selectedRecipients') : t('privateSharing')}</span><span className="dse-row-note">{file.kind === 'folder' ? t('folder') : `${file.contentType} · ${file.size.toLocaleString()} ${t('bytes')}`}</span></button><Button size="sm" variant="outline" aria-label={t('fileDetailsFor', { name: file.name })} onClick={() => { selectFile(file) }}>{t('details')}</Button></div>) : <p className="dse-status">{t('emptyFolder')}</p>}
      {page?.nextCursor && spaceId ? <Button size="sm" variant="outline" onClick={() => { reload(spaceId, parentId, page.nextCursor ?? undefined) }}>{t('loadMore')}</Button> : null}
    </section>
    {selected ? <><button type="button" className="dse-drive-drawer-overlay" aria-label={t('closeDetails')} onClick={closeDetails} /><aside className="dse-drive-details" aria-label={t('details')} onClick={(event) => { event.stopPropagation() }}><div className="dse-drive-detail-head"><div className="dse-drive-detail-title"><IconFolderOpenOutline16 size={18} /><strong title={selected.name}>{selected.name}</strong></div><button type="button" className="dse-drive-icon-button" aria-label={t('closeDetails')} onClick={closeDetails}><IconCloseOutline16 size={16} /></button></div><div className="dse-drive-detail-meta"><span>{selected.kind === 'folder' ? t('folder') : selected.contentType}</span>{selected.kind === 'file' ? <span>{selected.size.toLocaleString()} B</span> : null}</div><section className="dse-drive-sharing-summary">
      <div className="dse-sharing-summary-heading"><h3>{t('sharingScope')}</h3>{sharing?.canManage ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setRecipientQuery(''); setSharingDraft(otherOrganizationSharing ? { organizationId: directory.organizationId, scope: 'private', permission: 'viewer', memberIds: [], departments: [] } : sharing.policy); setInheritSharing(!otherOrganizationSharing && sharing.inheritedFrom !== null); setSharingOpen(true) }}>{t('manageAccess')}</Button> : null}</div>
      {sharing ? <>
        <p className="dse-sharing-summary-audience">{otherOrganizationSharing ? t('otherOrganizationSharing') : sharing.policy.scope === 'organization' ? t('organizationAudience', { name: directory?.organizationName ?? '' }) : sharing.policy.scope === 'private' ? t('privateSharing') : t('selectedRecipients')}</p>
        {sharing.policy.scope === 'selected' ? <ul className="dse-sharing-summary-recipients">{sharing.policy.departments.map(item => <li key={item.id}><IconFolderOpenOutline16 size={14} /><span>{directory?.departments.find(department => department.id === item.id)?.name ?? t('unavailableRecipient')}{item.includeDescendants ? ` · ${t('includeSubdepartments')}` : ''}</span></li>)}{sharing.policy.memberIds.map(id => <li key={id}><IconUserOutline16 size={14} /><span>{directory?.members.find(member => member.id === id)?.name ?? t('unavailableRecipient')}</span></li>)}</ul> : null}
        <p className="dse-sharing-summary-meta">{t('sharingAudienceCount', { count: String(sharing.audienceCount) })}</p>
        <div className="dse-sharing-summary-access"><span>{t('yourAccess')}</span><span>{sharing.role === 'viewer' ? t('sharingViewer') : sharing.role === 'member' ? t('sharingEditor') : t('sharingManager')}</span></div>
        {sharing.inheritedFrom ? <p className="dse-sharing-hint">{t('inheritedSharing')}</p> : null}
        {spaces.find(space => space.id === selected.spaceId)?.kind === 'organization' ? <p className="dse-sharing-hint">{t('organizationManagerAccess')}</p> : null}
      </> : <p className="dse-sharing-hint">{t('loading')}</p>}
    </section><div className="dse-drive-detail-actions">{selected.kind === 'file' && textContent === undefined ? <Button size="sm" disabled={!canWrite} onClick={openOffice}>{t('openFile')}</Button> : null}{selected.kind === 'file' ? <Button size="sm" variant="outline" icon={<IconDownloadOutline16 size={14} />} onClick={downloadSelected}>{t('downloadFile')}</Button> : null}<Button size="sm" variant="outline" icon={<IconEditOutline16 size={14} />} disabled={busy || !canWrite} onClick={() => { setRenameName(selected.name); setRenameDialogOpen(true) }}>{t('rename')}</Button><Button size="sm" variant="outline" icon={<IconTrashOutline16 size={14} />} disabled={busy || !canWrite} onClick={() => { setDeleteDialogOpen(true) }}>{t('deleteFile')}</Button></div>{selected.kind === 'file' ? <><h3>{t('fileInfo')}</h3><dl className="dse-drive-detail-facts"><div><dt>{t('fileType')}</dt><dd>{selected.contentType}</dd></div><div><dt>{t('fileSize')}</dt><dd>{selected.size.toLocaleString()} B</dd></div><div><dt>{t('modifiedAt')}</dt><dd>{selected.updatedAt}</dd></div></dl><h3>{t('versions')}</h3><ul className="dse-drive-detail-list">{versions.map(version => <li key={version.id}><span>{version.id === selected.versionId ? t('currentVersion') : t('version')} · {version.contentType} · {version.size.toLocaleString()} B</span></li>)}</ul>{textContent !== undefined ? <><textarea className="dse-drive-editor" readOnly={!canWrite} value={textContent} onChange={(event) => { setTextContent(event.currentTarget.value) }} /><Button size="sm" disabled={!canWrite || busy} onClick={saveText}>{t('save')}</Button></> : null}<h3>{t('descriptions')}</h3>{descriptions.length ? <ul className="dse-drive-detail-list">{descriptions.map(description => <li key={description.id}>{description.type}: {description.content}{description.versionId !== selected.versionId ? ` (${t('staleDescription')})` : ''}</li>)}</ul> : <p className="dse-status">{t('noDescriptions')}</p>}</> : null}</aside></> : null}
    <Modal headless className="dse-sharing-modal" open={sharingOpen && selected !== undefined} onClose={() => { if (!busy) setSharingOpen(false) }} title={t('manageAccess')}>
      <header className="dse-sharing-header">
        <div><h2>{t('manageAccess')}</h2><p title={selected?.name}>{selected?.name}</p></div>
        <button type="button" className="dse-drive-icon-button" disabled={busy} aria-label={t('closeDetails')} onClick={() => { setSharingOpen(false) }}><IconCloseOutline16 size={16} /></button>
      </header>
      <div className="dse-sharing-body">
        {sharingDraft && directory ? <div className="dse-drive-sharing">
          {otherOrganizationSharing ? <p className="dse-sharing-notice" role="note">{t('replaceOtherOrganizationSharing')}</p> : null}
          {selected?.parentId ? <label className="dse-sharing-check-row"><input type="checkbox" checked={inheritSharing} disabled={busy} onChange={(event) => { setInheritSharing(event.currentTarget.checked) }} /><span>{t('inheritFolderSharing')}</span></label> : null}
          <fieldset className="dse-sharing-section" disabled={busy || inheritSharing}>
            <legend>{t('sharingScope')}</legend>
            <p className="dse-sharing-hint">{t('sharingHelp')}</p>
            <div className="dse-sharing-scopes">
              {(['private', 'selected', 'organization'] as const).map(scope => <label className="dse-sharing-scope" key={scope}>
                <input type="radio" name="drive-sharing-scope" checked={sharingDraft.scope === scope} onChange={() => { changeSharingScope(scope) }} />
                <span>{scope === 'private' ? t('privateSharing') : scope === 'selected' ? t('selectedRecipients') : t('organizationAudience', { name: directory.organizationName })}</span>
              </label>)}
            </div>
          </fieldset>
          {sharingDraft.scope === 'selected' && !inheritSharing ? <section className="dse-sharing-recipients">
            <div className="dse-sharing-recipient-toolbar"><Input className="dse-sharing-search" icon={<IconSearchOutline16 size={16} />} aria-label={t('searchRecipients')} placeholder={t('searchRecipients')} value={recipientQuery} disabled={busy} onChange={(event) => { setRecipientQuery(event.currentTarget.value) }} /><Button size="sm" variant="ghost" disabled={busy || !directory.myDepartmentIds.some(id => directory.departments.some(department => department.id === id))} onClick={() => { setSharingDraft({ ...sharingDraft, departments: directory.departments.filter(department => directory.myDepartmentIds.includes(department.id)).map(department => ({ id: department.id, includeDescendants: false })) }) }}>{t('myDepartments')}</Button></div>
            <div className="dse-sharing-recipient-columns">
              <fieldset className="dse-sharing-section dse-sharing-recipient-section" disabled={busy}>
                <legend>{t('sharingDepartments')}<span className="dse-sharing-count">{sharingDraft.departments.length}</span></legend>
                <div className="dse-sharing-recipient-list">
                  {matchingDepartments.map((department) => {
                    const grant = sharingDraft.departments.find(item => item.id === department.id)
                    return <div className="dse-sharing-department" key={department.id}>
                      <label className="dse-sharing-check-row"><input type="checkbox" checked={grant !== undefined} onChange={(event) => { setSharingDraft({ ...sharingDraft, departments: event.currentTarget.checked ? [...sharingDraft.departments, { id: department.id, includeDescendants: false }] : sharingDraft.departments.filter(item => item.id !== department.id) }) }} /><span>{department.name}</span></label>
                      {grant ? <label className="dse-sharing-check-row dse-sharing-descendants"><input type="checkbox" checked={grant.includeDescendants} onChange={(event) => { setSharingDraft({ ...sharingDraft, departments: sharingDraft.departments.map(item => item.id === department.id ? { ...item, includeDescendants: event.currentTarget.checked } : item) }) }} /><span>{t('includeSubdepartments')}</span></label> : null}
                    </div>
                  })}
                  {matchingDepartments.length === 0 ? <p className="dse-sharing-empty">{t('noMatchingRecipients')}</p> : null}
                </div>
              </fieldset>
              <fieldset className="dse-sharing-section dse-sharing-recipient-section" disabled={busy}>
                <legend>{t('sharingMembers')}<span className="dse-sharing-count">{sharingDraft.memberIds.length}</span></legend>
                <div className="dse-sharing-recipient-list">
                  {matchingMembers.map(member => <label className="dse-sharing-check-row" key={member.id}><input type="checkbox" checked={sharingDraft.memberIds.includes(member.id)} onChange={(event) => { setSharingDraft({ ...sharingDraft, memberIds: event.currentTarget.checked ? [...sharingDraft.memberIds, member.id] : sharingDraft.memberIds.filter(id => id !== member.id) }) }} /><span>{member.name}</span></label>)}
                  {matchingMembers.length === 0 ? <p className="dse-sharing-empty">{t('noMatchingRecipients')}</p> : null}
                </div>
              </fieldset>
            </div>
            <p className="dse-sharing-hint">{t('departmentSharingHelp')}</p>
          </section> : null}
          {sharingDraft.scope !== 'private' ? <label className="dse-sharing-permission"><span>{t('sharingPermission')}</span><span className="dse-sharing-select"><select disabled={busy || inheritSharing} value={sharingDraft.permission} onChange={(event) => { setSharingDraft({ ...sharingDraft, permission: event.currentTarget.value as 'viewer' | 'member' }) }}><option value="viewer">{t('sharingViewer')}</option><option value="member">{t('sharingEditor')}</option></select><IconChevronDownOutline14 size={14} /></span></label> : null}
          {spaces.find(space => space.id === selected?.spaceId)?.kind === 'organization' ? <p className="dse-sharing-hint">{t('organizationManagerAccess')}</p> : null}
        </div> : null}
      </div>
      <footer className="dse-sharing-footer"><Button variant="outline" disabled={busy} onClick={() => { setSharingOpen(false) }}>{t('cancel')}</Button><Button variant="primary" disabled={busy || !sharingDraft || (!inheritSharing && sharingDraft.scope === 'selected' && sharingDraft.memberIds.length + sharingDraft.departments.length === 0)} onClick={submitSharing}>{t('save')}</Button></footer>
    </Modal>
    <Modal open={renameDialogOpen && selected !== undefined} onClose={() => { if (!busy) setRenameDialogOpen(false) }} title={t('renameFile')} description={t('renameFileMessage')} closeLabel={t('closeDetails')} footer={<><Button size="sm" variant="outline" disabled={busy} onClick={() => { setRenameDialogOpen(false) }}>{t('cancel')}</Button><Button size="sm" disabled={busy || !renameName.trim()} onClick={saveRename}>{t('save')}</Button></>}><input className="dse-modal-input" autoFocus value={renameName} disabled={busy} aria-label={t('rename')} onChange={(event) => { setRenameName(event.currentTarget.value) }} /></Modal>
    <Modal open={deleteDialogOpen && selected !== undefined} onClose={() => { if (!busy) setDeleteDialogOpen(false) }} title={t('confirmDelete')} {...(selected === undefined ? {} : { description: t('confirmDeleteMessage', { name: selected.name }) })} closeLabel={t('closeDetails')} footer={<><Button size="sm" variant="outline" disabled={busy} onClick={() => { setDeleteDialogOpen(false) }}>{t('cancel')}</Button><Button size="sm" disabled={busy} onClick={removeSelected}>{t('deleteFile')}</Button></>} />
  </main>
}

export function PluginMarket({
  uploadVisibilities,
  usePluginRevision,
  loadDashboard,
  loadPlugins,
  loadPluginInstallations,
  loadPluginDeviceTargets,
  loadPluginDiagnostics,
  uploadPlugin,
  installPlugin,
  upgradePlugin,
  uninstallPlugin,
  forceRemovePlugin,
  setPluginEnabled,
  loadPluginSettings, configurePluginSettings, loadConnectionSettings, configureConnection, authorizeConnection, authorizationStatus,
  t,
}: PluginMarketProps): ReactNode {
  const [settingsId, setSettingsId] = useState<string>()
  const [settings, setSettings] = useState<z.infer<typeof pluginSettings>>()
  const [settingsValues, setSettingsValues] = useState<Record<string, string | boolean>>({})
  const [settingsSecrets, setSettingsSecrets] = useState<Record<string, string>>({})
  const [settingsError, setSettingsError] = useState<string>()
  const [settingsSaving, setSettingsSaving] = useState(false)
  const settingsGeneration = useRef(0)
  const closeSettings = (): void => {
    settingsGeneration.current += 1
    setSettingsId(undefined); setSettings(undefined); setSettingsSecrets({}); setSettingsSaving(false)
  }
  const openSettings = (installationId: string): void => {
    const generation = ++settingsGeneration.current
    setSettingsId(installationId); setSettings(undefined); setSettingsSecrets({}); setSettingsError(undefined); setSettingsSaving(false)
    void loadPluginSettings?.(installationId).then((value) => {
      if (generation !== settingsGeneration.current) return
      setSettings(value)
      setSettingsValues(Object.fromEntries(value.specification.fields.map((field) => {
        const saved = value.config[field.name]
        return [field.name, field.type === 'boolean' ? saved === true : field.type === 'string-list' ? (Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string').join('\n') : '') : typeof saved === 'string' || typeof saved === 'number' ? String(saved) : '']
      })))
    }, () => { if (generation === settingsGeneration.current) setSettingsError(t('requestFailed')) })
  }
  const saveSettings = (): void => {
    if (!settings || !configurePluginSettings || settingsSaving) return
    const generation = settingsGeneration.current
    const config = Object.fromEntries(settings.specification.fields.map((field) => {
      const value = settingsValues[field.name]
      return [field.name, field.type === 'number' && value !== '' ? Number(value) : field.type === 'string-list' ? String(value ?? '').split('\n').map(item => item.trim()).filter(Boolean) : value ?? '']
    }))
    setSettingsSaving(true); setSettingsError(undefined)
    void configurePluginSettings({ installationId: settings.installationId, config, credentials: Object.fromEntries(Object.entries(settingsSecrets).filter(([, value]) => value.length > 0)) }).then(() => {
      if (generation !== settingsGeneration.current) return
      closeSettings(); reload()
    }, (error: unknown) => {
      if (generation === settingsGeneration.current) setSettingsError(error instanceof Error && error.message.includes('plugin/not-configured:') ? `${t('pluginConfigurationRequired')} ${error.message.split('plugin/not-configured:')[1]}` : t('requestFailed'))
    }).finally(() => { if (generation === settingsGeneration.current) setSettingsSaving(false) })
  }
  useEffect(() => () => { settingsGeneration.current += 1 }, [])
  const [connection, setConnection] = useState<z.infer<typeof pluginConnectionSettings>>()
  const [connectionId, setConnectionId] = useState<string>()
  const [connectionToken, setConnectionToken] = useState('')
  const [connectionUrl, setConnectionUrl] = useState('')
  const [authorizationUrl, setAuthorizationUrl] = useState<string>()
  const [connectionError, setConnectionError] = useState<string>()
  const [authorizing, setAuthorizing] = useState(false)
  const [connectionSaving, setConnectionSaving] = useState(false)
  const connectionGeneration = useRef(0)
  const cancelAuthorization = useRef<(() => void) | undefined>(undefined)
  const authorizationCleanup = useRef(new Map<string, Promise<void>>())
  const [plugins, setPlugins] = useState<EnterprisePluginCatalog>([])
  const [installations, setInstallations] = useState<EnterprisePluginInstallations>([])
  const [deviceTargets, setDeviceTargets] = useState<EnterprisePluginDeviceTargets>([])
  const [diagnostics, setDiagnostics] = useState<ReturnType<typeof enterprisePluginCapabilityDiagnostics.parse>>([])
  const [diagnosticsUnavailable, setDiagnosticsUnavailable] = useState(false)
  const [diagnosticsError, setDiagnosticsError] = useState<string>()
  const [dashboard, setDashboard] = useState<Awaited<ReturnType<PluginMarketInjected['loadDashboard']>>>()
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [visibility, setVisibility] = useState<'private' | 'organization' | 'platform'>('private')
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set())
  const [selectedFile, setSelectedFile] = useState<string>()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'installed' | 'updates'>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'work' | 'mcp' | 'skill'>('all')
  const [sortOrder, setSortOrder] = useState<'recent' | 'name'>('recent')
  const [forceRemoveInstallationId, setForceRemoveInstallationId] = useState<string>()
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>()
  const fileInput = useRef<HTMLInputElement>(null)
  const revision = usePluginRevision(value => value)
  const readGeneration = useRef(0)
  const reload = (showLoading = false): void => {
    const generation = ++readGeneration.current
    if (showLoading) setState('loading')
    const targetState = loadPluginDeviceTargets === undefined
      ? Promise.resolve<EnterprisePluginDeviceTargets>([])
      : loadPluginDeviceTargets()
    const diagnosticState = loadPluginDiagnostics === undefined
      ? Promise.resolve({ value: [] as ReturnType<typeof enterprisePluginCapabilityDiagnostics.parse>, unavailable: false, error: undefined })
      : loadPluginDiagnostics().then(value => ({ value, unavailable: false, error: undefined }), (error: unknown) => ({ value: undefined, unavailable: true, error: error instanceof Error ? error.message : undefined }))
    void Promise.all([loadDashboard(), loadPlugins(), loadPluginInstallations(), targetState, diagnosticState]).then(([account, catalog, installed, targets, capabilityState]) => {
      if (generation !== readGeneration.current) return
      setDashboard(account); setPlugins(catalog); setInstallations(installed); setDeviceTargets(targets)
      if (capabilityState.value !== undefined) setDiagnostics(capabilityState.value)
      setDiagnosticsUnavailable(capabilityState.unavailable); setDiagnosticsError(capabilityState.error); setState('ready')
    }, () => { if (generation === readGeneration.current) setState('error') })
  }
  useEffect(() => {
    reload()
    return () => { ++readGeneration.current }
  }, [revision])
  useEffect(() => () => {
    ++connectionGeneration.current
    cancelAuthorization.current?.()
  }, [])
  const openConnection = (installationId: string): void => {
    if (!loadConnectionSettings) return
    const generation = ++connectionGeneration.current
    cancelAuthorization.current?.()
    cancelAuthorization.current = undefined
    setAuthorizing(false); setConnectionSaving(false)
    setConnectionId(installationId); setConnection(undefined); setConnectionToken(''); setConnectionUrl(''); setConnectionError(undefined); setAuthorizationUrl(undefined)
    void loadConnectionSettings(installationId).then((value) => {
      if (generation !== connectionGeneration.current) return
      setConnection(value); setConnectionUrl(value.customUrl ?? '')
    }, () => { if (generation === connectionGeneration.current) setConnectionError(t('requestFailed')) })
  }
  const closeConnection = (): void => {
    ++connectionGeneration.current
    cancelAuthorization.current?.()
    cancelAuthorization.current = undefined
    setConnectionId(undefined); setConnection(undefined); setConnectionToken(''); setAuthorizationUrl(undefined); setAuthorizing(false); setConnectionSaving(false)
  }
  const openAuthorizationUrl = (url: string): void => {
    const fallback = (): void => { window.open(url, '_blank', 'noopener,noreferrer') }
    const opener = (window as EnterpriseWindow).__dshNative?.openExternal
    if (opener) void opener({ url }).then((opened) => { if (!opened) fallback() }).catch(fallback)
    else fallback()
  }
  const authorizationMessage = (error: unknown): string => {
    const code = error instanceof Error ? error.message : error
    switch (code) {
      case 'plugin/authorization-discovery-failed': return t('pluginAuthorizationDiscoveryFailed')
      case 'plugin/authorization-registration-failed': return t('pluginAuthorizationRegistrationFailed')
      case 'plugin/authorization-exchange-failed': return t('pluginAuthorizationExchangeFailed')
      case 'plugin/authorization-denied': return t('pluginAuthorizationDenied')
      case 'plugin/authorization-cancelled': return t('pluginAuthorizationCancelled')
      default: return t('pluginAuthorizationFailed')
    }
  }
  const saveConnection = (): void => {
    if (!connection || !configureConnection || connectionSaving || authorizing) return
    setConnectionError(undefined); setConnectionSaving(true)
    const id = connection.installationId
    const generation = connectionGeneration.current
    if (connection.connection.auth === 'oauth' && authorizeConnection) {
      const previousCleanup = authorizationCleanup.current.get(id)
      let started = false
      const request = (async () => {
        await previousCleanup
        if (generation !== connectionGeneration.current) return undefined
        started = true
        return authorizeConnection(id)
      })()
      // Cancellation waits for discovery to register its Host flow before withdrawing it.
      cancelAuthorization.current = () => {
        const cleanup = request.then(async () => {
          if (started) await authorizationStatus?.(id, true)
        }, () => {}).catch(() => {})
        authorizationCleanup.current.set(id, cleanup)
        void cleanup.finally(() => { if (authorizationCleanup.current.get(id) === cleanup) authorizationCleanup.current.delete(id) })
      }
      void request.then((value) => {
        if (generation !== connectionGeneration.current || value === undefined) return
        setConnectionSaving(false)
        if (value.url) {
          setAuthorizing(true)
          setAuthorizationUrl(value.url)
          openAuthorizationUrl(value.url)
        }
        else { closeConnection(); reload() }
      }, (error: unknown) => {
        if (generation !== connectionGeneration.current) return
        cancelAuthorization.current = undefined
        setConnectionSaving(false); setConnectionError(authorizationMessage(error))
      })
      return
    }
    const input = { installationId: id, ...(connection.connection.url === undefined ? { url: connectionUrl } : {}), ...(connectionToken ? { token: connectionToken } : {}) }
    setConnectionToken('')
    void configureConnection(input).then(() => {
      if (generation !== connectionGeneration.current) return
      closeConnection(); reload()
    }, () => { if (generation === connectionGeneration.current) { setConnectionSaving(false); setConnectionError(t('requestFailed')) } })
  }
  useEffect(() => {
    if (!connectionId || !authorizing || !authorizationStatus) return
    const generation = connectionGeneration.current
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = (): void => {
      void authorizationStatus(connectionId).then((value) => {
        if (disposed || generation !== connectionGeneration.current) return
        if (value.complete) { cancelAuthorization.current = undefined; closeConnection(); reload() }
        else if (value.error) { cancelAuthorization.current = undefined; setAuthorizing(false); setConnectionError(authorizationMessage(value.error)) }
        else timer = setTimeout(poll, 1000)
      }, () => { if (!disposed && generation === connectionGeneration.current) { cancelAuthorization.current?.(); cancelAuthorization.current = undefined; setAuthorizing(false); setConnectionError(t('pluginAuthorizationFailed')) } })
    }
    poll()
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
    }
  }, [connectionId, authorizing, authorizationStatus])
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
  const canManageInstallation = (installationId: string): boolean => {
    const installation = installations.find(item => item.id === installationId)
    return installation?.ownerKind !== 'organization' || dashboard?.capabilities?.manageOrganizationPlugins === true
  }
  const onUpload = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    if (visibility !== 'private' && dashboard?.capabilities?.publishPlugins !== true) {
      setNotice({ kind: 'error', text: t('pluginPublishPermissionDenied') })
      if (fileInput.current) fileInput.current.value = ''
      return
    }
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
    void installPlugin(releaseId).then((result: unknown) => { const installed = z.object({ id: z.string() }).loose().safeParse(result); if (installed.success) { const plugin = plugins.find(item => item.id === releaseId); if (plugin?.setupKind === 'mcp') openConnection(installed.data.id); else if (plugin?.setupKind === 'configuration' && loadPluginSettings) openSettings(installed.data.id) } setNotice({ kind: 'success', text: t('installComplete') }); reload() }, () => { setNotice({ kind: 'error', text: t('requestFailed') }) }).finally(() => { endBusy(key) })
  }
  const onToggle = (installationId: string, enabled: boolean): void => {
    if (!canManageInstallation(installationId)) { setNotice({ kind: 'error', text: t('pluginPermissionDenied') }); return }
    beginBusy(installationId)
    void setPluginEnabled(installationId, enabled).then(() => { reload() }, () => { setNotice({ kind: 'error', text: t('requestFailed') }) }).finally(() => { endBusy(installationId) })
  }
  const onUpgrade = (installationId: string, releaseId: string): void => {
    if (!canManageInstallation(installationId)) { setNotice({ kind: 'error', text: t('pluginPermissionDenied') }); return }
    beginBusy(installationId); setNotice(undefined)
    void upgradePlugin(installationId, releaseId).then(() => {
      setNotice({ kind: 'success', text: t('upgradeComplete') }); reload()
      const plugin = plugins.find(item => item.id === releaseId)
      if (plugin?.setupKind === 'mcp') openConnection(installationId)
      else if (plugin?.setupKind === 'configuration' && loadPluginSettings) openSettings(installationId)
    }, () => { setNotice({ kind: 'error', text: t('requestFailed') }) }).finally(() => { endBusy(installationId) })
  }
  const onUninstall = (installationId: string): void => {
    if (!canManageInstallation(installationId)) { setNotice({ kind: 'error', text: t('pluginPermissionDenied') }); return }
    beginBusy(installationId); setNotice(undefined)
    void uninstallPlugin(installationId).then(() => { setNotice({ kind: 'success', text: t('uninstallStarted') }); reload() }, () => { setNotice({ kind: 'error', text: t('requestFailed') }) }).finally(() => { endBusy(installationId) })
  }
  const onForceRemove = (installationId: string): void => {
    if (!canManageInstallation(installationId)) { setForceRemoveInstallationId(undefined); setNotice({ kind: 'error', text: t('pluginPermissionDenied') }); return }
    beginBusy(installationId); setNotice(undefined)
    void forceRemovePlugin(installationId).then(() => { setForceRemoveInstallationId(undefined); setNotice({ kind: 'success', text: t('forceRemovePluginComplete') }); reload() }, (error: unknown) => {
      const message = error instanceof Error ? error.message.trim() : ''
      setNotice({ kind: 'error', text: message ? `${t('requestFailed')} ${message}` : t('requestFailed') })
    }).finally(() => { endBusy(installationId) })
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
  const pluginCategory = (plugin: EnterprisePluginCatalog[number]): 'work' | 'mcp' | 'skill' => {
    return plugin.category ?? (plugin.setupKind === 'mcp' ? 'mcp' : 'work')
  }
  const filteredPlugins = availablePlugins
    .filter((plugin) => {
      const installation = installedFor(plugin)
      const newer = installation !== undefined && installation.releaseId !== plugin.id
      const query = searchQuery.trim().toLocaleLowerCase()
      const text = `${plugin.name ?? ''} ${plugin.description ?? ''} ${plugin.pluginId}`.toLocaleLowerCase()
      return (statusFilter === 'all' || (statusFilter === 'installed' ? installation !== undefined : newer))
        && (categoryFilter === 'all' || pluginCategory(plugin) === categoryFilter)
        && (!query || text.includes(query))
    })
    .sort((left, right) => sortOrder === 'name'
      ? (left.name ?? left.pluginId).localeCompare(right.name ?? right.pluginId)
      : right.publishedAt.localeCompare(left.publishedAt))
  return <main className="dse-market">
    <header className="dse-market-header">
      <div><h2 className="dse-market-title">{t('pluginMarket')}</h2><p className="dse-market-intro">{t('pluginMarketIntro')}</p></div>
      <div className="dse-market-header-actions">
        <Tooltip label={t('refreshPlugins')}><button type="button" className="dse-market-refresh" aria-label={t('refreshPlugins')} onClick={() => { reload() }}><IconRefreshOutline16 /></button></Tooltip>
      </div>
    </header>
    <section className="dse-market-upload" aria-labelledby="dse-market-upload-title">
      <div className="dse-market-upload-body">
        <div className="dse-market-upload-heading"><span className="dse-market-upload-icon" aria-hidden="true"><IconArchiveOutline20 size={20} /></span><div><h3 id="dse-market-upload-title">{t('uploadPlugin')}</h3><p>{t('uploadPluginHelp')}</p></div></div>
        <div className="dse-market-upload-controls">
          <label className="dse-market-visibility"><span>{t('visibility')}</span><select value={visibility} disabled={busy} onChange={(event) => { setVisibility(event.currentTarget.value as typeof visibility) }}><option value="private">{t('privateVisibility')}</option>{dashboard?.capabilities?.publishPlugins ? <>{(!uploadVisibilities || uploadVisibilities.includes('organization')) && <option value="organization">{t('organizationVisibility')}</option>}<option value="platform">{t('platformVisibility')}</option></> : null}</select></label>
          <input ref={fileInput} className="dse-file-input" aria-label={t('pluginPackageFile')} type="file" accept=".zip,application/zip" disabled={busy} onChange={onUpload} />
          <Button size="md" variant="primary" aria-label={t('selectPluginPackage')} disabled={busy} onClick={() => { fileInput.current?.click() }} icon={<IconArchiveOutline20 size={15} />}>{busy ? t('uploadingPlugin') : t('uploadPlugin')}</Button>
        </div>
      </div>
      {selectedFile ? <p className="dse-market-filename" title={selectedFile}>{selectedFile}</p> : null}
    </section>
    {notice ? <p className={notice.kind === 'error' ? 'dse-market-notice dse-error' : 'dse-market-notice'} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p> : null}
    {diagnosticsUnavailable ? <p className="dse-error" role="alert">{t('pluginDiagnosticsUnavailable')} {diagnosticsError}</p> : null}
    <section className="dse-market-catalog" aria-labelledby="dse-market-catalog-title">
      <div className="dse-market-catalog-heading"><div><h3 id="dse-market-catalog-title">{t('availablePlugins')}</h3><span>{t('pluginCount', { count: filteredPlugins.length })}</span></div></div>
      <div className="dse-market-toolbar"><div className="dse-market-tabs" role="tablist">{(['all', 'installed', 'updates'] as const).map(filter => <button type="button" role="tab" disabled={busy} aria-selected={statusFilter === filter} key={filter} onClick={() => { setStatusFilter(filter) }}>{t(filter === 'all' ? 'allPlugins' : filter === 'installed' ? 'installedPlugins' : 'updatablePlugins')}</button>)}</div><label className="dse-market-search"><IconSearchOutline16 size={15} /><input aria-label={t('searchPlugins')} placeholder={t('searchPlugins')} value={searchQuery} onChange={(event) => { setSearchQuery(event.currentTarget.value) }} /></label></div>
      <div className="dse-market-body"><aside className="dse-market-filter" aria-label={t('pluginType')}><span className="dse-market-filter-title">{t('pluginType')}</span>{(['all', 'work', 'mcp', 'skill'] as const).map(filter => <button type="button" className={categoryFilter === filter ? 'dse-market-filter-option is-active' : 'dse-market-filter-option'} key={filter} aria-pressed={categoryFilter === filter} onClick={() => { setCategoryFilter(filter) }}>{t(filter === 'all' ? 'allTypes' : filter === 'work' ? 'workTools' : filter === 'mcp' ? 'mcpServices' : 'skillWorkflows')}</button>)}</aside><div className="dse-market-results"><label className="dse-market-sort"><span>{t('sortPlugins')}</span><select value={sortOrder} onChange={(event) => { setSortOrder(event.currentTarget.value as typeof sortOrder) }}><option value="recent">{t('recentlyPublished')}</option><option value="name">{t('sortByName')}</option></select></label>{filteredPlugins.length === 0 ? <div className="dse-market-empty"><IconCordisPluginOutline14 size={20} /><p>{t('noPlugins')}</p></div> : <div className="dse-market-list">{filteredPlugins.map((plugin) => { const installation = installedFor(plugin); const newer = installation !== undefined && installation.releaseId !== plugin.id; const operationKey = installation?.id ?? `release:${plugin.id}`; const targets = installation === undefined ? [] : deviceTargets.filter(target => target.installationId === installation.id); const runtime = installation === undefined ? [] : diagnostics.filter(item => item.installationId === installation.id); const missingCapability = runtime.flatMap(item => [...item.tools.names.filter(name => !item.tools.present.includes(name)), ...item.skills.names.filter(name => !item.skills.present.includes(name)), ...item.mcpTools.names.filter(name => !item.mcpTools.present.includes(name)), ...item.presets.filter(preset => !preset.present).map(preset => `preset:${preset.id}`), ...item.clientSlots.filter(slot => !slot.present).map(slot => `slot:${slot.id}`)])[0]; const runtimeError = runtime.flatMap(item => [...item.mcpServers.filter(server => server.state !== 'connected').map(server => server.lastError ?? server.serverName), ...item.clientWindows.filter(client => client.mountState === 'failed').map(client => client.lastError ?? client.windowId)])[0]; const runtimeState = runtime.some(item => item.state === 'stale') || targets.some(target => target.observedState === 'failed' || target.observedState === 'cleanup-failed') ? 'failed' : diagnosticsUnavailable ? 'unknown' : undefined; const currentState = runtimeState ?? targets.find(target => target.observedState === 'active')?.observedState ?? installation?.observedState; const stopping = installation?.observedState === 'stopping'; const changing = stopping || installation?.observedState === 'preparing'; const enabled = installation?.desiredState === 'enabled'; const lastError = missingCapability === undefined ? runtimeError ?? targets.find(target => target.lastError)?.lastError ?? installation?.lastError : t('capabilityMissing', { capability: missingCapability }); const operationBusy = pluginBusy(operationKey); const canManage = installation?.ownerKind !== 'organization' || dashboard?.capabilities?.manageOrganizationPlugins === true; return <article className="dse-market-row" key={plugin.pluginId}>
        <div className="dse-market-plugin-main">
          <div className="dse-market-plugin-head">
            <div className="dse-market-plugin-name"><PluginIcon key={plugin.icon} name={plugin.name ?? plugin.pluginId} icon={plugin.icon} /><div><h4>{plugin.name ?? plugin.pluginId}</h4><p className="dse-market-plugin-id">{plugin.pluginId}</p></div></div>
            <span className="dse-market-plugin-status" data-state={lastError ? lastError.includes('plugin/not-configured:') ? 'connection' : 'failed' : currentState ?? 'available'}><Pill active={installation !== undefined && currentState === 'active' && !lastError}>{installation ? lastError?.includes('plugin/not-configured:') ? t(plugin.setupKind === 'mcp' ? 'pluginNeedsConnection' : 'pluginNeedsConfiguration') : stateLabel(currentState ?? 'unknown') : t('available')}</Pill></span>
          </div>
          <p className="dse-market-plugin-description">{plugin.description ?? t('pluginNoDescription')}</p>
          <div className="dse-market-plugin-facts"><span>{t(pluginCategory(plugin) === 'work' ? 'workTools' : pluginCategory(plugin) === 'mcp' ? 'mcpServices' : 'skillWorkflows')}</span><span className="dse-market-plugin-version">{t('version')} {plugin.version}</span>{plugin.targets.map(target => <span key={target}>{targetLabel(target)}</span>)}</div>
          {runtime.length > 0 ? <details className="dse-market-runtime"><summary>{t('pluginRuntimeDetails')}</summary><div className="dse-tags" aria-label={t('pluginState')}>{runtime.flatMap(item => [
            <span className="dse-tag" key={`${item.activationId}:target`}>{targetLabel(item.targetKind)}: {stateLabel(item.state === 'active' ? 'active' : 'failed')}</span>,
            ...([['capabilityTools', item.tools], ['capabilitySkills', item.skills], ['capabilityMcp', item.mcpTools]] as const).filter(([, capability]) => capability.names.length > 0).map(([label, capability]) => <span className="dse-tag" key={`${item.activationId}:${label}`}>{t(label)}: {capability.present.length}/{capability.names.length}</span>),
            ...item.mcpServers.map(server => <span className="dse-tag" key={`${item.activationId}:mcp:${server.serverName}`}>{t('mcpServices')} {server.serverName}: {stateLabel(server.state === 'connected' ? 'active' : server.state === 'failed' ? 'failed' : 'preparing')}</span>),
            ...item.presets.map(preset => <span className="dse-tag" key={`${item.activationId}:preset:${preset.id}`}>{t('capabilityPreset')} {preset.id}: {stateLabel(preset.present ? 'active' : 'failed')}</span>),
            ...item.clientSlots.map(slot => <span className="dse-tag" key={`${item.activationId}:slot:${slot.id}`}>{t('capabilityClientSlot')} {slot.id}: {stateLabel(slot.present ? 'active' : 'failed')}</span>),
            ...item.clientWindows.map(client => <span className="dse-tag" key={`${item.activationId}:window:${client.windowId}:${client.moduleId}`}>{t('capabilityClientWindow')} {client.windowId}: {stateLabel(client.mountState === 'active' ? 'active' : client.mountState === 'failed' ? 'failed' : 'unknown')}</span>),
          ])}</div></details> : null}{newer ? <p className="dse-row-note dse-market-update">{t('updateAvailable')} · {t('version')} {installation.version} → {plugin.version}</p> : null}{lastError?.includes('plugin/not-configured:') ? <p className="dse-row-note" role="status">{t(plugin.setupKind === 'mcp' ? 'pluginConnectionRequired' : 'pluginConfigurationRequired')}</p> : lastError ? <p className="dse-row-note dse-error" role="alert">{t('pluginActivationError')}: {lastError}</p> : null}{installation && !canManage ? <p className="dse-row-note" role="status">{t('pluginPermissionDenied')}</p> : null}</div>
        <footer className="dse-market-plugin-footer">
          <span className="dse-market-install-owner">{installation ? installation.ownerKind === 'organization' ? t('organizationInstall') : t('personalInstall') : t('stateNotInstalled')}</span>
          <div className="dse-market-plugin-action">{installation ? <>
            {plugin.setupKind === 'mcp' && loadConnectionSettings ? <Button size="sm" variant={lastError?.includes('plugin/not-configured:') ? 'primary' : 'outline'} disabled={operationBusy || !canManage} onClick={() => { openConnection(installation.id) }}>{t('pluginConnect')}</Button> : null}
            {plugin.setupKind === 'configuration' && loadPluginSettings ? <Button size="sm" variant={lastError?.includes('plugin/not-configured:') ? 'primary' : 'outline'} disabled={operationBusy || newer || !canManage} onClick={() => { openSettings(installation.id) }}>{t('pluginConfigure')}</Button> : null}
            {newer ? <Button size="sm" variant="primary" disabled={operationBusy || changing || !canManage} onClick={() => { onUpgrade(installation.id, plugin.id) }}>{t('upgradePlugin')}</Button> : null}
            <Button size="sm" variant="outline" disabled={operationBusy || stopping || !canManage || plugin.status === 'unavailable'} onClick={() => { onToggle(installation.id, !enabled) }}>{enabled ? t('disablePlugin') : t('enablePlugin')}</Button>
          </> : <Button size="sm" variant="primary" disabled={operationBusy} onClick={() => { onInstall(plugin.id) }}>{t('installPlugin')}</Button>}</div>
          {installation ? <details className="dse-market-maintenance"><summary>{t('pluginMoreActions')}</summary><div className="dse-market-maintenance-actions">
            <Button size="sm" variant="outline" disabled={operationBusy || stopping || !canManage} onClick={() => { onUninstall(installation.id) }}>{t('uninstallPlugin')}</Button>
            <Button size="sm" variant="outline" disabled={operationBusy || !canManage} onClick={() => { setForceRemoveInstallationId(installation.id) }}>{t('forceRemovePlugin')}</Button>
          </div></details> : null}
        </footer>
      </article> })}</div>}</div></div>
    </section>
    <Modal open={settingsId !== undefined} onClose={() => { if (!settingsSaving) closeSettings() }} title={t('pluginConfigure')} description={t('pluginConfigurationHelp')} closeLabel={t('cancel')} footer={<><Button size="sm" variant="outline" disabled={settingsSaving} onClick={closeSettings}>{t('cancel')}</Button><Button size="sm" disabled={!settings || settingsSaving} onClick={saveSettings}>{t('save')}</Button></>}>
      {settings ? <form className="dse-plugin-settings" onSubmit={(event) => { event.preventDefault(); saveSettings() }}>
        {settings.specification.help ? <p className="dse-row-note">{settings.specification.help}</p> : null}
        {settings.specification.fields.map(field => <label key={field.name}>{field.label}{field.type === 'string-list' ? <textarea className="dse-modal-input" disabled={settingsSaving} value={String(settingsValues[field.name] ?? '')} onChange={(event) => { const value = event.currentTarget.value; setSettingsValues(values => ({ ...values, [field.name]: value })) }} /> : field.type === 'boolean' ? <input type="checkbox" disabled={settingsSaving} checked={settingsValues[field.name] === true} onChange={(event) => { const checked = event.currentTarget.checked; setSettingsValues(values => ({ ...values, [field.name]: checked })) }} /> : <input className="dse-modal-input" type={field.type === 'string' ? 'text' : field.type} required={field.required} min={field.min} max={field.max} step={field.integer ? 1 : 'any'} disabled={settingsSaving} value={String(settingsValues[field.name] ?? '')} onChange={(event) => { const value = event.currentTarget.value; setSettingsValues(values => ({ ...values, [field.name]: value })) }} />}{field.description ? <span className="dse-row-note">{field.description}</span> : null}</label>)}
        {settings.credentials.map(credential => <label key={credential.name}>{credential.label}<input className="dse-modal-input" type="password" autoComplete="off" disabled={settingsSaving} value={settingsSecrets[credential.name] ?? ''} placeholder={credential.configured ? t('pluginTokenSaved') : ''} onChange={(event) => { const value = event.currentTarget.value; setSettingsSecrets(values => ({ ...values, [credential.name]: value })) }} /></label>)}
      </form> : <p>{t('loading')}</p>}{settingsError ? <p className="dse-error" role="alert">{settingsError}</p> : null}
    </Modal>
    <Modal open={connectionId !== undefined} onClose={closeConnection} title={t('pluginConnect')} description={t('pluginConnectionHelp')} closeLabel={t('cancel')} footer={<><Button size="sm" variant="outline" onClick={closeConnection}>{t('cancel')}</Button><Button size="sm" disabled={!connection || authorizing || connectionSaving || (connection.connection.auth === 'token' && !connection.configured && !connectionToken.trim()) || (connection.connection.url === undefined && !connectionUrl.trim())} onClick={saveConnection}>{connection?.connection.auth === 'oauth' ? t('pluginLogin') : t('save')}</Button></>}>
      {connection ? <div className="dse-inline-form">{connection.connection.url ? <p className="dse-row-note">{t('pluginServiceEndpoint')}: {connection.connection.url}</p> : <label>{t('pluginServiceEndpoint')}<input className="dse-modal-input" type="url" value={connectionUrl} onChange={(event) => { setConnectionUrl(event.currentTarget.value) }} /></label>}{connection.connection.auth === 'token' ? <label>{t('pluginServiceToken')}<input className="dse-modal-input" type="password" autoComplete="off" value={connectionToken} placeholder={connection.configured ? t('pluginTokenSaved') : ''} onChange={(event) => { setConnectionToken(event.currentTarget.value) }} /></label> : null}{connection.connection.credentialUrl ? <a href={connection.connection.credentialUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => { if ((window as EnterpriseWindow).__dshNative?.openExternal) { event.preventDefault(); openAuthorizationUrl(event.currentTarget.href) } }}>{t('pluginCredentialsPage')}</a> : null}{authorizing ? <p role="status">{t('pluginAuthorizationWaiting')}</p> : null}{authorizationUrl ? <a href={authorizationUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => { if ((window as EnterpriseWindow).__dshNative?.openExternal) event.preventDefault(); openAuthorizationUrl(authorizationUrl) }}>{t('pluginLogin')}</a> : null}</div> : <p>{t('loading')}</p>}{connectionError ? <p className="dse-error" role="alert">{connectionError}</p> : null}
    </Modal>
    <Modal open={forceRemoveInstallationId !== undefined} onClose={() => { if (forceRemoveInstallationId === undefined || !pluginBusy(forceRemoveInstallationId)) setForceRemoveInstallationId(undefined) }} title={t('forceRemovePlugin')} description={t('forceRemovePluginConfirm')} closeLabel={t('cancel')} footer={<><Button size="sm" variant="outline" disabled={forceRemoveInstallationId !== undefined && pluginBusy(forceRemoveInstallationId)} onClick={() => { setForceRemoveInstallationId(undefined) }}>{t('cancel')}</Button><Button size="sm" disabled={forceRemoveInstallationId === undefined || pluginBusy(forceRemoveInstallationId)} onClick={() => { if (forceRemoveInstallationId !== undefined) onForceRemove(forceRemoveInstallationId) }}>{t('forceRemovePlugin')}</Button></>} />
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
  const [runView, setRunView] = useState<'queue' | 'history'>('queue')
  const queueTabRef = useRef<HTMLButtonElement | null>(null)
  const historyTabRef = useRef<HTMLButtonElement | null>(null)
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
  const handleRunTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = runView === 'queue' ? 'history' : 'queue'
    setRunView(next)
    ;(next === 'queue' ? queueTabRef : historyTabRef).current?.focus()
  }
  if (state === 'loading') return <div className="dse-status">{t('loading')}</div>
  if (state === 'error' || snapshot === undefined) return <div className="dse-status dse-error">{t('error')} <Button size="sm" onClick={reload}>{t('retry')}</Button></div>
  const providerFor = (ruleId: string) => snapshot.providers.find(item => item.ruleId === ruleId)
  const queued = snapshot.batches.filter(batch => batch.state === 'queued' || batch.state === 'delivering' || batch.state === 'processing')
  const history = snapshot.batches.filter(batch => !queued.includes(batch)).slice(-50).reverse()
  const sourceLabel = (rule: TriggerRule): string => t(rule.source.kind === 'timer' ? 'triggerTimer' : rule.source.kind === 'local-file' ? 'triggerLocalFiles' : 'triggerCloudFiles')
  const stateLabel = (value: TriggerSnapshot['batches'][number]['state']): string => t(`triggerBatch${value[0]?.toUpperCase() ?? ''}${value.slice(1)}` as EnterpriseLocaleKey)
  return <main className="dse-triggers">
    <header className="dse-trigger-header"><div><h2 className="dse-market-title">{t('triggers')}</h2><p className="dse-market-intro">{t('triggerIntro')}</p></div><Button size="sm" onClick={() => { setDraft(freshTriggerDraft(t('triggerDefaultPrompt'))); setMatchResult(undefined); setEditorError(false); setEditorOpen(true) }}>{t('triggerNewRule')}</Button></header>
    {surfaceError ? <p className="dse-status dse-error" role="alert">{t('requestFailed')}</p> : null}
    <section className="dse-trigger-column" aria-label={t('triggerRules')}>
      <div className="dse-trigger-section-head"><h3>{t('triggerRules')}</h3><span>{snapshot.rules.length}</span></div>
      {snapshot.rules.length === 0 ? <div className="dse-trigger-empty"><span className="dse-trigger-empty-icon" aria-hidden="true"><IconAlarmClockOutline16 size={20} /></span><p>{t('triggerNoRules')}</p><Button size="sm" variant="outline" onClick={() => { setDraft(freshTriggerDraft(t('triggerDefaultPrompt'))); setMatchResult(undefined); setEditorError(false); setEditorOpen(true) }}>{t('triggerCreateFirstRule')}</Button></div> : <div className="dse-trigger-list">{snapshot.rules.map((rule) => { const provider = providerFor(rule.id); return <article className="dse-trigger-rule" key={rule.id}><div className="dse-trigger-rule-head"><div className="dse-trigger-rule-identity"><strong>{rule.name}</strong><span>{sourceLabel(rule)} · {t('versionShort')}{rule.version}</span></div><div className="dse-tags"><span className="dse-tag" data-state={rule.enabled ? 'enabled' : 'disabled'}>{rule.enabled ? t('triggerEnabled') : t('triggerDisabled')}</span><span className="dse-tag" data-state={provider?.state ?? 'idle'}>{provider?.state === 'watching' ? t('triggerListening') : provider?.state === 'failed' ? t('triggerListenerFailed') : provider?.state === 'missed' ? t('triggerMissed') : t('triggerNotListening')}</span></div></div><p>{rule.target.kind === 'existing-session' ? `${t('triggerExistingSession')}: ${rule.target.sessionId}` : `${t('triggerNewSession')}: ${rule.target.workspacePath}`}</p>{provider?.message ? <p className="dse-row-note">{provider.message}</p> : null}<div className="dse-actions"><Button size="sm" variant="outline" disabled={busy} onClick={() => { setDraft(draftFromRule(rule)); setMatchResult(undefined); setEditorError(false); setEditorOpen(true) }}>{t('triggerEdit')}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { mutate(() => setTriggerEnabled(rule.id, !rule.enabled)) }}>{rule.enabled ? t('disablePlugin') : t('enablePlugin')}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { mutate(() => removeTrigger(rule.id)) }}>{t('triggerRemove')}</Button></div></article> })}</div>}
    </section>
    <Modal open={editorOpen} onClose={() => { if (!busy) setEditorOpen(false) }} title={draft.id ? t('triggerEditRule') : t('triggerCreateRule')} headless className="dse-trigger-modal">
      <header className="dse-trigger-editor-header">
        <span className="dse-trigger-editor-icon" aria-hidden="true"><IconAlarmClockOutline16 size={22} /></span>
        <div><h2>{draft.id ? t('triggerEditRule') : t('triggerCreateRule')}</h2><p>{t('triggerPromptDelivery')}</p></div>
        <button type="button" className="dse-trigger-editor-close" aria-label={t('triggerCloseEditor')} disabled={busy} onClick={() => { setEditorOpen(false) }}><IconCloseOutline16 size={16} /></button>
      </header>
      <div className="dse-trigger-modal-content"><div className="dse-trigger-editor">
        <fieldset className="dse-trigger-editor-section"><legend><span aria-hidden="true">01</span>{t('triggerConditions')}</legend>
          <div className="dse-trigger-fields"><label><span>{t('triggerRuleName')}</span><input placeholder={t('triggerRuleNamePlaceholder')} value={draft.name} onChange={(event) => { patchDraft('name', event.currentTarget.value) }} /></label>
            <label><span>{t('triggerSource')}</span><select value={draft.sourceKind} onChange={(event) => { patchDraft('sourceKind', event.currentTarget.value as TriggerDraft['sourceKind']) }}><option value="timer">{t('triggerTimer')}</option><option value="local-file">{t('triggerLocalFiles')}</option><option value="cloud-file">{t('triggerCloudFiles')}</option></select></label></div>
          {draft.sourceKind === 'timer' ? <div className={draft.timerKind === 'every' ? 'dse-trigger-fields dse-trigger-timer-fields' : 'dse-trigger-fields'}><label><span>{t('triggerSchedule')}</span><select value={draft.timerKind} onChange={(event) => { patchDraft('timerKind', event.currentTarget.value as TriggerDraft['timerKind']) }}><option value="every">{t('triggerRecurring')}</option><option value="at">{t('triggerOneTime')}</option></select></label><label><span>{t('triggerStartAt')}</span><input type="datetime-local" value={draft.timerAt} onChange={(event) => { patchDraft('timerAt', event.currentTarget.value) }} /></label>{draft.timerKind === 'every' ? <label><span>{t('triggerEverySeconds')}</span><input type="number" min="1" value={draft.everySeconds} onChange={(event) => { patchDraft('everySeconds', event.currentTarget.value) }} /></label> : null}</div> : <><div className="dse-trigger-fields">{draft.sourceKind === 'local-file' ? <label className="dse-trigger-wide"><span>{t('triggerRoots')}</span><textarea value={draft.roots} onChange={(event) => { patchDraft('roots', event.currentTarget.value) }} placeholder={t('triggerRootsHelp')} /></label> : <label className="dse-trigger-wide"><span>{t('triggerCloudSpace')}</span><select value={draft.spaceId} onChange={(event) => { patchDraft('spaceId', event.currentTarget.value) }}><option value="">{t('triggerSelectSpace')}</option>{spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>}<label><span>{t('triggerIncludes')}</span><textarea value={draft.includes} onChange={(event) => { patchDraft('includes', event.currentTarget.value) }} /></label><label><span>{t('triggerExcludes')}</span><textarea value={draft.excludes} onChange={(event) => { patchDraft('excludes', event.currentTarget.value) }} /></label><label><span>{t('triggerBatchWindow')}</span><input type="number" min="50" value={draft.windowMs} onChange={(event) => { patchDraft('windowMs', event.currentTarget.value) }} /></label>{draft.sourceKind === 'local-file' ? <><label><span>{t('triggerStabilityWindow')}</span><input type="number" min="50" value={draft.stabilityMs} onChange={(event) => { patchDraft('stabilityMs', event.currentTarget.value) }} /></label><label><span>{t('triggerRateLimit')}</span><input type="number" min="1" value={draft.maxEventsPerMinute} onChange={(event) => { patchDraft('maxEventsPerMinute', event.currentTarget.value) }} /></label></> : null}</div><div className="dse-inline-form"><input aria-label={t('triggerTestPath')} placeholder={t('triggerTestPath')} value={matchPath} onChange={(event) => { setMatchPath(event.currentTarget.value) }} /><Button size="sm" variant="outline" disabled={busy || !matchPath} onClick={runMatch}>{t('triggerTestMatch')}</Button>{matchResult !== undefined ? <span className="dse-row-note">{matchResult ? t('triggerMatches') : t('triggerDoesNotMatch')}</span> : null}</div></>}
        </fieldset>
        <fieldset className="dse-trigger-editor-section"><legend><span aria-hidden="true">02</span>{t('triggerTarget')}</legend>
          <div className="dse-trigger-fields"><label><span>{t('triggerTarget')}</span><select value={draft.targetKind} onChange={(event) => { patchDraft('targetKind', event.currentTarget.value as TriggerDraft['targetKind']) }}><option value="existing-session">{t('triggerExistingSession')}</option><option value="new-session">{t('triggerNewSession')}</option></select></label>
            {draft.targetKind === 'existing-session' ? <label><span>{t('triggerSession')}</span><select value={draft.sessionId || sessions.current || ''} onChange={(event) => { patchDraft('sessionId', event.currentTarget.value) }}><option value="">{t('triggerSelectSession')}</option>{sessions.ids.map(id => <option value={id} key={id}>{sessions.byId[id]?.displayTitle ?? id}</option>)}</select></label> : null}
          </div>
          {draft.targetKind === 'new-session' ? <div className="dse-trigger-fields"><label className="dse-trigger-wide"><span>{t('triggerWorkspacePath')}</span><input value={draft.workspacePath} onChange={(event) => { patchDraft('workspacePath', event.currentTarget.value) }} /></label><label><span>{t('triggerAgentPreset')}</span><input value={draft.agentPreset} onChange={(event) => { patchDraft('agentPreset', event.currentTarget.value) }} /></label><label><span>{t('triggerPermissionPreset')}</span><input value={draft.permissionPreset} onChange={(event) => { patchDraft('permissionPreset', event.currentTarget.value) }} /></label><label className="dse-trigger-wide"><span>{t('triggerTitleTemplate')}</span><input value={draft.titleTemplate} onChange={(event) => { patchDraft('titleTemplate', event.currentTarget.value) }} /></label></div> : null}
        </fieldset>
        <fieldset className="dse-trigger-editor-section"><legend><span aria-hidden="true">03</span>{t('triggerInstruction')}</legend>
          <label><span>{t('triggerPrompt')}</span><textarea aria-label={t('triggerPrompt')} className="dse-trigger-instruction" value={draft.instruction} onChange={(event) => { patchDraft('instruction', event.currentTarget.value) }} /></label>
          <details className="dse-trigger-variables"><summary>{t('triggerVariablesTitle')}</summary><p>{t('triggerPromptVariables')}</p></details>
        </fieldset>
        {editorError ? <p className="dse-status dse-error" role="alert">{t('requestFailed')}</p> : null}
      </div></div>
      <footer className="dse-trigger-editor-footer"><Button variant="outline" disabled={busy} onClick={() => { setEditorOpen(false) }}>{t('cancel')}</Button><Button variant="primary" disabled={busy} onClick={submit}>{busy ? t('saving') : t('save')}</Button></footer>
    </Modal>
    <section className="dse-trigger-runs" aria-label={runView === 'queue' ? t('triggerQueue') : t('triggerHistory')}>
      <div className="dse-trigger-run-tabs" role="tablist" aria-label={t('triggerRunViews')}>
        <button ref={queueTabRef} type="button" id="dse-trigger-queue-tab" role="tab" tabIndex={runView === 'queue' ? 0 : -1} aria-controls="dse-trigger-run-panel" aria-selected={runView === 'queue'} onKeyDown={handleRunTabKeyDown} onClick={() => { setRunView('queue') }}>{t('triggerQueue')}<span aria-hidden="true">{queued.length}</span></button>
        <button ref={historyTabRef} type="button" id="dse-trigger-history-tab" role="tab" tabIndex={runView === 'history' ? 0 : -1} aria-controls="dse-trigger-run-panel" aria-selected={runView === 'history'} onKeyDown={handleRunTabKeyDown} onClick={() => { setRunView('history') }}>{t('triggerHistory')}<span aria-hidden="true">{history.length}</span></button>
      </div>
      <div id="dse-trigger-run-panel" role="tabpanel" aria-labelledby={runView === 'queue' ? 'dse-trigger-queue-tab' : 'dse-trigger-history-tab'}>
        {runView === 'queue' ? queued.length === 0 ? <p className="dse-trigger-quiet-empty">{t('triggerQueueEmpty')}</p> : <ul className="dse-list">{queued.map(batch => <li className="dse-row" key={batch.id}><span className="dse-row-main"><strong className="dse-row-title">{snapshot.rules.find(rule => rule.id === batch.ruleId)?.name ?? batch.ruleId}</strong><span className="dse-row-note">{stateLabel(batch.state)} · {batch.resources.length} {t('triggerResources')} · {new Date(batch.createdAt).toLocaleString()}</span></span>{batch.sessionId ? <Button size="sm" variant="outline" onClick={() => { void openSession(batch.sessionId as string) }}>{t('triggerOpenSession')}</Button> : null}</li>)}</ul> : history.length === 0 ? <p className="dse-trigger-quiet-empty">{t('triggerHistoryEmpty')}</p> : <ul className="dse-list">{history.map(batch => <li className="dse-row" key={batch.id}><span className="dse-row-main"><strong className="dse-row-title">{snapshot.rules.find(rule => rule.id === batch.ruleId)?.name ?? batch.ruleSnapshot.name}</strong><span className="dse-row-note">{stateLabel(batch.state)} · {t('versionShort')}{batch.ruleVersion} · {batch.resources.length} {t('triggerResources')} · {new Date(batch.createdAt).toLocaleString()}{batch.error ? ` · ${batch.error}` : ''}</span></span><span className="dse-actions">{batch.sessionId ? <Button size="sm" variant="outline" onClick={() => { void openSession(batch.sessionId as string) }}>{t('triggerOpenSession')}</Button> : null}{batch.state === 'failed' || batch.state === 'unknown' ? <Button size="sm" variant="outline" icon={<IconPlayOutline16 size={14} />} disabled={busy} onClick={() => { mutate(() => retryTrigger(batch.id)) }}>{t('triggerRetry')}</Button> : null}</span></li>)}</ul>}
      </div>
    </section>
  </main>
}

function EnterpriseMainSurface(props: PluginMarketProps & CloudDriveProps & TriggerProps): ReactNode {
  if (props.surface === 'cloud-drive') return <CloudDrive {...props} />
  if ((props.surface as MainSurface) === 'triggers') return <TriggerSurface {...props} />
  return <PluginMarket {...props} />
}

function onSettingsTabKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const current = tabs.findIndex(tab => tab === event.target)
  if (current < 0) return
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  event.preventDefault()
  tabs[next]?.focus()
  tabs[next]?.click()
}

function memberRoleLabel(role: string, t: AccountProps['t']): string {
  return role === 'owner' ? t('owner') : role === 'administrator' ? t('administrator') : role === 'member' ? t('member') : role
}

type UsageInterval = { from: string; to: string }

function recentUsageInterval(days: number): UsageInterval {
  const to = new Date()
  return { from: new Date(to.getTime() - days * 86_400_000).toISOString(), to: to.toISOString() }
}

function UsageRangePicker({ onChange, timeZone, t }: {
  onChange: (range: UsageInterval) => void
  timeZone: string
  t: AccountProps['t']
}): ReactNode {
  const [period, setPeriod] = useState('30')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  return <div className="dse-usage-filter">
    <label className="dse-period"><span>{t('usagePeriod')}</span><select value={period} onChange={(event) => {
      const next = event.currentTarget.value
      setPeriod(next)
      if (next !== 'custom') onChange(recentUsageInterval(Number(next)))
    }}><option value="3">{t('last3Days')}</option><option value="7">{t('last7Days')}</option><option value="30">{t('last30Days')}</option><option value="custom">{t('customRange')}</option></select></label>
    {period === 'custom' ? <div className="dse-inline-form dse-date-filter">
      <label>{t('usageFrom')}<input type="date" value={from} max={to} onChange={(event) => { setFrom(event.currentTarget.value) }} /></label>
      <label>{t('usageTo')}<input type="date" value={to} min={from} onChange={(event) => { setTo(event.currentTarget.value) }} /></label>
      <Button size="sm" variant="primary" disabled={!from || !to || from > to} onClick={() => { onChange({ from: zonedDateStart(from, timeZone), to: zonedDateStart(shiftCalendarDate(to, 1), timeZone) }) }}>{t('applyRange')}</Button>
    </div> : null}
  </div>
}

function UsageRecords({ accountId, range, loadOwnUsage, loadMemberUsage, t }: Pick<AccountProps, 'loadOwnUsage' | 'loadMemberUsage' | 't'> & {
  accountId?: string
  range: UsageInterval
}): ReactNode {
  const [state, setState] = useState<AsyncState<EnterpriseUsagePage>>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  const request = useRef(0)
  useEffect(() => {
    const id = ++request.current
    setState({ status: 'loading' }); setBusy(false); setError(false)
    const pending = accountId === undefined ? loadOwnUsage(undefined, range.from, range.to) : loadMemberUsage(accountId, undefined, range.from, range.to)
    void pending.then((value) => { if (id === request.current) setState({ status: 'ready', value }) }, () => { if (id === request.current) setState({ status: 'error' }) })
    return () => { request.current++ }
  }, [accountId, range, loadOwnUsage, loadMemberUsage, revision])
  if (state.status === 'loading') return <p className="dse-meta" role="status">{t('loading')}</p>
  if (state.status === 'error') return <div role="alert"><p className="dse-error">{t('requestFailed')}</p><Button size="sm" variant="outline" onClick={() => { setRevision(value => value + 1) }}>{t('retry')}</Button></div>
  const page = state.value
  const more = (): void => {
    if (!page.nextCursor || busy) return
    const id = request.current
    setBusy(true); setError(false)
    const pending = accountId === undefined ? loadOwnUsage(page.nextCursor, range.from, range.to) : loadMemberUsage(accountId, page.nextCursor, range.from, range.to)
    void pending.then((value) => {
      if (id !== request.current) return
      setState({ status: 'ready', value: { ...value, items: [...page.items, ...value.items] } }); setBusy(false)
    }, () => { if (id === request.current) { setBusy(false); setError(true) } })
  }
  return <>
    {page.items.length === 0 ? <p className="dse-empty">{t('noUsage')}</p> : <ul className="dse-list">{page.items.map(item => <li className="dse-row" key={item.id}>
      <span className="dse-row-main"><strong className="dse-row-title">{item.modelId}</strong><span className="dse-row-note">{new Date(item.occurredAt).toLocaleString()} · {item.purpose} · {t(item.status === 'settled' ? 'usageSettled' : item.status === 'failed' ? 'usageFailed' : 'usagePending')}</span><span className="dse-row-note">{(item.totalTokens ?? (item.inputTokens ?? 0) + (item.outputTokens ?? 0)).toLocaleString()} {t('tokens')}</span></span>
      <span className="dse-money">{item.currency === 'CNY' && item.totalCostMicrosCny !== null ? moneyCny(item.totalCostMicrosCny) : t(item.status === 'failed' ? 'noCharge' : 'costUnavailable')}</span>
    </li>)}</ul>}
    {error ? <p className="dse-error" role="alert">{t('requestFailed')}</p> : null}
    {page.nextCursor ? <Button size="sm" variant="outline" disabled={busy} onClick={more}>{t('loadMore')}</Button> : null}
  </>
}

function BillingSection({ loadWallet, loadWalletLedger, loadOwnUsageSummary, loadOwnUsage, loadMemberUsage, redeem, t }: BillingProps): ReactNode {
  const redeemForm = useId()
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<AsyncState<EnterpriseWallet>>({ status: 'loading' })
  const [tab, setTab] = useState<'overview' | 'usage' | 'ledger'>('overview')
  const [range, setRange] = useState<UsageInterval>(() => recentUsageInterval(30))
  const [summary, setSummary] = useState<AsyncState<EnterpriseUsageSummary>>({ status: 'loading' })
  const [ledger, setLedger] = useState<AsyncState<EnterpriseWalletLedger>>({ status: 'loading' })
  const [ledgerRevision, setLedgerRevision] = useState(0)
  const [ledgerBusy, setLedgerBusy] = useState(false)
  const [ledgerError, setLedgerError] = useState(false)
  const ledgerRequest = useRef(0)
  const [redeemOpen, setRedeemOpen] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [operationError, setOperationError] = useState<string>()
  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void loadWallet().then((value) => { if (current) setState({ status: 'ready', value }) }, () => { if (current) setState({ status: 'error' }) })
    return () => { current = false }
  }, [loadWallet, revision])
  useEffect(() => {
    if (tab !== 'overview') return
    let current = true
    setSummary({ status: 'loading' })
    void loadOwnUsageSummary(range.from, range.to).then((value) => { if (current) setSummary({ status: 'ready', value }) }, () => { if (current) setSummary({ status: 'error' }) })
    return () => { current = false }
  }, [loadOwnUsageSummary, range, tab, revision])
  useEffect(() => {
    if (tab !== 'ledger') return
    const id = ++ledgerRequest.current
    setLedger({ status: 'loading' }); setLedgerBusy(false); setLedgerError(false)
    void loadWalletLedger().then((value) => { if (id === ledgerRequest.current) setLedger({ status: 'ready', value }) }, () => { if (id === ledgerRequest.current) setLedger({ status: 'error' }) })
    return () => { ledgerRequest.current++ }
  }, [loadWalletLedger, tab, revision, ledgerRevision])
  const moreLedger = (): void => {
    if (ledger.status !== 'ready' || !ledger.value.nextCursor || ledgerBusy) return
    const previous = ledger.value
    const id = ledgerRequest.current
    setLedgerBusy(true); setLedgerError(false)
    void loadWalletLedger(previous.nextCursor ?? undefined).then((value) => {
      if (id !== ledgerRequest.current) return
      setLedger({ status: 'ready', value: { ...value, items: [...previous.items, ...value.items] } }); setLedgerBusy(false)
    }, () => { if (id === ledgerRequest.current) { setLedgerBusy(false); setLedgerError(true) } })
  }
  if (state.status !== 'ready') return <SettingsPageStatus titleKey="billingNav" intro="billingIntro" loading={state.status === 'loading'} retry={() => { setRevision(value => value + 1) }} t={t} />
  const closeRedeem = (): void => { if (!busy) { setRedeemOpen(false); setOperationError(undefined); setCode('') } }
  const submitRedeem = (): void => {
    setBusy(true); setOperationError(undefined)
    void redeem(code).then(() => { setCode(''); setBusy(false); setRedeemOpen(false); setRevision(value => value + 1) }, (error: unknown) => { setBusy(false); setOperationError(error instanceof Error ? error.message : 'UNKNOWN') })
  }
  const errorKey = operationError === 'INVALID_REDEMPTION_CODE' ? 'invalidCode' : operationError === 'REDEMPTION_CODE_REVOKED' ? 'revokedCode' : operationError === 'REDEMPTION_CODE_REDEEMED' ? 'usedCode' : operationError === 'REDEMPTION_CODE_EXPIRED' ? 'expiredCode' : 'requestFailed'
  return <div className="dse-section">
    <header><h2 className="dse-title">{t('billingNav')}</h2><p className="dse-subtle">{t('billingIntro')}</p></header>
    <section className="dse-card dse-balance dse-balance-header"><div><h3>{t('teamBalance')}</h3><p className="dse-value">{moneyCny(state.value.balanceMicrosCny)}</p><p className="dse-meta">{t('sharedBalance')}</p></div><Button size="sm" variant="outline" onClick={() => { setRedeemOpen(true) }}>{t('redeemCode')}</Button></section>
    <div className="dse-settings-tabs" role="tablist" onKeyDown={onSettingsTabKeyDown} aria-label={t('billingNav')}>{(['overview', 'usage', 'ledger'] as const).map(value => <button key={value} type="button" role="tab" id={`billing-${value}-tab`} aria-controls={`billing-${value}-panel`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => { setTab(value) }}>{t(value === 'overview' ? 'usageOverview' : value === 'usage' ? 'usageRecords' : 'walletLedger')}</button>)}</div>
    <section className="dse-settings-panel" role="tabpanel" id={`billing-${tab}-panel`} aria-labelledby={`billing-${tab}-tab`}>
      <div hidden={tab === 'ledger'}><UsageRangePicker onChange={setRange} timeZone={summary.status === 'ready' ? summary.value.range.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone} t={t} /></div>
      {tab === 'overview' ? <>
        {summary.status === 'ready' ? <><div className="dse-summary-grid">{([
          { labelKey: 'settledCost', value: moneyCny(summary.value.totalCostMicrosCny) },
          { labelKey: 'calls', value: summary.value.calls.toLocaleString() },
          { labelKey: 'tokens', value: summary.value.totalTokens.toLocaleString() },
        ] satisfies { labelKey: EnterpriseLocaleKey; value: string }[]).map(item => <div key={item.labelKey}><span>{t(item.labelKey)}</span><strong>{item.value}</strong></div>)}</div><p className="dse-meta">{new Date(summary.value.range.from).toLocaleDateString(undefined, { timeZone: summary.value.range.timeZone })} – {new Date(Date.parse(summary.value.range.to) - 1).toLocaleDateString(undefined, { timeZone: summary.value.range.timeZone })}</p>{summary.value.unpricedCalls > 0 ? <p className="dse-meta">{t('unpricedCalls', { count: summary.value.unpricedCalls })}</p> : null}</> : summary.status === 'loading' ? <p role="status" className="dse-meta">{t('loading')}</p> : <div role="alert"><p className="dse-error">{t('requestFailed')}</p><Button size="sm" variant="outline" onClick={() => { setRevision(value => value + 1) }}>{t('retry')}</Button></div>}
      </> : tab === 'usage' ? <UsageRecords range={range} loadOwnUsage={loadOwnUsage} loadMemberUsage={loadMemberUsage} t={t} /> : <>
        {ledger.status === 'ready' ? <>{ledger.value.items.length === 0 ? <p className="dse-empty">{t('noLedger')}</p> : <ul className="dse-list">{ledger.value.items.map(item => <li className="dse-row" key={item.id}><span className="dse-row-main"><strong className="dse-row-title">{t(item.kind === 'redemption_credit' ? 'redemptionCredit' : 'modelUsageDebit')}</strong><span className="dse-row-note">{new Date(item.createdAt).toLocaleString()} · {t('balanceAfter')} {moneyCny(item.balanceAfterMicrosCny)}</span></span><span className="dse-money">{item.amountMicrosCny > 0 ? '+' : ''}{moneyCny(item.amountMicrosCny)}</span></li>)}</ul>}{ledger.value.nextCursor ? <Button size="sm" variant="outline" disabled={ledgerBusy} onClick={moreLedger}>{t('loadMore')}</Button> : null}{ledgerError ? <p role="alert" className="dse-error">{t('requestFailed')}</p> : null}</> : ledger.status === 'loading' ? <p role="status" className="dse-meta">{t('loading')}</p> : <div role="alert"><p className="dse-error">{t('requestFailed')}</p><Button size="sm" variant="outline" onClick={() => { setLedgerRevision(value => value + 1) }}>{t('retry')}</Button></div>}
      </>}
    </section>
    <Modal open={redeemOpen} onClose={closeRedeem} title={t('redeemCode')} closeLabel={t('closeDialog')} description={t('redeemHelp')} className="dse-settings-modal" footer={<><Button size="sm" variant="outline" disabled={busy} onClick={closeRedeem}>{t('cancel')}</Button><Button size="sm" variant="primary" disabled={busy || !redeemCodeInput.safeParse({ code }).success} type="submit" form={redeemForm}>{t('redeem')}</Button></>}>
      <form id={redeemForm} onSubmit={(event) => { event.preventDefault(); if (!busy && redeemCodeInput.safeParse({ code }).success) submitRedeem() }}><label className="dse-modal-field"><span>{t('redeemCode')}</span><input value={code} disabled={busy} onChange={(event) => { setCode(event.currentTarget.value) }} placeholder={t('redeemPlaceholder')} /></label>{operationError ? <p className="dse-error" role="alert">{t(errorKey)}</p> : null}</form>
    </Modal>
  </div>
}

function MemberDetail({ member, timeZone, loadOwnUsage, loadMemberUsage, back, t }: Pick<AccountProps, 'loadOwnUsage' | 'loadMemberUsage' | 't'> & {
  member: EnterpriseTeam['members'][number]
  timeZone: string
  back: () => void
}): ReactNode {
  const [tab, setTab] = useState<'profile' | 'usage'>('profile')
  const [range, setRange] = useState<UsageInterval>(() => recentUsageInterval(30))
  return <>
    <Button size="sm" variant="ghost" className="dse-back" icon={<IconChevronDownOutline14 className="dse-back-chevron" />} onClick={back}>{t('backToMembers')}</Button>
    <div className="dse-member-heading"><span className="dse-avatar" aria-hidden="true">{Array.from(member.name || member.email).slice(0, 2).join('').toLocaleUpperCase()}</span><div><h2>{member.name || member.email}</h2><p className="dse-meta">{member.email}</p></div></div>
    <div className="dse-settings-tabs" role="tablist" onKeyDown={onSettingsTabKeyDown} aria-label={t('memberDetails')}>{(['profile', 'usage'] as const).map(value => <button key={value} type="button" role="tab" id={`member-${value}-tab`} aria-controls={`member-${value}-panel`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => { setTab(value) }}>{t(value === 'profile' ? 'memberDetails' : 'usageRecords')}</button>)}</div>
    <section className="dse-settings-panel" role="tabpanel" id={`member-${tab}-panel`} aria-labelledby={`member-${tab}-tab`}>
      {tab === 'profile' ? <dl className="dse-profile-fields"><div><dt>{t('memberEmail')}</dt><dd>{member.email}</dd></div><div><dt>{t('memberRole')}</dt><dd>{member.roles.map(role => memberRoleLabel(role, t)).join(', ')}</dd></div><div><dt>{t('memberStatus')}</dt><dd>{member.status === 'active' ? t('activeMember') : member.status}</dd></div></dl> : null}<div hidden={tab !== 'usage'}><UsageRangePicker onChange={setRange} timeZone={timeZone} t={t} /></div>{tab === 'usage' ? <UsageRecords accountId={member.accountId} range={range} loadOwnUsage={loadOwnUsage} loadMemberUsage={loadMemberUsage} t={t} /> : null}
    </section>
  </>
}

function DirectorySection({ loadDashboard, loadTeam, loadOwnUsage, loadMemberUsage, inviteMember, revokeInvitation, loadDepartments, createDepartment, updateDepartment, deleteDepartment, setMemberDepartments, t }: DirectoryProps): ReactNode {
  const inviteForm = useId()
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<AsyncState<{ team?: EnterpriseTeam }>>({ status: 'loading' })
  const [tab, setTab] = useState<'members' | 'departments' | 'invitations'>('members')
  const [selectedMember, setSelectedMember] = useState<EnterpriseTeam['members'][number]>()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'administrator'>('member')
  const [busy, setBusy] = useState(false)
  const [operationError, setOperationError] = useState(false)
  const [invitationError, setInvitationError] = useState(false)
  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void (async () => {
      const dashboard = await loadDashboard()
      const canManage = dashboard.roles.some(item => item.role === 'owner' || item.role === 'administrator')
      const team = canManage ? await loadTeam() : undefined
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Effect cleanup may run during loadTeam.
      if (current) setState({ status: 'ready', value: team === undefined ? {} : { team } })
    })().catch(() => { if (current) setState({ status: 'error' }) })
    return () => { current = false }
  }, [loadDashboard, loadTeam, revision])
  if (state.status !== 'ready') return <SettingsPageStatus titleKey="directoryNav" intro="directoryIntro" loading={state.status === 'loading'} retry={() => { setRevision(value => value + 1) }} t={t} />
  const team = state.value.team
  const closeInvite = (): void => { if (!busy) { setInviteOpen(false); setOperationError(false); setEmail(''); setRole('member') } }
  const submitInvite = (): void => {
    setBusy(true); setOperationError(false)
    void inviteMember(email, role).then(() => { setEmail(''); setRole('member'); setBusy(false); setInviteOpen(false); setRevision(value => value + 1) }, () => { setBusy(false); setOperationError(true) })
  }
  return <div className="dse-section">
    {!selectedMember ? <header className="dse-page-heading"><div><h2 className="dse-title">{t('directoryNav')}</h2><p className="dse-subtle">{t('directoryIntro')}</p></div>{team ? <Button size="sm" variant="primary" onClick={() => { setInviteOpen(true) }}>{t('inviteMember')}</Button> : null}</header> : null}
    {!team ? <div className="dse-status">{t('directoryUnavailable')}</div> : selectedMember ? <MemberDetail key={selectedMember.accountId} member={selectedMember} timeZone={team.range.timeZone} loadOwnUsage={loadOwnUsage} loadMemberUsage={loadMemberUsage} back={() => { setSelectedMember(undefined) }} t={t} /> : <>
      <div className="dse-settings-tabs" role="tablist" onKeyDown={onSettingsTabKeyDown} aria-label={t('directoryNav')}>{(['members', 'departments', 'invitations'] as const).map(value => <button key={value} type="button" role="tab" id={`directory-${value}-tab`} aria-controls={`directory-${value}-panel`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => { setTab(value) }}>{t(value === 'members' ? 'directory' : value === 'departments' ? 'departments' : 'pendingInvitations')}{value !== 'departments' ? <span className="dse-tab-count">{value === 'members' ? team.members.length : team.invitations.length}</span> : null}</button>)}</div>
      <section className="dse-settings-panel" role="tabpanel" id={`directory-${tab}-panel`} aria-labelledby={`directory-${tab}-tab`}>
        {tab === 'departments' ? <Departments members={team.members} loadDepartments={loadDepartments} createDepartment={createDepartment} updateDepartment={updateDepartment} deleteDepartment={deleteDepartment} setMemberDepartments={setMemberDepartments} t={t} /> : tab === 'members' ? <ul className="dse-list">{team.members.map(member => <li className="dse-row" key={member.membershipId}><button className="dse-member" type="button" onClick={() => { setSelectedMember(member) }}><span className="dse-identity"><span className="dse-avatar" aria-hidden="true">{Array.from(member.name || member.email).slice(0, 2).join('').toLocaleUpperCase()}</span><span className="dse-row-main"><strong className="dse-row-title">{member.name || member.email}</strong><span className="dse-row-note">{member.email}</span></span></span><span className="dse-member-badges"><span className="dse-tag">{member.roles.map(role => memberRoleLabel(role, t)).join(', ')}</span><span className="dse-row-note">{member.status === 'active' ? t('activeMember') : member.status}</span><IconChevronDownOutline14 className="dse-detail-chevron" /></span></button></li>)}</ul> : <>
          {team.invitations.length === 0 ? <p className="dse-empty">{t('noInvitations')}</p> : <ul className="dse-list">{team.invitations.map(invitation => <li className="dse-row" key={invitation.id}><span className="dse-row-main"><strong className="dse-row-title">{invitation.email}</strong><span className="dse-row-note">{memberRoleLabel(invitation.role, t)} · {t('expires')} {new Date(invitation.expiresAt).toLocaleString()}</span></span><Button size="sm" variant="outline" disabled={busy} onClick={() => {
            setBusy(true); setInvitationError(false)
            void revokeInvitation(invitation.id).then(() => { setBusy(false); setRevision(value => value + 1) }, () => { setBusy(false); setInvitationError(true) })
          }}>{t('revokeInvitation')}</Button></li>)}</ul>}{invitationError ? <p className="dse-error" role="alert">{t('requestFailed')}</p> : null}
        </>}
      </section>
    </>}
    <Modal open={inviteOpen} onClose={closeInvite} title={t('inviteMember')} closeLabel={t('closeDialog')} description={t('inviteHelp')} className="dse-settings-modal" footer={<><Button size="sm" variant="outline" disabled={busy} onClick={closeInvite}>{t('cancel')}</Button><Button size="sm" variant="primary" disabled={busy || !inviteMemberInput.safeParse({ email, role }).success} type="submit" form={inviteForm}>{t('invite')}</Button></>}>
      <form id={inviteForm} onSubmit={(event) => { event.preventDefault(); if (!busy && inviteMemberInput.safeParse({ email, role }).success) submitInvite() }}><div className="dse-modal-fields"><label className="dse-modal-field"><span>{t('memberEmail')}</span><input type="email" value={email} disabled={busy} onChange={(event) => { setEmail(event.currentTarget.value) }} placeholder={t('memberEmail')} /></label><label className="dse-modal-field"><span>{t('memberRole')}</span><select value={role} disabled={busy} onChange={(event) => { setRole(event.currentTarget.value as 'member' | 'administrator') }}><option value="member">{t('member')}</option>{team?.canInviteAdministrator ? <option value="administrator">{t('administrator')}</option> : null}</select></label></div>{operationError ? <p className="dse-error" role="alert">{t('requestFailed')}</p> : null}</form>
    </Modal>
  </div>
}

export const inject = ['slots', 'locale', 'connection', 'mainNavigation', 'modules']

/** Register enterprise pages into the original Web settings shell. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('enterprise', { zh, en }), 'enterprise-client: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  const sessions = ctx.get('sessions') as ISessions
  const call = async (endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> => {
    const result = await connection.rpc.call('/enterprise', endpoint, { args: payload }, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const nativeWindowId = (window as EnterpriseWindow & { __dshWindowId?: string }).__dshWindowId
  const pluginRuntime = new EnterpriseClientPluginRuntime({
    ctx,
    call,
    ...(nativeWindowId === undefined ? {} : { windowId: nativeWindowId }),
  })
  const pluginRevision = createSnapshotStore(0)
  let runtimeDisposed = false
  const reconcile = (): void => {
    void pluginRuntime.reconcile().catch((error: unknown) => {
      console.error('[enterprise] plugin Client reconciliation failed', error instanceof Error ? error.message : error)
    }).finally(() => {
      if (!runtimeDisposed) pluginRevision.set(pluginRevision.getSnapshot() + 1)
    })
  }
  ctx.effect(() => {
    const onGeneration = (): void => {
      if (connection.generation.getSnapshot() !== undefined) reconcile()
    }
    const unsubscribe = connection.generation.subscribe(onGeneration)
    onGeneration()
    const onPageHide = (): void => { void pluginRuntime.disconnect() }
    window.addEventListener('pagehide', onPageHide)
    return async () => {
      runtimeDisposed = true
      window.removeEventListener('pagehide', onPageHide)
      unsubscribe()
      await pluginRuntime.disconnect()
      await pluginRuntime.dispose()
    }
  }, 'enterprise-client: browser plugin targets')
  const native = (): NativeEnterpriseActions | undefined => (window as EnterpriseWindow).__dshNative
  const nativeUpdates = createSnapshotStore(Boolean(native()?.checkForUpdates))
  const availableUpdate = createSnapshotStore<string | null>(null)
  let updateRevision = 0
  ctx.effect(() => {
    let disposed = false
    const ready = (): void => {
      const bridge = native()
      nativeUpdates.set(Boolean(bridge?.checkForUpdates))
      const revision = ++updateRevision
      if (!bridge) { availableUpdate.set(null); return }
      void bridge.getAvailableUpdateVersion().then((version) => {
        const value = z.string().nullable().parse(version)
        if (!disposed && revision === updateRevision) availableUpdate.set(value)
      }).catch(() => { /* Startup discovery stays silent when the native transport is unavailable. */ })
    }
    window.addEventListener('dsh-native-bridge-ready', ready)
    window.addEventListener('dsh-desktop-update-available', ready)
    ready()
    return () => {
      disposed = true
      window.removeEventListener('dsh-native-bridge-ready', ready)
      window.removeEventListener('dsh-desktop-update-available', ready)
    }
  }, 'enterprise-client: native update availability')
  const checkForUpdates = async (): Promise<void> => {
    const bridge = native()
    if (!bridge) throw new Error('Native desktop bridge is unavailable')
    await bridge.checkForUpdates()
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'desktop-updates', order: 30, locale: 'enterprise',
    inject: () => ({
      checkForUpdates,
      hooks: { nativeUpdates },
    }),
  }, DesktopUpdateSetting))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'desktop-update-notification', locale: 'enterprise',
    inject: () => ({
      checkForUpdates,
      dismissUpdate: async () => {
        const bridge = native()
        if (!bridge) throw new Error('Native desktop bridge is unavailable')
        await bridge.dismissUpdateNotification()
        ++updateRevision
        availableUpdate.set(null)
      },
      hooks: { availableUpdate },
    }),
  }, DesktopUpdateNotification))
  const injected = (): EnterpriseInjected => ({
    uploadCloudSessions: async () => z.object({ uploaded: z.number().int().nonnegative() }).strict().parse(await call('upload-cloud-sessions', {})),
    importCloudSessions: async () => {
      const result = z.object({ imported: z.number().int().nonnegative() }).strict().parse(await call('import-cloud-sessions', {}))
      await sessions.refresh()
      return result
    },
    loadDashboard: async () => enterpriseDashboard.parse(await call('dashboard', {})),
    loadModelSelection: async () => enterpriseModelSelection.parse(await call('model-selection', {})),
    saveModel: async (model) => { const input = setModelInput.parse({ model }); return enterpriseModelSelection.parse(await call('set-model', input)) },
    loadPlugins: async () => enterprisePluginCatalog.parse(await call('plugins', {})),
    loadPluginInstallations: async () => enterprisePluginInstallations.parse(await call('plugin-installations', {})),
    loadPluginDeviceTargets: async () => enterprisePluginDeviceTargets.parse(await call('plugin-device-targets', {})),
    loadPluginDiagnostics: async () => enterprisePluginCapabilityDiagnostics.parse(await call('plugin-runtime-diagnostics', {})),
    loadPluginSettings: async installationId => pluginSettings.parse(await call('plugin-settings', { installationId })),
    configurePluginSettings: async (input) => { const value = await call('plugin-configure-settings', pluginSettingsInput.parse(input)); reconcile(); return value },
    loadConnectionSettings: async installationId => pluginConnectionSettings.parse(await call('plugin-connection-settings', { installationId })),
    configureConnection: async (input) => { const value = await call('plugin-configure-connection', pluginConnectionInput.parse(input)); reconcile(); return value },
    authorizeConnection: async installationId => z.object({ url: z.url().optional() }).strict().parse(await call('plugin-authorize-connection', { installationId })),
    authorizationStatus: async (installationId, cancel) => z.object({ complete: z.boolean(), error: z.string().optional() }).strict().parse(await call('plugin-authorization-status', { installationId, ...(cancel === undefined ? {} : { cancel }) })),
    uploadPlugin: async (visibility, bytes) => {
      const input = pluginUploadInput.parse({ visibility, bytes: [...bytes] })
      return call('plugin-upload', input)
    },
    installPlugin: async (releaseId) => {
      const value = await call('plugin-install', pluginInstallationInput.parse({ releaseId }))
      reconcile()
      return value
    },
    upgradePlugin: async (installationId, releaseId) => {
      const value = await call('plugin-upgrade', pluginUpgradeInput.parse({ installationId, releaseId, confirmPermissions: true }))
      reconcile()
      return value
    },
    uninstallPlugin: async (installationId) => {
      const value = await call('plugin-uninstall', { installationId })
      reconcile()
      return value
    },
    forceRemovePlugin: async (installationId) => {
      const value = await call('plugin-force-remove', { installationId })
      reconcile()
      return value
    },
    setPluginEnabled: async (installationId, enabled) => {
      const value = await call('plugin-enable', pluginEnableInput.parse({ installationId, enabled }))
      reconcile()
      return value
    },
    openConversation: () => { ctx.mainNavigation.openConversation() },
    openPluginMarket: () => { ctx.mainNavigation.openPluginMarket() },
    revokeRuntime: async (runtimeId) => { revokeRuntimeInput.parse({ runtimeId }); await call('revoke-runtime', { runtimeId }) },
    loadWallet: async () => enterpriseWallet.parse(await call('wallet', {})),
    loadWalletLedger: async cursor => enterpriseWalletLedger.parse(await call('wallet-ledger', walletLedgerInput.parse({ cursor }))),
    loadOwnUsage: async (cursor, from, to) => enterpriseUsagePage.parse(await call('own-usage', ownUsageInput.parse({ cursor, from, to }))),
    loadOwnUsageSummary: async (from, to) => enterpriseUsageSummary.parse(await call('own-usage-summary', teamUsageRangeInput.parse({ from, to }))),
    redeem: async (code) => { const input = redeemCodeInput.parse({ code }); return enterpriseWallet.parse(await call('redeem', input)) },
    loadDepartments: async () => enterpriseDepartments.parse(await call('departments', {})),
    createDepartment: async (name, parentId) => { await call('create-department', createDepartmentInput.parse({ name, parentId })) },
    updateDepartment: async (unitId, name, parentId) => { await call('update-department', updateDepartmentInput.parse({ unitId, name, parentId })) },
    deleteDepartment: async (unitId) => { await call('delete-department', deleteDepartmentInput.parse({ unitId })) },
    setMemberDepartments: async (membershipId, unitIds) => { await call('member-departments', memberDepartmentsInput.parse({ membershipId, unitIds })) },
    loadTeam: async (from, to) => { const input = teamUsageRangeInput.parse({ from, to }); return enterpriseTeam.parse(await call('team', input)) },
    loadMemberUsage: async (accountId, cursor, from, to) => { const input = memberUsageInput.parse({ accountId, cursor, from, to }); return enterpriseUsagePage.parse(await call('member-usage', input)) },
    inviteMember: async (email, role) => { const input = inviteMemberInput.parse({ email, role }); await call('invite-member', input) },
    revokeInvitation: async (invitationId) => { const input = revokeInvitationInput.parse({ invitationId }); await call('revoke-invitation', input) },
    switchOrganization: () => { void native()?.switchOrganization() },
    logout: () => { void native()?.logout() },
  })
  const t = ctx.locale.bind('enterprise')
  const marketInjected = (): PluginMarketInjected & CloudDriveInjected => ({ ...injected(), ...driveInjected(), hooks: { pluginRevision } })
  const driveInjected = (): CloudDriveInjected => ({
    loadDirectory: async () => driveDirectory.parse(await call('drive-directory', {})),
    loadSharing: async nodeId => driveSharing.parse(await call('drive-sharing', { nodeId })),
    saveSharing: async (nodeId, policy) => driveSharing.parse(await call('drive-sharing-update', { nodeId, policy })),
    loadSpaces: async () => driveSpaces.parse(await call('drive-spaces', {})),
    loadFiles: async (spaceId, parentId, cursor, shared) => driveFilePage.parse(await call('drive-files', { spaceId, parentId, cursor, shared })),
    searchFiles: async (spaceId, query, cursor, shared) => driveFilePage.parse(await call('drive-search', { spaceId, query, cursor, shared })),
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
    yield ctx.slots.register({ name: 'settings.section', id: 'enterprise', icon: IconUserOutline16, order: 5, label: () => t('accountNav'), locale: 'enterprise', inject: injected }, AccountSection)
    yield ctx.slots.register({ name: 'settings.section', id: 'enterprise-models', icon: IconDataOutline16, order: 10, label: () => t('modelsNav'), locale: 'enterprise', inject: injected }, ModelSection)
    yield ctx.slots.register({ name: 'settings.section', id: 'enterprise-directory', icon: IconListPenOutline16, order: 15, label: () => t('directoryNav'), locale: 'enterprise', inject: injected }, DirectorySection)
    yield ctx.slots.register({ name: 'settings.section', id: 'enterprise-billing', icon: IconChecklistOutline14, order: 16, label: () => t('billingNav'), locale: 'enterprise', inject: injected }, BillingSection)
    yield ctx.slots.register({ name: 'settings.section', id: 'plugins', icon: IconCordisPluginOutline14, order: 20, label: () => t('pluginsNav'), locale: 'enterprise', inject: injected }, PluginsSection)
  })
  ctx.slots.inject('sidebar.rail.item', () => ctx.slots.register({
    name: 'sidebar.rail.item', id: 'plugin-market', order: 20, label: () => t('pluginMarket'), icon: IconCordisPluginOutline14, locale: 'enterprise',
    inject: () => ({ navigation: ctx.mainNavigation, open: () => { ctx.mainNavigation.openPluginMarket() } }),
  } as never, PluginMarketAction as never))
  ctx.slots.inject('sidebar.rail.item', () => ctx.slots.register({
    name: 'sidebar.rail.item', id: 'cloud-drive', order: 25, label: () => t('cloudDrive'), icon: IconFolderOpenOutline16, locale: 'enterprise',
    inject: () => ({ navigation: ctx.mainNavigation, open: () => { ctx.mainNavigation.openCloudDrive() } }),
  } as never, CloudDriveAction as never))
  ctx.slots.inject('sidebar.rail.item', () => ctx.slots.register({
    name: 'sidebar.rail.item', id: 'triggers', order: 30, label: () => t('triggers'), icon: IconAlarmClockOutline16, locale: 'enterprise',
    inject: () => ({ navigation: ctx.mainNavigation, open: () => { ctx.mainNavigation.openTriggers() } }),
  } as never, TriggerAction as never))
  ctx.slots.inject('main.surface', function* () {
    for (const key of ['plugin-market', 'cloud-drive', 'triggers']) {
      yield ctx.slots.register({
        name: 'main.surface', key, locale: 'enterprise', inject: () => ({ ...marketInjected(), ...triggerInjected() }),
      }, EnterpriseMainSurface)
    }
  })
}
