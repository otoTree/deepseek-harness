/* oxlint-disable @stylistic/max-len -- Runtime transport requests mirror the enterprise lifecycle wire protocol. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { exports as resolveExports } from 'resolve.exports'
import { satisfies, validRange } from 'semver'
import { createRequire, isBuiltin } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import {
  pluginManifest,
  resolvePluginTargets,
  type PluginCapabilityTransport,
  type PluginClientContribution,
  type PluginSdk,
} from '@deepseek-ai/dsh-plugin-protocol'
import {
  bindPluginSdk,
  CordisPluginManager,
  createClientWindowBrokerPlatform,
  ClientWindowRegistry,
  type ClientWindowPlatform,
} from '@deepseek-ai/dsh-plugin-runtime'
import { createHttpPluginTransport } from '@deepseek-ai/dsh-plugin-sdk'
import { mcpConnectionStatusesForOwners, type McpConnectionStatus } from '@deepseek-ai/dsh-mcp-client'
import { init, parse } from 'es-module-lexer'
import { strFromU8 } from 'fflate'
import { verifyPluginPackage as parsePackage } from '@deepseek-ai/dsh-plugin-protocol/archive'
import { z } from 'zod'
import { load as loadYaml, dump as dumpYaml } from 'js-yaml'
import type { EnterprisePluginCatalog, EnterprisePluginInstallations } from './wire.ts'
import { marketCredentialKey, withHostCredentials } from './plugin-credentials.ts'
import { pluginAuthorizationFailure, pluginMcpConnection, pluginConfiguration, resolvePluginConfiguration, type pluginSettings, type pluginSettingsInput, type pluginConnectionSettings } from './wire.ts'
import { authorizePluginMcp } from './plugin-oauth.ts'

interface RuntimeRelease {
  readonly id: string
  readonly pluginId: string
  readonly version: string
  readonly digest?: string | undefined
}

interface VerifiedPackage {
  readonly manifest: ReturnType<typeof pluginManifest.parse>
  readonly entries: ReadonlyMap<string, Uint8Array>
  readonly digest: string
}

interface ActiveTarget {
  readonly hostOwners?: ReadonlySet<Fiber>
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
  readonly clientBundles?: readonly {
    readonly moduleId: string
    readonly source: string
    readonly contributions: Extract<ReturnType<typeof pluginManifest.parse>['targets'][number], { kind: 'client' }>['contributions']
  }[]
  readonly windowDisposers?: readonly (() => void)[]
  readonly disposeContribution?: () => Promise<void>
  readonly capabilityNames?: {
    readonly tools: readonly string[]
    readonly skills: readonly string[]
    readonly mcpTools: readonly string[]
  }
  readonly presets?: readonly { readonly id: string; readonly root: string; readonly packageId?: string; readonly presetId: string }[]
  /** Verified inputs used to restore this target when a replacement fails. */
  readonly releaseSpec: RuntimeRelease
  readonly config: Readonly<Record<string, unknown>>
  readonly archive: VerifiedPackage
  readonly targets: ReturnType<typeof resolvePluginTargets>
}

interface CleanupFailure {
  readonly target: ActiveTarget
  readonly error: unknown
  readonly attempts: number
  readonly nextRetryAt: number
}

/** Window-local Client mount state; it never changes the target lease. */
export interface EnterpriseClientWindowState {
  readonly windowId: string
  readonly moduleId: string
  readonly activationId: string
  readonly pluginId: string
  readonly mountState: 'active' | 'failed' | 'disconnected'
  readonly lastError: string | null
  readonly lastSeen: number
}

/** Runtime evidence for one installed product target. */
export interface EnterprisePluginCapabilityDiagnostic {
  readonly installationId: string
  readonly pluginId: string
  readonly version: string
  readonly targetKind: 'host' | 'client'
  readonly activationId: string
  readonly state: 'active' | 'stale'
  readonly tools: { readonly names: readonly string[]; readonly present: readonly string[] }
  readonly skills: { readonly names: readonly string[]; readonly present: readonly string[] }
  readonly mcpTools: { readonly names: readonly string[]; readonly present: readonly string[] }
  readonly mcpServers: readonly McpConnectionStatus[]
  readonly presets: readonly { readonly id: string; readonly present: boolean; readonly broken?: string }[]
  readonly clientSlots: readonly { readonly id: string; readonly slot: string; readonly present: boolean; readonly error?: string | undefined }[]
  readonly clientWindows: readonly EnterpriseClientWindowState[]
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
  readonly contributions: Extract<ReturnType<typeof pluginManifest.parse>['targets'][number], { kind: 'client' }>['contributions']
}

/** Native services, authenticated requests and execution budgets for one product/account scope. */
export interface EnterprisePluginRuntimeOptions {
  readonly ctx: Context
  readonly apiUrl: string
  readonly organizationId: string
  readonly deviceId: () => Promise<string>
  readonly request: (path: string, signal: AbortSignal, init?: RequestInit) => Promise<unknown>
  /** Product-owned transport; omitted consumers retain the enterprise lease transport. */
  readonly createTransport?: (activationId: string, token: string) => PluginCapabilityTransport
  readonly requestBytes: (path: string, signal: AbortSignal) => Promise<Uint8Array>
  /** Maximum time one target may spend preparing before its lease is failed. */
  readonly activationTimeoutMs?: number
  /** Maximum duration of a browser authorization, including human interaction. */
  readonly authorizationTimeoutMs?: number
  /** Maximum time one target stop may occupy reconciliation. */
  readonly cleanupTimeoutMs?: number
  /** ZIP validation limits, including the aggregate decompressed size. */
  readonly packageLimits?: {
    readonly maxFiles: number
    readonly maxPackageBytes: number
    readonly maxEntryBytes: number
    readonly maxExpandedBytes: number
  }
  readonly windowPlatform?: ClientWindowPlatform
  readonly windowBroker?: { readonly url: string; readonly token: string }
}

interface ReconcileOptions {
  /** Abort an in-flight lifecycle pass before starting this pass. */
  readonly supersede?: boolean
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
  try {
    const boundedSignal = AbortSignal.any([signal, controller.signal])
    return await untilAbort(operation(boundedSignal), boundedSignal)
  }
  finally { clearTimeout(timer) }
}

async function untilAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => { reject(signal.reason instanceof Error ? signal.reason : new Error('Plugin target activation aborted')) }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
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


interface BundledHostPackage {
  readonly root: string
  readonly files: ReadonlySet<string>
  readonly defaultEntry: string
  readonly metadata: { readonly name: string; readonly version: string; readonly exports?: unknown }
}

function packageSpecifier(specifier: string): { readonly name: string; readonly subpath: string } {
  const parts = specifier.split('/')
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? ''
  return { name, subpath: parts.slice(name.startsWith('@') ? 2 : 1).join('/') }
}

function hostModuleUrl(
  specifier: string,
  dependencies: Readonly<Record<string, string>>,
  bundled: ReadonlyMap<string, BundledHostPackage>,
): string {
  const { name: packageName, subpath } = packageSpecifier(specifier)
  const dependencyVersion = Object.hasOwn(dependencies, packageName) ? dependencies[packageName] : undefined
  const bundledPackage = bundled.get(packageName)
  if (bundledPackage !== undefined) {
    if (dependencyVersion === undefined) {
      throw new Error(`Plugin Host target imports bundled module ${packageName} without declaring it as a dependency`)
    }
    checkDependencyVersion(packageName, bundledPackage.metadata.version, dependencyVersion)
    const exports = resolveExports(bundledPackage.metadata, subpath === '' ? '.' : `./${subpath}`)
    const candidates = exports === undefined
      ? subpath === '' ? [bundledPackage.defaultEntry] : [subpath, `host/${subpath}`]
      : exports.map(path => path.replace(/^\.\//u, ''))
    const relativePath = candidates.find(candidate => bundledPackage.files.has(candidate))
    if (relativePath === undefined || relativePath.includes('..') || relativePath.startsWith('/')) {
      throw new Error(`Bundled plugin dependency ${specifier} does not expose a Host module`)
    }
    return pathToFileURL(join(bundledPackage.root, ...relativePath.split('/'))).href
  }
  if (packageName !== '@deepseek-ai/cordis' && dependencyVersion === undefined) {
    throw new Error(`Plugin Host target imports undeclared external module ${specifier}`)
  }
  const anchor = process.env.DSH_INSTALL_ANCHOR
  const resolveFrom = createRequire(anchor === undefined || anchor === '' ? import.meta.url : anchor)
  try {
    const resolved = resolveFrom.resolve(specifier)
    if (dependencyVersion !== undefined) {
      let directory = dirname(resolved)
      for (;;) {
        let metadata: { name?: string; version?: string } | undefined
        try { metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: string; version?: string } }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        if (metadata?.name === packageName && metadata.version !== undefined) {
          checkDependencyVersion(packageName, metadata.version, dependencyVersion)
          break
        }
        const parent = dirname(directory)
        if (parent === directory) throw new Error(`Cannot verify Harness dependency ${packageName}`)
        directory = parent
      }
    }
    return pathToFileURL(resolved).href
  }
  catch (error) {
    throw new Error(`Plugin Host dependency ${packageName} is not provided by this Harness installation`, { cause: error })
  }
}

function checkDependencyVersion(name: string, version: string, requested: string): void {
  const value = requested.replace(/^workspace:/u, '')
  const range = requested.startsWith('workspace:') && (value === '^' || value === '~') ? `${value}${version}` : value
  if (validRange(range) === null || !satisfies(version, range, { includePrerelease: true })) throw new Error(`Plugin dependency ${name}@${requested} is incompatible with installed ${version}`)
}

async function linkHostSource(
  source: string,
  dependencies: Readonly<Record<string, string>>,
  bundled: ReadonlyMap<string, BundledHostPackage>,
  relativePath: string,
  files: ReadonlySet<string>,
): Promise<string> {
  await init
  const [imports] = parse(source)
  const replacements = imports.flatMap((entry) => {
    if (entry.d === -2) return []
    if (entry.n === undefined) throw new Error('Plugin Host target contains a non-literal dynamic import')
    if (entry.n.startsWith('.')) {
      const target = new URL(entry.n, `file:///package/${relativePath}`).pathname
      const file = decodeURIComponent(target).slice('/package/'.length)
      if (!target.startsWith('/package/') || !files.has(file)) throw new Error(`Plugin Host import ${entry.n} from ${relativePath} is missing or escapes its package`)
      return []
    }
    if (isBuiltin(entry.n)) return []
    const linked = hostModuleUrl(entry.n, dependencies, bundled)
    return [{ start: entry.s, end: entry.e, value: entry.d === -1 ? linked : JSON.stringify(linked) }]
  })
  return replacements.sort((left, right) => right.start - left.start).reduce(
    (linked, replacement) => linked.slice(0, replacement.start) + replacement.value + linked.slice(replacement.end),
    source,
  )
}

async function installHostPackage(
  ctx: Context,
  organizationId: string,
  pluginId: string,
  version: string,
  releaseDigest: string | undefined,
  packageInfo: {
    readonly id: string | undefined
    readonly name: string | undefined
    readonly dependencies: Readonly<Record<string, string>>
    readonly bundled: ReadonlyMap<string, BundledHostPackage>
  },
  entryPath: string,
  source: Uint8Array,
  archiveEntries: ReadonlyMap<string, Uint8Array>,
  embeddedPackageJson?: string,
): Promise<{ entry: string; sdkProvider: string; packageRoot: string }> {
  const homePath = (ctx as Context & { dshHomePath?: (...segments: string[]) => string }).dshHomePath
  if (homePath === undefined) throw new Error('The DSH Home path service is unavailable')
  const root = homePath('plugins', organizationId, 'installed', pluginId, version, releaseDigest ?? digest(source))
  const packageRoot = packageInfo.id === undefined ? root : join(root, packageInfo.id)
  const archivePrefix = packageInfo.id === undefined ? '' : `packages/${packageInfo.id}/`
  const packageFiles = [...archiveEntries].filter(([path]) => packageInfo.id === undefined
    ? path === entryPath || path.startsWith('host/') || path.startsWith('assets/')
    : path.startsWith(archivePrefix) && path !== `packages/${packageInfo.id}/package.json`)
  const entry = join(packageRoot, ...(packageInfo.id === undefined ? entryPath : entryPath.slice(archivePrefix.length)).split('/'))
  const host = join(packageRoot, 'host')
  const sdkProvider = join(host, 'sdk-provider.mjs')
  await mkdir(host, { recursive: true, mode: 0o700 })
  const packageJson = embeddedPackageJson ?? `${JSON.stringify({ name: packageInfo.name ?? `@harness-market/${pluginId}`, version, type: 'module', dependencies: packageInfo.dependencies })}\n`
  const existingPackageJson = (await readOptionalFile(join(packageRoot, 'package.json')))?.toString('utf8')
  if (existingPackageJson !== undefined && existingPackageJson !== packageJson) {
    throw new Error('An installed plugin version already exists with different package contents')
  }
  if (existingPackageJson === undefined) await writeFile(join(packageRoot, 'package.json'), packageJson, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  for (const [path, bytes] of packageFiles) {
    const relativePath = packageInfo.id === undefined ? path : path.slice(archivePrefix.length)
    const installedPath = join(packageRoot, ...relativePath.split('/'))
    const contents = !relativePath.startsWith('client/') && /\.(?:mjs|js)$/u.test(relativePath)
      ? Buffer.from(await linkHostSource(strFromU8(bytes), packageInfo.dependencies, packageInfo.bundled, relativePath, new Set(packageFiles.map(([path]) => path.slice(archivePrefix.length)))))
      : bytes
    await mkdir(dirname(installedPath), { recursive: true, mode: 0o700 })
    const existing = await readOptionalFile(installedPath)
    if (existing !== undefined) {
      if (!Buffer.from(existing).equals(Buffer.from(contents))) {
        throw new Error('An installed plugin version already exists with different package contents')
      }
    } else {
      await writeFile(installedPath, contents, { mode: 0o600, flag: 'wx' })
    }
  }
  await writeFile(sdkProvider, "export default { name: 'enterprise-plugin-sdk-provider', apply(ctx, config) { ctx.provide('pluginSdk', config.sdk) } }\n", { encoding: 'utf8', mode: 0o600 })
  return { entry, sdkProvider, packageRoot }
}

function linkPresetComposition(
  input: unknown, dependencies: Readonly<Record<string, string>>, bundled: ReadonlyMap<string, BundledHostPackage>,
): unknown[] {
  const rows = z.array(z.looseObject({ name: z.string().min(1), group: z.boolean().optional(), config: z.unknown().optional() })).parse(input)
  return rows.map((row) => {
    if (row.name === 'cordis:group' && row.group === true) return { ...row, config: linkPresetComposition(row.config, dependencies, bundled) }
    if (row.group === true || row.name.startsWith('.') || row.name.startsWith('/') || row.name.includes(':')) throw new Error(`Agent preset must reference a declared Cordis package: ${row.name}`)
    const { name } = packageSpecifier(row.name)
    if (['@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-llm', '@deepseek-ai/cordis', '@deepseek-ai/cordis-plugin-loader'].includes(name)) throw new Error(`Agent preset cannot replace Host runtime ${name}`)
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Agent preset references undeclared package ${name}`)
    return { ...row, name: hostModuleUrl(row.name, dependencies, bundled) }
  })
}

async function installPresetFiles(
  ctx: Context,
  pluginId: string,
  packageId: string | undefined,
  presets: readonly { readonly id: string; readonly entry: string }[],
  entries: ReadonlyMap<string, Uint8Array>,
  dependencies: Readonly<Record<string, string>>,
  bundled: ReadonlyMap<string, BundledHostPackage>,
  installed: { id: string; root: string; packageId?: string; presetId: string }[],
  signal: AbortSignal,
): Promise<void> {
  if (presets.length === 0) return
  const homePath = (ctx as Context & { dshHomePath?: (...segments: string[]) => string }).dshHomePath
  if (homePath === undefined) throw new Error('The DSH Home path service is unavailable')
  for (const preset of presets) {
    signal.throwIfAborted()
    const raw = entries.get(preset.entry)
    if (raw === undefined) throw new Error(`Plugin package omits preset ${preset.entry}`)
    const bytes = Buffer.from(dumpYaml(linkPresetComposition(loadYaml(strFromU8(raw)), dependencies, bundled)))
    const identity = JSON.stringify([pluginId, packageId ?? null, preset.id])
    const label = `${pluginId}-${packageId ?? 'legacy'}-${preset.id}`.replaceAll('.', '-').replaceAll('_', '-').replace(/-+/gu, '-')
    const id = `${label}-${digest(Buffer.from(identity)).slice(0, 16)}`
    const root = homePath('.agent-presets', id)
    const path = join(root, 'agent.cordis.yml')
    const markerPath = join(root, '.dsh-plugin-owned')
    const presetPrefix = `packages/${packageId}/presets/${preset.id}/`
    const presetEntries = [...entries].filter(([entry]) => entry.startsWith(presetPrefix))
    if (presetEntries.length === 0) throw new Error(`Plugin package omits preset resources for ${preset.entry}`)
    const existing = await readOptionalFile(path)
    if (existing !== undefined && !Buffer.from(existing).equals(Buffer.from(bytes))) {
      throw new Error(`Agent preset ${id} already exists with different contents`)
    }
    const marker = JSON.stringify({ pluginId, packageId: packageId ?? null, presetId: preset.id }) + '\n'
    const existingMarker = (await readOptionalFile(markerPath))?.toString('utf8')
    if (existing !== undefined && existingMarker === undefined) throw new Error(`Agent preset ${id} is not managed by the plugin installer`)
    if (existingMarker !== undefined && existingMarker !== marker) throw new Error(`Agent preset ${id} is owned by another installer`)
    await mkdir(root, { recursive: true, mode: 0o700 })
    if (existingMarker === undefined) await writeFile(markerPath, marker, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    installed.push({ id, root, ...(packageId === undefined ? {} : { packageId }), presetId: preset.id })
    for (const [entry, rawResource] of presetEntries) {
      signal.throwIfAborted()
      const resource = entry === preset.entry ? bytes : rawResource
      const resourcePath = join(root, ...relative(presetPrefix, entry).split('/'))
      await mkdir(dirname(resourcePath), { recursive: true, mode: 0o700 })
      const current = await readOptionalFile(resourcePath)
      if (current !== undefined && !Buffer.from(current).equals(Buffer.from(resource))) {
        throw new Error(`Agent preset resource ${entry} already exists with different contents`)
      }
      if (current === undefined) await writeFile(resourcePath, resource, { mode: 0o600, flag: 'wx' })
    }
  }
}

async function readOptionalFile(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function removeOwnedPreset(item: { readonly root: string }, pluginId: string, packageId: string | undefined, presetId: string): Promise<void> {
  const markerPath = join(item.root, '.dsh-plugin-owned')
  const expected = JSON.stringify({ pluginId, packageId: packageId ?? null, presetId }) + '\n'
  const marker = await readFile(markerPath, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
  if (marker === undefined) return
  if (marker !== expected) throw new Error(`Refusing to remove unmanaged Agent preset ${item.root}`)
  await rm(item.root, { recursive: true, force: true })
}

/** Remove a managed preset file and retire its standing Cordis generation. */
async function revokeOwnedPreset(
  ctx: Context,
  item: { readonly id: string; readonly root: string },
  pluginId: string,
  packageId: string | undefined,
  presetId: string,
): Promise<void> {
  await removeOwnedPreset(item, pluginId, packageId, presetId)
  const presets = ctx.get('agentPresets') as { revokeManaged?: (id: string) => Promise<void> } | undefined
  await presets?.revokeManaged?.(item.id)
}

/** Resolve bundled package imports against the verified archive's installed roots. */
function bundledHostPackages(
  ctx: Context,
  organizationId: string,
  release: RuntimeRelease,
  archive: VerifiedPackage,
): ReadonlyMap<string, BundledHostPackage> {
  const homePath = (ctx as Context & { dshHomePath?: (...segments: string[]) => string }).dshHomePath
  if (homePath === undefined || archive.manifest.packages === undefined) return new Map()
  const resolved = new Map<string, BundledHostPackage>()
  for (const item of archive.manifest.packages) {
    const hostTarget = item.targets.find(target => target.kind === 'host')
    if (hostTarget === undefined) continue
    const prefix = `packages/${item.id}/`
    const root = homePath('plugins', organizationId, 'installed', release.pluginId, release.version, archive.digest, item.id)
    const files = new Set([...archive.entries.keys()]
      .filter(path => path.startsWith(prefix) && path !== `${prefix}package.json`)
      .map(path => path.slice(prefix.length)))
    const bytes = archive.entries.get(`${prefix}package.json`)
    if (bytes === undefined) throw new Error(`Missing package metadata for ${item.name}`)
    const metadata = JSON.parse(strFromU8(bytes)) as BundledHostPackage['metadata']
    resolved.set(item.name, { root, files, metadata, defaultEntry: hostTarget.entry.slice(prefix.length) })
  }
  return resolved
}

function toolNames(ctx: Context): string[] {
  const tools = ctx.get('tools') as { schemas: () => readonly { name: string }[] } | undefined
  return tools?.schemas() .map(tool => tool.name) ?? []
}

async function skillNames(ctx: Context): Promise<string[]> {
  const skills = ctx.get('skills') as { snapshot: () => Promise<{ skills: readonly { name: string }[] }> } | undefined
  return skills === undefined ? [] : (await skills.snapshot()).skills.map(skill => skill.name)
}

/** Reconciles control-plane desired state with live Host and browser targets. */
export class EnterprisePluginRuntime {
  private readonly authorizations = new Map<string, { controller: AbortController; done: Promise<void>; releaseId: string; permissionRevision: number; url?: string; error?: string; complete: boolean }>()
  private readonly manager: CordisPluginManager
  private readonly active = new Map<string, ActiveTarget>()
  private readonly pendingReplacements = new Map<string, { previous: readonly ActiveTarget[]; releaseId: string; permissionRevision: number }>()
  private readonly cleanupFailures = new Map<string, CleanupFailure>()
  private serial: Promise<void> = Promise.resolve()
  private readonly renewalTimer: ReturnType<typeof setInterval>
  private cleanupRetryTimer: ReturnType<typeof setTimeout> | undefined
  private readonly clientMounts = new Map<string, EnterpriseClientWindowState>()
  private readonly clientSlots = new Map<string, EnterprisePluginCapabilityDiagnostic['clientSlots']>()
  private readonly lifecycleController = new AbortController()
  private reconciliationController: AbortController | undefined
  private disposed = false
  /** Native windows owned by the active plugin targets; disposed with this runtime. */
  readonly clientWindows: ClientWindowRegistry

  private async settingsPackage(installationId: string, signal: AbortSignal) {
    const installations = await this.options.request('plugins/installations', signal) as EnterprisePluginInstallations
    const installation = installations.find(item => item.id === installationId && item.desiredState !== 'uninstalled')
    if (installation === undefined) throw new Error('plugin/installation-unavailable')
    const catalog = await this.options.request('plugins/catalog', signal) as EnterprisePluginCatalog
    const release = catalog.find(item => item.id === installation.releaseId)
    if (release === undefined) throw new Error('plugin/release-unavailable')
    const archive = parsePackage(await this.options.requestBytes(`plugins/${release.id}/package`, signal), release, this.options.packageLimits ?? { maxFiles: 256, maxPackageBytes: 32 * 1024 * 1024, maxEntryBytes: 16 * 1024 * 1024, maxExpandedBytes: 32 * 1024 * 1024 })
    return { installation, archive }
  }

  private async connectionPackage(installationId: string, signal: AbortSignal) {
    const { installation, archive } = await this.settingsPackage(installationId, signal)
    const contributions = archive.manifest.contributions
    if (Array.isArray(contributions) || contributions.mcpConnection === undefined) throw new Error('plugin/connection-unavailable')
    const connection = pluginMcpConnection.parse(contributions.mcpConnection)
    return { installation, archive, connection }
  }

  /** Read setup metadata and saved non-secret values from a verified plugin archive.
   * @param installationId - Installation visible to the current account.
   * @param signal - Cancellation of package and installation reads.
   * @returns Form fields and credential presence without secret values.
   */
  async settings(installationId: string, signal: AbortSignal): Promise<z.infer<typeof pluginSettings>> {
    const { installation, archive } = await this.settingsPackage(installationId, signal)
    const metadata = archive.manifest.contributions
    if (Array.isArray(metadata) || metadata.configuration === undefined) throw new Error('plugin/configuration-unavailable')
    const specification = pluginConfiguration.parse(metadata.configuration)
    const credentials = await Promise.all((archive.manifest.credentialDescriptors ?? []).filter(item => item.kind !== 'oauth').map(async item => ({
      name: item.name, label: item.label ?? item.name,
      configured: await this.options.ctx.get('credentials')?.readRecord(marketCredentialKey({ organizationId: this.options.organizationId, installationId }, item.name)) !== undefined,
    })))
    const config = Object.fromEntries(specification.fields.flatMap((field) => {
      const value = installation.config[field.name] ?? field.default
      return value === undefined ? [] : [[field.name, value]]
    }))
    return { installationId, specification, config, credentials }
  }

  /** Save ordinary settings and scoped credentials after the API verifies write authority.
   * @param input - Declared field values and nonempty replacement secrets.
   * @param signal - Cancellation of preparation and reconciliation.
   * @returns Once settings are saved and the installation is enabled.
   */
  async configureSettings(input: z.infer<typeof pluginSettingsInput>, signal: AbortSignal): Promise<void> {
    const { installation, archive } = await this.settingsPackage(input.installationId, signal)
    const metadata = archive.manifest.contributions
    if (Array.isArray(metadata) || metadata.configuration === undefined) throw new Error('plugin/configuration-unavailable')
    const specification = pluginConfiguration.parse(metadata.configuration)
    const descriptors = (archive.manifest.credentialDescriptors ?? []).filter(item => item.kind !== 'oauth')
    if (Object.keys(input.config).some(name => !specification.fields.some(field => field.name === name))
      || Object.keys(input.credentials).some(name => !descriptors.some(item => item.name === name))) throw new Error('plugin/undeclared-setting')
    if (Object.keys(input.credentials).length > 0 && !archive.manifest.permissions.includes('credentials.write')) throw new Error('plugin/unsupported-capability')
    const config = resolvePluginConfiguration(specification, { ...installation.config, ...input.config })
    const credentials = this.options.ctx.get('credentials')
    for (const descriptor of descriptors) {
      if (input.credentials[descriptor.name] === undefined && !await credentials?.readRecord(marketCredentialKey({ organizationId: this.options.organizationId, installationId: input.installationId }, descriptor.name))) throw new Error(`plugin/not-configured: ${descriptor.label ?? descriptor.name}`)
    }
    if (descriptors.length > 0 && credentials === undefined) throw new Error('plugin/credentials-unavailable')
    // API ownership checks precede local secret writes and stopping the running target.
    await this.options.request(`plugins/installations/${input.installationId}`, signal, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false, config }) })
    await this.reconcile(signal)
    signal.throwIfAborted()
    if (credentials !== undefined) {
      for (const [name, value] of Object.entries(input.credentials)) {
        await credentials.modifyRecord(marketCredentialKey({ organizationId: this.options.organizationId, installationId: input.installationId }, name), () => Promise.resolve({ kind: 'grant', payload: { name, value } }))
      }
    }
    await this.options.request(`plugins/installations/${input.installationId}`, signal, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) })
  }

  /** Read verified connection fields and credential presence without returning secrets.
   * @param installationId - Installation visible to this account.
   * @param signal - Cancellation of installation and package reads.
   * @returns Browser-safe service connection configuration.
   */
  async connectionSettings(installationId: string, signal: AbortSignal): Promise<z.infer<typeof pluginConnectionSettings>> {
    const { installation, connection } = await this.connectionPackage(installationId, signal)
    const name = connection.auth === 'oauth' ? 'oauth-state' : 'api-key'
    const record = await this.options.ctx.get('credentials')?.readRecord(marketCredentialKey({ organizationId: this.options.organizationId, installationId }, name))
    return { installationId, connection, ...(typeof installation.config.mcpUrl === 'string' ? { customUrl: installation.config.mcpUrl } : {}), configured: (connection.url !== undefined || typeof installation.config.mcpUrl === 'string') && (connection.auth === 'none' || record !== undefined) }
  }

  /** Commit connection inputs after the API checks write authority; restart through reconciliation.
   * @param input - Installation and human-supplied endpoint or token.
   * @param signal - Cancels authorization and configuration operations.
   * @returns Once credentials and non-secret configuration have been saved.
   */
  async configureConnection(input: { installationId: string; url?: string | undefined; token?: string | undefined }, signal: AbortSignal): Promise<void> {
    const { installation, archive, connection } = await this.connectionPackage(input.installationId, signal)
    if (input.url !== undefined && connection.url !== undefined) throw new Error('plugin/fixed-endpoint')
    if (input.token !== undefined && connection.auth !== 'token') throw new Error('plugin/token-not-supported')
    if (input.token !== undefined && !archive.manifest.permissions.includes('credentials.write')) throw new Error('plugin/unsupported-capability')
    const config = {
      ...installation.config,
      ...(connection.url === undefined ? input.url === undefined ? {} : { mcpUrl: input.url } : { mcpUrl: connection.url }),
      ...(connection.auth === 'oauth' ? { auth: 'oauth' } : {}),
    }
    if (connection.url === undefined && typeof config.mcpUrl !== 'string') throw new Error('plugin/not-configured: MCP URL is required')
    // This mutation enforces personal/organization ownership before any local credential write.
    await this.options.request(`plugins/installations/${input.installationId}`, signal, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false, config }) })
    await this.reconcile(signal)
    signal.throwIfAborted()
    if (input.token !== undefined) {
      const credentials = this.options.ctx.get('credentials')
      if (credentials === undefined) throw new Error('plugin/credentials-unavailable')
      await credentials.modifyRecord(marketCredentialKey({ organizationId: this.options.organizationId, installationId: input.installationId }, 'api-key'), () => Promise.resolve({ kind: 'grant', payload: { name: 'api-key', value: input.token } }))
    }
    if (connection.auth !== 'oauth') await this.options.request(`plugins/installations/${input.installationId}`, signal, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) })
  }

  /** Start PKCE discovery and return the service login URL; tokens stay in Host storage.
   * @param installationId - Installation to authorize.
   * @param signal - Cancels preparation before the browser login begins.
   * @returns Service authorization URL or an already completed grant.
   */
  async authorizeConnection(installationId: string, signal: AbortSignal): Promise<{ url?: string }> {
    const previous = this.authorizations.get(installationId)
    if (previous?.complete || previous?.error) this.authorizations.delete(installationId)
    if (this.authorizations.has(installationId)) throw new Error('plugin/authorization-in-progress')
    const { connection, archive, installation } = await this.connectionPackage(installationId, signal)
    if (connection.auth !== 'oauth' || connection.url === undefined || !archive.manifest.permissions.includes('authorization.oauth')) throw new Error('plugin/unsupported-capability')
    await this.configureConnection({ installationId }, signal)
    const controller = new AbortController()
    const flow = { controller, done: Promise.resolve(), releaseId: installation.releaseId, permissionRevision: installation.permissionRevision, complete: false } as { controller: AbortController; done: Promise<void>; releaseId: string; permissionRevision: number; url?: string; error?: string; complete: boolean }
    let deliver!: (value: { url?: string }) => void
    let reject!: (error: unknown) => void
    const initial = new Promise<{ url?: string }>((resolve, fail) => { deliver = resolve; reject = fail })
    this.authorizations.set(installationId, flow)
    const authorizationSignal = AbortSignal.any([controller.signal, this.lifecycleController.signal, AbortSignal.timeout(this.options.authorizationTimeoutMs ?? 300_000)])
    flow.done = authorizePluginMcp(this.options.ctx, { organizationId: this.options.organizationId, installationId }, connection.url, authorizationSignal, (url) => { flow.url = url; deliver({ url }) }, async () => {
      const current = await this.connectionPackage(installationId, authorizationSignal)
      if (current.installation.releaseId !== flow.releaseId || current.installation.permissionRevision !== flow.permissionRevision) throw new Error('plugin/authorization-cancelled')
      await this.options.request(`plugins/installations/${installationId}`, authorizationSignal, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) })
    }, connection.oauth).then(async () => {
      await this.options.request(`plugins/installations/${installationId}`, authorizationSignal, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) })
      await this.reconcile(authorizationSignal)
      flow.complete = true; deliver({})
    }).catch((error: unknown) => {
      flow.error = pluginAuthorizationFailure.safeParse(error instanceof Error ? error.message : undefined).data ?? 'plugin/authorization-failed'
      reject(new Error(flow.error))
    })
    return untilAbort(initial, signal)
  }

  /** Read or cancel one Host-owned browser authorization attempt.
   * @param installationId - Installation that owns the attempt.
   * @param cancel - Whether to withdraw the attempt.
   * @returns Token-free attempt status.
   */
  async authorizationStatus(installationId: string, cancel = false): Promise<{ complete: boolean; error?: string }> {
    const flow = this.authorizations.get(installationId)
    if (flow === undefined) { if (cancel) return { complete: false }; throw new Error('plugin/authorization-unavailable') }
    if (cancel) { flow.controller.abort(); await flow.done }
    if (cancel || flow.complete || flow.error !== undefined) this.authorizations.delete(installationId)
    return { complete: flow.complete, ...(flow.error === undefined ? {} : { error: flow.error }) }
  }

  constructor(private readonly options: EnterprisePluginRuntimeOptions) {
    this.manager = new CordisPluginManager(options.ctx)
    this.clientWindows = new ClientWindowRegistry(options.windowPlatform ?? (options.windowBroker === undefined
      ? {
        create: () => { throw new Error('No native Client window platform is attached') },
        close: () => {},
        focus: () => { throw new Error('No native Client window platform is attached') },
      }
      : createClientWindowBrokerPlatform(options.windowBroker)))
    this.renewalTimer = setInterval(() => { void this.renewLeases() }, 5 * 60 * 1000)
    if (typeof this.renewalTimer === 'object' && 'unref' in this.renewalTimer) this.renewalTimer.unref()
  }

  private key(installationId: string, targetKind: 'host' | 'client'): string {
    return `${installationId}:${targetKind}`
  }

  /** Download, verify, activate, and unload targets until observed state matches desired state.
   * @param signal - Cancels this lifecycle pass.
   * @param options - Controls superseding an in-flight pass; passes remain serialized.
   */
  reconcile(signal: AbortSignal, options: ReconcileOptions = {}): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Enterprise plugin runtime disposed'))
    if (options.supersede !== false) this.reconciliationController?.abort(new Error('Plugin reconciliation superseded'))
    const controller = new AbortController()
    this.reconciliationController = controller
    const lifecycleSignal = AbortSignal.any([signal, this.lifecycleController.signal, controller.signal])
    const next = this.serial.then(() => this.reconcileNow(lifecycleSignal)).finally(() => {
      if (this.reconciliationController === controller) this.reconciliationController = undefined
    })
    this.serial = next.catch(() => {})
    return next
  }

  private async reconcileNow(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await this.retryCleanupNow(signal)
    signal.throwIfAborted()
    const [catalog, installations, rawDeviceTargets] = await untilAbort(Promise.all([
      this.options.request('plugins/catalog', signal) as Promise<EnterprisePluginCatalog>,
      this.options.request('plugins/installations', signal) as Promise<EnterprisePluginInstallations>,
      this.options.request('plugins/device-targets', signal).catch((error: unknown) => {
        this.options.ctx.logger('enterprise-plugin').warn(error)
        return undefined
      }),
    ]), signal)
    signal.throwIfAborted()
    const deviceTargets = Array.isArray(rawDeviceTargets) ? rawDeviceTargets as readonly {
      installationId: string
      targetKind: 'host' | 'client'
      desiredState: string
      observedState: string
      releaseId: string
      permissionRevision: number
      activationId?: string | null
      leaseExpiresAt?: string | null
    }[] : undefined
    const releases = new Map(catalog.map(release => [release.id, release]))
    for (const [id, flow] of this.authorizations) {
      const installation = installations.find(item => item.id === id)
      if (installation === undefined || installation.desiredState === 'uninstalled' || installation.releaseId !== flow.releaseId || installation.permissionRevision !== flow.permissionRevision) flow.controller.abort()
    }
    const enabled = installations.flatMap((installation) => {
      const release = releases.get(installation.releaseId)
      const installationTargets = deviceTargets?.filter(target => target.installationId === installation.id
        && target.releaseId === installation.releaseId
        && target.permissionRevision === installation.permissionRevision)
      const hasTarget = deviceTargets === undefined || installationTargets?.length === 0 || installationTargets?.some(target => target.desiredState === 'enabled')
      return installation.enabled && installation.desiredState === 'enabled' && hasTarget && release !== undefined
        ? [{ installation, release }]
        : []
    })
    const wanted = new Set<string>()
    const archives = await Promise.allSettled(enabled.map(async ({ installation, release }) => ({
      installation,
      release,
      archive: parsePackage(await untilAbort(this.options.requestBytes(`plugins/${release.id}/package`, signal), signal), release,
        this.options.packageLimits ?? { maxFiles: 256, maxPackageBytes: 32 * 1024 * 1024, maxEntryBytes: 16 * 1024 * 1024, maxExpandedBytes: 32 * 1024 * 1024 }),
    })))
    signal.throwIfAborted()
    const enabledIds = new Set(enabled.map(item => item.installation.id))
    for (const id of this.pendingReplacements.keys()) if (!enabledIds.has(id)) this.pendingReplacements.delete(id)
    const targetTasks: Promise<void>[] = []
    for (const result of archives) {
      if (result.status === 'rejected') {
        this.options.ctx.logger('enterprise-plugin').error(result.reason)
        // A bad replacement archive must not turn a previously verified
        // release into an outage. Keep its live targets until the control
        // plane publishes a valid replacement; the next reconciliation will
        // retry the download and activation.
        const failedInstallation = enabled[archives.indexOf(result)]?.installation
        if (failedInstallation !== undefined) {
          for (const key of this.active.keys()) {
            if (key.startsWith(`${failedInstallation.id}:`)) wanted.add(key)
          }
        }
        continue
      }
      const { installation, release, archive } = result.value
      const resolvedTargets = resolvePluginTargets(archive.manifest)
      // Keep targets of one product in a single lifecycle task. The API lease
      // and permission revision belong to the product, so activating Host and
      // Client concurrently can let one target observe a revision that the
      // other target has already rolled back. Independent products still run
      // concurrently through the surrounding task list.
      targetTasks.push(this.reconcileProduct(
        installation.id, installation.permissionRevision, installation.config, release, archive, resolvedTargets,
        deviceTargets, signal, wanted,
      ))
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
        const deviceId = await bounded(this.options.deviceId(), cleanupTimeout(this.options), 'Plugin device identity')
        await bounded(this.options.request(`plugins/installations/${target.installationId}/deactivate`, timeoutSignal(signal, cleanupTimeout(this.options)), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId, targetKind: target.targetKind, revokeOnly: true }),
        }), cleanupTimeout(this.options), `Plugin ${target.installationId} target deactivation`)
      }))
    }
    await Promise.allSettled([...this.active].filter(([key]) => !wanted.has(key)).map(async ([, target]) => {
      try { await this.stop(target) }
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
      void this.reconcile(new AbortController().signal).catch((error: unknown) => {
        this.options.ctx.logger('enterprise-plugin').error(error)
      })
    }, delay)
    if (typeof this.cleanupRetryTimer === 'object' && 'unref' in this.cleanupRetryTimer) this.cleanupRetryTimer.unref()
  }

  /** Reconcile all targets of one product as one replacement transaction. */
  private async reconcileProduct(
    installationId: string,
    permissionRevision: number,
    config: Readonly<Record<string, unknown>>,
    release: RuntimeRelease,
    archive: VerifiedPackage,
    resolvedTargets: ReturnType<typeof resolvePluginTargets>,
    deviceTargets: readonly {
      readonly installationId: string
      readonly targetKind: 'host' | 'client'
      readonly releaseId: string
      readonly permissionRevision: number
      readonly activationId?: string | null
    }[] | undefined,
    signal: AbortSignal,
    wanted: Set<string>,
  ): Promise<void> {
    const targetKinds = (['host', 'client'] as const).filter(kind => resolvedTargets.some(item => item.target.kind === kind))
    for (const kind of targetKinds) wanted.add(this.key(installationId, kind))
    const previous = [...this.active.values()].filter(target => target.installationId === installationId)
    const changed = targetKinds.some((kind) => {
      const current = previous.find(target => target.targetKind === kind)
      const serverTarget = deviceTargets?.find(target => target.installationId === installationId && target.targetKind === kind)
      return current?.releaseId !== release.id || current.permissionRevision !== permissionRevision
        || JSON.stringify(current.config) !== JSON.stringify(config)
        || (serverTarget?.activationId !== undefined && serverTarget.activationId !== current.activationId)
    }) || previous.some(target => !targetKinds.includes(target.targetKind))
    if (!changed) return
    this.pendingReplacements.delete(installationId)
    try {
      // A product revision owns every target lease. All previous targets must
      // leave before a replacement can publish any of its contributions.
      for (const old of previous) await this.stop(old)
      for (const kind of targetKinds) {
        if (this.cleanupFailures.has(this.key(installationId, kind))) throw new Error(`Plugin ${release.pluginId} has pending cleanup`)
        await withinDeadline(signal, activationTimeout(this.options), `Plugin ${release.pluginId} ${kind} activation`, activationSignal =>
          this.start(installationId, permissionRevision, config, release, archive, kind, resolvedTargets.filter(item => item.target.kind === kind), activationSignal))
      }
      if (targetKinds.includes('client') && previous.some(old => old.releaseId !== release.id)) {
        this.pendingReplacements.set(installationId, { previous, releaseId: release.id, permissionRevision })
      }
    } catch (error) {
      await this.restoreProduct(installationId, release.id, permissionRevision, previous, error, signal)
      for (const target of this.active.values()) if (target.installationId === installationId) wanted.add(this.key(installationId, target.targetKind))
    }
  }

  /** Clear partial contributions and restore a previous release only after the API accepts its revision. */
  private async restoreProduct(
    installationId: string, releaseId: string, permissionRevision: number,
    previous: readonly ActiveTarget[], failure: unknown, signal: AbortSignal,
  ): Promise<void> {
    this.pendingReplacements.delete(installationId)
    const cleanup = await Promise.allSettled([...this.active.values()]
      .filter(target => target.installationId === installationId).map(target => this.stop(target)))
    if (cleanup.some(result => result.status === 'rejected') || [...this.cleanupFailures.values()].some(item => item.target.installationId === installationId)) {
      this.options.ctx.logger('enterprise-plugin').error(failure)
      return
    }
    const oldRelease = previous[0]?.releaseSpec
    if (oldRelease === undefined || signal.aborted) {
      this.options.ctx.logger('enterprise-plugin').error(failure)
      return
    }
    try {
      let revision = permissionRevision
      if (oldRelease.id !== releaseId) {
        const rollback = z.looseObject({ permissionRevision: z.number().int().positive() }).parse(
          await this.options.request(`plugins/installations/${installationId}/upgrade`, signal, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ releaseId: oldRelease.id, confirmPermissions: false,
              expectedReleaseId: releaseId, expectedPermissionRevision: permissionRevision }),
          }))
        revision = rollback.permissionRevision
      }
      for (const old of previous) {
        await withinDeadline(signal, activationTimeout(this.options), `Plugin ${old.pluginId} ${old.targetKind} rollback`, activationSignal =>
          this.start(installationId, revision, old.config, old.releaseSpec, old.archive, old.targetKind, old.targets, activationSignal))
      }
    } catch (rollbackError) {
      await Promise.allSettled([...this.active.values()].filter(target => target.installationId === installationId).map(target => this.stop(target)))
      this.options.ctx.logger('enterprise-plugin').error(new AggregateError([failure, rollbackError], `Plugin ${oldRelease.pluginId} replacement and rollback failed`))
      return
    }
    this.options.ctx.logger('enterprise-plugin').error(failure)
  }

  private async start(
    installationId: string,
    permissionRevision: number,
    config: Readonly<Record<string, unknown>>,
    release: RuntimeRelease,
    archive: VerifiedPackage,
    targetKind: 'host' | 'client',
    targets: ReturnType<typeof resolvePluginTargets>,
    signal: AbortSignal,
  ): Promise<void> {
    const deviceId = await bounded(this.options.deviceId(), cleanupTimeout(this.options), 'Plugin device identity')
    const lease = await this.options.request(`plugins/installations/${installationId}/devices/${encodeURIComponent(deviceId)}/activate`, signal, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetKind }),
    }) as { activationId?: unknown; token?: unknown }
    if (typeof lease.activationId !== 'string' || typeof lease.token !== 'string') throw new Error('Plugin activation returned an invalid lease')
    const remoteTransport = this.options.createTransport?.(lease.activationId, lease.token)
      ?? createHttpPluginTransport({ baseUrl: this.options.apiUrl, activationId: lease.activationId, token: lease.token })
    const transport = targetKind === 'host' ? withHostCredentials(this.options.ctx, remoteTransport,
      { organizationId: this.options.organizationId, installationId }, archive.manifest.permissions) : remoteTransport
    const bound = bindPluginSdk(transport)
    const clientBundles = targetKind === 'client' ? targets.map(({ target }) => {
      if (target.kind !== 'client') throw new Error('Client target list contains a Host target')
      const bytes = archive.entries.get(target.entry)
      if (bytes === undefined) throw new Error(`Plugin target entry ${target.entry} is missing`)
      return { moduleId: target.moduleId, source: strFromU8(bytes), contributions: target.contributions }
    }) : []
    const contributions = clientBundles.flatMap(bundle => bundle.contributions)
    let disposeContribution: (() => Promise<void>) | undefined
    let windowDisposers: (() => void)[] = []
    let capabilityNames: ActiveTarget['capabilityNames']
    const discoveredTools: string[] = []
    const discoveredSkills: string[] = []
    const hostOwners = new Set<Fiber>()
    const installedPresets: { id: string; root: string; packageId?: string; presetId: string }[] = []
    const bundled = targetKind === 'host'
      ? bundledHostPackages(this.options.ctx, this.options.organizationId, release, archive)
      : new Map<string, BundledHostPackage>()
    try {
      // Registering a window is part of activation. Keep it inside this
      // guarded section so duplicate or invalid definitions report the target
      // as failed instead of leaving its device row in `preparing` forever.
      windowDisposers = targetKind === 'client'
        ? contributions.filter(contribution => contribution.kind === 'window').map(contribution => this.clientWindows.register({
          pluginId: release.pluginId,
          contributionId: contribution.id,
          surface: contribution.surface,
          shell: contribution.shell,
          multiplicity: contribution.multiplicity,
          titleKey: contribution.titleKey,
          ...(contribution.defaultBounds === undefined ? {} : { defaultBounds: contribution.defaultBounds }),
        }))
        : []
      if (targetKind === 'host') {
        const metadata = archive.manifest.contributions
        if (!Array.isArray(metadata) && metadata.configuration !== undefined) {
          resolvePluginConfiguration(pluginConfiguration.parse(metadata.configuration), config)
          for (const descriptor of archive.manifest.credentialDescriptors ?? []) {
            if (descriptor.kind !== 'oauth' && !await bound.sdk.credentials?.get(descriptor.name, signal)) throw new Error(`plugin/not-configured: ${descriptor.label ?? descriptor.name}`)
          }
        }
        if (!Array.isArray(metadata) && metadata.mcpConnection !== undefined) {
          const connection = pluginMcpConnection.parse(metadata.mcpConnection)
          if (connection.url === undefined && typeof config.mcpUrl !== 'string') throw new Error('plugin/not-configured: MCP URL is required')
          if (connection.auth !== 'none' && !await bound.sdk.credentials?.get(connection.auth === 'oauth' ? 'oauth-state' : 'api-key', signal)) {
            throw new Error('plugin/not-configured: authorization is required')
          }
        }
        disposeContribution = () => this.manager.remove(installationId)
        try {
          const installed: {
            readonly packageFiles: { readonly entry: string; readonly sdkProvider: string; readonly packageRoot: string }
            readonly packageId: string | undefined
            readonly packageName: string | undefined
            readonly dependencies: Readonly<Record<string, string>>
            readonly target: typeof targets[number]['target']
          }[] = []
          for (const { packageId, packageName, dependencies, target } of targets) {
            if (target.kind !== 'host') throw new Error('Host target list contains a Client target')
            const bytes = archive.entries.get(target.entry)
            if (bytes === undefined) throw new Error(`Plugin target entry ${target.entry} is missing`)
            const embeddedPackageJson = packageId === undefined ? undefined : archive.entries.get(`packages/${packageId}/package.json`)
            const packageFiles = await untilAbort(installHostPackage(
              this.options.ctx, this.options.organizationId, release.pluginId, release.version, archive.digest,
              { id: packageId, name: packageName, dependencies, bundled }, target.entry, bytes, archive.entries,
              embeddedPackageJson === undefined ? undefined : strFromU8(embeddedPackageJson),
            ), signal)
            installed.push({ packageFiles, packageId, packageName, dependencies, target })
          }
          const presetPackages = new Set<string | undefined>()
          for (const item of installed) {
            if (presetPackages.has(item.packageId)) continue
            presetPackages.add(item.packageId)
            await installPresetFiles(
              this.options.ctx, release.pluginId, item.packageId,
              (targets.find(candidate => candidate.target === item.target)?.presets ?? []), archive.entries, { ...item.dependencies, ...(item.packageName === undefined ? {} : { [item.packageName]: archive.manifest.packages?.find(row => row.id === item.packageId)?.version ?? release.version }) }, bundled, installedPresets, signal,
            )
          }
          const first = installed[0]
          if (first === undefined) throw new Error('Product has no installed Host entry')
          const loaded = await untilAbort(this.manager.load(
            installationId, installed.map(item => ({ url: pathToFileURL(item.packageFiles.entry).href, config })),
            pathToFileURL(first.packageFiles.sdkProvider).href, bound.sdk, signal,
          ), signal)
          for (const owner of loaded.owners) hostOwners.add(owner)
        } catch (error) {
          throw error
        }
        const ownerUids = new Set([...hostOwners].flatMap(owner => owner.uid === null ? [] : [owner.uid]))
        const tools = this.options.ctx.get('tools') as { registrationsOwnedBy?: (owners: ReadonlySet<number>) => readonly string[] } | undefined
        const skills = this.options.ctx.get('skills') as { registrationsOwnedBy?: (owners: ReadonlySet<number>) => readonly string[] } | undefined
        const addedTools = tools?.registrationsOwnedBy?.(ownerUids) ?? []
        const addedSkills = skills?.registrationsOwnedBy?.(ownerUids) ?? []
        toolNames(this.options.ctx)
        const declared: string[] = []
        for (const { target } of targets) for (const value of target.contributions) if (typeof value === 'string') declared.push(value)
        const declaresTools = declared.some(value => value === 'host:tool' || value.startsWith('tool:') || !value.includes(':'))
        const declaresSkills = declared.some(value => value === 'host:skill' || value.startsWith('skill:'))
        if (declaresTools && addedTools.length === 0) throw new Error(`Plugin ${release.pluginId} declares a Host tool but registered no Tool`)
        if (declaresSkills && addedSkills.length === 0) throw new Error(`Plugin ${release.pluginId} declares a Skill but registered no Skill`)
        const mcpServers = mcpConnectionStatusesForOwners(this.options.ctx, ownerUids)
        if (declared.some(value => value.startsWith('mcp:')) && (mcpServers.length === 0 || mcpServers.some(server => server.state !== 'connected'))) throw new Error(`Plugin ${release.pluginId} has no connected MCP contribution`)
        for (const value of declared) {
          if (!value.includes(':') && !addedTools.includes(value)) throw new Error(`Plugin ${release.pluginId} did not register tool ${value}`)
          if (value.startsWith('tool:') && !addedTools.includes(value.slice(5))) throw new Error(`Plugin ${release.pluginId} did not register ${value}`)
          if (value.startsWith('skill:') && !addedSkills.includes(value.slice(6))) throw new Error(`Plugin ${release.pluginId} did not register ${value}`)
        }
        discoveredTools.push(...addedTools)
        discoveredSkills.push(...addedSkills)
      }
      if (targetKind === 'host') capabilityNames = {
        tools: discoveredTools,
        skills: discoveredSkills,
        mcpTools: discoveredTools.filter(name => name.startsWith('mcp__')),
      }
      const active: ActiveTarget = {
        installationId, releaseId: release.id, permissionRevision, pluginId: release.pluginId, version: release.version,
        targetKind, activationId: lease.activationId, transport, sdk: bound.sdk, invalidateSdk: bound.dispose,
        ...(clientBundles.length === 0 ? {} : { clientBundles, windowDisposers }),
        ...(disposeContribution === undefined ? {} : { disposeContribution }),
        ...(capabilityNames === undefined ? {} : { capabilityNames }),
        ...(targetKind === 'host' ? { hostOwners } : {}),
        ...(installedPresets.length === 0 ? {} : { presets: installedPresets }),
        releaseSpec: release,
        config,
        archive,
        targets,
      }
      if (targetKind === 'host') await this.heartbeat(active, 'active', null, signal)
      this.active.set(this.key(installationId, targetKind), active)
    } catch (error) {
      const failed: ActiveTarget = {
        installationId, releaseId: release.id, permissionRevision, pluginId: release.pluginId, version: release.version,
        targetKind, activationId: lease.activationId, transport, sdk: bound.sdk, invalidateSdk: bound.dispose,
        windowDisposers, presets: installedPresets, releaseSpec: release, archive, targets, config,
        ...(disposeContribution === undefined ? {} : { disposeContribution }),
      }
      bound.dispose()
      await this.reportFailed(installationId, lease.activationId, deviceId, targetKind, error, new AbortController().signal)
      try { await this.stop(failed) }
      catch (cleanupError) { this.options.ctx.logger('enterprise-plugin').error(cleanupError) }
      throw error
    }
  }

  private async stop(target: ActiveTarget): Promise<void> {
    const deviceId = await bounded(this.options.deviceId(), cleanupTimeout(this.options), 'Plugin device identity')
    let revokeError: unknown
    try {
      await bounded(this.options.request(`plugins/installations/${target.installationId}/deactivate`, timeoutSignal(new AbortController().signal, cleanupTimeout(this.options)), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, targetKind: target.targetKind, revokeOnly: true }),
      }), cleanupTimeout(this.options), `Plugin ${target.pluginId} lease revocation`)
    } catch (error) { revokeError = error }
    if (target.targetKind === 'client') {
      this.clientWindows.beginDrain(target.pluginId)
      try {
        await bounded(this.clientWindows.closePlugin(target.pluginId), cleanupTimeout(this.options), `Plugin ${target.pluginId} window cleanup`)
      } catch (error) {
        revokeError = revokeError === undefined ? error : new AggregateError([revokeError, error], `Plugin ${target.pluginId} lease cleanup failed`)
      }
    }
    if (target.targetKind === 'client') {
      for (const [key, mount] of this.clientMounts) if (mount.activationId === target.activationId) this.clientMounts.delete(key)
      for (const key of this.clientSlots.keys()) if (key.startsWith(`${target.activationId}:`)) this.clientSlots.delete(key)
    }
    for (const dispose of target.windowDisposers ?? []) dispose()
    target.invalidateSdk()
    let disposeError: unknown
    try {
      if (target.disposeContribution !== undefined) {
        await bounded(target.disposeContribution(), cleanupTimeout(this.options), `Plugin ${target.pluginId} cleanup`)
      }
    } catch (error) { disposeError = error }
    await Promise.all((target.presets ?? []).map(item => revokeOwnedPreset(this.options.ctx, item, target.pluginId, item.packageId, item.presetId).catch((error: unknown) => {
      disposeError ??= error
    })))
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
    if (target.targetKind === 'client') this.clientWindows.endDrain(target.pluginId)
    this.scheduleCleanupRetry()
  }

  private async heartbeat(target: ActiveTarget, state: 'active' | 'failed' | 'disabled', error: string | null, signal: AbortSignal): Promise<void> {
    const deviceId = await bounded(this.options.deviceId(), cleanupTimeout(this.options), 'Plugin device identity')
    await untilAbort(this.options.request(`plugins/installations/${target.installationId}/devices/${encodeURIComponent(deviceId)}/heartbeat`, signal, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activationId: target.activationId, targetKind: target.targetKind, observedState: state, error }),
    }), signal)
  }

  private async reportFailed(installationId: string, activationId: string, deviceId: string, targetKind: 'host' | 'client', error: unknown, signal: AbortSignal): Promise<void> {
    await bounded(this.options.request(`plugins/installations/${installationId}/devices/${encodeURIComponent(deviceId)}/heartbeat`, signal, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activationId, targetKind, observedState: 'failed', error: error instanceof Error ? error.message : 'Plugin activation failed' }),
    }), cleanupTimeout(this.options), `Plugin ${installationId} failure report`).catch((reportError: unknown) => { this.options.ctx.logger('enterprise-plugin').warn(reportError) })
  }

  private async renewLeases(): Promise<void> {
    if (this.disposed) return
    const next = this.serial.then(async () => {
      if (this.disposed) return
      await Promise.allSettled([...this.active.values()].map(async (target) => {
        try {
          const diagnostic = (await this.capabilityDiagnostics()).find(row => row.activationId === target.activationId)
          if (diagnostic?.state === 'active') await this.heartbeat(target, 'active', null, timeoutSignal(this.lifecycleController.signal, activationTimeout(this.options)))
          else if (target.targetKind === 'host') {
            throw new Error(`Plugin ${target.pluginId} lost its live Host contributions`)
          }
        }
        catch (error) {
          try { await this.stop(target) }
          catch (cleanupError) { this.options.ctx.logger('enterprise-plugin').error(cleanupError) }
          this.options.ctx.logger('enterprise-plugin').warn(error)
        }
      }))
    })
    this.serial = next.catch(() => {})
    await next
  }

  /** Retry failed contribution cleanup in the product lifecycle queue.
   * @param signal - Cancels before retrying cleanup.
   * @returns Completion of the queued cleanup attempts.
   */
  retryCleanup(signal: AbortSignal = new AbortController().signal): Promise<void> {
    const next = this.serial.then(() => this.retryCleanupNow(signal))
    this.serial = next.catch(() => {})
    return next
  }

  private async retryCleanupNow(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await Promise.allSettled([...this.cleanupFailures.values()].filter(failure => failure.nextRetryAt <= Date.now()).map(async (failure) => {
      try { await this.stop(failure.target) }
      catch { /* The failure remains recorded with an increased backoff. */ }
    }))
    this.scheduleCleanupRetry()
  }

  /** Return Client targets whose activation credentials remain Host-owned.
   * @returns Bundles currently prepared for browser mounting, without activation tokens.
   */
  clientTargets(): EnterpriseClientPluginTarget[] {
    return [...this.active.values()].flatMap(target => (target.clientBundles ?? []).map(bundle => ({
      installationId: target.installationId, releaseId: target.releaseId, pluginId: target.pluginId,
      version: target.version, activationId: target.activationId, ...bundle,
    })))
  }

  /** Return runtime evidence used by the plugin market, rather than manifest claims.
   * @returns Observed tools, skills, Client mounts and slot registrations for active targets.
   */
  async capabilityDiagnostics(): Promise<readonly EnterprisePluginCapabilityDiagnostic[]> {
    const diagnostics: EnterprisePluginCapabilityDiagnostic[] = []
    for (const target of this.active.values()) {
      const capabilityNames = target.capabilityNames ?? { tools: [], skills: [], mcpTools: [] }
      const ownerUids = new Set([...(target.hostOwners ?? [])].flatMap(owner => owner.uid === null ? [] : [owner.uid]))
      const mcpServers = mcpConnectionStatusesForOwners(this.options.ctx, ownerUids)
      const dynamicMcpTools = [...new Set(mcpServers.flatMap(server => server.discoveredTools))]
      const mcpTools = dynamicMcpTools.length === 0 ? capabilityNames.mcpTools : dynamicMcpTools
      const currentTools = new Set(toolNames(this.options.ctx))
      const currentSkills = new Set(await skillNames(this.options.ctx))
      const presetService = this.options.ctx.get('agentPresets') as {
        list: () => Promise<readonly { id: string; broken?: string }[]>
        hasStandingMount?: (id: string) => boolean
      } | undefined
      const presetRows = presetService === undefined ? [] : await presetService.list()
      const presetById = new Map(presetRows.map(row => [row.id, row]))
      const presets = (target.presets ?? []).map((item) => {
        const row = presetById.get(item.id)
        return row?.broken === undefined
          ? { id: item.id, present: row !== undefined || presetService?.hasStandingMount?.(item.id) === true }
          : { id: item.id, present: false, broken: row.broken }
      })
      const expectedSlots = (target.clientBundles ?? []).flatMap(bundle => bundle.contributions
        .filter((contribution): contribution is Extract<PluginClientContribution, { kind: 'slot' }> => contribution.kind === 'slot')
        .map(contribution => ({ moduleId: bundle.moduleId, id: contribution.id, slot: contribution.slot })))
      const clientWindows = [...this.clientMounts.values()].filter(item => item.activationId === target.activationId)
      const slotsForWindow = (windowId: string): EnterprisePluginCapabilityDiagnostic['clientSlots'] => expectedSlots.map((expected) => {
        const mounted = clientWindows.some(row => row.windowId === windowId && row.moduleId === expected.moduleId && row.mountState === 'active')
        const reported = mounted ? this.clientSlots.get(`${target.activationId}:${windowId}:${expected.moduleId}`)?.find(row => row.id === expected.id && row.slot === expected.slot && row.present) : undefined
        return reported ?? { id: expected.id, slot: expected.slot, present: false, error: 'Client slot has not reported a live registration' }
      })
      const completeWindow = clientWindows.find(window =>
        (target.clientBundles ?? []).every(bundle => clientWindows.some(row => row.windowId === window.windowId && row.moduleId === bundle.moduleId && row.mountState === 'active'))
        && slotsForWindow(window.windowId).every(slot => slot.present))
      const clientSlots = slotsForWindow(completeWindow?.windowId ?? clientWindows[0]?.windowId ?? '')
      const clientReady = target.targetKind !== 'client' || completeWindow !== undefined
      const state = capabilityNames.tools.some(name => !currentTools.has(name))
        || capabilityNames.skills.some(name => !currentSkills.has(name))
        || presets.some(item => !item.present)
        || mcpServers.some(item => item.state !== 'connected')
        || mcpTools.some(name => !currentTools.has(name))
        || clientSlots.some(item => !item.present)
        || clientWindows.some(item => item.mountState === 'failed')
        || !clientReady ? 'stale' : 'active'
      diagnostics.push({
        installationId: target.installationId,
        pluginId: target.pluginId,
        version: target.version,
        targetKind: target.targetKind,
        activationId: target.activationId,
        state,
        tools: { names: capabilityNames.tools, present: capabilityNames.tools.filter(name => currentTools.has(name)) },
        skills: { names: capabilityNames.skills, present: capabilityNames.skills.filter(name => currentSkills.has(name)) },
        mcpTools: { names: mcpTools, present: mcpTools.filter(name => currentTools.has(name)) },
        mcpServers,
        presets,
        clientSlots,
        clientWindows,
      })
    }
    return diagnostics
  }

  /** Relay one browser SDK call through its current Host-owned activation transport.
   * @param activationId - Current Client activation; rejects stale or inactive targets.
   * @param operation - SDK operation or an owned native window operation.
   * @param input - Operation payload checked by the receiving capability.
   * @param signal - Cancels the capability request.
   * @returns Capability result; window close and focus resolve without a value.
   */
  async callClient<T>(activationId: string, operation: string, input: unknown, signal: AbortSignal): Promise<T> {
    const target = [...this.active.values()].find(candidate => candidate.targetKind === 'client' && candidate.activationId === activationId)
    if (target === undefined) throw new Error('plugin/not-active')
    if (operation === 'client-window/open') {
      const value = input as { contributionId?: unknown; input?: unknown; ownerWindowId?: unknown }
      if (typeof value.contributionId !== 'string') throw new Error('client-window/open requires contributionId')
      return await this.clientWindows.open(
        target.pluginId,
        value.contributionId,
        value.input,
        typeof value.ownerWindowId === 'string' ? value.ownerWindowId : undefined,
      ) as T
    }
    if (operation === 'client-window/close') {
      const value = input as { windowInstanceId?: unknown }
      if (typeof value.windowInstanceId !== 'string') throw new Error('client-window/close requires windowInstanceId')
      const instance = this.clientWindows.list(target.pluginId).find(item => item.windowInstanceId === value.windowInstanceId)
      if (instance === undefined) throw new Error('plugin/window-not-owned')
      await this.clientWindows.close(value.windowInstanceId)
      return undefined as T
    }
    if (operation === 'client-window/focus') {
      const value = input as { windowInstanceId?: unknown }
      if (typeof value.windowInstanceId !== 'string') throw new Error('client-window/focus requires windowInstanceId')
      const instance = this.clientWindows.list(target.pluginId).find(item => item.windowInstanceId === value.windowInstanceId)
      if (instance === undefined) throw new Error('plugin/window-not-owned')
      await this.clientWindows.focus(value.windowInstanceId)
      return undefined as T
    }
    if (operation === 'client-window/list') return this.clientWindows.list(target.pluginId) as T
    return await target.transport.call<T>(operation, input, signal)
  }

  /** Relay and collect one browser SDK stream without exposing its activation token.
   * @param activationId - Current Client activation; rejects stale or inactive targets.
   * @param operation - SDK stream operation.
   * @param input - Operation payload checked by the receiving capability.
   * @param signal - Cancels stream consumption.
   * @returns Collected chunks; rejects after 10,000 chunks or a transport failure.
   */
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

  /**
   * Record one browser window's mount state and report active or failed Client targets to the API.
   * @param activationId Host-owned Client activation id.
   * @param windowId Browser window reporting the mount.
   * @param state Browser mount state.
   * @param error Failure detail for a failed mount, or null otherwise.
   * @param signal Aborts the server heartbeat request.
   * @param moduleId Client bundle reporting its mount; omitted only for legacy single-bundle callers.
   * @returns Resolves after all bundles in the window mount, a failure is reported, or local disconnect is recorded.
   */
  async reportClientWindow(
    activationId: string,
    windowId: string,
    state: 'active' | 'failed' | 'disconnected',
    error: string | null,
    signal: AbortSignal,
    moduleId?: string,
  ): Promise<void> {
    const target = [...this.active.values()].find(candidate => candidate.targetKind === 'client' && candidate.activationId === activationId)
    if (target === undefined) throw new Error('plugin/not-active')
    const resolvedModule = moduleId ?? (target.clientBundles?.length === 1 ? target.clientBundles[0]?.moduleId : undefined)
    if (resolvedModule === undefined || !target.clientBundles?.some(bundle => bundle.moduleId === resolvedModule)) throw new Error('plugin/unknown-client-module')
    this.clientMounts.set(`${activationId}:${windowId}:${resolvedModule}`, {
      windowId, moduleId: resolvedModule, activationId, pluginId: target.pluginId,
      mountState: state, lastError: error, lastSeen: Date.now(),
    })
    if (state === 'disconnected') this.clientSlots.delete(`${activationId}:${windowId}:${resolvedModule}`)
    const allMounted = (target.clientBundles ?? []).every(bundle => this.clientMounts.get(`${activationId}:${windowId}:${bundle.moduleId}`)?.mountState === 'active')
    if (state === 'failed' || (state === 'active' && allMounted)) await this.heartbeat(target, state, state === 'failed' ? error : null, signal)
    const pending = this.pendingReplacements.get(target.installationId)
    if (state === 'active' && allMounted && pending?.releaseId === target.releaseId) this.pendingReplacements.delete(target.installationId)
    if (state === 'failed' && pending?.releaseId === target.releaseId) {
      const next = this.serial.then(() => this.restoreProduct(target.installationId, pending.releaseId, pending.permissionRevision, pending.previous, new Error(error ?? 'Client mount failed'), signal))
      this.serial = next.catch(() => {})
      await next
    }
  }

  /** Record slot registration evidence reported by the browser Client runtime.
   * @param activationId - Active Client activation; rejects missing targets or modules.
   * @param moduleId - Declared Client bundle reporting the registration.
   * @param windowId - Browser window owning these observations.
   * @param slots - Latest observed registrations replacing this module/window report.
   */
  reportClientSlots(
    activationId: string,
    moduleId: string,
    windowId: string,
    slots: readonly { readonly id: string; readonly slot: string; readonly present: boolean; readonly error?: string | undefined }[],
  ): void {
    if (![...this.active.values()].some(target => target.targetKind === 'client' && target.activationId === activationId && target.clientBundles?.some(bundle => bundle.moduleId === moduleId))) {
      throw new Error('plugin/not-active')
    }
    this.clientSlots.set(`${activationId}:${windowId}:${moduleId}`, slots)
  }

  /** Return window-local mount diagnostics for the current Host runtime.
   * @returns A snapshot of the observed Client mount states.
   */
  clientWindowStates(): readonly EnterpriseClientWindowState[] { return [...this.clientMounts.values()] }

  /** Revoke all leases and wait for every contribution to leave the Host. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.reconciliationController?.abort(new Error('Enterprise plugin runtime disposed'))
    this.lifecycleController.abort(new Error('Enterprise plugin runtime disposed'))
    await Promise.all([...this.authorizations.values()].map(flow => flow.done))
    this.authorizations.clear()
    clearInterval(this.renewalTimer)
    if (this.cleanupRetryTimer !== undefined) clearTimeout(this.cleanupRetryTimer)
    await this.serial
    this.pendingReplacements.clear()
    const targets = new Set([...this.active.values(), ...[...this.cleanupFailures.values()].map(item => item.target)])
    const results = await Promise.allSettled([...targets].map(target => this.stop(target)))
    const failures: unknown[] = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason as unknown)
    if (failures.length) throw new AggregateError(failures, 'Enterprise plugin runtime did not stop cleanly')
  }
}
