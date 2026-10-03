# Agent Note: Enterprise client and admin share a dark visual system

Status: implemented

English | [中文](2026-09-29-enterprise-admin-visual-system.zh.md)

## Problem

The enterprise client and administrator console need one visual direction while their tasks require different layout density and information pacing. The repository already has a semantic `ui-theme`, but the current documentation does not define how the client and admin surfaces should converge on one visual language.

## Decision

The cross-product visual baseline is a dark system derived from the supplied Arivo reference: `#141414` canvas, layered neutral surfaces, `#68C5FF` as the ordinary accent, restrained component sheen, and limited key-data glow. `#E06E5C` is reserved for the smallest failure status treatment. Typography, spacing, border, elevation, icon, focus, overlay, and responsive rules are shared; client and admin may select different density and page rails.

`packages/client/ui-theme/src/styles/visual-system.css` owns the shared visual roles and maps them to existing aliases. An unset client preference resolves to dark; saved `light` and `system` values remain supported. `ui-primitives` buttons and inputs use compact control radii and the shared focus color. Enterprise pages inherit the semantic palette, the Electrobun account page imports the theme styles and selects dark, and Admin consumes the shared roles with the light content-canvas exception recorded in [the Admin reference alignment note](2026-09-30-enterprise-admin-reference-alignment.md). `docs/visual-design-system.md` is the cross-product visual owner, and `docs/web-styling.md` remains the browser CSS implementation reference.

The existing `light` and `system` theme choices remain supported through semantic role mapping. They do not create a second component structure or a second state vocabulary. CSS declares Noto Sans SC and Space Grotesk before platform fallbacks, but the repository contains no licensed WOFF2 files for those families and the configured font source was unreachable during implementation; product builds currently use installed system fallbacks. Arivo page-specific components and its single-file screenshot workflow are reference material only and are not product requirements.

## Alternatives considered

- **Keep client and admin as separate visual systems** — this would preserve local freedom but duplicate palette, state, focus, and overlay decisions across every feature.
- **Copy the Arivo document directly into the repository** — this would preserve measurements but import another product's page assumptions and bypass the existing token owner.
- **Make dark mode the only theme** — this would simplify the visual baseline but remove the current `light` and `system` preference contract without a product decision.

## Consequences

- New shared visual values enter `ui-theme` before feature packages consume them.
- Client pages can use comfortable reading density while admin pages use compact scanning density without diverging in color or state semantics.
- New pages use the shared content-rail, elevation, focus, overlay, responsive, and locale-owned copy rules in the visual reference.
- High-fidelity measurements that affect both products update the cross-product visual reference and its Chinese counterpart before implementation changes.
- The visual reference is not a website page in this change and does not add a website allowlist entry.

## Verification

The bilingual visual reference and this note are maintained as complete Markdown pairs with translation sidecars. The named-pair check, repository Markdown-link check, and whitespace check pass. `pnpm run test:docs` and `pnpm run doc-sync` reach their aggregate gates but fail on unrelated worktree state: `docs/config-catalog.md` has an unrecorded pair change, and other failures report trigger/Workbench JSDoc, missing package metadata, stale generated paths, and tsconfig paths. No product code changes are part of this decision.
