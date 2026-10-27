# Agent Note: Admin reference alignment uses a light operational canvas

Status: implemented

English | [中文](2026-09-30-enterprise-admin-reference-alignment.zh.md)

## Problem

The supplied enterprise administrator export uses a dark navigation rail and a light operational canvas, while the earlier cross-product visual baseline kept the entire Admin surface dark. The existing Admin also rendered several platform views as generic JSON tables, which made the key organization, usage, health, and audit workflows difficult to scan.

## Decision

Admin maps shared `ui-theme` semantic roles to the light operational canvas defined by the [Figma redesign](https://www.figma.com/design/oIEgfoHtGZUcZ2WhMBijP0). The dark navigation rail groups overview, organizations and accounts, platform resources, and platform governance. Each page has one title and contextual actions; provider tasks, account details and team details have explicit routes or query views. Reference sample values stay outside production components.

The platform overview is served by one administrator-only `/v1/platform/overview` transaction. It returns the reporting range, organization/member/runtime and usage totals, Shanghai-time trend points, pending work, health rows, and recent audit events. The member metric counts membership relationships. Trend plots derive from returned amounts and retain an empty state when no points exist.

Existing resource APIs own mutations. Forms preserve displayed revisions, audited reasons, failed input, expiry semantics and accounting units; GiB capacity inputs convert to integer bytes before submission. Modal forms trap keyboard focus, close with Escape when cancellation is enabled, and restore focus to the invoking control.

Panel sizing, section gaps, and navigation scrolling follow the [content height and spacing decision](../bug-fix/2026-10-16-admin-content-heights-and-spacing.md).

Private deployments expose enterprise SSO and directory synchronization in the Admin shell because these are enterprise configuration workflows. The shell requires platform administration, while each selected team additionally requires active membership and `identity.manage` or `directory.sync`. Open deployments do not fetch these resources. Explicit team selection prevents platform identity from implying customer-team authority. Identity edits preserve stored secrets when their fields are blank; diff decisions retain versions and require confirmation. Rollback creates compensating differences for a separate approval.

## Alternatives considered

- **Keep the complete Admin surface dark** — this would preserve the earlier palette but fail the supplied administrator reference, whose light work area is part of its scanning hierarchy.
- **Render the PNG export inside the product** — this would produce a screenshot match without a usable or accessible interface and would make live data and actions impossible.
- **Assemble overview cards from independent browser requests** — this could show totals from different moments; the server-side aggregate keeps one reporting range and one transaction.

## Consequences

- Admin and the enterprise client share semantic roles and interaction states while intentionally differing in surface brightness and information density.
- The overview has a stable typed response and one refresh point, while detailed pages continue to use their existing resource-specific APIs.
- Copy remains locale-owned in `apps/admin/app/messages.ts`; reference example numbers are test fixtures only.
- Local fonts and Lucide assets provide consistent typography and navigation without third-party requests during page rendering. Font subsets cover dictionary copy; dynamic names can use system fallbacks.

## Verification

Admin typecheck, owner-local page snapshots, focused interaction tests and a production build cover the implementation. Browser acceptance uses isolated read-only API fixtures for page geometry and responsive layouts; it does not establish live mutation success.
