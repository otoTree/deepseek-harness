# Agent Note: Admin reference alignment uses a light operational canvas

Status: implemented

English | [中文](2026-09-30-enterprise-admin-reference-alignment.zh.md)

## Problem

The supplied enterprise administrator export uses a dark navigation rail and a light operational canvas, while the earlier cross-product visual baseline kept the entire Admin surface dark. The existing Admin also rendered several platform views as generic JSON tables, which made the key organization, usage, health, and audit workflows difficult to scan.

## Decision

Admin keeps the shared `ui-theme` semantic roles, status vocabulary, focus treatment, and responsive rules, but `apps/admin/app/global.css` maps its content canvas, cards, controls, and table surfaces to the light reference presentation. The navigation rail remains dark and owns the global scope switcher, grouped navigation, health summary, and administrator account area. The enterprise client keeps the cross-product dark presentation described by [the shared visual system](2026-09-29-enterprise-admin-visual-system.md).

The platform overview is served by one administrator-only `/v1/platform/overview` transaction. It returns the reporting range, organization/member/runtime and usage totals, Shanghai-time trend points, pending work, health rows, and recent audit events. The Admin validates this response with typed Zod view models before rendering metric cards, trends, pending items, health rows, and audit rows.

Admin navigation uses domain routes for the active work area, while query parameters remain available for organization scope and list filters. Existing resource APIs remain action owners, and the domain pages add durable approval and history endpoints where the reference workflow requires them.

## Alternatives considered

- **Keep the complete Admin surface dark** — this would preserve the earlier palette but fail the supplied administrator reference, whose light work area is part of its scanning hierarchy.
- **Render the PNG export inside the product** — this would produce a screenshot match without a usable or accessible interface and would make live data and actions impossible.
- **Assemble overview cards from independent browser requests** — this could show totals from different moments; the server-side aggregate keeps one reporting range and one transaction.

## Consequences

- Admin and the enterprise client share semantic roles and interaction states while intentionally differing in surface brightness and information density.
- The overview has a stable typed response and one refresh point, while detailed pages continue to use their existing resource-specific APIs.
- Copy remains locale-owned in `apps/admin/app/messages.ts`; reference example numbers are test fixtures only.
- The main remaining visual work is page-by-page refinement of detailed tables and drawers; the shared shell and overview establish their owners and spacing rules.

## Verification

`pnpm --filter @deepseek-ai/dsh-enterprise-admin typecheck`, its unit tests, and its production build pass. The API typecheck passes. Playwright verified the 1440px login and authenticated overview against local response fixtures; the overview shows the reference layout, metric cards, trend, pending items, health, and audit panels.
