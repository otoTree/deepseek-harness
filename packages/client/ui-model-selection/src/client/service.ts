/**
 * ModelDirectoryResolver (`ctx.modelDirectories`): the root owner of per-session
 * {@link ModelDirectory} instances. Both selection entries (the /model popup
 * and the composer model seat) resolve their session's directory through
 * this service, which is what makes the dual entry one shared state.
 *
 * Per-session storage follows the client service pattern (InputTriggerService /
 * CommandUiRuntime): a lazy service-internal map whose entry is deleted by the
 * owning scope's disposer. The host `dsh-scope` ScopedLayers registry does
 * does not belong here: it derives scope from the host carrier mechanism
 * (object-keyed), while client scopes tag contexts with branded SessionId
 * strings, and it models global+shadow named registries — this is a
 * per-session singleton with no global layer to merge.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import { ModelCatalogDirectory } from './catalog.ts'
import { ModelDirectory } from './directory.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    modelDirectories: ModelDirectoryResolver
  }
}

/** Live mutable state in one holder (service methods run behind the caller-ctx tracker). */
interface LiveState {
  /** Per-session directories; entries are deleted by their scope disposer. */
  readonly directories: Map<SessionId, ModelDirectory>
  readonly catalogs: Map<SessionId, ModelCatalogDirectory>
  source?: (sessionId: SessionId, signal: AbortSignal) => Promise<ModelCatalog | null>
}

/** The `ctx.modelDirectories` session model-selection service. */
export class ModelDirectoryResolver extends Service {
  static inject = ['sessions', 'remote', 'remote.session']

  private readonly live: LiveState = { directories: new Map(), catalogs: new Map() }
  private readonly catalog: ModelCatalogDirectory

  /** Localized composer-block copy; this plugin owns the string it raises. */
  private readonly blockReason: () => string

  /**
   * @param ctx - owning root context (the service registers itself as `models`).
   * @param config - the bound translator for this plugin's own dictionary.
   */
  constructor(ctx: Context, config: { blockReason: () => string }) {
    super(ctx, 'modelDirectories')
    this.blockReason = config.blockReason
    this.catalog = new ModelCatalogDirectory(ctx)
    void this.catalog.load().catch(() => { /* selectors expose the shared error */ })
    ctx.on('connection/reset', () => {
      this.catalog.resetGeneration()
      for (const catalog of this.live.catalogs.values()) catalog.resetGeneration()
      for (const [sessionId, directory] of this.live.directories) {
        const scoped = this.live.catalogs.get(sessionId)
        if (scoped) directory.useCatalog(scoped)
        directory.resetConnected()
      }
    })
    const refresh = () => {
      this.catalog.refresh()
      for (const catalog of this.live.catalogs.values()) catalog.refresh()
    }
    ctx.remote.$on('llm/adapters-updated', refresh)
    ctx.remote.$on('settings/document-updated', refresh)
    ctx.remote.$on('credentials/reference-updated', refresh)
    ctx.effect(() => () => {
      this.catalog.dispose()
      for (const catalog of this.live.catalogs.values()) catalog.dispose()
    }, 'ui-model-selection: close catalog reads')
  }

  /** Install one optional Session-authorized catalog source; null uses the shared catalog.
   * @param source - Presentation-only discovery; must validate Session authority on the Host.
   * @returns Disposer restoring the shared catalog without changing any model selection.
   */
  registerCatalogSource(source: (sessionId: SessionId, signal: AbortSignal) => Promise<ModelCatalog | null>): () => void {
    const { live } = this
    if (live.source) throw new Error('ui-model-selection: a catalog source is already registered')
    live.source = source
    for (const [sessionId, directory] of live.directories) directory.useCatalog(this.catalogFor(sessionId))
    return () => {
      if (live.source !== source) return
      delete live.source
      for (const catalog of live.catalogs.values()) catalog.dispose()
      live.catalogs.clear()
      for (const directory of live.directories.values()) directory.useCatalog(this.catalog)
    }
  }

  private catalogFor(sessionId: SessionId): ModelCatalogDirectory {
    const { live } = this
    const source = live.source
    if (!source || this.ctx.sessions.subagentAddress(sessionId) !== undefined) return this.catalog
    const existing = live.catalogs.get(sessionId)
    if (existing) return existing
    const catalog = new ModelCatalogDirectory(this.ctx, async (signal) => {
      const selected = await source(sessionId, signal)
      signal.throwIfAborted()
      return selected ?? this.catalog.load()
    })
    live.catalogs.set(sessionId, catalog)
    void catalog.load().catch(() => { /* the Session selector exposes the source failure */ })
    return catalog
  }

  /**
   * Resolve the per-session shared directory (lazy; the scope disposer
   * removes and disposes it). Unknown sessions fail loud.
   * @param sessionId - the owning session.
   * @returns the resident directory both entries share.
   */
  directoryFor(sessionId: SessionId): ModelDirectory {
    const { live } = this
    const existing = live.directories.get(sessionId)
    if (existing !== undefined) return existing
    const sessions = this.ctx.sessions
    const actx = sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no scope`)
    const binding = sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no binding`)
    const directory = new ModelDirectory(
      this.ctx.remote.session,
      sessionId,
      () => sessions.subagentAddress(sessionId) === undefined,
      this.catalogFor(sessionId),
      binding.session.projections.faceOf('modelSelection'),
      this.catalog,
    )
    live.directories.set(sessionId, directory)
    // The composer cannot read this plugin (the dependency runs one way), so
    // the block is pushed: the Host says whether an adapter serves the
    // session's route, and only a definite `false` makes the input inert.
    // `null` — before the first load, or after one failed — must not, or a
    // slow or unreachable Host would lock a working composer.
    const conversation = this.ctx.get('conversation')
    if (conversation !== undefined) {
      const publish = (): void => {
        conversation.blocks.set(sessionId, directory.store.getSnapshot().routable === false
          ? { reason: this.blockReason() }
          : undefined)
      }
      publish()
      actx.effect(() => {
        const stop = directory.store.subscribe(publish)
        return () => {
          stop()
          conversation.blocks.set(sessionId, undefined)
        }
      }, 'ui-model-selection: composer block')
    }
    actx.effect(() => () => {
      directory.dispose()
      live.directories.delete(sessionId)
      live.catalogs.get(sessionId)?.dispose()
      live.catalogs.delete(sessionId)
    }, 'ui-model-selection: session directory')
    return directory
  }
}
