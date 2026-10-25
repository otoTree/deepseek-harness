/** Product-independent composition of the original governed plugin market. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconCordisPluginOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { z } from 'zod'
import { EnterpriseClientPluginRuntime, PluginMarket, PluginMarketAction, type PluginMarketInjected } from './enterprise.tsx'
import { en, zh } from './locales.ts'
import { enterprisePluginCatalog, enterprisePluginInstallations, enterprisePluginDeviceTargets,
  enterprisePluginCapabilityDiagnostics, pluginSettings, pluginConnectionSettings, type EnterprisePluginCatalog, type EnterprisePluginInstallations } from '../wire.ts'

/** Keep revoked installations manageable in the UI without adding them to the executable catalog. */
export function marketDisplayCatalog(
  catalog: EnterprisePluginCatalog,
  installations: EnterprisePluginInstallations,
  unavailableDescription: string,
): EnterprisePluginCatalog {
  const rows = catalog.filter((plugin, index) => catalog.findIndex(item => item.pluginId === plugin.pluginId) === index)
  for (const installation of installations) {
    if (catalog.some(plugin => plugin.id === installation.releaseId)) continue
    const index = rows.findIndex(plugin => plugin.pluginId === installation.pluginId)
    const unavailable = { id: installation.releaseId, pluginId: installation.pluginId ?? installation.id,
      name: installation.pluginId ?? installation.id, version: installation.version ?? '—', targets: [], permissions: [], tools: [],
      description: unavailableDescription, status: 'unavailable',
      publishedAt: installation.updatedAt, policyRevision: installation.permissionRevision }
    if (index < 0) rows.push(unavailable)
    else rows[index] = unavailable
  }
  return rows
}

/** Mount the original market and Client plugin runtime against a product-owned authenticated RPC.
 * @param ctx - Existing OS Client services; this does not register enterprise account pages.
 * @param rpcPath - Product Host endpoint retaining account credentials outside the WebView.
 */
export function registerPluginMarket(ctx: Context, rpcPath: string, product?: { name: string; workspacePublishing?: boolean }): void {
  ctx.effect(() => ctx.locale.register('enterprise', { en: product ? { ...en, pluginMarketIntro: en.pluginMarketIntroProduct.replace('{product}', product.name), noPlugins: en.pluginMarketEmpty } : en, zh: product ? { ...zh, pluginMarketIntro: zh.pluginMarketIntroProduct.replace('{product}', product.name), noPlugins: zh.pluginMarketEmpty } : zh }), 'plugin-market: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  const call = async (endpoint: string, args: unknown, signal?: AbortSignal): Promise<unknown> => {
    const result = await connection.rpc.call(rpcPath, endpoint, { args }, signal)
    if (!result.ok) throw new Error(result.error.message === 'SIGN_IN_REQUIRED' && product ? t('marketSignInRequired', { product: product.name }) : result.error.message)
    return result.value
  }
  const runtime = new EnterpriseClientPluginRuntime({ ctx, call })
  const pluginRevision = createSnapshotStore(0)
  let closed = false
  const reconcile = (): void => {
    void runtime.reconcile().catch(() => {}).finally(() => {
      if (!closed) pluginRevision.set(pluginRevision.getSnapshot() + 1)
    })
  }
  ctx.effect(() => {
    const refresh = (): void => { if (connection.generation.getSnapshot() !== undefined) reconcile() }
    const unsubscribe = connection.generation.subscribe(refresh)
    const hide = (): void => { void runtime.disconnect() }
    window.addEventListener('pagehide', hide)
    window.addEventListener('focus', refresh)
    const timer = setInterval(refresh, 30000)
    refresh()
    return async () => {
      closed = true; clearInterval(timer); unsubscribe()
      window.removeEventListener('pagehide', hide); window.removeEventListener('focus', refresh)
      await runtime.disconnect(); await runtime.dispose()
    }
  }, 'plugin-market: Client target lifetime')
  const mutate = async (operation: string, args: unknown): Promise<unknown> => {
    const value = await call(operation, args); reconcile(); return value
  }
  const injected = (): PluginMarketInjected => ({
    hooks: { pluginRevision },
    ...(product?.workspacePublishing === false ? { uploadVisibilities: ['private', 'platform'] as const } : {}),
    loadDashboard: async () => z.object({ capabilities: z.object({ manageOrganizationPlugins: z.boolean(), publishPlugins: z.boolean() }) }).parse(await call('market-capabilities', {})),
    loadPlugins: async () => {
      const catalog = enterprisePluginCatalog.parse(await call('plugins', {}))
      return product ? marketDisplayCatalog(catalog, enterprisePluginInstallations.parse(await call('plugin-installations', {})), t('marketReleaseUnavailable'))
        : catalog.filter((plugin, index) => catalog.findIndex(item => item.pluginId === plugin.pluginId) === index)
    },
    loadPluginInstallations: async () => enterprisePluginInstallations.parse(await call('plugin-installations', {})),
    loadPluginDeviceTargets: async () => enterprisePluginDeviceTargets.parse(await call('plugin-device-targets', {})),
    loadPluginDiagnostics: async () => enterprisePluginCapabilityDiagnostics.parse(await call('plugin-runtime-diagnostics', {})),
    uploadPlugin: (visibility, bytes) => mutate('plugin-upload', { visibility, bytes: [...bytes] }),
    installPlugin: releaseId => mutate('plugin-install', { releaseId }),
    upgradePlugin: (installationId, releaseId) => mutate('plugin-upgrade', { installationId, releaseId, confirmPermissions: true }),
    uninstallPlugin: installationId => mutate('plugin-uninstall', { installationId }),
    forceRemovePlugin: installationId => mutate('plugin-force-remove', { installationId }),
    setPluginEnabled: (installationId, enabled) => mutate('plugin-enable', { installationId, enabled }),
    loadPluginSettings: async installationId => pluginSettings.parse(await call('plugin-settings', { installationId })),
    configurePluginSettings: input => mutate('plugin-configure-settings', input),
    loadConnectionSettings: async installationId => pluginConnectionSettings.parse(await call('plugin-connection-settings', { installationId })),
    configureConnection: input => mutate('plugin-configure-connection', input),
    authorizeConnection: async installationId => z.object({ url: z.url().optional() }).parse(await call('plugin-authorize-connection', { installationId })),
    authorizationStatus: async (installationId, cancel) => z.object({ complete: z.boolean(), error: z.string().optional() }).parse(await call('plugin-authorization-status', { installationId, ...(cancel === undefined ? {} : { cancel }) })),
  })
  const t = ctx.locale.bind('enterprise')
  ctx.slots.inject('sidebar.rail.item', () => ctx.slots.register({ name: 'sidebar.rail.item', id: 'plugin-market', order: 20,
    locale: 'enterprise', label: () => t('pluginMarket'), icon: IconCordisPluginOutline14,
    inject: () => ({ navigation: ctx.mainNavigation, open: () => { ctx.mainNavigation.openPluginMarket() } }),
  }, PluginMarketAction))
  ctx.slots.inject('main.surface', () => ctx.slots.register({ name: 'main.surface', key: 'plugin-market',
    locale: 'enterprise', inject: injected }, PluginMarket))
}
