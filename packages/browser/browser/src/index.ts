/** Session-owned browser capability with shared tab state and awaited cleanup. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session'

/** Opaque identity of one Session-owned browser context. */
export type BrowserSessionId = Branded<'BrowserSessionId'>
/** Opaque identity of one tab within a browser context. */
export type BrowserTabId = Branded<'BrowserTabId'>
const OBSERVED_SNAPSHOT_MAX_CHARS = 200_000
const OBSERVED_TITLE_MAX_CHARS = 4096

/**
 * Brand one registry-issued browser context id.
 * @param value - serialized browser context identity.
 * @returns the branded identity.
 */
export const BrowserSessionId = (value: string): BrowserSessionId => value as BrowserSessionId
/**
 * Brand one registry-issued browser tab id.
 * @param value - serialized browser tab identity.
 * @returns the branded identity.
 */
export const BrowserTabId = (value: string): BrowserTabId => value as BrowserTabId

/** Client-safe state for one browser tab. */
export interface BrowserTab {
  readonly tabId: BrowserTabId
  readonly title: string
  readonly url: string
  readonly favicon?: string
  readonly loading: boolean
  readonly active: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
}

/** Result of a browser operation that leaves one tab selected. */
export interface BrowserActionResult { readonly tab: BrowserTab }
/** Provider-observed state before registry-owned identity and selection are applied. */
export type BrowserProviderTab = Omit<BrowserTab, 'tabId' | 'active'>

/** Stable browser capability failure taxonomy. */
export type BrowserErrorCode =
  | 'INVALID_URL'
  | 'INVALID_OBSERVATION'
  | 'TAB_LIMIT'
  | 'UNKNOWN_PROVIDER'
  | 'UNKNOWN_SESSION'
  | 'UNKNOWN_TAB'
  | 'SESSION_CLOSING'
  | 'UNSUPPORTED_ACTION'

/** Stable failure from URL, provider, tab, or lifecycle policy. */
export class BrowserError extends Error {
  constructor(message: string, readonly code: BrowserErrorCode) {
    super(message)
    this.name = 'BrowserError'
  }
}

/** Replaceable browser backend. One backend context is shared by all tabs in a Session. */
export interface BrowserProvider {
  readonly name: string
  open(sessionId: SessionId, tabId: BrowserTabId, url: string): Promise<BrowserProviderTab>
  close(sessionId: SessionId, tabId: BrowserTabId): Promise<void>
  read(sessionId: SessionId, tabId: BrowserTabId): Promise<BrowserProviderTab>
  click?(sessionId: SessionId, tabId: BrowserTabId, selector: string): Promise<BrowserProviderTab>
  fill?(sessionId: SessionId, tabId: BrowserTabId, selector: string, value: string): Promise<BrowserProviderTab>
  press?(sessionId: SessionId, tabId: BrowserTabId, selector: string, key: string): Promise<BrowserProviderTab>
  clickAt?(sessionId: SessionId, tabId: BrowserTabId, x: number, y: number, clicks: 1 | 2): Promise<BrowserProviderTab>
  scroll?(sessionId: SessionId, tabId: BrowserTabId, deltaX: number, deltaY: number): Promise<BrowserProviderTab>
  insertText?(sessionId: SessionId, tabId: BrowserTabId, text: string): Promise<BrowserProviderTab>
  pressFocused?(sessionId: SessionId, tabId: BrowserTabId, key: string): Promise<BrowserProviderTab>
  back?(sessionId: SessionId, tabId: BrowserTabId): Promise<BrowserProviderTab>
  forward?(sessionId: SessionId, tabId: BrowserTabId): Promise<BrowserProviderTab>
  reload?(sessionId: SessionId, tabId: BrowserTabId): Promise<BrowserProviderTab>
  snapshot?(sessionId: SessionId, tabId: BrowserTabId): Promise<string>
  screenshot?(sessionId: SessionId, tabId: BrowserTabId): Promise<Uint8Array>
}

/** Client-observed state from a Session-owned native browser view. */
export interface BrowserObservation {
  readonly title: string
  readonly url: string
  readonly snapshot: string
  readonly canGoBack: boolean
  readonly canGoForward: boolean
}

interface RecordState {
  readonly sessionId: SessionId
  readonly tabs: Map<BrowserTabId, BrowserTab>
  readonly provider: BrowserProvider
  readonly observations: Map<BrowserTabId, string>
  active?: BrowserTabId
  revision: number
}

declare module '@deepseek-ai/cordis' {
  interface Context { browsers: BrowserService }
  interface Events {
    /**
     * Publish one committed browser state revision for live Client followers.
     * @mode emit
     * @param sessionId - Session that owns the browser context.
     * @param browserId - browser context whose state changed.
     * @param revision - monotonic revision within the browser context.
     * @param tabs - complete committed tab list for the revision.
     */
    'browser/change'(sessionId: SessionId, browserId: BrowserSessionId, revision: number, tabs: readonly BrowserTab[]): void
  }
}

/** Browser registry deployment policy. */
export interface Config {
  /** Maximum simultaneous tabs in one Session browser context. */
  maxTabs?: number
}

/** Schemastery configuration for the browser registry. */
export const Config: z<Config> = z.object({
  maxTabs: z.number().step(1).min(1).max(100).default(12),
})

/** Session-owned browser registry shared by Host Remote consumers and model tools. */
export class BrowserService extends Service {
  static Config = Config
  private readonly sessions = new Map<BrowserSessionId, RecordState>()
  private readonly byOwner = new Map<SessionId, BrowserSessionId>()
  private readonly providers = new Map<string, BrowserProvider>()
  private readonly closings = new Map<BrowserSessionId, { readonly sessionId: SessionId; readonly promise: Promise<void> }>()
  private readonly closingByOwner = new Map<SessionId, BrowserSessionId>()
  private readonly maxTabs: number
  private sequence = 0

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'browsers')
    this.maxTabs = config.maxTabs ?? 12
    if (!Number.isSafeInteger(this.maxTabs) || this.maxTabs < 1) {
      throw new Error('browser: maxTabs must be a positive safe integer')
    }
    ctx.effect(() => () => this.disposeAll(), 'browser teardown')
  }

  /**
   * Register one provider for the current effect scope.
   * @param provider - provider implementation with a unique non-empty name.
   * @returns a disposer that removes this exact registration.
   */
  register(provider: BrowserProvider): () => void {
    if (provider.name.length === 0) throw new Error('browser provider name must be non-empty')
    if (this.providers.has(provider.name)) throw new Error(`browser provider "${provider.name}" already registered`)
    this.providers.set(provider.name, provider)
    return () => {
      if (this.providers.get(provider.name) === provider) this.providers.delete(provider.name)
    }
  }

  /**
   * Return the existing Session context or create its single shared context.
   * @param sessionId - product Session that owns the context.
   * @param providerName - required provider name, or the first registered provider when absent.
   * @param ownerCtx - effect scope that should close the context.
   * @returns the shared browser context identity.
   */
  ensure(sessionId: SessionId, providerName?: string, ownerCtx?: Context): BrowserSessionId {
    const existing = this.byOwner.get(sessionId)
    if (existing !== undefined) {
      const state = this.sessions.get(existing)
      if (state !== undefined && providerName !== undefined && state.provider.name !== providerName) {
        throw new BrowserError(`Session browser already uses provider "${state.provider.name}"`, 'UNKNOWN_PROVIDER')
      }
      return existing
    }
    if (this.closingByOwner.has(sessionId)) {
      throw new BrowserError('Session browser context is closing', 'SESSION_CLOSING')
    }
    const provider = providerName === undefined
      ? this.providers.values().next().value
      : this.providers.get(providerName)
    if (provider === undefined) {
      throw new BrowserError(`unknown browser provider "${providerName ?? '(default)'}"`, 'UNKNOWN_PROVIDER')
    }
    const id = BrowserSessionId(`browser-${++this.sequence}`)
    this.sessions.set(id, { sessionId, tabs: new Map(), provider, observations: new Map(), revision: 0 })
    this.byOwner.set(sessionId, id)
    ownerCtx?.effect(() => async () => { await this.closeSession(sessionId) }, 'browser Session cleanup')
    this.publish(id)
    return id
  }

  /**
   * Compatibility alias for callers that explicitly request context creation.
   * @param sessionId - product Session that owns the context.
   * @param providerName - optional provider name.
   * @returns the shared browser context identity.
   */
  create(sessionId: SessionId, providerName?: string): BrowserSessionId { return this.ensure(sessionId, providerName) }
  /**
   * Return the Session's browser context, if one exists.
   * @param sessionId - product Session to inspect.
   * @returns the browser context identity when present.
   */
  find(sessionId: SessionId): BrowserSessionId | undefined { return this.byOwner.get(sessionId) }

  /**
   * Close the exact Session context and every provider page it owns.
   * @param sessionId - product Session that owns the context.
   * @param browserId - exact context to close.
   * @returns when all provider pages finish closing.
   */
  async close(sessionId: SessionId, browserId: BrowserSessionId): Promise<void> {
    const closing = this.closings.get(browserId)
    if (closing !== undefined) {
      if (closing.sessionId !== sessionId) {
        throw new BrowserError('browser session is not owned by the requested Session', 'UNKNOWN_SESSION')
      }
      await closing.promise
      return
    }
    const state = this.expect(sessionId, browserId)
    this.sessions.delete(browserId)
    this.byOwner.delete(sessionId)
    this.closingByOwner.set(sessionId, browserId)
    const promise = (async () => {
      const results = await Promise.allSettled([...state.tabs.keys()].map(tabId => state.provider.close(sessionId, tabId)))
      const failures: unknown[] = []
      for (const result of results) {
        if (result.status === 'rejected') failures.push(result.reason as unknown)
      }
      if (failures.length > 0) throw new AggregateError(failures, `failed to close browser context ${browserId}`)
    })()
    this.closings.set(browserId, { sessionId, promise })
    try {
      await promise
    } finally {
      this.closings.delete(browserId)
      if (this.closingByOwner.get(sessionId) === browserId) this.closingByOwner.delete(sessionId)
    }
  }

  /**
   * Close a Session context when present.
   * @param sessionId - product Session whose context should close.
   * @returns when cleanup finishes or immediately when no context exists.
   */
  async closeSession(sessionId: SessionId): Promise<void> {
    const browserId = this.byOwner.get(sessionId) ?? this.closingByOwner.get(sessionId)
    if (browserId !== undefined) await this.close(sessionId, browserId)
  }

  /**
   * Read the current committed state without exposing registry internals.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context to read.
   * @returns a detached array of committed tabs.
   */
  list(sessionId: SessionId, browserId: BrowserSessionId): BrowserTab[] {
    return [...this.expect(sessionId, browserId).tabs.values()]
  }

  /**
   * Return the current revision for baseline-plus-delta followers.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context to read.
   * @returns the monotonic context revision.
   */
  revision(sessionId: SessionId, browserId: BrowserSessionId): number {
    return this.expect(sessionId, browserId).revision
  }

  /**
   * Open and select a new tab.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context that will own the tab.
   * @param url - absolute HTTP(S) URL or `about:blank`.
   * @returns the committed selected tab.
   */
  async open(sessionId: SessionId, browserId: BrowserSessionId, url: string): Promise<BrowserActionResult> {
    const state = this.expect(sessionId, browserId)
    assertUrl(url)
    if (state.tabs.size >= this.maxTabs) throw new BrowserError('browser tab limit reached', 'TAB_LIMIT')
    const tabId = BrowserTabId(`tab-${++this.sequence}`)
    const previousActive = state.active
    this.selectInMemory(state, tabId)
    let observed: BrowserProviderTab
    try {
      observed = await state.provider.open(sessionId, tabId, url)
    } catch (error) {
      let cleanupError: unknown
      try { await state.provider.close(sessionId, tabId) } catch (failure: unknown) { cleanupError = failure }
      if (previousActive === undefined) delete state.active
      else this.selectInMemory(state, previousActive)
      if (cleanupError !== undefined) {
        throw new AggregateError([error, cleanupError], `browser tab ${tabId} failed to open and close`)
      }
      throw error
    }
    const tab = this.commit(state, tabId, observed, true)
    this.publish(browserId)
    return { tab }
  }

  /**
   * Navigate an existing tab and publish provider-observed state after commit.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context that owns the tab.
   * @param tabId - tab to navigate.
   * @param url - absolute HTTP(S) URL or `about:blank`.
   * @returns the committed tab.
   */
  async navigate(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId, url: string): Promise<BrowserActionResult> {
    const state = this.expect(sessionId, browserId)
    this.expectTab(state, tabId)
    assertUrl(url)
    const observed = await state.provider.open(sessionId, tabId, url)
    state.observations.delete(tabId)
    const tab = this.commit(state, tabId, observed)
    this.publish(browserId)
    return { tab }
  }

  /**
   * Select a tab without creating or navigating it.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context that owns the tab.
   * @param tabId - tab to select.
   * @returns the selected tab.
   */
  select(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId): BrowserActionResult {
    const state = this.expect(sessionId, browserId)
    this.expectTab(state, tabId)
    this.selectInMemory(state, tabId)
    this.publish(browserId)
    return { tab: this.expectTab(state, tabId) }
  }

  /**
   * Close one tab while preserving the Session browser context.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context that owns the tab.
   * @param tabId - tab to close.
   * @returns a close acknowledgement.
   */
  async closeTab(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId): Promise<{ closed: true }> {
    const state = this.expect(sessionId, browserId)
    this.expectTab(state, tabId)
    await state.provider.close(sessionId, tabId)
    state.tabs.delete(tabId)
    state.observations.delete(tabId)
    if (state.active === tabId) {
      const next = [...state.tabs.values()].at(-1)
      if (next === undefined) delete state.active
      else this.selectInMemory(state, next.tabId)
    }
    this.publish(browserId)
    return { closed: true }
  }

  /**
   * Navigate one tab backward.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context that owns the tab.
   * @param tabId - tab to navigate.
   * @returns the committed tab.
   */
  async back(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId): Promise<BrowserActionResult> {
    return this.providerAction(sessionId, browserId, tabId, 'back')
  }

  /**
   * Navigate one tab forward.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context that owns the tab.
   * @param tabId - tab to navigate.
   * @returns the committed tab.
   */
  async forward(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId): Promise<BrowserActionResult> {
    return this.providerAction(sessionId, browserId, tabId, 'forward')
  }

  /**
   * Reload one tab.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context that owns the tab.
   * @param tabId - tab to reload.
   * @returns the committed tab.
   */
  async reload(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId): Promise<BrowserActionResult> {
    return this.providerAction(sessionId, browserId, tabId, 'reload')
  }

  /**
   * Run a DOM action and publish any navigation or title change it caused.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context that owns the tab.
   * @param tabId - target tab.
   * @param kind - provider DOM operation.
   * @param selector - provider selector for the target element.
   * @param value - fill value or key for operations that require one.
   * @returns the committed tab.
   */
  async action(
    sessionId: SessionId,
    browserId: BrowserSessionId,
    tabId: BrowserTabId,
    kind: 'click' | 'fill' | 'press',
    selector: string,
    value?: string,
  ): Promise<BrowserActionResult> {
    const state = this.expect(sessionId, browserId)
    this.expectTab(state, tabId)
    let observed: BrowserProviderTab
    if (kind === 'click') {
      if (state.provider.click === undefined) {
        throw new BrowserError('browser provider does not support click', 'UNSUPPORTED_ACTION')
      }
      observed = await state.provider.click(sessionId, tabId, selector)
    } else if (kind === 'fill') {
      if (state.provider.fill === undefined) {
        throw new BrowserError('browser provider does not support fill', 'UNSUPPORTED_ACTION')
      }
      observed = await state.provider.fill(sessionId, tabId, selector, value ?? '')
    } else {
      if (state.provider.press === undefined) {
        throw new BrowserError('browser provider does not support press', 'UNSUPPORTED_ACTION')
      }
      observed = await state.provider.press(sessionId, tabId, selector, value ?? '')
    }
    state.observations.delete(tabId)
    const tab = this.commit(state, tabId, observed)
    this.publish(browserId)
    return { tab }
  }

  /**
   * Forward a pointer click from a rendered provider screenshot.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context that owns the tab.
   * @param tabId - target tab.
   * @param x - horizontal viewport coordinate.
   * @param y - vertical viewport coordinate.
   * @param clicks - single or double click.
   * @returns the committed tab.
   */
  async clickAt(
    sessionId: SessionId,
    browserId: BrowserSessionId,
    tabId: BrowserTabId,
    x: number,
    y: number,
    clicks: 1 | 2,
  ): Promise<BrowserActionResult> {
    const state = this.expect(sessionId, browserId)
    this.expectTab(state, tabId)
    if (state.provider.clickAt === undefined) {
      throw new BrowserError('browser provider does not support pointer clicks', 'UNSUPPORTED_ACTION')
    }
    const observed = await state.provider.clickAt(sessionId, tabId, x, y, clicks)
    state.observations.delete(tabId)
    const tab = this.commit(state, tabId, observed)
    this.publish(browserId)
    return { tab }
  }

  /**
   * Forward a wheel delta from the Client browser viewport.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context that owns the tab.
   * @param tabId - target tab.
   * @param deltaX - horizontal wheel delta.
   * @param deltaY - vertical wheel delta.
   * @returns the committed tab.
   */
  async scroll(
    sessionId: SessionId,
    browserId: BrowserSessionId,
    tabId: BrowserTabId,
    deltaX: number,
    deltaY: number,
  ): Promise<BrowserActionResult> {
    const state = this.expect(sessionId, browserId)
    this.expectTab(state, tabId)
    if (state.provider.scroll === undefined) {
      throw new BrowserError('browser provider does not support scrolling', 'UNSUPPORTED_ACTION')
    }
    const observed = await state.provider.scroll(sessionId, tabId, deltaX, deltaY)
    state.observations.delete(tabId)
    const tab = this.commit(state, tabId, observed)
    this.publish(browserId)
    return { tab }
  }

  /**
   * Insert text at the page's focused editable element.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context that owns the tab.
   * @param tabId - target tab.
   * @param text - text to insert.
   * @returns the committed tab.
   */
  async insertText(
    sessionId: SessionId,
    browserId: BrowserSessionId,
    tabId: BrowserTabId,
    text: string,
  ): Promise<BrowserActionResult> {
    const state = this.expect(sessionId, browserId)
    this.expectTab(state, tabId)
    if (state.provider.insertText === undefined) {
      throw new BrowserError('browser provider does not support focused text input', 'UNSUPPORTED_ACTION')
    }
    const observed = await state.provider.insertText(sessionId, tabId, text)
    state.observations.delete(tabId)
    const tab = this.commit(state, tabId, observed)
    this.publish(browserId)
    return { tab }
  }

  /**
   * Press one provider key chord at the page's focused element.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context that owns the tab.
   * @param tabId - target tab.
   * @param key - provider key chord.
   * @returns the committed tab.
   */
  async pressFocused(
    sessionId: SessionId,
    browserId: BrowserSessionId,
    tabId: BrowserTabId,
    key: string,
  ): Promise<BrowserActionResult> {
    const state = this.expect(sessionId, browserId)
    this.expectTab(state, tabId)
    if (state.provider.pressFocused === undefined) {
      throw new BrowserError('browser provider does not support focused key input', 'UNSUPPORTED_ACTION')
    }
    const observed = await state.provider.pressFocused(sessionId, tabId, key)
    state.observations.delete(tabId)
    const tab = this.commit(state, tabId, observed)
    this.publish(browserId)
    return { tab }
  }

  /**
   * Read semantic page text from a current native observation or provider.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context that owns the tab.
   * @param tabId - target tab.
   * @returns bounded semantic page text.
   */
  async snapshot(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId): Promise<string> {
    const state = this.expect(sessionId, browserId)
    this.expectTab(state, tabId)
    const observation = state.observations.get(tabId)
    if (observation !== undefined) return observation
    if (state.provider.snapshot === undefined) throw new BrowserError('browser provider does not support snapshots', 'UNSUPPORTED_ACTION')
    return state.provider.snapshot(sessionId, tabId)
  }

  /**
   * Commit bounded metadata and semantic text from the visible native browser.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context that owns the tab.
   * @param tabId - observed tab.
   * @param observation - native title, URL, navigation state, and semantic text.
   * @returns the committed tab.
   */
  observe(
    sessionId: SessionId,
    browserId: BrowserSessionId,
    tabId: BrowserTabId,
    observation: BrowserObservation,
  ): BrowserActionResult {
    const state = this.expect(sessionId, browserId)
    const current = this.expectTab(state, tabId)
    assertUrl(observation.url)
    if (observation.title.length > OBSERVED_TITLE_MAX_CHARS || observation.snapshot.length > OBSERVED_SNAPSHOT_MAX_CHARS) {
      throw new BrowserError('browser observation exceeds its configured limit', 'INVALID_OBSERVATION')
    }
    state.observations.set(tabId, observation.snapshot)
    const tab: BrowserTab = {
      ...current,
      title: observation.title,
      url: observation.url,
      loading: false,
      canGoBack: observation.canGoBack,
      canGoForward: observation.canGoForward,
    }
    state.tabs.set(tabId, tab)
    this.publish(browserId)
    return { tab }
  }

  /**
   * Capture the provider page as PNG bytes.
   * @param sessionId - product Session that owns the context.
   * @param browserId - context that owns the tab.
   * @param tabId - target tab.
   * @returns PNG bytes from the provider.
   */
  async screenshot(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId): Promise<Uint8Array> {
    const state = this.expect(sessionId, browserId)
    this.expectTab(state, tabId)
    if (state.provider.screenshot === undefined) throw new BrowserError('browser provider does not support screenshots', 'UNSUPPORTED_ACTION')
    return state.provider.screenshot(sessionId, tabId)
  }

  private async providerAction(
    sessionId: SessionId,
    browserId: BrowserSessionId,
    tabId: BrowserTabId,
    kind: 'back' | 'forward' | 'reload',
  ): Promise<BrowserActionResult> {
    const state = this.expect(sessionId, browserId)
    this.expectTab(state, tabId)
    const operation = state.provider[kind]
    if (operation === undefined) throw new BrowserError(`browser provider does not support ${kind}`, 'UNSUPPORTED_ACTION')
    const observed = await operation.call(state.provider, sessionId, tabId)
    state.observations.delete(tabId)
    const tab = this.commit(state, tabId, observed)
    this.publish(browserId)
    return { tab }
  }

  private commit(state: RecordState, tabId: BrowserTabId, observed: BrowserProviderTab, forceActive = false): BrowserTab {
    const tab: BrowserTab = { tabId, ...observed, active: forceActive || state.active === tabId }
    state.tabs.set(tabId, tab)
    if (tab.active) this.selectInMemory(state, tabId)
    return this.expectTab(state, tabId)
  }

  private selectInMemory(state: RecordState, tabId: BrowserTabId): void {
    for (const tab of state.tabs.values()) state.tabs.set(tab.tabId, { ...tab, active: tab.tabId === tabId })
    state.active = tabId
  }

  private publish(browserId: BrowserSessionId): void {
    const state = this.sessions.get(browserId)
    if (state === undefined) return
    state.revision += 1
    this.ctx.emit('browser/change', state.sessionId, browserId, state.revision, [...state.tabs.values()])
  }

  private expect(sessionId: SessionId, browserId: BrowserSessionId): RecordState {
    const state = this.sessions.get(browserId)
    if (state?.sessionId !== sessionId) {
      throw new BrowserError('browser session is not owned by the requested Session', 'UNKNOWN_SESSION')
    }
    return state
  }

  private expectTab(state: RecordState, tabId: BrowserTabId): BrowserTab {
    const tab = state.tabs.get(tabId)
    if (tab === undefined) throw new BrowserError(`unknown browser tab "${tabId}"`, 'UNKNOWN_TAB')
    return tab
  }

  private async disposeAll(): Promise<void> {
    const owners = new Set([...this.byOwner.keys(), ...this.closingByOwner.keys()])
    const results = await Promise.allSettled([...owners].map(sessionId => this.closeSession(sessionId)))
    this.sessions.clear()
    this.byOwner.clear()
    this.closings.clear()
    this.closingByOwner.clear()
    this.providers.clear()
    const failures: unknown[] = []
    for (const result of results) {
      if (result.status === 'rejected') failures.push(result.reason as unknown)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'failed to dispose browser sessions')
  }
}

function assertUrl(value: string): void {
  if (value.length === 0 || value.length > 8192) throw new BrowserError('browser URL is empty or too long', 'INVALID_URL')
  if (value === 'about:blank') return
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new BrowserError('browser URL is invalid', 'INVALID_URL') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BrowserError('browser URL protocol is not allowed', 'INVALID_URL')
  }
}

export default BrowserService
