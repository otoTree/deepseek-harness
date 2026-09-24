/* oxlint-disable @stylistic/max-len -- Runtime transport requests mirror the enterprise lifecycle wire protocol. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { pluginManifest, type PluginCapabilityTransport, type PluginSdk } from '@deepseek-ai/dsh-plugin-protocol'
import { bindPluginSdk, mountPluginTarget, type PluginTargetModule } from '@deepseek-ai/dsh-plugin-runtime'
import { createHttpPluginTransport } from '@deepseek-ai/dsh-plugin-sdk'
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
  readonly source: string
}

export interface EnterprisePluginRuntimeOptions {
  readonly ctx: Context
  readonly apiUrl: string
  readonly organizationId: string
  readonly deviceId: () => Promise<string>
  readonly request: (path: string, signal: AbortSignal, init?: RequestInit) => Promise<unknown>
  readonly requestBytes: (path: string, signal: AbortSignal) => Promise<Uint8Array>
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

async function importTarget(source: Uint8Array, identity: string): Promise<PluginTargetModule> {
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${encodeURIComponent(identity)}`
  return await import(url) as PluginTargetModule
}

/** Reconciles control-plane desired state with live Host and browser targets. */
export class EnterprisePluginRuntime {
  private readonly active = new Map<string, ActiveTarget>()
  private readonly cleanupFailures = new Map<string, CleanupFailure>()
  private serial: Promise<void> = Promise.resolve()
  private readonly renewalTimer: ReturnType<typeof setInterval>

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
    const [catalog, installations, rawDeviceTargets] = await Promise.all([
      this.options.request('plugins/catalog', signal) as Promise<EnterprisePluginCatalog>,
      this.options.request('plugins/installations', signal) as Promise<EnterprisePluginInstallations>,
      this.options.request('plugins/device-targets', signal),
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
      const hasTarget = deviceTargets === undefined || deviceTargets.some(target => target.installationId === installation.id && target.desiredState === 'enabled')
      return installation.enabled && installation.desiredState === 'enabled' && hasTarget && release !== undefined
        ? [{ installation, release }]
        : []
    })
    const wanted = new Set<string>()
    for (const candidate of enabled) {
      const { installation, release } = candidate
      const archive = parsePackage(await this.options.requestBytes(`plugins/${release.id}/package`, signal), release)
      for (const target of archive.manifest.targets) {
        const key = this.key(installation.id, target.kind)
        wanted.add(key)
        const current = this.active.get(key)
        if (current?.releaseId === release.id && current.permissionRevision === installation.permissionRevision) continue
        if (current !== undefined) await this.stop(current, signal)
        await this.start(installation.id, installation.permissionRevision, release, archive, target.kind, target.entry, signal)
      }
    }

    // A server-side disable or uninstall can revoke a target after the local
    // contribution has already disappeared (for example while the desktop
    // was offline). Reconcile those rows explicitly; only walking `active`
    // would leave the server target stuck in `stopping` forever.
    if (deviceTargets !== undefined) {
      const activeKeys = new Set(this.active.keys())
      for (const target of deviceTargets) {
        if (target.desiredState === 'enabled'
          || target.observedState === 'disabled'
          || activeKeys.has(this.key(target.installationId, target.targetKind))) continue
        await this.options.request(`plugins/installations/${target.installationId}/deactivate`, signal, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: await this.options.deviceId(), targetKind: target.targetKind }),
        }).catch(() => {})
      }
      for (const installation of installations) {
        if (installation.desiredState !== 'uninstalled') continue
        const hasActive = [...this.active.values()].some(target => target.installationId === installation.id)
        if (hasActive) continue
        await this.options.request(`plugins/installations/${installation.id}/uninstall/complete`, signal, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
        }).catch(() => {})
      }
    }
    for (const [key, target] of [...this.active]) {
      if (!wanted.has(key)) await this.stop(target, signal)
    }
  }

  private async start(
    installationId: string,
    permissionRevision: number,
    release: RuntimeRelease,
    archive: VerifiedPackage,
    targetKind: 'host' | 'client',
    entry: string,
    signal: AbortSignal,
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
    let disposeContribution: (() => Promise<void>) | undefined
    try {
      if (targetKind === 'host') {
        disposeContribution = await mountPluginTarget(this.options.ctx, await importTarget(bytes, `${release.id}:${lease.activationId}`), bound.sdk)
      }
      const active: ActiveTarget = {
        installationId, releaseId: release.id, permissionRevision, pluginId: release.pluginId, version: release.version,
        targetKind, activationId: lease.activationId, transport, sdk: bound.sdk, invalidateSdk: bound.dispose,
        ...(targetKind === 'client' ? { source: strFromU8(bytes) } : {}),
        ...(disposeContribution === undefined ? {} : { disposeContribution }),
      }
      if (targetKind === 'host') await this.heartbeat(active, 'active', null, signal)
      this.active.set(this.key(installationId, targetKind), active)
    } catch (error) {
      await disposeContribution?.().catch(() => {})
      bound.dispose()
      await this.reportFailed(installationId, lease.activationId, deviceId, targetKind, error, signal)
      await this.options.request(`plugins/installations/${installationId}/deactivate`, signal, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, targetKind }),
      }).catch(() => {})
      throw error
    }
  }

  private async stop(target: ActiveTarget, signal: AbortSignal): Promise<void> {
    const deviceId = await this.options.deviceId()
    let revokeError: unknown
    try {
      await this.options.request(`plugins/installations/${target.installationId}/deactivate`, signal, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, targetKind: target.targetKind }),
      })
    } catch (error) { revokeError = error }
    target.invalidateSdk()
    let disposeError: unknown
    try { await target.disposeContribution?.() } catch (error) { disposeError = error }
    const failures = [revokeError, disposeError].filter(error => error !== undefined)
    const key = this.key(target.installationId, target.targetKind)
    if (failures.length) {
      const previous = this.cleanupFailures.get(key)
      const attempts = (previous?.attempts ?? 0) + 1
      this.cleanupFailures.set(key, { target, error: new AggregateError(failures, `Plugin ${target.pluginId} did not stop cleanly`), attempts, nextRetryAt: Date.now() + Math.min(60_000, 500 * 2 ** attempts) })
      this.active.delete(key)
      throw this.cleanupFailures.get(key)?.error
    }
    this.active.delete(key)
    this.cleanupFailures.delete(key)
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
    for (const target of [...this.active.values()]) {
      try { await this.heartbeat(target, 'active', null, controller.signal) }
      catch (error) {
        try { await this.stop(target, controller.signal) }
        catch (cleanupError) { this.options.ctx.logger('enterprise-plugin').error(cleanupError) }
        this.options.ctx.logger('enterprise-plugin').warn(error)
      }
    }
  }

  /** Retry a failed local contribution cleanup without restoring its authorization. */
  async retryCleanup(signal: AbortSignal = new AbortController().signal): Promise<void> {
    for (const failure of [...this.cleanupFailures.values()]) {
      if (failure.nextRetryAt > Date.now()) continue
      try { await this.stop(failure.target, signal) }
      catch { /* The failure remains recorded with an increased backoff. */ }
    }
  }

  /** Return Client targets whose activation credentials remain Host-owned. */
  clientTargets(): EnterpriseClientPluginTarget[] {
    return [...this.active.values()].flatMap(target => target.targetKind === 'client' && target.source !== undefined ? [{
      installationId: target.installationId, releaseId: target.releaseId, pluginId: target.pluginId,
      version: target.version, activationId: target.activationId, source: target.source,
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
    clearInterval(this.renewalTimer)
    const controller = new AbortController()
    const results = []
    for (const target of [...this.active.values()]) results.push(await Promise.resolve(this.stop(target, controller.signal)).then(() => undefined, error => error))
    const failures = results.filter(error => error !== undefined)
    if (failures.length) throw new AggregateError(failures, 'Enterprise plugin runtime did not stop cleanly')
  }
}
