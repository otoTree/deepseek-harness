# Agent Note: Enterprise Admin uses domain routes and durable approval workflows

Status: implemented

English | [中文](2026-10-01-enterprise-admin-domain-routes.zh.md)

## Problem

The reference export separates organization, synchronization, permissions, models, identity, and platform operations into distinct work areas. The existing Admin selected one generic table through a query parameter and the API did not retain synchronization decisions, identity mappings, login failures, or session approvals.

## Decision

Admin exposes shareable App Router URLs grouped by domain. Organization directory, member detail, and account detail are separate routes; synchronization has script, run, diff, and history routes; permissions has catalog, role, and session-approval routes; models has catalog, adapter, and Runtime detail routes; identity has provider, mapping, and login-failure routes; platform has settings, redemption, and health routes.

The shared shell owns navigation and the light operational canvas. Each domain page chooses a resource-specific view with explicit columns, summary metrics, and a detail or approval surface where the workflow requires one. The old `?section=` navigation is not maintained.

Synchronization previews create append-only diff rows. Diff decisions use a version check. Rollback creates a compensating run and leaves the source run unchanged. Identity field mappings, masked login-failure records, and session approval decisions are tenant-scoped, permission-checked, audited, and versioned where concurrent decisions can conflict. Health reports unknown when a provider probe is not available; it does not fabricate availability.

## Alternatives considered

- **Continue extending the generic table** — this would keep one interaction model for workflows that require tree navigation, code review, mapping forms, and approvals.
- **Keep query parameters as the primary navigation** — query state is useful for filters, but it does not provide stable domain URLs or route-level ownership for detail pages.
- **Overwrite synchronization history during rollback** — this would hide the original decision and prevent audit reconstruction; compensating runs preserve both facts.

## Consequences

- Admin URLs can be bookmarked, shared, and tested independently by domain.
- API migrations add durable workflow records and tenant row-level security policies.
- The shared shell is intentionally small; domain-specific forms and action affordances remain close to their resources.
- Provider probes and unimplemented external systems remain visibly unknown until a real health signal exists.

## Verification

Admin typecheck, unit tests, and production build pass. API typecheck and focused API tests pass. The domain routes are rendered by the App Router catch-all with explicit path parsing, and the new workflow tables are included in migration `0033_admin_workflows`.
