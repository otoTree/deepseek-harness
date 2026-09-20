---
description: "Session-owned browser contexts and tab state shared by Host Remotes, model tools, and Client panels."
kind: "package-reference"
---
# @deepseek-ai/dsh-browser

English | [中文](README.zh.md)

## Summary

The browser capability gives each Session one provider-backed context with opaque browser and tab ids. Mount it when Host controllers, model tools, and a Client panel must address the same tabs. The service owns identity, active-tab state, revision events, tab limits, URL protocol checks, and awaited provider cleanup; a provider owns page automation. Use [`dsh-browser-playwright`](../browser-playwright/README.md) for the shipped Playwright backend.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the service before registering a `BrowserProvider`, then let consumers call `ctx.browsers.ensure` for the Session they serve.

### When to choose it

Choose this capability when browser state must be shared across multiple consumers in one Session. Choose a provider package for actual page automation; this package intentionally contains no browser engine.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-browser'
  config:
    maxTabs: 12
```

`maxTabs` is the positive per-Session tab limit and defaults to `12`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`BrowserService` maps one Session id to one provider and browser context, stores committed `BrowserTab` records, and publishes `browser/change` revisions after provider operations succeed. A native Client may attach a bounded semantic observation to a tab; snapshot reads prefer that observation until a successful provider action invalidates it. Navigation accepts HTTP(S) URLs plus the exact internal new-tab URL `about:blank`; other protocols fail before the provider runs. `close` waits for every provider tab and retains a closing marker until cleanup settles. Provider failures are converted into stable `BrowserError` codes where the registry owns the policy. The source is [`src/index.ts`](src/index.ts).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-browser-playwright`](../browser-playwright/README.md) — Playwright provider.
- [`dsh-tool-browser`](../tool-browser/README.md) — model-facing browser tools.
- [`dsh-api-workbench-controller`](../../api/workbench-controller/README.md) — Host Remote operations.
- [`dsh-client-ui-workbench`](../../client/ui-workbench/README.md) — Client browser panel.

-----

<a id="model-experience"></a>
## Model Experience

### Session browser state

#### What the model sees

The service itself adds no prompt text; [`dsh-tool-browser`](../tool-browser/README.md) renders `BrowserTab` metadata and bounded snapshots or screenshots for model requests. A current native semantic observation supplies snapshot text before the provider fallback.

#### Token effect

Token use comes from the consumer's tab metadata, snapshot text, or screenshot result, bounded by the tool package rather than by this registry.

#### KV Cache effect

Browser state does not change the request prefix; only a newly rendered tool result can extend the live conversation.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The registry enforces protocol, tab-count, and lifecycle limits but does not provide DNS-pinned public-network SSRF protection.
- A provider must be registered before `ensure`; this package does not launch a browser engine by itself.
- Native observations are limited to 4,096 title characters and 200,000 snapshot characters; the observing Client decides which semantic page content to include.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
