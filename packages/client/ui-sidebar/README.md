---
description: "Sidebar shell plugin for the dsh web client: New Session action, collapse control, scroll-aware region seat, and rail-pinned Settings seat."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-sidebar` is the sidebar shell of the dsh web client: users start new sessions, collapse into the layout-owned 56px rail, and reach Settings from the permanent rail, while the scroll-aware region seat hosts the Workspace and Session browser. Product identity belongs to the global topbar, so the session sidebar does not render a second product name. The Workspace and Session browser rendered into `sidebar.workspaces` belongs to ui-workspace; this package neither derives its rows nor owns its view preferences. New Session starts the runtime's page-local frontend Session Intent against the explicit, current, or most recently active Workspace. Collapse into the layout-owned 56px rail remains presentation-local.

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

The session sidebar owns New Session, Workspace and Session browser seats. The permanent first-level NavigationRail is a separate shell layer with locale-owned labels for Sessions, Cloud drive, Triggers, Plugin marketplace, and Settings. The global top bar exposes the session sidebar toggle, product and Session title, Files, Terminal, and Browser Workbench tabs, plus one icon-only Workbench toggle. Those tabs are Session-scoped child entries; ui-workbench owns their actions and active-tab state.

### Brand and New Session

The global topbar owns the product and Session title. The collapsed rail may render the deployment's `sidebar.brand.mark` as its expand affordance; the expanded session sidebar does not repeat product identity. New Session targets the explicit Workspace used by a scoped action, otherwise the current Session's Workspace, otherwise the most recently active Workspace; when none exists it clears into the blank New Session page.

### Collapse behavior

During a live collapse, the expanded content fades out at its current width, the upper controls share one fade and leftward translation into the 56px rail, and the layout's column slide ends the motion. A page that starts collapsed renders the rail statically, and reduced-motion mode disables both transitions. The rail-pinned `sidebar.settings` control remains outside the session sidebar.

### Scrollbars

Scrollbars in the column are a pointer affordance: the shell rebinds the scrollbar indirection to `transparent` whenever the pointer is outside the column and keeps the thumb drawn for 2s after the pointer leaves, so a list nobody is pointing at carries no bar. The reservation that keeps rows from moving belongs to the scrolling region (ui-workspace), so revealing a thumb never reflows.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The shell is pure composition: `SidebarRootComponentProps` composes the layout owner share, the global `useSessions` and `useWorkspaces` hooks, the `sidebar.workspaces` and `sidebar.footer.action` child slots, and injected `startSession` plus sidebar-toggle callbacks. The rail owns the `sidebar.settings` child slot. There is no plugin store.

### Slot discipline

Declaration-aware `slots.inject()` lets a replacing package activate before or after the sidebar. The permanent rail renders the `sidebar.settings` seat with its compact owner share; the session sidebar foot is reserved for `sidebar.footer.action`. The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; SidebarRoot, the row components, and the tree derivation remain package-internal behind the slot registration.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the surfaces that fill the shell's seats and the composition model.

- [ui-workspace](../ui-workspace/README.md) — the Workspace and Session browser rendered into `sidebar.workspaces`.
- [ui-settings](../ui-settings/README.md) — the settings domain base registering the trigger row at `sidebar.settings`.
- [ui-layout](../ui-layout/README.md) — the layout owner whose rail and column state the collapse uses.
- [ui-theme](../ui-theme/README.md) — the scrollbar token indirection the shell rebinds.
- [Slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) — the composition model behind the seats.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the shell owns versus what its occupants own; they are current package constraints.

- **Session state-dot rendering is owned by ui-workspace** — no done/error notification sources are available to this shell.
- **Workspace browser behavior is composition-owned** — grouping, ordering, search, and row state belong to ui-workspace, not this shell.
- **"New task completed" unread marking is local viewing state** — completion-time > last-seen never reaches the host.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. A pure-consumer plugin deriving its rows in-component from the standard useSessions delivery — it emits no cordis events and owns no cross-plugin mutable state; derivation and interaction behavior are asserted directly by this package's tree/component specs.
