# Agent Note: Arivo shared Web and desktop appearance

Status: implemented

English | [中文](2026-10-24-arivo-shared-appearance.zh.md)

## Problem

An independently colored desktop shell diverges from Arivo Web even when creative pages share components. Online fonts also need to remain available offline without changing enterprise dependencies.

## Decision

The [Arivo builder](../../../../apps/electrobun/scripts/build-arivo.ts) consumes the verified creative release’s `theme.css`, containing its versioned public Web palette, glow and OFL fonts. A generated esbuild injection supplies the sheet and existing brand logo to the startup Client; no cross-repository source or new workspace dependency is resolved. The [startup adapter](../../../../apps/electrobun/src/distribution/arivo-shell/client/theme.ts) maps OS semantic roles to shared variables, and its lifecycle owns the stylesheet and body marker. The OS’s persisted light/dark preference selects the shared palette without changing another product’s theme.

The [topbar slot](../../../../apps/electrobun/src/distribution/arivo-shell/client/topbar.ts) retains the original runtime’s Session content, sidebar and workbench actions with Arivo branding. Existing Agent, rail contributions and marketplace ownership remain intact. Local versus cloud differences belong to capabilities and localized copy; scoped asset/project controls retain their Web colors.

## Alternatives considered

**Maintain a desktop palette.** Separate literals drift even when the palette initially matches Web.

**Import the Web repository or download fonts at runtime.** Source imports break release isolation; network fonts break offline appearance.

## Consequences

Only explicit Arivo builds require the creative theme artifact. Enterprise desktop, Admin and API continue using their original build paths and dependencies. The [startup product regression](../../../../apps/web/tests/arivo-startup.e2e.ts) checks computed OS/iframe colors, typography, preference propagation, original conversations and controls. Native screenshots remain necessary to verify the packaged window; browser tests do not replace Windows, installer, update or final product acceptance.
