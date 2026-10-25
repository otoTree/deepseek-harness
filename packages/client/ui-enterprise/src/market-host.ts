/** Product-owned authentication around the original Cordis installer and local plugin runtime. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { PluginCapabilityTransport } from '@deepseek-ai/dsh-plugin-protocol'
import { EnterprisePluginRuntime } from './plugin-runtime.ts'
import { z } from 'zod'
import { pluginEnableInput, pluginInstallationInput, pluginUpgradeInput, pluginUploadInput, pluginSettingsInput, pluginConnectionInput } from './wire.ts'

/** Captured native account. API and activation credentials never enter browser DTOs. */
export interface ProductMarketSession {
  readonly protocolVersion: number
  readonly scopeId: string
  readonly apiOrigin: string
  readonly deviceId: string
  readonly signal: AbortSignal
  request(this: void, path: string, signal: AbortSignal, init?: RequestInit): Promise<unknown>
  bytes(this: void, path: string, signal: AbortSignal): Promise<Uint8Array>
  capability(this: void, activationId: string, token: string, operation: string, input: unknown, signal?: AbortSignal): Promise<unknown>
  dispose(): void
}
/** Register authenticated market RPCs without registering enterprise credentials, organization or model features.
 * @param ctx - Original OS Host runtime and Cordis services.
 * @param rpcPath - Product-specific local connection endpoint.
 * @param open - Account-fenced native session supplier.
 */
export function registerPluginMarketHost(ctx: Context, rpcPath: string, open: () => Promise<ProductMarketSession>): void {
  const lifetime = new AbortController()
  let current: { session: ProductMarketSession; runtime: EnterprisePluginRuntime; stop: () => Promise<void> } | undefined
  let tail: Promise<unknown> = Promise.resolve()
  const get = () => {
    const result = tail.then(async () => {
      lifetime.signal.throwIfAborted()
      if (current && !current.session.signal.aborted) return current
      if (current) { await current.stop(); current = undefined }
      const session = await open()
      if (session.protocolVersion !== 1) { session.dispose(); throw new Error('PLUGIN_MARKET_PROTOCOL_UNAVAILABLE') }
      const createTransport = (activationId: string, token: string): PluginCapabilityTransport => ({
        call: async <T>(operation: string, input: unknown, signal?: AbortSignal) =>
          await session.capability(activationId, token, operation, input, signal) as T,
        stream: () => ({ [Symbol.asyncIterator]() {
          return { next: () => Promise.reject(new Error('PLUGIN_CAPABILITY_NOT_SUPPORTED')) }
        } }),
      })
      const runtime = new EnterprisePluginRuntime({ ctx, organizationId: session.scopeId, apiUrl: session.apiOrigin,
        deviceId: () => Promise.resolve(session.deviceId), request: session.request, requestBytes: session.bytes, createTransport })
      let stopping: Promise<void> | undefined
      const stop = (): Promise<void> => stopping ??= runtime.dispose().finally(() => { session.dispose() })
      current = { session, runtime, stop }
      session.signal.addEventListener('abort', () => {
        void stop().catch((error: unknown) => { ctx.logger('plugin-market').warn(error) })
      }, { once: true })
      return current
    })
    tail = result.catch(() => {})
    return result
  }
  const reconcile = (): void => {
    void get().then(({ runtime, session }) =>
      runtime.reconcile(AbortSignal.any([lifetime.signal, session.signal]), { supersede: false })).catch(() => {})
  }
  ctx.effect(() => {
    const timer = setInterval(reconcile, 30000)
    timer.unref()
    reconcile()
    return async () => {
      clearInterval(timer); lifetime.abort(); await tail
      if (current) { await current.stop() }
    }
  }, 'plugin-market: product Host runtime')
  ctx.effect(() => ctx.connection.rpc.handle(rpcPath, async (endpoint, payload, signal) => {
    try {
      const { args } = z.object({ args: z.unknown() }).strict().parse(payload)
      const { runtime, session } = await get()
      const joined = AbortSignal.any([signal, lifetime.signal, session.signal])
      const request = session.request
      let value: unknown
      const id = () => z.object({ installationId: z.uuid() }).strict().parse(args).installationId
      const write = (path: string, method: string, body?: unknown) => request(path, joined, { method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
      if (endpoint === 'market-capabilities') value = await request('capabilities', joined)
      else if (endpoint === 'plugins') value = await request('plugins/catalog', joined)
      else if (endpoint === 'plugin-installations') value = await request('plugins/installations', joined)
      else if (endpoint === 'plugin-device-targets') value = await request('plugins/device-targets', joined)
      else if (endpoint === 'plugin-settings') value = await runtime.settings(id(), joined)
      else if (endpoint === 'plugin-configure-settings') { await runtime.configureSettings(pluginSettingsInput.parse(args), joined); value = null; reconcile() }
      else if (endpoint === 'plugin-connection-settings') value = await runtime.connectionSettings(id(), joined)
      else if (endpoint === 'plugin-configure-connection') { await runtime.configureConnection(pluginConnectionInput.parse(args), joined); value = null; reconcile() }
      else if (endpoint === 'plugin-authorize-connection') value = await runtime.authorizeConnection(id(), joined)
      else if (endpoint === 'plugin-authorization-status') {
        const input = z.object({ installationId: z.uuid(), cancel: z.boolean().optional() }).strict().parse(args)
        value = await runtime.authorizationStatus(input.installationId, input.cancel)
      }
      else if (endpoint === 'plugin-runtime-targets' || endpoint === 'plugin-runtime-diagnostics') {
        await runtime.reconcile(joined, { supersede: false })
        value = endpoint === 'plugin-runtime-targets' ? { targets: runtime.clientTargets(), diagnostics: await runtime.capabilityDiagnostics(), activationTimeoutMs: 30000, cleanupTimeoutMs: 10000 } : await runtime.capabilityDiagnostics()
      }
      else if (endpoint === 'plugin-sdk-call' || endpoint === 'plugin-sdk-stream') {
        const input = z.object({ activationId: z.uuid(), operation: z.string().min(1), input: z.unknown() }).strict().parse(args)
        value = await (endpoint === 'plugin-sdk-call' ? runtime.callClient(input.activationId, input.operation, input.input, joined) : runtime.streamClient(input.activationId, input.operation, input.input, joined))
      }
      else if (endpoint === 'plugin-client-window-state') {
        const input = z.object({ activationId: z.uuid(), windowId: z.string().min(1).max(128), moduleId: z.string().min(1).max(200).optional(), state: z.enum(['active', 'failed', 'disconnected']), error: z.string().max(1000).nullable() }).strict().parse(args)
        await runtime.reportClientWindow(input.activationId, input.windowId, input.state, input.error, joined, input.moduleId); value = null
      }
      else if (endpoint === 'plugin-client-slot-state') {
        const input = z.object({ activationId: z.uuid(), moduleId: z.string(), windowId: z.string(),
          slots: z.array(z.object({ id: z.string(), slot: z.string(), present: z.boolean(), error: z.string().optional() })),
        }).strict().parse(args)
        runtime.reportClientSlots(input.activationId, input.moduleId, input.windowId, input.slots); value = null
      }
      else if (endpoint === 'plugin-install') value = await write(`plugins/${pluginInstallationInput.parse(args).releaseId}/install`, 'POST')
      else if (endpoint === 'plugin-enable') { const input = pluginEnableInput.parse(args); value = await write(`plugins/installations/${input.installationId}`, 'PATCH', { enabled: input.enabled }) }
      else if (endpoint === 'plugin-upgrade') { const input = pluginUpgradeInput.parse(args); value = await write(`plugins/installations/${input.installationId}/upgrade`, 'POST', { releaseId: input.releaseId, confirmPermissions: input.confirmPermissions }) }
      else if (endpoint === 'plugin-uninstall') value = await write(`plugins/installations/${id()}`, 'DELETE')
      else if (endpoint === 'plugin-force-remove') value = await write(`plugins/installations/${id()}/force-remove`, 'POST')
      else if (endpoint === 'plugin-upload') {
        const input = pluginUploadInput.parse(args)
        value = await request(`plugins/packages?visibility=${encodeURIComponent(input.visibility)}`, joined, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: Uint8Array.from(input.bytes) })
      }
      else throw new Error('PLUGIN_MARKET_OPERATION_INVALID')
      if (['plugin-install', 'plugin-enable', 'plugin-upgrade', 'plugin-uninstall', 'plugin-force-remove'].includes(endpoint)) reconcile()
      return { ok: true as const, value }
    } catch (error) {
      return { ok: false as const, error: { code: 'plugin-market/unavailable', message: error instanceof Error ? error.message : 'PLUGIN_MARKET_UNAVAILABLE', details: {} } }
    }
  }), 'plugin-market: authenticated product controls')
}
