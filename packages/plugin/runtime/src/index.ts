/** Runtime helpers that bind an SDK transport to one Cordis activation lifetime. */
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { PluginCapabilityTransport, PluginSdk } from '@deepseek-ai/dsh-plugin-protocol'
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
  const scope = ctx.isolate('pluginSdk')
  const provider = scope.plugin({
    name: `plugin-sdk:${module.name ?? 'target'}`,
    apply(providerContext: Context): void { providerContext.provide('pluginSdk', sdk) },
  })
  try {
    await awaitActivation(provider.await(), options.signal)
    const target = options.config === undefined
      ? provider.ctx.plugin(plugin as Plugin<void>)
      : provider.ctx.plugin(plugin as Plugin<unknown>, options.config)
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
      await provider.dispose()
    }
  } catch (error) {
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

declare module '@deepseek-ai/cordis' {
  interface Context { pluginSdk: PluginSdk }
}
