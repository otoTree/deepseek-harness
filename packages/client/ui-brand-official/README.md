---
description: "Official DeepSeek Harness name occupant for the sidebar, active only in official builds; for users and maintainers choosing or replacing brand presentation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-official

English | [中文](README.zh.md)

## Summary

This package fills `sidebar.brand.name` with the official DeepSeek Harness name. It registers the occupant only when the client bundle builds with the `official` profile; every other build loads the plugin but registers nothing, so the shell fallback stays visible. It deliberately leaves `sidebar.brand.mark` empty, and the New Session hero has no brand-mark slot or fallback image. Choose this package when the deployed identity uses the AgentOS name without a product icon; a deployment with its own brand composes a different package into the sidebar slots instead. It retains no runtime state and contributes nothing to model requests.

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

Mount this plugin in the browser roster of a deployment that uses the AgentOS name, then build the client with the `official` profile so the name occupant registers.

### Choosing the profile

`DSH_CLIENT_BUILD_PROFILE` selects which name renders. An `official` build shows AgentOS in the sidebar; any other value leaves the localized local-build label in place. Neither mode supplies a sidebar icon, and the New Session hero remains text-only. The plugin still loads and validates in both cases; only the name registration is profile-gated.

### Replacing the brand

A deployment with its own identity leaves this package out and composes another package that occupies the sidebar name and optional mark slots. Occupying a slot is the only composition route; there is no brand configuration surface here.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The name occupant installs through `ctx.slots.inject()`, which waits on the sidebar declaration so registration works whether this row activates before or after the declarer and withdraws when the declaration collapses. The `brand.official` locale namespace owns the AgentOS name in every supported language. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat. The browser title is a build-environment concern (`DSH_CLIENT_TITLE`), outside the slot system.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough. They move from the slots this package occupies to the shell that renders them.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — owns the text-only New Session hero.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package retains no mutable state, and its name occupant follows the declaring sidebar slot's lifetime.
