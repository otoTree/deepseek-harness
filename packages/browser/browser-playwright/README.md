---
description: "Playwright provider that gives each Session an isolated browser context with tab actions, snapshots, screenshots, and cleanup."
kind: "package-reference"
---
# @deepseek-ai/dsh-browser-playwright

English | [中文](README.zh.md)

## Summary

This package registers `playwright` as a provider for `dsh-browser`. Choose it when a composition needs headless Chromium page automation behind the shared Session browser context. It creates one isolated Playwright context per Session, maps selector and screenshot-viewport input to pages, exposes ARIA snapshots and PNG screenshots, and closes pages, contexts, and the browser during Cordis teardown. It does not own browser ids or model-facing tool schemas.

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

Mount `dsh-browser` and this provider in the same composition, then let browser consumers select the `playwright` provider.

### When to choose it

Choose it for automated page navigation and interaction in a controlled host process. Use another `BrowserProvider` when deployment policy requires a different engine or an embedded native view.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-browser'
- name: '@deepseek-ai/dsh-browser-playwright'
```

The provider runs headless and has no Cordis configuration fields.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`PlaywrightBrowserProvider` lazily launches Chromium, creates one context for each Session, and creates pages for browser tabs. It applies selector actions, coordinate clicks, wheel deltas, text insertion, and key chords to the same page. ARIA snapshots come from the page body, and PNG screenshots provide the Client viewport. Each operation reads the page title and URL into the capability's `BrowserProviderTab`; concurrent first tabs share context creation, and idle contexts close after their last page. The source is [`src/index.ts`](src/index.ts).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-browser`](../browser/README.md) — provider-neutral capability state.
- [`dsh-tool-browser`](../tool-browser/README.md) — model-facing tools.
- [Playwright](https://playwright.dev/) — upstream browser automation API.

-----

<a id="model-experience"></a>
## Model Experience

### Provider results

#### What the model sees

The provider contributes tab metadata, accessibility snapshot text, or bounded PNG bytes to [`dsh-tool-browser`](../tool-browser/README.md), which renders those values as model tool results.

#### Token effect

Navigation metadata and snapshot text consume tokens only when the model-facing tool returns them; screenshots consume the provider result budget instead of text tokens.

#### KV Cache effect

The provider does not alter the request prefix; each returned tool result is appended by the owning tool consumer.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Chromium must be available to Playwright at runtime; this package does not download or manage browser binaries.
- The provider exposes screenshots and page state, not an interactive native Electrobun BrowserView.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
