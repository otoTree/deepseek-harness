/* oxlint-disable @stylistic/max-len -- Runtime transport requests mirror the enterprise lifecycle wire protocol. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire, isBuiltin } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { pluginManifest, type PluginCapabilityTransport, type PluginSdk } from '@deepseek-ai/dsh-plugin-protocol'
import { bindPluginSdk, mountPluginTarget, type PluginTargetModule } from '@deepseek-ai/dsh-plugin-runtime'
import { createHttpPluginTransport } from '@deepseek-ai/dsh-plugin-sdk'
import { init, parse } from 'es-module-lexer'
import { strFromU8, unzipSync } from 'fflate'
import type { EnterprisePluginCatalog, EnterprisePluginInstallations } from './wire.ts'

interface RuntimeRelease {
  readonly id: string
  readonly pluginId: string
  readonly version: string
  readonly digest?: string | undefined
}

interface VerifiedPackage {
  readonly manifest: ReturnType<typeof pluginManifest.parse>
  readonly entries: ReadonlyMap<string, Uint8Array>
}

interface ActiveTarget {
  readonly installationId: string
  readonly releaseId: string
  readonly permissionRevision: number
  readonly pluginId: string
  readonly version: string
  readonly targetKind: 'host' | 'client'
  readonly activationId: string
  readonly transport: PluginCapabilityTransport
  readonly sdk: PluginSdk
  readonly invalidateSdk: () => void
  readonly moduleId?: string
  readonly source?: string
  readonly disposeContribution?: () => Promise<void>
}

interface CleanupFailure {
  readonly target: ActiveTarget
  readonly error: unknown
  readonly attempts: number
  readonly nextRetryAt: number
}

/** Client target source made available to an authenticated browser page. */
export interface EnterpriseClientPluginTarget {
  readonly installationId: string
  readonly releaseId: string
  readonly pluginId: string
  readonly version: string
  readonly activationId: string
  readonly moduleId: string
  readonly source: string
}

export interface EnterprisePluginRuntimeOptions {
  readonly ctx: Context
  readonly apiUrl: string
  readonly organizationId: string
  readonly deviceId: () => Promise<string>
  readonly request: (path: string, signal: AbortSignal, init?: RequestInit) => Promise<unknown>
  readonly requestBytes: (path: string, signal: AbortSignal) => Promise<Uint8Array>
  /** Maximum time one target may spend preparing before its lease is failed. */
  readonly activationTimeoutMs?: number
  /** Maximum time one target stop may occupy reconciliation. */
  readonly cleanupTimeoutMs?: number
}

function timeoutSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
}

const cleanupTimeout = (options: EnterprisePluginRuntimeOptions): number => options.cleanupTimeoutMs ?? 10_000
const activationTimeout = (options: EnterprisePluginRuntimeOptions): number => options.activationTimeoutMs ?? 30_000

async function withinDeadline<T>(
  signal: AbortSignal,
  timeoutMs: number,
  label: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`)) }, timeoutMs)
  if (typeof timer === 'object' && 'unref' in timer) timer.unref()
  try { return await operation(AbortSignal.any([signal, controller.signal])) }
  finally { clearTimeout(timer) }
}

async function untilAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Plugin target activation aborted'))
    signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([operation, cancelled]) }
  finally { if (abort !== undefined) signal.removeEventListener('abort', abort) }
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(`${label} timed out after ${timeoutMs}ms`)) }, timeoutMs)
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
  })
  try { return await Promise.race([operation, deadline]) }
  finally { if (timer !== undefined) clearTimeout(timer) }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function parsePackage(bytes: Uint8Array, release: RuntimeRelease): VerifiedPackage {
  if (release.digest !== undefined && digest(bytes) !== release.digest) throw new Error('Downloaded plugin package digest does not match the catalog')
  const files = unzipSync(bytes)
  const manifestBytes = files['manifest.json']
  const integrityBytes = files['integrity.json']
  if (manifestBytes === undefined || integrityBytes === undefined) throw new Error('Plugin package omits manifest.json or integrity.json')
  const manifest = pluginManifest.parse(JSON.parse(strFromU8(manifestBytes)))
  if (manifest.pluginId !== release.pluginId || manifest.version !== release.version) throw new Error('Plugin package identity does not match the selected release')
  const integrity = JSON.parse(strFromU8(integrityBytes)) as unknown
  if (integrity === null || typeof integrity !== 'object' || Array.isArray(integrity)) throw new Error('Plugin package integrity.json must be an object')
  const records = integrity as Record<string, unknown>
  for (const [path, entry] of Object.entries(files)) {
    if (path === 'integrity.json') continue
    if (!/^(?:manifest\.json|(?:client|host)\/[A-Za-z0-9._/-]+\.js)$/u.test(path) || path.includes('..')) throw new Error(`Plugin package contains unsafe entry ${path}`)
    if (records[path] !== digest(entry)) throw new Error(`Plugin package integrity check failed for ${path}`)
  }
  for (const target of manifest.targets) {
    if (files[target.entry] === undefined) throw new Error(`Plugin package omits ${target.entry}`)
  }
  return { manifest, entries: new Map(Object.entries(files)) }
}

function hostModuleUrl(specifier: string): string {
  if (specifier !== '@deepseek-ai/cordis') throw new Error(`Plugin Host target imports unsupported external module ${specifier}`)
  const anchor = process.env.DSH_INSTALL_ANCHOR
  const resolveFrom = createRequire(anchor === undefined || anchor === '' ? import.meta.url : anchor)
  return pathToFileURL(resolveFrom.resolve(specifier)).href
}

async function linkHostSource(source: string): Promise<string> {
  await init
  const [imports] = parse(source)
  const replacements = imports.flatMap((entry) => {
    if (entry.d === -2) return []
    if (entry.n === undefined) throw new Error('Plugin Host target contains a non-literal dynamic import')
    if (isBuiltin(entry.n)) return []
    const linked = hostModuleUrl(entry.n)
    return [{ start: entry.s, end: entry.e, value: entry.d === -1 ? linked : JSON.stringify(linked) }]
  })
  return replacements.sort((left, right) => right.start - left.start).reduce(
    (linked, replacement) => linked.slice(0, replacement.start) + replacement.value + linked.slice(replacement.end),
    source,
  )
}

async function importTarget(source: Uint8Array, identity: string, version: string): Promise<PluginTargetModule> {
  const linked = await linkHostSource(strFromU8(source))
  const root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-plugin-'))
  const host = join(root, 'host')
  const entry = join(host, `${createHash('sha256').update(identity).digest('hex')}.mjs`)
  try {
    await mkdir(host)
    await Promise.all([
      writeFile(join(root, 'package.json'), `${JSON.stringify({ type: 'module', version })}\n`, { mode: 0o600 }),
      writeFile(entry, linked, { mode: 0o600 }),
    ])
    return await import(pathToFileURL(entry).href) as PluginTargetModule
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** Reconciles control-plane desired state with live Host and browser targets. */
export class EnterprisePluginRuntime {
  private readonly active = new Map<string, ActiveTarget>()
  private readonly cleanupFailures = new Map<string, CleanupFailure>()
  private serial: Promise<void> = Promise.resolve()
  private readonly renewalTimer: ReturnType<typeof setInterval>
  private cleanupRetryTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(private readonly options: EnterprisePluginRuntimeOptions) {
    this.renewalTimer = setInterval(() => { void this.renewLeases() }, 5 * 60 * 1000)
    if (typeof this.renewalTimer === 'object' && 'unref' in this.renewalTimer) this.renewalTimer.unref()
  }

  private key(installationId: string, targetKind: 'host' | 'client'): string {
    return `${installationId}:${targetKind}`
  }

  /** Download, verify, activate, and unload targets until observed state matches desired state. */
  reconcile(signal: AbortSignal): Promise<void> {
    const next = this.serial.then(() => this.reconcileNow(signal))
    this.serial = next.catch(() => {})
    return next
  }

  private async reconcileNow(signal: AbortSignal): Promise<void> {
    await this.retryCleanup(signal)
    const [catalog, installations, rawDeviceTargets] = await Promise.all([
      this.options.request('plugins/catalog', signal) as Promise<EnterprisePluginCatalog>,
      this.options.request('plugins/installations', signal) as Promise<EnterprisePluginInstallations>,
      this.options.request('plugins/device-targets', signal).catch((error) => {
        this.options.ctx.logger('enterprise-plugin').warn(error)
        return undefined
      }),
    ])
    const deviceTargets = Array.isArray(rawDeviceTargets) ? rawDeviceTargets as readonly {
      installationId: string
      targetKind: 'host' | 'client'
      desiredState: string
      observedState: string
      releaseId: string
      permissionRevision: number
      activationId?: string | null
    }[] : undefined
    const releases = new Map(catalog.map(release => [release.id, release]))
    const enabled = installations.flatMap((installation) => {
      const release = releases.get(installation.releaseId)
      const installationTargets = deviceTargets?.filter(target => target.installationId === installation.id)
      const hasTarget = deviceTargets === undefined || installationTargets?.length === 0 || installationTargets?.some(target => target.desiredState === 'enabled')
      return installation.enabled && installation.desiredState === 'enabled' && hasTarget && release !== undefined
        ? [{ installation, release }]
        : []
    })
    const wanted = new Set<string>()
    const archives = await Promise.allSettled(enabled.map(async ({ installation, release }) => ({
      installation,
      release,
      archive: parsePackage(await this.options.requestBytes(`plugins/${release.id}/package`, signal), release),
    })))
    const targetTasks: Promise<void>[] = []
    for (const result of archives) {
      if (result.status === 'rejected') {
        this.options.ctx.logger('enterprise-plugin').error(result.reason)
        continue
      }
      const { installation, release, archive } = result.value
      for (const target of archive.manifest.targets) {
        const key = this.key(installation.id, target.kind)
        wanted.add(key)
        targetTasks.push(this.reconcileTarget(installation.id, installation.permissionRevision, release, archive, target.kind, target.entry, target.kind === 'client' ? target.moduleId : undefined, signal))
      }
    }
    await Promise.allSettled(targetTasks)

    // A server-side disable or uninstall can revoke a target after the local
    // contribution has already disappeared (for example while the desktop
    // was offline). Reconcile those rows explicitly; only walking `active`
    // would leave the server target stuck in `stopping` forever.
    if (deviceTargets !== undefined) {
      const activeKeys = new Set(this.active.keys())
      await Promise.allSettled(deviceTargets.map(async (target) => {
        if (target.desiredState === 'enabled'
          || target.observedState === 'disabled'
          || activeKeys.has(this.key(target.installationId, target.targetKind))) return
        const deviceId = await this.options.deviceId()
        await bounded(this.options.request(`plugins/installations/${target.installationId}/deactivate`, timeoutSignal(signal, cleanupTimeout(this.options)), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId, targetKind: target.targetKind }),
        }), cleanupTimeout(this.options), `Plugin ${target.installationId} target deactivation`)
      }))
    }
    await Promise.allSettled([...this.active].filter(([key]) => !wanted.has(key)).map(async ([, target]) => {
      try { await this.stop(target, signal) }
      catch (error) { this.options.ctx.logger('enterprise-plugin').error(error) }
    }))
    await Promise.allSettled(installations.filter(installation => installation.desiredState === 'uninstalled').map(async (installation) => {
      const hasActive = [...this.active.values()].some(target => target.installationId === installation.id)
      const hasCleanupFailure = [...this.cleanupFailures.keys()].some(key => key.startsWith(`${installation.id}:`))
      if (hasActive || hasCleanupFailure) return
      await bounded(this.options.request(`plugins/installations/${installation.id}/uninstall/complete`, signal, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      }), cleanupTimeout(this.options), `Plugin ${installation.id} uninstall completion`)
    }))
    this.scheduleCleanupRetry()
  }

  private scheduleCleanupRetry(): void {
    if (this.disposed) return
    if (this.cleanupRetryTimer !== undefined) clearTimeout(this.cleanupRetryTimer)
    const nextRetryAt = [...this.cleanupFailures.values()].reduce<number | undefined>((earliest, failure) =>
      earliest === undefined ? failure.nextRetryAt : Math.min(earliest, failure.nextRetryAt), undefined)
    if (nextRetryAt === undefined) return
    const delay = Math.max(0, nextRetryAt - Date.now())
    this.cleanupRetryTimer = setTimeout(() => {
      this.cleanupRetryTimer = undefined
      if (this.disposed) return
      void this.reconcile(new AbortController().signal).catch(error => {
        this.options.ctx.logger('enterprise-plugin').error(error)
      })
    }, delay)
    if (typeof this.cleanupRetryTimer === 'object' && 'unref' in this.cleanupRetryTimer) this.cleanupRetryTimer.unref()
  }

  private async reconcileTarget(
    installationId: string,
    permissionRevision: number,
    release: RuntimeRelease,
    archive: VerifiedPackage,
    targetKind: 'host' | 'client',
    entry: string,
    moduleId: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const key = this.key(installationId, targetKind)
    if (this.cleanupFailures.has(key)) return
    const current = this.active.get(key)
    try {
      if (current?.releaseId === release.id && current.permissionRevision === permissionRevision) return
      if (current !== undefined) await this.stop(current, signal)
      await withinDeadline(signal, activationTimeout(this.options), `Plugin ${release.pluginId} ${targetKind} activation`, activationSignal =>
        this.start(installationId, permissionRevision, release, archive, targetKind, entry, moduleId, activationSignal, signal))
    } catch (error) {
      this.options.ctx.logger('enterprise-plugin').error(error)
    }
  }

  private async start(
    installationId: string,
    permissionRevision: number,
    release: RuntimeRelease,
    archive: VerifiedPackage,
    targetKind: 'host' | 'client',
    entry: string,
    moduleId: string | undefined,
    signal: AbortSignal,
    recoverySignal: AbortSignal,
  ): Promise<void> {
    const deviceId = await this.options.deviceId()
    const lease = await this.options.request(`plugins/installations/${installationId}/devices/${encodeURIComponent(deviceId)}/activate`, signal, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetKind }),
    }) as { activationId?: unknown; token?: unknown }
    if (typeof lease.activationId !== 'string' || typeof lease.token !== 'string') throw new Error('Plugin activation returned an invalid lease')
    const transport = createHttpPluginTransport({ baseUrl: this.options.apiUrl, activationId: lease.activationId, token: lease.token })
    const bound = bindPluginSdk(transport)
    const bytes = archive.entries.get(entry)
    if (bytes === undefined) throw new Error(`Plugin target entry ${entry} is missing`)
    if (targetKind === 'client' && moduleId === undefined) throw new Error('Plugin Client target omits its module id')
    let disposeContribution: (() => Promise<void>) | undefined
    try {
      if (targetKind === 'host') {
        disposeContribution = await mountPluginTarget(
          this.options.ctx,
          await untilAbort(importTarget(bytes, `${release.id}:${lease.activationId}`, release.version), signal),
          bound.sdk,
          { signal },
        )
      }
      const active: ActiveTarget = {
        installationId, releaseId: release.id, permissionRevision, pluginId: release.pluginId, version: release.version,
        targetKind, activationId: lease.activationId, transport, sdk: bound.sdk, invalidateSdk: bound.dispose,
        ...(targetKind === 'client' ? { moduleId: moduleId!, source: strFromU8(bytes) } : {}),
        ...(disposeContribution === undefined ? {} : { disposeContribution }),
      }
      if (targetKind === 'host') await this.heartbeat(active, 'active', null, signal)
      this.active.set(this.key(installationId, targetKind), active)
    } catch (error) {
      await disposeContribution?.().catch(() => {})
      bound.dispose()
      await this.reportFailed(installationId, lease.activationId, deviceId, targetKind, error, recoverySignal)
      await bounded(this.options.request(`plugins/installations/${installationId}/deactivate`, timeoutSignal(recoverySignal, cleanupTimeout(this.options)), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, targetKind }),
      }), cleanupTimeout(this.options), `Plugin ${installationId} failed-start lease revocation`).catch(() => {})
      throw error
    }
  }

  private async stop(target: ActiveTarget, signal: AbortSignal): Promise<void> {
    const deviceId = await this.options.deviceId()
    let revokeError: unknown
    try {
      await bounded(this.options.request(`plugins/installations/${target.installationId}/deactivate`, timeoutSignal(signal, cleanupTimeout(this.options)), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, targetKind: target.targetKind }),
      }), cleanupTimeout(this.options), `Plugin ${target.pluginId} lease revocation`)
    } catch (error) { revokeError = error }
    target.invalidateSdk()
    let disposeError: unknown
    try {
      if (target.disposeContribution !== undefined) {
        await bounded(target.disposeContribution(), cleanupTimeout(this.options), `Plugin ${target.pluginId} cleanup`)
      }
    } catch (error) { disposeError = error }
    const failures = [revokeError, disposeError].filter(error => error !== undefined)
    const key = this.key(target.installationId, target.targetKind)
    if (failures.length) {
      const previous = this.cleanupFailures.get(key)
      const attempts = (previous?.attempts ?? 0) + 1
      this.cleanupFailures.set(key, { target, error: new AggregateError(failures, `Plugin ${target.pluginId} did not stop cleanly`), attempts, nextRetryAt: Date.now() + Math.min(60_000, 500 * 2 ** attempts) })
      this.active.delete(key)
      this.scheduleCleanupRetry()
      throw this.cleanupFailures.get(key)?.error
    }
    this.active.delete(key)
    this.cleanupFailures.delete(key)
    this.scheduleCleanupRetry()
  }

  private async heartbeat(target: ActiveTarget, state: 'active' | 'failed' | 'disabled', error: string | null, signal: AbortSignal): Promise<void> {
    const deviceId = await this.options.deviceId()
    await this.options.request(`plugins/installations/${target.installationId}/devices/${encodeURIComponent(deviceId)}/heartbeat`, signal, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activationId: target.activationId, targetKind: target.targetKind, observedState: state, error }),
    })
  }

  private async reportFailed(installationId: string, activationId: string, deviceId: string, targetKind: 'host' | 'client', error: unknown, signal: AbortSignal): Promise<void> {
    await this.options.request(`plugins/installations/${installationId}/devices/${encodeURIComponent(deviceId)}/heartbeat`, signal, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activationId, targetKind, observedState: 'failed', error: error instanceof Error ? error.message : 'Plugin activation failed' }),
    }).catch(() => {})
  }

  private async renewLeases(): Promise<void> {
    const controller = new AbortController()
    await Promise.allSettled([...this.active.values()].map(async (target) => {
      try { await this.heartbeat(target, 'active', null, controller.signal) }
      catch (error) {
        try { await this.stop(target, controller.signal) }
        catch (cleanupError) { this.options.ctx.logger('enterprise-plugin').error(cleanupError) }
        this.options.ctx.logger('enterprise-plugin').warn(error)
      }
    }))
  }

  /** Retry a failed local contribution cleanup without restoring its authorization. */
  async retryCleanup(signal: AbortSignal = new AbortController().signal): Promise<void> {
    await Promise.allSettled([...this.cleanupFailures.values()].filter(failure => failure.nextRetryAt <= Date.now()).map(async (failure) => {
      try { await this.stop(failure.target, signal) }
      catch { /* The failure remains recorded with an increased backoff. */ }
    }))
    this.scheduleCleanupRetry()
  }

  /** Return Client targets whose activation credentials remain Host-owned. */
  clientTargets(): EnterpriseClientPluginTarget[] {
    return [...this.active.values()].flatMap(target => target.targetKind === 'client' && target.moduleId !== undefined && target.source !== undefined ? [{
      installationId: target.installationId, releaseId: target.releaseId, pluginId: target.pluginId,
      version: target.version, activationId: target.activationId, moduleId: target.moduleId, source: target.source,
    }] : [])
  }

  /** Relay one browser SDK call through its current Host-owned activation transport. */
  async callClient<T>(activationId: string, operation: string, input: unknown, signal: AbortSignal): Promise<T> {
    const target = [...this.active.values()].find(candidate => candidate.targetKind === 'client' && candidate.activationId === activationId)
    if (target === undefined) throw new Error('plugin/not-active')
    return await target.transport.call<T>(operation, input, signal)
  }

  /** Relay and collect one browser SDK stream without exposing its activation token. */
  async streamClient(activationId: string, operation: string, input: unknown, signal: AbortSignal): Promise<unknown[]> {
    const target = [...this.active.values()].find(candidate => candidate.targetKind === 'client' && candidate.activationId === activationId)
    if (target === undefined) throw new Error('plugin/not-active')
    const chunks: unknown[] = []
    for await (const chunk of target.transport.stream(operation, input, signal)) {
      chunks.push(chunk)
      if (chunks.length > 10_000) throw new Error('Plugin stream exceeds the Host relay chunk limit')
    }
    return chunks
  }

  /** Accept the browser's observed Client activation state. */
  async reportClient(activationId: string, state: 'active' | 'failed', error: string | null, signal: AbortSignal): Promise<void> {
    const target = [...this.active.values()].find(candidate => candidate.targetKind === 'client' && candidate.activationId === activationId)
    if (target === undefined) throw new Error('plugin/not-active')
    await this.heartbeat(target, state, error, signal)
  }

  /** Revoke all leases and wait for every contribution to leave the Host. */
  async dispose(): Promise<void> {
    this.disposed = true
    clearInterval(this.renewalTimer)
    if (this.cleanupRetryTimer !== undefined) clearTimeout(this.cleanupRetryTimer)
    const controller = new AbortController()
    const results = await Promise.allSettled([...this.active.values()].map(target => this.stop(target, controller.signal)))
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
    if (failures.length) throw new AggregateError(failures, 'Enterprise plugin runtime did not stop cleanly')
  }
}
