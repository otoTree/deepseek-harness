/** Runtime helpers that bind an SDK transport to one Cordis activation lifetime. */
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type {
  ClientWindowDefinition,
  ClientWindowInstance,
  PluginCapabilityTransport,
  PluginSdk,
} from '@deepseek-ai/dsh-plugin-protocol'
import { createPluginSdk } from '@deepseek-ai/dsh-plugin-sdk'

/** Create an SDK and a disposer that invalidates its transport after unload.
 * @param transport Platform transport bound to one activation lease.
 * @param onDispose Optional callback run once when the activation is disposed.
 * @returns The SDK facade and its idempotent disposer.
 */
export function bindPluginSdk(transport: PluginCapabilityTransport, onDispose?: () => void): { sdk: PluginSdk; dispose: () => void } {
  let disposed = false
  const activeCalls = new Set<AbortController>()
  const beginCall = (signal?: AbortSignal): { controller: AbortController; signal: AbortSignal } => {
    if (disposed) throw new Error('plugin/not-active')
    const controller = new AbortController()
    activeCalls.add(controller)
    return { controller, signal: signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]) }
  }
  const guarded: PluginCapabilityTransport = {
    call: async <T>(operation: string, input: unknown, signal?: AbortSignal): Promise<T> => {
      const active = beginCall(signal)
      try { return await transport.call<T>(operation, input, active.signal) }
      finally { activeCalls.delete(active.controller) }
    },
    stream: async function* <T>(operation: string, input: unknown, signal?: AbortSignal): AsyncIterable<T> {
      const active = beginCall(signal)
      try {
        yield* transport.stream<T>(operation, input, active.signal)
      } finally {
        activeCalls.delete(active.controller)
      }
    },
  }
  return {
    sdk: createPluginSdk(guarded),
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const controller of activeCalls) controller.abort('plugin/not-active')
      activeCalls.clear()
      onDispose?.()
    },
  }
}

/** ESM exports accepted from a verified Host or Client target entry. */
export interface PluginTargetModule {
  /** Default Cordis plugin export. */
  readonly default?: Plugin
  /** Named Cordis object-plugin entrypoint. */
  readonly apply?: (ctx: Context, config?: unknown) => unknown
  /** Optional Cordis plugin display name. */
  readonly name?: string
  /** Services required by a named object-plugin entrypoint. */
  readonly inject?: Plugin['inject']
  /** Optional Cordis configuration schema. */
  readonly Config?: Plugin['Config']
}

/** Optional activation controls for one target mount. */
export interface MountPluginTargetOptions {
  /** Installation configuration passed to the Cordis plugin. */
  readonly config?: unknown
  /** Cancellation that disposes a target still waiting for required services. */
  readonly signal?: AbortSignal
  /** Optional restricted window service scoped to this Client target. */
  readonly clientWindow?: ClientWindowService
  /** Optional unique isolate name when several Client targets share a root. */
  readonly scopeName?: string
}

function pluginFromModule(module: PluginTargetModule): Plugin {
  if (module.default !== undefined) return module.default
  if (typeof module.apply !== 'function') throw new TypeError('Plugin target must export a Cordis plugin')
  return {
    ...(module.name === undefined ? {} : { name: module.name }),
    ...(module.inject === undefined ? {} : { inject: module.inject }),
    ...(module.Config === undefined ? {} : { Config: module.Config }),
    apply: module.apply,
  } as Plugin
}

async function awaitActivation<T>(activation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return activation
  signal.throwIfAborted()
  let abort: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Plugin target activation aborted'))
    signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([activation, cancelled]) }
  finally { if (abort !== undefined) signal.removeEventListener('abort', abort) }
}

async function disposeAfterFailure(disposal: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  if (!signal?.aborted) return disposal
  void disposal.catch(() => {
    // The activation deadline already owns the reported failure; a non-cooperative target may settle its disposal later.
  })
}

/** Mount one verified target with an isolated installation-scoped SDK service.
 * @param ctx Parent Host or Client Cordis context.
 * @param module Verified target module exports.
 * @param sdk SDK bound to the target's current activation lease.
 * @param options Installation configuration and activation cancellation.
 * @returns An idempotent disposer that waits for target effects to stop.
 */
export async function mountPluginTarget(
  ctx: Context,
  module: PluginTargetModule,
  sdk: PluginSdk,
  options: MountPluginTargetOptions = {},
): Promise<() => Promise<void>> {
  const plugin = pluginFromModule(module)
  const scopeLabel = Symbol(options.scopeName ?? 'plugin-target')
  const scope = ctx.isolate('pluginSdk', scopeLabel).isolate('clientWindow', scopeLabel)
  const provider = scope.plugin({
    name: `plugin-sdk:${options.scopeName ?? 'target'}:${module.name ?? 'target'}`,
    apply(providerContext: Context): void { providerContext.provide('pluginSdk', sdk) },
  })
  let windowProvider: ReturnType<Context['plugin']> | undefined
  try {
    await awaitActivation(provider.await(), options.signal)
    let targetContext = provider.ctx
    if (options.clientWindow !== undefined) {
      const clientWindow = options.clientWindow
      windowProvider = provider.ctx.plugin({
        name: `plugin-client-window:${options.scopeName ?? 'target'}:${module.name ?? 'target'}`,
        apply(providerContext: Context): void { providerContext.provide('clientWindow', clientWindow) },
      })
      await awaitActivation(windowProvider.await(), options.signal)
      targetContext = windowProvider.ctx
    }
    const target = options.config === undefined
      ? targetContext.plugin(plugin as Plugin<void>)
      : targetContext.plugin(plugin as Plugin<unknown>, options.config)
    try {
      await awaitActivation(target.await(), options.signal)
    } catch (error) {
      await disposeAfterFailure(target.dispose(), options.signal)
      throw error
    }
    let disposed = false
    return async () => {
      if (disposed) return
      disposed = true
      await target.dispose()
      await windowProvider?.dispose()
      await provider.dispose()
    }
  } catch (error) {
    await disposeAfterFailure(windowProvider?.dispose() ?? Promise.resolve(), options.signal)
    await disposeAfterFailure(provider.dispose(), options.signal)
    throw error
  }
}

/** Install the SDK on a Cordis context for a plugin's declared activation scope.
 * @param ctx Cordis context that owns the plugin contribution.
 * @param transport Platform transport bound to the current activation.
 * @returns A disposer that removes the SDK and invalidates retained handles.
 */
export function installPluginSdk(ctx: Context, transport: PluginCapabilityTransport): () => void {
  const bound = bindPluginSdk(transport)
  const disposer = ctx.effect(() => {
    ;(ctx as Context & { pluginSdk?: PluginSdk }).pluginSdk = bound.sdk
    return () => {
      bound.dispose()
      Reflect.deleteProperty(ctx, 'pluginSdk')
    }
  })
  return disposer
}

/** Platform operations used by the Host registry to materialize native windows. */
export interface ClientWindowPlatform {
  create(instance: ClientWindowInstance, definition: ClientWindowDefinition, input: unknown): Promise<void> | void
  close(instance: ClientWindowInstance): Promise<void> | void
  focus(instance: ClientWindowInstance): Promise<void> | void
}

/** Build a platform adapter over an authenticated loopback window broker. */
export function createClientWindowBrokerPlatform(broker: { url: string; token: string }): ClientWindowPlatform {
  const call = async (op: string, instance: ClientWindowInstance, definition?: ClientWindowDefinition, input?: unknown): Promise<void> => {
    const response = await fetch(broker.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${broker.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, instance, ...(definition === undefined ? {} : { definition }), ...(input === undefined ? {} : { input }) }),
    })
    if (!response.ok) throw new Error(`Client window broker failed: ${response.status}`)
  }
  return {
    create: (instance, definition, input) => call('create', instance, definition, input),
    close: instance => call('close', instance),
    focus: instance => call('focus', instance),
  }
}

/** Read-only event emitted after a window instance changes state. */
export interface ClientWindowEvent {
  readonly kind: 'opened' | 'closed' | 'focused' | 'error'
  readonly instance: ClientWindowInstance
  readonly error?: unknown
}

/** Host-side registry for declarative Client window contributions. */
export class ClientWindowRegistry {
  private readonly definitions = new Map<string, ClientWindowDefinition>()
  private readonly instances = new Map<string, ClientWindowInstance>()
  private readonly listeners = new Set<(event: ClientWindowEvent) => void>()
  private nextInstance = 1
  private readonly drainingPlugins = new Set<string>()

  constructor(private readonly platform: ClientWindowPlatform) {}

  /** Register one normalized contribution and return its idempotent disposer. */
  register(definition: ClientWindowDefinition): () => void {
    const key = this.key(definition.pluginId, definition.contributionId)
    if (this.definitions.has(key)) throw new Error(`Client window contribution already registered: ${key}`)
    this.definitions.set(key, definition)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.drainingPlugins.add(definition.pluginId)
      void this.closePlugin(definition.pluginId).finally(() => {
        if (!this.listDefinitions(definition.pluginId).some(item => item.pluginId === definition.pluginId)) {
          this.drainingPlugins.delete(definition.pluginId)
        }
      })
      this.definitions.delete(key)
    }
  }

  /** Subscribe to opened, closed, focused, and window-local error events. */
  subscribe(listener: (event: ClientWindowEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Return the currently registered definitions. */
  listDefinitions(pluginId?: string): readonly ClientWindowDefinition[] {
    return [...this.definitions.values()].filter(definition => pluginId === undefined || definition.pluginId === pluginId)
  }

  /** Return live instances, optionally filtered by plugin. */
  list(pluginId?: string): readonly ClientWindowInstance[] {
    return [...this.instances.values()].filter(instance => pluginId === undefined || instance.pluginId === pluginId)
  }

  /** Open a declared contribution; singleton contributions focus the existing instance. */
  async open(pluginId: string, contributionId: string, input: unknown, ownerWindowId?: string): Promise<ClientWindowInstance> {
    if (this.drainingPlugins.has(pluginId)) throw new Error(`Client window plugin is draining: ${pluginId}`)
    const definition = this.definitions.get(this.key(pluginId, contributionId))
    if (definition === undefined) throw new Error(`Unknown Client window contribution: ${pluginId}/${contributionId}`)
    if (definition.multiplicity === 'singleton') {
      const existing = this.list(pluginId).find(instance => instance.contributionId === contributionId)
      if (existing !== undefined) {
        await this.focus(existing.windowInstanceId)
        return existing
      }
    }
    const instance: ClientWindowInstance = {
      windowInstanceId: `plugin-window-${this.nextInstance++}`,
      pluginId,
      contributionId,
      ...(ownerWindowId === undefined ? {} : { ownerWindowId }),
      state: 'opening',
    }
    this.instances.set(instance.windowInstanceId, instance)
    try {
      await this.platform.create(instance, definition, input)
      const ready = { ...instance, state: 'ready' as const }
      this.instances.set(instance.windowInstanceId, ready)
      this.emit({ kind: 'opened', instance: ready })
      return ready
    } catch (error) {
      this.instances.delete(instance.windowInstanceId)
      this.emit({ kind: 'error', instance: { ...instance, state: 'closed' }, error })
      throw error
    }
  }

  /** Close one live window instance without affecting sibling windows. */
  async close(windowInstanceId: string): Promise<void> {
    const instance = this.instances.get(windowInstanceId)
    if (instance === undefined) return
    const closing = { ...instance, state: 'closing' as const }
    this.instances.set(windowInstanceId, closing)
    try {
      await this.platform.close(closing)
    } finally {
      this.instances.delete(windowInstanceId)
      this.emit({ kind: 'closed', instance: { ...closing, state: 'closed' } })
    }
  }

  /** Focus one live window instance. */
  async focus(windowInstanceId: string): Promise<void> {
    const instance = this.instances.get(windowInstanceId)
    if (instance === undefined) throw new Error(`Unknown Client window instance: ${windowInstanceId}`)
    await this.platform.focus(instance)
    this.emit({ kind: 'focused', instance })
  }

  /** Close every window owned by one plugin during disable or upgrade. */
  async closePlugin(pluginId: string): Promise<void> {
    this.drainingPlugins.add(pluginId)
    await Promise.all([...this.list(pluginId)].map(instance => this.close(instance.windowInstanceId)))
    if (this.listDefinitions(pluginId).length > 0) this.drainingPlugins.delete(pluginId)
  }

  /** Reject new opens while an upgrade or disable drains existing instances. */
  beginDrain(pluginId: string): void { this.drainingPlugins.add(pluginId) }

  /** Resume opens after a failed or cancelled reconciliation. */
  endDrain(pluginId: string): void {
    if (this.listDefinitions(pluginId).length > 0) this.drainingPlugins.delete(pluginId)
  }

  private key(pluginId: string, contributionId: string): string { return `${pluginId}:${contributionId}` }
  private emit(event: ClientWindowEvent): void { for (const listener of this.listeners) listener(event) }
}

/** Client-side restricted window service; callers never receive native handles. */
export interface ClientWindowService {
  open(contributionId: string, input?: unknown): Promise<ClientWindowInstance>
  close(windowInstanceId: string): Promise<void>
  focus(windowInstanceId: string): Promise<void>
  list(): Promise<readonly ClientWindowInstance[]>
}

/** Build a Client window service over the existing capability transport. */
export function createClientWindowService(transport: PluginCapabilityTransport): ClientWindowService {
  return {
    open: (contributionId, input) => transport.call<ClientWindowInstance>('client-window/open', { contributionId, input }),
    close: async (windowInstanceId) => { await transport.call('client-window/close', { windowInstanceId }) },
    focus: async (windowInstanceId) => { await transport.call('client-window/focus', { windowInstanceId }) },
    list: () => transport.call<readonly ClientWindowInstance[]>('client-window/list', {}),
  }
}

/** Install the restricted Client window service for one Client Context. */
export function installClientWindow(ctx: Context, service: ClientWindowService): () => void {
  return ctx.effect(() => {
    ;(ctx as Context & { clientWindow?: ClientWindowService }).clientWindow = service
    return () => { Reflect.deleteProperty(ctx, 'clientWindow') }
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context { pluginSdk: PluginSdk }
  interface Context { clientWindow: ClientWindowService }
  interface Context { clientWindows: ClientWindowRegistry }
}
