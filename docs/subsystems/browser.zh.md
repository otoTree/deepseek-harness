# 交互式浏览器

[English](browser.md) | 中文

交互式浏览器 capability 是由 Host Remote、模型工具和 Client 面板共享的[能力 seam](../glossary.zh.md#capability-seam)。其 Service Definition 是 [`dsh-browser`](../../packages/browser/browser)，随产品提供的 Service Provider 是 [`dsh-browser-playwright`](../../packages/browser/browser-playwright)，面向模型的 Consumer 是 [`dsh-tool-browser`](../../packages/browser/tool-browser)。Workbench Client 通过 [`dsh-api-workbench-controller`](../../packages/api/workbench-controller) 使用同一组按 Session 管理的 identity，并负责可见浏览器的展示。

源码：[`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)

## Session context 与标签状态

`BrowserService` 为每个产品 Session 提供至多一个活动浏览器 context。`BrowserSessionId` 和 `BrowserTabId` 是不透明 identity；消费方必须同时传入产品 Session id 与 browser id，因此跨 Session 访问会失败。服务管理活动标签选择、已提交的 `BrowserTab` 记录、单调修订、标签上限、provider 注册与等待完成的 teardown。provider 管理浏览器引擎页面，并在每次操作后返回观察到的标题、URL、加载状态、历史状态和 favicon 状态。

每次成功的状态变更都会通过 `browser/change` 发送完整的已提交标签列表。Client follower 先获得 baseline，再应用更晚的修订，因此重连不依赖无限增长的事件积压。

## 原生展示与 provider 自动化

Electrobun 桌面 Client 在面板的真实 viewport 尺寸内展示沙箱化原生 WebView。Web Client 使用 iframe。两个可见面板都不渲染 provider screenshot。Session Playwright provider 仍是模型工具和 Host Remote 使用的自动化引擎。

原生 WebView 与 Playwright provider 是两个不同的浏览器引擎，并非同一页面的两个句柄。原生顶层导航会镜像到 provider，原生视图会回报有界的标题、URL、历史状态和语义 DOM 文本。`snapshot` 优先读取当前原生 observation；成功的 provider 操作会使其失效，随后回退到 provider snapshot。直接的原生交互不会表示为完全相同的 Playwright 操作序列。

## 操作与生命周期

服务支持 context 创建与清理、标签打开／选择／关闭、导航、selector 操作、viewport 点击与滚动、焦点文本与按键输入、语义 snapshot，以及 provider 支持时的 PNG screenshot。不支持的可选操作以 `UNSUPPORTED_ACTION` 失败。context 清理会等待每个 provider 页面；前一个 context 仍在关闭时，Session 不能创建替代 context。

## 限制与安全

导航接受 HTTP(S) URL 和精确的内部新标签 URL `about:blank`。服务强制 URL 长度、标签数量、原生标题长度、原生 snapshot 长度、所有权和清理状态限制。这些检查是生命周期与资源策略，不是完整的 SSRF 防护：当前浏览器 capability 不会把导航 DNS 固定到公网地址。把浏览器导航视为不可信网络访问的部署必须先添加该策略，才能启用任意目标地址。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [SessionId](core.zh.md)

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

Types: [SessionId](core.zh.md)

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)
<!-- END GENERATED cordis-surface -->
