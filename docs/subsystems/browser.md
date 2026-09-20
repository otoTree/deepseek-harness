# Interactive Browser

English | [中文](browser.zh.md)

The interactive browser capability is a [capability seam](../glossary.md#capability-seam) shared by Host Remotes, model tools, and Client panels. Its Service Definition is [`dsh-browser`](../../packages/browser/browser), the shipped Service Provider is [`dsh-browser-playwright`](../../packages/browser/browser-playwright), and its model-facing Consumer is [`dsh-tool-browser`](../../packages/browser/tool-browser). The Workbench Client uses the same Session-owned identities through [`dsh-api-workbench-controller`](../../packages/api/workbench-controller) while owning the visible browser presentation.

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)

## Session context and tab state

`BrowserService` gives each product Session at most one active browser context. `BrowserSessionId` and `BrowserTabId` are opaque identities; consumers must pass both the product Session id and browser id so cross-Session access fails. The service owns active-tab selection, committed `BrowserTab` records, monotonic revisions, tab limits, provider registration, and awaited teardown. Providers own browser-engine pages and return observed title, URL, loading, history, and favicon state after each operation.

Every successful state change emits `browser/change` with the complete committed tab list. Client followers begin with a baseline and apply only later revisions, so reconnecting does not depend on an unbounded event backlog.

## Native presentation and provider automation

The Electrobun desktop Client displays a sandboxed native WebView at the panel's actual viewport size. The Web Client uses an iframe. Neither visible panel renders a provider screenshot. The Session Playwright provider remains the automation engine used by model tools and Host Remotes.

The native WebView and Playwright provider are distinct browser engines, not two handles for one page. Native top-level navigation is mirrored to the provider, and the native view reports bounded title, URL, history state, and semantic DOM text. `snapshot` prefers that current native observation until a successful provider operation invalidates it, then falls back to the provider snapshot. Direct native interaction is not represented as an identical sequence of Playwright actions.

## Operations and lifecycle

The service supports context creation and cleanup, tab open/select/close, navigation, selector actions, viewport clicks and scrolling, focused text and key input, semantic snapshots, and PNG screenshots when the selected provider implements them. Unsupported optional operations fail with `UNSUPPORTED_ACTION`. Context cleanup waits for every provider page; a Session cannot create a replacement context while the previous one is still closing.

## Limits and security

Navigation accepts HTTP(S) URLs and the exact internal new-tab URL `about:blank`. The service enforces URL length, tab count, native title length, native snapshot length, ownership, and cleanup state. These checks are lifecycle and resource policy, not complete SSRF protection: the current browser capability does not DNS-pin navigation to public addresses. Deployments that treat browser navigation as untrusted network access must add that policy before enabling arbitrary destinations.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowsers--browserservice"></a>

### `ctx.browsers` — `BrowserService`

Session-owned browser registry shared by Host Remote consumers and model tools.

```ts cordis-catalog
/**
 * Register one provider for the current effect scope.
 * @param provider - provider implementation with a unique non-empty name.
 * @returns a disposer that removes this exact registration.
 */
register(provider: BrowserProvider): () => void

/**
 * Return the existing Session context or create its single shared context.
 * @param sessionId - product Session that owns the context.
 * @param providerName - required provider name, or the first registered provider when absent.
 * @param ownerCtx - effect scope that should close the context.
 * @returns the shared browser context identity.
 */
ensure(sessionId: SessionId, providerName?: string, ownerCtx?: Context): BrowserSessionId

/**
 * Compatibility alias for callers that explicitly request context creation.
 * @param sessionId - product Session that owns the context.
 * @param providerName - optional provider name.
 * @returns the shared browser context identity.
 */
create(sessionId: SessionId, providerName?: string): BrowserSessionId

/**
 * Return the Session's browser context, if one exists.
 * @param sessionId - product Session to inspect.
 * @returns the browser context identity when present.
 */
find(sessionId: SessionId): BrowserSessionId | undefined

/**
 * Close the exact Session context and every provider page it owns.
 * @param sessionId - product Session that owns the context.
 * @param browserId - exact context to close.
 * @returns when all provider pages finish closing.
 */
async close(sessionId: SessionId, browserId: BrowserSessionId): Promise<void>

/**
 * Close a Session context when present.
 * @param sessionId - product Session whose context should close.
 * @returns when cleanup finishes or immediately when no context exists.
 */
async closeSession(sessionId: SessionId): Promise<void>

/**
 * Read the current committed state without exposing registry internals.
 * @param sessionId - product Session that owns the context.
 * @param browserId - context to read.
 * @returns a detached array of committed tabs.
 */
list(sessionId: SessionId, browserId: BrowserSessionId): BrowserTab[]

/**
 * Return the current revision for baseline-plus-delta followers.
 * @param sessionId - product Session that owns the context.
 * @param browserId - context to read.
 * @returns the monotonic context revision.
 */
revision(sessionId: SessionId, browserId: BrowserSessionId): number

/**
 * Open and select a new tab.
 * @param sessionId - product Session that owns the context.
 * @param browserId - context that will own the tab.
 * @param url - absolute HTTP(S) URL or `about:blank`.
 * @returns the committed selected tab.
 */
async open(sessionId: SessionId, browserId: BrowserSessionId, url: string): Promise<BrowserActionResult>

/**
 * Navigate an existing tab and publish provider-observed state after commit.
 * @param sessionId - product Session that owns the context.
 * @param browserId - context that owns the tab.
 * @param tabId - tab to navigate.
 * @param url - absolute HTTP(S) URL or `about:blank`.
 * @returns the committed tab.
 */
async navigate(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId, url: string): Promise<BrowserActionResult>

/**
 * Select a tab without creating or navigating it.
 * @param sessionId - product Session that owns the context.
 * @param browserId - context that owns the tab.
 * @param tabId - tab to select.
 * @returns the selected tab.
 */
select(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId): BrowserActionResult

/**
 * Close one tab while preserving the Session browser context.
 * @param sessionId - product Session that owns the context.
 * @param browserId - context that owns the tab.
 * @param tabId - tab to close.
 * @returns a close acknowledgement.
 */
async closeTab(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId): Promise<{ closed: true }>

/**
 * Navigate one tab backward.
 * @param sessionId - product Session that owns the context.
 * @param browserId - context that owns the tab.
 * @param tabId - tab to navigate.
 * @returns the committed tab.
 */
async back(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId): Promise<BrowserActionResult>

/**
 * Navigate one tab forward.
 * @param sessionId - product Session that owns the context.
 * @param browserId - context that owns the tab.
 * @param tabId - tab to navigate.
 * @returns the committed tab.
 */
async forward(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId): Promise<BrowserActionResult>

/**
 * Reload one tab.
 * @param sessionId - product Session that owns the context.
 * @param browserId - context that owns the tab.
 * @param tabId - tab to reload.
 * @returns the committed tab.
 */
async reload(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId): Promise<BrowserActionResult>

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
async action( sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId, kind: 'click' | 'fill' | 'press', selector: string, value?: string, ): Promise<BrowserActionResult>

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
async clickAt( sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId, x: number, y: number, clicks: 1 | 2, ): Promise<BrowserActionResult>

/**
 * Forward a wheel delta from the Client browser viewport.
 * @param sessionId - product Session that owns the context.
 * @param browserId - context that owns the tab.
 * @param tabId - target tab.
 * @param deltaX - horizontal wheel delta.
 * @param deltaY - vertical wheel delta.
 * @returns the committed tab.
 */
async scroll( sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId, deltaX: number, deltaY: number, ): Promise<BrowserActionResult>

/**
 * Insert text at the page's focused editable element.
 * @param sessionId - product Session that owns the context.
 * @param browserId - context that owns the tab.
 * @param tabId - target tab.
 * @param text - text to insert.
 * @returns the committed tab.
 */
async insertText( sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId, text: string, ): Promise<BrowserActionResult>

/**
 * Press one provider key chord at the page's focused element.
 * @param sessionId - product Session that owns the context.
 * @param browserId - context that owns the tab.
 * @param tabId - target tab.
 * @param key - provider key chord.
 * @returns the committed tab.
 */
async pressFocused( sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId, key: string, ): Promise<BrowserActionResult>

/**
 * Read semantic page text from a current native observation or provider.
 * @param sessionId - product Session that owns the context.
 * @param browserId - context that owns the tab.
 * @param tabId - target tab.
 * @returns bounded semantic page text.
 */
async snapshot(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId): Promise<string>

/**
 * Commit bounded metadata and semantic text from the visible native browser.
 * @param sessionId - product Session that owns the context.
 * @param browserId - context that owns the tab.
 * @param tabId - observed tab.
 * @param observation - native title, URL, navigation state, and semantic text.
 * @returns the committed tab.
 */
observe( sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId, observation: BrowserObservation, ): BrowserActionResult

/**
 * Capture the provider page as PNG bytes.
 * @param sessionId - product Session that owns the context.
 * @param browserId - context that owns the tab.
 * @param tabId - target tab.
 * @returns PNG bytes from the provider.
 */
async screenshot(sessionId: SessionId, browserId: BrowserSessionId, tabId: BrowserTabId): Promise<Uint8Array>
```

Types: [SessionId](core.md)

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)

<a id="browser-events"></a>

### `browser/*` events

<a id="browserchange--emit"></a>

#### `browser/change` — emit

Publish one committed browser state revision for live Client followers.

```ts cordis-catalog
/**
 * Publish one committed browser state revision for live Client followers.
 * @mode emit
 * @param sessionId - Session that owns the browser context.
 * @param browserId - browser context whose state changed.
 * @param revision - monotonic revision within the browser context.
 * @param tabs - complete committed tab list for the revision.
 */
'browser/change'(sessionId: SessionId, browserId: BrowserSessionId, revision: number, tabs: readonly BrowserTab[]): void
```

Types: [SessionId](core.md)

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)
<!-- END GENERATED cordis-surface -->
