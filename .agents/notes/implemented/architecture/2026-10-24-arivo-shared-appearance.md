# Agent Note: Arivo shared Web and desktop appearance

Status: implemented

English | [中文](2026-10-24-arivo-shared-appearance.zh.md)

## Problem

An independently colored desktop shell diverges from Arivo Web even when creative pages share components. Online fonts also need to remain available offline without changing enterprise dependencies.

## Decision

The [Arivo builder](../../../../apps/electrobun/scripts/build-arivo.ts) consumes the verified creative release’s `theme.css`, containing its versioned public Web palette, glow and OFL fonts. A generated esbuild injection supplies the sheet and existing brand logo to the startup Client; no cross-repository source or new workspace dependency is resolved. The [startup adapter](../../../../apps/electrobun/src/distribution/arivo-shell/client/theme.ts) maps OS semantic roles to shared variables, and its lifecycle owns the stylesheet and body marker. The OS’s persisted light/dark preference selects the shared palette without changing another product’s theme.

The [topbar slot](../../../../apps/electrobun/src/distribution/arivo-shell/client/topbar.ts) retains the original runtime’s Session content, sidebar and workbench actions with Arivo branding. Existing Agent, rail contributions and marketplace ownership remain intact. Local versus cloud differences belong to capabilities and localized copy; scoped asset/project controls retain their Web colors.

Public `controls.css` extracts neutral actions, compact radii and fields from the routed Web profile. The verified native release supplies these tokens to OS primitives and embedded account/project forms. Model settings use a DOM listbox with viewport placement, Escape, arrow navigation and focus restoration; existing services retain catalog authorization and default-model persistence. Packaged startup acceptance covers both palettes and the model popup.

Arivo sets the layout’s optional `--dsh-layout-column-transition` to `none`. Native macOS captures can omit the Workbench during a grid-column transition despite correct computed geometry. Immediate widths produce visible creative-panel captures without forced layout polling; intermittent incomplete native captures still require separate investigation. The shared shell preserves its existing transition when no distribution override is present.

Arivo paints the ambient glow once on the outer document. The optional `--dsh-shell-surface` fill makes the stationary frame, rail, session sidebar and conversation transparent; embedded creative documents also use transparent roots and omit their own glow. Drawers and Workbench overlays retain an opaque base, and elevated controls keep their semantic fills. This prevents independently positioned backgrounds from meeting at hard column edges without making overlapping content translucent.

The [shared desktop conversation decision](2026-10-26-shared-desktop-conversation.md) owns compact Workbench and composer presentation in the shared theme. Arivo supplies its palette through the existing semantic aliases; browser/file commands, Session binding and editor departure checks retain their original owners.

## Alternatives considered

**Maintain a desktop palette.** Separate literals drift even when the palette initially matches Web.

**Import the Web repository or download fonts at runtime.** Source imports break release isolation; network fonts break offline appearance.

## Consequences

Only explicit Arivo builds require the creative theme artifact. Enterprise desktop, Admin and API continue using their original build paths and dependencies. The [startup product regression](../../../../apps/web/tests/arivo-startup.e2e.ts) checks computed OS/iframe colors, typography, preference propagation, original conversations and controls. Native screenshots remain necessary to verify the packaged window; browser tests do not replace Windows, installer, update or final product acceptance.
