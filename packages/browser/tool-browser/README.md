---
description: "Model-facing browser tools for opening, navigating, inspecting, interacting with, and closing Session-shared tabs."
kind: "package-reference"
---
# @deepseek-ai/dsh-tool-browser

English | [中文](README.zh.md)

## Summary

`dsh-tool-browser` registers ten model-facing tools over the Session-owned `dsh-browser` context. The tools cover tab creation and selection, HTTP(S) navigation, click/fill/press actions, accessibility snapshots, screenshots, and context cleanup. Mount it with a registered provider such as `dsh-browser-playwright`; registration does not launch a browser. Snapshot characters and decoded screenshot bytes are bounded before results enter the Session log.

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

Mount this package after `dsh-browser`, `dsh-tools`, and a browser provider so an initiating Agent can call the browser tools.

### When to choose it

Choose it when a model needs controlled page navigation and inspection in the same context that the Workbench UI displays. Use the Host Controller alone for Client-only actions that should not become model tools.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-browser'
- name: '@deepseek-ai/dsh-browser-playwright'
- name: '@deepseek-ai/dsh-tool-browser'
  config:
    maxSnapshotChars: 200000
    maxScreenshotBytes: 5242880
```

`maxSnapshotChars` defaults to `200000` and `maxScreenshotBytes` defaults to `5242880`; both must be positive safe integers.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each tool resolves the initiating Agent's Session, calls `ctx.browsers`, and JSON-renders bounded results. `browser_tabs` can omit `browserId` to discover the context already opened by the Workbench for that Session. The action tools return the committed `BrowserTab`; snapshot and screenshot tools apply their configured bounds before returning ARIA text or base64 PNG data. The tool names, schemas, durable events, and provider requirements are listed in the generated [tool catalog](../../../docs/tool-catalog.md#tool-package-map). The source is [`src/index.ts`](src/index.ts).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Browser tool catalog](../../../docs/tool-catalog.md#tool-package-map) — generated schemas and session effects.
- [`dsh-browser`](../browser/README.md) — shared browser state.
- [`dsh-browser-playwright`](../browser-playwright/README.md) — provider implementation.
- [`dsh-client-ui-workbench`](../../client/ui-workbench/README.md) — browser panel.

-----

<a id="model-experience"></a>
## Model Experience

### Browser tool schemas

#### What the model sees

The model receives the ten schemas and descriptions in the generated [`dsh-tool-browser` catalog](../../../docs/tool-catalog.md#tool-package-map). It can call `browser_tabs` without an id to discover the Workbench's Session browser, then read ARIA snapshot text or a base64 PNG from any listed tab.

#### Token effect

Tool-call arguments and JSON results consume request tokens; `maxSnapshotChars` bounds text results and `maxScreenshotBytes` bounds decoded image payloads before logging.

#### KV Cache effect

Each browser call adds a tool-call/result pair to the conversation; unchanged system and tool prefixes remain cacheable according to the provider.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The tools require a provider at execution time and fail when no provider named `playwright` is registered.
- URL validation currently checks HTTP(S) syntax and capability limits but is not a DNS-pinned public-network SSRF policy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
