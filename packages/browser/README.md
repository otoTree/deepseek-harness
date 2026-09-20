---
description: "Package map for the browser capability family: Session-owned state, the Playwright provider, and model-facing browser tools."
kind: "package-group"
---

# browser/ — interactive browser capability family

English | [中文](README.zh.md)

## Summary

The `browser/` group gives each product Session one shared interactive browser context. The core service owns opaque context and tab identities, committed state, limits, and cleanup; the Playwright provider owns page automation; and the tool package exposes the shared context to the model. Desktop Clients may render a separate native browser view and synchronize navigation and bounded semantic observations into the same Session state. The native view and Playwright remain distinct browser engines.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Three packages complete the browser capability seam.

| Package | Role | ctx key |
|---|---|---|
| [`browser/`](browser/README.md) | Owns Session browser identities, tab state, revisions, limits, observations, and cleanup | `ctx.browsers` |
| [`browser-playwright/`](browser-playwright/README.md) | Provides isolated Playwright contexts and page automation | registers on `ctx.browsers` |
| [`tool-browser/`](tool-browser/README.md) | Exposes navigation, interaction, snapshots, and screenshots to the model | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Interactive browser subsystem](../../docs/subsystems/browser.md) — shared state, native observation, provider automation, lifecycle, and security limits.
- [Session-following Workbench decision](../../.agents/notes/implemented/architecture/2026-09-19-session-following-workbench.md) — UI ownership, native rendering, provider synchronization, and acceptance limits.
- [Workbench Client package](../client/ui-workbench/README.md) — native Electrobun WebView and Web iframe presentation.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
