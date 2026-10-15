/** Product-owned Cordis Loader groups for verified, installed Host packages. */
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { PluginSdk } from '@deepseek-ai/dsh-plugin-protocol'

/** Installed entry supplied by the package verifier and store. */
export interface InstalledCordisEntry {
  readonly url: string
  readonly config?: unknown
}

/** One product's live Loader group and contribution owners. */
export interface ManagedCordisProduct {
  readonly groupId: string
  readonly owners: ReadonlySet<Fiber>
  /** Remove the product group and wait for its Cordis effects to stop.
   * @returns Completion of Loader removal; a failed removal can be retried.
   */
  dispose(): Promise<void>
}

/** Connects market installations to the running profile's Cordis Loader. */
export class CordisPluginManager {
  private readonly products = new Map<string, ManagedCordisProduct>()

  constructor(private readonly ctx: Context) {}

  /** Install a verified product composition under an SDK-isolated Loader group.
   * @param installationId - Organization-scoped market installation identity.
   * @param entries - Verified Host entry URLs and their installation configuration.
   * @param providerUrl - Host-owned module providing the activation SDK.
   * @param sdk - SDK bound to the current activation lease.
   * @param signal - Cancels preparation and removes the incomplete Loader group.
   * @returns The live group and all package fibers owning its registrations.
   */
  async load(
    installationId: string, entries: readonly InstalledCordisEntry[],
    providerUrl: string, sdk: PluginSdk, signal: AbortSignal,
  ): Promise<ManagedCordisProduct> {
    if (this.products.has(installationId)) throw new Error(`Cordis product ${installationId} is already loaded`)
    signal.throwIfAborted()
    const loader = this.ctx.loader
    const groupId = await loader.create({
      name: 'cordis:group', group: true, config: [], isolate: { pluginSdk: `market-${installationId}` },
    })
    const owners = new Set<Fiber>()
    const product = { groupId, owners, dispose: (): Promise<void> => dispose() }
    this.products.set(installationId, product)
    let removal: Promise<void> | undefined
    const dispose = (): Promise<void> => {
      removal ??= loader.remove(groupId).then(() => {
        if (this.products.get(installationId)?.groupId === groupId) this.products.delete(installationId)
      }).catch((error: unknown) => {
        removal = undefined
        throw error
      })
      return removal
    }
    const abort = (): void => { void dispose().catch((error: unknown) => { this.ctx.logger('plugin-manager').error(error) }) }
    signal.addEventListener('abort', abort, { once: true })
    const activate = async (entry: InstalledCordisEntry): Promise<Fiber> => {
      signal.throwIfAborted()
      // Disabled creation commits the child to its group before import or apply
      // can suspend. Group removal therefore owns even an incomplete activation.
      const id = await loader.create({
        name: entry.url, disabled: true,
        ...(entry.config === undefined ? {} : { config: entry.config }),
      }, groupId)
      signal.throwIfAborted()
      await loader.update(id, { disabled: null })
      signal.throwIfAborted()
      const fiber = loader.resolve(id).fiber
      if (fiber === undefined) throw new Error(`Cordis package ${entry.url} did not create a Host fiber`)
      return fiber
    }
    try {
      signal.throwIfAborted()
      await activate({ url: providerUrl, config: { sdk } })
      for (const entry of entries) {
        owners.add(await activate(entry))
      }
      return product
    } catch (error) {
      try { await dispose() }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], `Cordis product ${installationId} cleanup failed`) }
      signal.throwIfAborted()
      throw error
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  /** Remove a live or partially loaded composition; failed disposal remains retryable.
   * @param installationId - Organization-scoped market installation identity.
   * @returns Completion after the owned Loader group has left the profile.
   */
  async remove(installationId: string): Promise<void> {
    await this.products.get(installationId)?.dispose()
  }
}
