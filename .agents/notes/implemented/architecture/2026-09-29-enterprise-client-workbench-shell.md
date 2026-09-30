# Agent Note: Enterprise client shell separates rail, Session sidebar, and Workbench

Status: implemented

English | [中文](2026-09-29-enterprise-client-workbench-shell.zh.md)

## Problem

The enterprise client needs stable first-level navigation while users collapse the Session browser and open Workbench panels without losing Session context.

## Decision

`ui-layout` owns a fixed 56px rail, a 48px top bar, the resizable Session sidebar, the conversation area, and the Workbench details column. The rail cannot be closed. The Session sidebar stores its width and open state independently and becomes a left drawer below the narrow breakpoint. The top bar receives client content through slots and uses `ctx.layout` for sidebar and Workbench transitions.

Workbench remains the core client details capability. Its Session-scoped store is the sole active-tab source for Files, Terminal, Browser, Results, and plugin tabs. Canvas has no shell column and may only register a Workbench panel. The Workbench starts closed, keeps its active tab when closed, and opens beside conversation when the container can retain a 560px conversation area. Otherwise the details content uses a right overlay with a 300px minimum and a 360px default.

Workbench uses a compact top tab row and an add-tab button. The button opens a grid picker containing built-in panels and plugin entries from one picker slot. Selection calls the existing Session store `setActiveTab`; closing the picker returns focus to the add-tab button and does not create another tab registry.

Workbench consumes the shared visual-system roles for its layered surfaces, hairline borders, text hierarchy, and ice-blue active state. Its shell and panel controls use the shared control radius, stable 36px compact targets, visible focus treatment, and reduced-motion behavior. Active tabs and selected file rows use an accent surface plus text or position so selection does not depend on color alone.

The Browser panel selects the native Electrobun WebView only when both the host custom element and the validated Runtime storage identity are available. It falls back to an iframe while the native bridge is unavailable and switches when the bridge dispatches its readiness event, so delayed desktop injection does not make the Workbench fail to render.

Enterprise Cloud drive, Triggers, and Plugin marketplace actions register in the rail while continuing to call `mainNavigation`; their page data and permission flows are unchanged.

The rail and top bar registrations wait on the layout declarations through `slots.inject()`. The sidebar declares `mainNavigation` as an explicit dependency before it creates the rail entry. Enterprise destinations use `sidebar.rail.item` as their only registration seat, so the rail does not render duplicate built-in destinations or fall back to the old footer action seat.

## Alternatives considered

Keeping first-level navigation inside the collapsible Session sidebar would hide enterprise destinations and make narrow layouts ambiguous. A separate Canvas shell would duplicate Workbench state, so Canvas remains a plugin-registered Workbench panel.

## Consequences

- Collapsing the Session sidebar never hides the rail or changes first-level navigation.
- Session changes close the Workbench view without unloading the details subtree or changing capability ownership.
- Narrow layouts preserve the conversation width and use an overlay instead of forcing unreadable columns.
- Escape closes the open Workbench before page-level overlays handle the key.

## Verification

The layout, sidebar, Workbench, and enterprise client type checks pass after regenerating dependent client declarations. Focused layout and sidebar tests cover the new slot declarations and the existing Session/detail lifecycle; legacy geometry assertions require migration to the four-column rail-aware template.
