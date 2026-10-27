---
description: "Local enterprise administration UI, authentication forms, and shared Web theme."
---

# Enterprise administration

English | [中文](README.zh.md)

## Summary

The Next.js 16.3.4 console provides management login and enterprise administration pages over the [enterprise API](../api/README.md). Public account flows use `/account`; native consent and explicit team selection use the desktop account UI. The console imports the shared `ui-theme` semantic roles, keeps a dark navigation rail, and uses a light operational canvas for dense tables and administration workflows; its compact components and navigation remain owned by this app. The target visual and interaction direction is defined in the [Enterprise Client and Admin Visual Design System](../../docs/visual-design-system.md). It is not the DSH chat UI.

The browser title uses the locale-owned 智域OS name. [`app/icon.png`](app/icon.png) mirrors the [shared product artwork](../web/public/favicon.png).

The public `/account` page handles invitation acceptance, verification and password recovery independently of the platform-only Admin shell. [Team administration](../../docs/developer/enterprise-team-governance.md) defines the two clients and their permissions.

Platform usage details use server cursors; export reads every page in the selected period. Models, provider/task recovery, devices, platform settings and installer resources reread their state on configured visible-page refreshes.

The [Figma redesign](https://www.figma.com/design/oIEgfoHtGZUcZ2WhMBijP0) defines the four navigation groups, page hierarchy and operational forms. [Local assets](public/admin) include the brand, licensed Lucide icons and self-hosted font subsets. [Page acceptance](tests/admin-pages.test.ts) owns the keyless [page output snapshot](tests/admin-pages.expected.md), route coverage, modal focus and revision-preserving interactions.

## Table of Contents

- [Development](#development)
- [Limitations](#limitations)
- [Dev Note](#dev-note)

<a id="development"></a>
## Development

`pnpm --filter @deepseek-ai/dsh-enterprise-admin build` builds the console. `pnpm run enterprise:admin` starts its loopback development server at `http://127.0.0.1:4000`. Set `ADMIN_API_URL` when starting the Admin server or container to the HTTP(S) API URL reachable by the browser; the default is `http://127.0.0.1:8787`. The server validates this public value when rendering each page and passes it to the browser without embedding it in the build. Invalid values fail the page request. Restart the container with a new value and reload the page to switch environments using the same image. Model secrets never belong in this variable. The desktop account UI owns user registration, organization membership, password reset, and desktop consent.

The container copies the Next.js standalone server, `.next/static`, and `public` assets, including the brand image, navigation icons, and fonts, then starts it with Node. Workspace source, development dependencies, and build caches stay in the build stage. The [container runtime decision](../../.agents/notes/implemented/architecture/2026-10-21-enterprise-container-runtime-payloads.md) owns artifact selection.

The [domain shell](app/admin-shell.tsx) manages deployment policy, server-paged teams, explicit Owner/resource setup, subscription/seats, audited balance adjustments and lifecycle recovery. Platform resources include model providers, operation revisions, all/selected-team publication, plugin review and signed installers. Team roles, departments and team audit use the desktop membership interfaces.

The [enterprise workspace](app/enterprise-workspace.tsx) exposes identity connections, field mapping, login failures, synchronization scripts, runs, diff decisions and compensating rollback history in private deployments. Admin requires platform administration, explicit active team membership and `identity.manage` or `directory.sync`; it never selects the first team implicitly. Open/SaaS deployments do not load these team resources. OIDC and OAuth2 support browser login; SAML and LDAP configuration storage does not establish working login integration. Synchronization uses manual input previews and explicit approvals; scheduling and Webhook management have no console controls.

Visible resource views refresh on focus and at `ADMIN_ACTIVITY_REFRESH_MS` (default 30000, range 1000–3600000). Background identity checks retain mounted forms, selected files and active uploads; temporary failures show an inline error, while expired or revoked authorization removes management controls. Account search and paging use server results. Targeted account recovery requires the displayed revision and an audited reason and revokes existing login credentials. Subscription forms expose expiry; a blank expiry is perpetual. Legacy role and department routes explain the authorized desktop entry. Platform identity alone cannot enter a team or inspect its content.

At `/platform/plugins`, a platform administrator can select multiple standard `.dsh-plugin.zip` files. Each upload receives a digest-checked platform approval before the page reports it as published; failed approvals remain in the review list for manual recovery. Published platform releases appear in every organization's desktop plugin catalog after it refreshes.

At `/platform/plans`, platform administrators create, edit, disable and delete unused plans. Team management selects a catalog entry, its displayed revision, seat override and expiry. Assignment applies configured plan resource defaults without crediting funds or resetting usage; catalog edits leave existing teams unchanged. Referenced and provisioning plans cannot be deleted.

At `/platform/desktop-releases`, a platform administrator uploads a full installer and its offline-signed `.update.json` file. Publication requires the configured release public key, matching size/hash, and a newer version for that platform. The page supports cancellation and lists published releases and upload drafts. Deploy the [API release settings](../api/README.md#desktop-releases) before using this page; installed clients need the matching pinned update feed and key.

Device views show revocable cloud login authorizations and their server expiry, without a device quota. A valid authorization does not establish that the device is online. Subscription forms manage seats and budgets; desktop conversations remain on the user’s computer.

Admin panels grow with their content and align at the top of each row. The [layout decision](../../.agents/notes/implemented/bug-fix/2026-10-16-admin-content-heights-and-spacing.md) defines shared minimum control and metric sizes, card padding, section spacing, reading typography, and the independently scrollable sticky navigation. Browser layout evidence belongs under the Admin-owned `output/playwright/admin-layout/` directory, outside Session snapshots.

<a id="limitations"></a>
## Limitations

- A provisioned API deployment is required for management access. User registration and membership flows run in the desktop account UI; local development registration does not require SMTP unless `ENTERPRISE_REQUIRE_EMAIL_VERIFICATION=true`.
- Some advanced operations remain API-only, including scoped unit move/delete and invitation revocation; the global organization and account workflows are available in the console.
- Management copy is owned by a Chinese dictionary; the Portal provides Chinese and English user-facing copy.
- These pages do not replace native Keychain storage, device management, Web chat, or the local execution service.

<a id="dev-note"></a>
## Dev Note

See the [acceptance matrix](../../docs/developer/discussion/enterprise-client-acceptance.md) before distributing this development build.
