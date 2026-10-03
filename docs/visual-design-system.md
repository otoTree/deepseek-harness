# Enterprise Client and Admin Visual Design System

English | [中文](visual-design-system.zh.md)

## Summary

This reference defines the shared visual and interaction system for the enterprise client and the platform administrator console. It adopts the Arivo high-fidelity reference's dark canvas, ice-blue emphasis, restrained glow, and dense information layout, then maps those rules to the existing `ui-theme` semantic tokens. Client and admin pages share the same visual language while keeping different content density and task pacing.

This reference defines the target design baseline and its current implementation owners. Shared theme roles and the administrator navigation consume the dark palette; the Admin content canvas uses the light operational exception documented in [the Admin reference alignment note](../.agents/notes/implemented/architecture/2026-09-30-enterprise-admin-reference-alignment.md). Saved client preferences continue to select light or system mappings. Font-family stacks name the approved families and retain platform fallbacks when local font assets are unavailable.

## Table of Contents

- [Scope and authority](#scope-and-authority)
- [Design principles](#design-principles)
- [Visual foundations](#visual-foundations)
- [Layout and responsive rules](#layout-and-responsive-rules)
- [Component and state rules](#component-and-state-rules)
- [Interaction rules](#interaction-rules)
- [Enterprise client patterns](#enterprise-client-patterns)
- [Admin console patterns](#admin-console-patterns)
- [Implementation mapping](#implementation-mapping)
- [Acceptance checklist](#acceptance-checklist)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

-----

## Scope and authority

The scope covers `apps/web`, the enterprise client packages under `packages/client/`, and `apps/admin`. It applies to their shells, navigation, content pages, forms, tables, overlays, feedback, and responsive behavior.

The file `Arivo_Studio_高保真视觉规范_V（3.0）.md` supplied with this task is the visual reference for the dark direction. Its product names, page-specific composition, single-file HTML workflow, and screenshot delivery instructions are not repository requirements. This document extracts reusable visual rules and assigns them to the repository's token and component owners.

The shared source of truth is `packages/client/ui-theme/src/styles/`. Feature packages consume semantic aliases; they do not create another global palette. The [Web UI style reference](web-styling.md) remains the browser CSS ownership reference, while this document owns the cross-product visual direction and interaction vocabulary.

The default product presentation is dark. The existing `light` and `system` settings remain valid when a composition exposes them; they map the same semantic roles to light surfaces without changing component structure, interaction order, or state meaning.

-----

## Design principles

### One shared foundation

Color roles, typography roles, spacing steps, corner rules, elevation, focus treatment, icon geometry, and state meanings are shared by client and admin. A page may choose a different density or layout rail, but it does not create a local design language.

### Dark surface hierarchy

Hierarchy comes from surface level, text contrast, spacing, and elevation. Do not add a new color to make a component feel important. Use the next semantic surface or a stronger interaction state.

### Accent is a signal

Ice blue is reserved for active interaction, key data, progress, and environmental emphasis. It is not a default button fill for every action. Danger red is limited to the smallest failure indicator that needs it.

### Dense but calm

Enterprise work requires scanning and repeated action. Keep rows aligned, labels short, controls predictable, and secondary detail quiet. Use glow and glass only when an element is an intentional focal point.

### State is visible without color alone

Every state uses text, icon, position, or affordance in addition to color. Disabled, loading, failed, selected, and completed states remain understandable in grayscale and with reduced motion.

-----

## Visual foundations

### Color tokens

The following values define the target dark baseline. New code should consume the nearest `--dsw-alias-*` role; these names describe the design role and are not permission to write literal colors in feature CSS.

| Role | Target value | Use |
| --- | --- | --- |
| Canvas | `#141414` | Application background and full-bleed work area |
| Surface base | `#202426` | Primary content card, main panel, or node-like work unit |
| Surface secondary | `#121212` | Auxiliary panel, notification area, and compact status container |
| Surface tertiary | `#383C40` | Selectable control nested inside a surface |
| Surface deep | `#0A0A0A` | Focused or high-priority data panel |
| Surface control | `#0E0E0E` | Search, filter, and compact input control |
| Surface button | `#131315` | Secondary capsule and compact action |
| Divider | `#232325` | Track, separator, or quiet structural rule |
| Text primary | `#FFFFFF` | Page title, primary value, and action label |
| Text secondary | `#D3D3D3` | Body text and supporting explanation |
| Text caption | `#9B9B9C` | Labels, inactive navigation, and compact descriptions |
| Text meta | `#868C94` | Timestamp, ownership, and low-priority metadata |
| Accent | `#68C5FF` | Active state, progress, key data glow, and environmental light |
| Accent deep | `#4785B2` | Accent gradient midpoint and low-intensity emphasis |
| Danger | `#E06E5C` | Failure status text or failure status border only |

Neutral borders use the existing semantic border aliases and render as 0.5px hairlines where the browser supports them. State-colored borders remain 1px when the state must be explicit. Feature components must not introduce a second accent family, arbitrary gray, or page-local danger color.

### Typography

Use `Noto Sans SC` for Chinese interface copy and `Space Grotesk` for numbers, percentages, and short Latin labels. Fall back through the existing system stack when a font is unavailable.

| Role | Font | Size / line height | Use |
| --- | --- | --- | --- |
| Page title | Noto Sans SC 600 | 22 / 30px | Primary page heading |
| Section title | Noto Sans SC 600 | 16 / 24px | Section and panel heading |
| Body | Noto Sans SC 400 | 14 / 22px | Main content and form copy |
| Compact body | Noto Sans SC 400 | 13 / 20px | Dense rows, admin metadata, and supporting copy |
| Label | Noto Sans SC 500 | 12 / 18px | Field label, tab, and navigation label |
| Meta | Noto Sans SC 400 | 11 / 16px | Timestamp, hint, and secondary status |
| Key value | Space Grotesk 600 | 22–26 / 28px | Quota, amount, percentage, or progress anchor |
| Code | Existing monospace role | Existing role | Terminal, JSON, and source text |

Pair every font size with a line height. Do not use negative letter spacing. Text that can grow must wrap or truncate within its owning layout without overlapping adjacent controls.

### Material and elevation

Regular cards use a subtle stroke and the shared panel elevation. Elevated surfaces set `border: 0` and use the existing elevation token so the hairline remains the first shadow layer. Do not combine a neutral border token with an elevation shadow on the same surface.

Component sheen is a restrained three-layer treatment: a dark solid base, a low-opacity ice-blue radial highlight near the upper leading edge, and no full-surface color shift. Use it for an active navigation item, a deliberate primary action, or a focused data card.

Key data glow is limited to values such as quota, progress, and a running total. It must not be applied to ordinary body text, every button, or every numeric table cell.

Liquid glass is optional and reserved for one or two deliberate focal surfaces such as onboarding or an empty-state hero. It is not the default card treatment and must not fill an entire page.

### Iconography

Use the existing icon library or icon primitives. Icons use a consistent 20px navigation size, 16px compact-control size, or 24px prominent-action size. Stroke icons use rounded joins and a neutral foreground; the active state comes from the container unless the icon itself conveys a state.

Every icon-only action needs an accessible name and a tooltip when its meaning is not obvious. Do not draw a manual SVG when an existing library icon expresses the same action.

-----

## Layout and responsive rules

### Page rails

Use a shared content rail inside each page shell. A toolbar, page heading, table, and card grid that belong to the same task use the same left and right boundaries. Do not give each section an independent margin formula.

The client shell prioritizes a readable central conversation area with persistent navigation and optional details. The admin shell prioritizes a stable navigation column and a wide work area for comparison and editing. The exact rail width can flex with the viewport, but the alignment relationship must remain stable.

### Density

Client content uses comfortable reading density: 8–16px internal gaps, 36–44px interactive rows, and larger breathing room around streaming or creative content. Admin content uses compact scanning density: 6–12px internal gaps, 32–40px rows, and fixed column alignment for tables.

Density changes the spacing and row height, not the semantic component or state vocabulary. Do not create separate client and admin colors for the same state.

### Responsive behavior

At narrow widths, navigation collapses into a drawer or compact rail, secondary details move into a drawer, and multi-column forms become a single column. Tables retain access to every field through horizontal scrolling, column prioritization, or a detail view; they must not silently remove important data.

At touch widths, hit targets remain at least 36px for compact controls and 44px for primary touch actions. Hover-only information must have a focus or tap equivalent. Motion is reduced under `prefers-reduced-motion: reduce`.

The enterprise client keeps a fixed 56px first-level navigation rail. The session sidebar defaults to 280px, can be dragged between 264px and 420px, and closes independently. Workbench defaults to 360px, has a 300px minimum, and uses at most 80% of the main workspace; conversation keeps at least 560px, so a narrow container opens Workbench as a right overlay.

-----

## Component and state rules

### Shell, navigation, and headings

The top bar owns product identity, workspace or scope context, global status, and account actions. The side rail owns stable navigation. Page content starts with one clear title, optional description, and the primary action for that page.

Navigation items have default, hover, focus, active, and disabled states. Active state uses the component sheen or a quiet selected surface; the icon does not need a separate color change. Group labels are secondary and never compete with the active item.

### Buttons and controls

Primary actions use the accent or sheen treatment only when they are the main next step. Secondary actions use the button surface or transparent background with a subtle border. Destructive actions use neutral presentation until confirmation, then the danger role is applied to the confirmation context.

Icon buttons are square and stable in size. Text buttons keep labels short and do not become rounded cards. A button that opens a menu uses a clear disclosure icon and preserves the selected value in the trigger.

### Inputs, filters, and forms

Labels precede controls and remain visible when a value is present. Help text belongs below the field and error text belongs next to the invalid field. Form layouts use two columns only when labels and validation remain readable; admin forms may use a full-width field for long values, JSON, or cross-field explanations.

Filters show the active scope and provide a clear reset path. A change that can invalidate unsaved work requires an explicit confirmation or a visible draft state. Inline validation does not replace a summary of blocking errors at submit time.

### Cards, rows, and tables

Cards group one task or one summary. Do not put unrelated cards inside another card. Use list rows when users compare many items or perform repeated actions. Tables align values by column, keep headers visible during long scans, and expose row actions without forcing a hover-only path.

Empty states name the missing object and provide one next action. Loading states preserve the final layout dimensions. Errors state what failed, what remains intact, and the next recovery action.

### Overlays and feedback

Menus and popovers anchor to their trigger, stay inside the viewport, close on Escape, and restore focus to the trigger. Drawers keep the page context visible; modals interrupt only when the decision is consequential or cannot be represented inline.

Toasts confirm a completed or failed operation and remain neutral in fill. A failure toast provides the affected object, a concise reason, a location or retry action when available, and a close action. Persistent issues belong in the page or notification panel instead of an indefinite toast stack.

### Status vocabulary

Use one status vocabulary across both products: queued, running, ready, failed, cancelled, disabled, and selected. The status label includes text or a familiar icon and does not rely on hue alone. Running may use a restrained accent sheen; failed may use the danger color only on its label or border.

-----

## Interaction rules

Every task has one obvious entry point, one visible current location, and one recoverable exit. Actions that alter the current scope show the resulting scope in the page title, breadcrumb, or selected navigation item.

Hover reveals secondary affordances without hiding the primary action. Focus uses a visible ring or equivalent contrast. Keyboard order follows visual order, and Escape closes the nearest transient layer before the page-level layer.

Use inline actions for reversible, local changes. Use a drawer for detail that needs context from the list. Use a modal for destructive confirmation, credential entry, or a short focused decision. After completion, return focus to the initiating control or move it to the newly created content.

Long-running work exposes progress, allows cancellation when supported, and reports the final state in the same place as the initiating action. A failure offers retry, inspect, or feedback according to the operation; it does not disappear without a record.

Copy is locale-owned. Labels, tooltips, placeholders, error text, and accessible names use the owning dictionary. Avoid embedding implementation terms in user-facing labels unless the user is acting on that technical concept.

-----

## Enterprise client patterns

### Application shell

Keep the navigation rail stable while the active session or workspace changes. The current workspace, session, and connection state are visible near the shell boundary. Details panels open beside the work area and close without destroying the active session context.

### Conversation and streaming

The conversation is the primary reading surface. Composer actions stay grouped, the submit action remains stable during streaming, and queued work is visible without obscuring the latest response. Tool and attachment results use their own compact rows or cards and preserve the source link to the session event.

Streaming, approval, question, and error states must be distinguishable before the user reads the full content. Keep transient status close to the operation and persistent history in the conversation timeline.

### Files, tasks, and settings

Files and deliverables use list or grid patterns according to whether comparison or preview is primary. Tasks and workflows show status, owner, timing, and the next available action in a stable row. Settings use grouped sections with one control per row and a clear saved or pending state.

### Account and organization

Account and organization pages use the same shell as the client but a denser form rhythm. Permission, device, and membership states are explicit, and a blocked action explains the required role or administrator action.

-----

## Admin console patterns

### Login and session state

The login page is focused and quiet. It shows the product identity, one form, one primary action, and an inline recovery path. Authentication errors identify the failed step without exposing secrets.

### Navigation and organization tree

The admin rail groups pages by management task. The organization tree uses selection and expansion as separate actions; selecting a node updates the detail region without losing the tree position. Status is shown in text and remains readable when the tree is collapsed.

### Tables and detail drawers

Admin tables optimize for scanning: stable headers, compact rows, visible filters, and row actions that remain reachable by keyboard. A detail drawer preserves the selected row context and contains tabs only when the record has independent detail groups. Closing the drawer returns focus to the selected row.

### Forms and high-risk actions

Model, pricing, adapter, organization, invitation, and platform settings forms group related fields and show cross-field validation near the fields it explains. Sensitive values remain masked and are never repeated in confirmation text. Destructive or irreversible actions use a confirmation modal that names the object and consequence.

### Usage and audit

Usage pages lead with a small set of key totals, then trends, filters, grouped breakdowns, and records. Audit pages prioritize time, actor, object, action, and result. Charts and summaries use the shared accent sparingly; table values remain neutral unless they communicate a state.

-----

## Implementation mapping

This table maps the design system to its implementation owners and records the current coverage. It does not authorize feature packages to bypass their owners.

| Owner | Current responsibility | Implementation |
| --- | --- | --- |
| `packages/client/ui-theme` | Static scale, semantic aliases, theme preference, typography, elevation, motion, scrollbar | Owns the shared palette roles, dark default, light mappings, font stacks, and reduced-motion rule; font files use system fallback until licensed WOFF2 assets are available |
| `packages/client/ui-primitives` | Shared buttons and inputs | Uses compact control radii and a shared visible focus treatment |
| `packages/client/ui-enterprise` | Enterprise client cards, rows, forms, marketplace, drive, triggers, and status presentation | Existing semantic consumers inherit the shared palette; page layout and density remain package-owned |
| `packages/client/ui-enterprise-account` | Electrobun login, registration, organization selection, and logout page | Imports shared theme roles and uses the fixed dark account presentation |
| `apps/admin/app/global.css` | Admin shell, forms, tables, tree, drawers, modals, and responsive layout | Uses shared roles with a dark navigation rail, light operational canvas, compact table density, and narrow-screen layout |
| `docs/web-styling.md` | Browser CSS ownership, CSS Modules, elevation, borders, links, and focus behavior | Remains the implementation-level CSS reference and links to this cross-product direction |
| `apps/web` and client UI packages | Agent shell, conversation, Workbench, settings, attachments, tasks, and feedback | Consume shared `ui-theme` semantic roles; each package retains its page composition and interaction owner |

The shared theme and Admin navigation use the target dark palette, while the Admin content canvas follows the light operational exception. Client packages that already consume semantic aliases inherit the shared roles without local palette copies. A feature package must not add a local global token or copy a static palette value; new page-specific values enter the token owner first.

-----

## Acceptance checklist

Use this checklist for every new or substantially revised page.

- The page uses the shared canvas, surface, text, border, accent, and elevation roles.
- The page has one content rail shared by its heading, toolbar, and main content.
- The page identifies its primary action and preserves a visible current location.
- Every interactive control has default, hover, focus, disabled, loading, and error behavior where applicable.
- Every icon-only action has an accessible name and a discoverable explanation when needed.
- Empty, loading, success, and failure states explain the next action without relying on color alone.
- Destructive actions name the object and consequence before confirmation.
- Narrow layouts keep the same actions available through drawers, scrolling, or detail views.
- Text, labels, placeholders, errors, and accessible names come from the locale owner.
- Motion honors reduced-motion preferences and never hides a state transition.
- New visual values are added to the token owner before they are used by a feature package.
- The implementation mapping and owning README are updated when a shared responsibility changes.

-----

## Further Exploration

- [Web UI style reference](web-styling.md) — browser CSS ownership and implementation constraints.
- [ui-theme README](../packages/client/ui-theme/README.md) — current theme service and token stylesheet behavior.
- [enterprise client README](../packages/client/ui-enterprise/README.md) — current enterprise client presentation surfaces.
- [admin README](../apps/admin/README.md) — current administrator console pages and limits.
- [Client architecture](subsystems/web-client.md) — browser composition and rendering ownership.

## Dev Note

The Arivo reference was measured from a separate product and contains page-specific values that do not map to current DSH surfaces. This document keeps the reusable dark visual language and records the adaptation to DSH semantic tokens; future high-fidelity measurements should update this owner before code changes.
