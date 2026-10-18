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

`BrowserService` maps each Session to a provider context, stores committed `BrowserTab` records, and publishes `browser/change` revisions after successful operations. `refresh` and screenshot reads update changed provider metadata without another navigation and reject tabs closed during the read. An `attachmentUrl` identifies a native page for provider discovery; attached snapshots always read the actual provider DOM. Other providers may use bounded native observations until an action invalidates them. Navigation accepts HTTP(S) and the exact new-tab URL `about:blank`. Context cleanup retains a closing marker until all provider tabs settle. See [`src/index.ts`](src/index.ts).

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

The service adds no prompt text; [`dsh-tool-browser`](../tool-browser/README.md) renders tab metadata and bounded snapshots or screenshots. Attached native pages supply actual accessibility snapshots through their provider.

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

**Runtime invariant:** No runtime invariant companion is published. One Session context owns tab identities and revisions; mutation and cleanup update that context directly.
