---
description: "Local enterprise administration UI, authentication forms, and shared Web theme."
---

# Enterprise administration

English | [中文](README.zh.md)

## Summary

The Next.js 16.3.4 console provides management login and enterprise administration pages over the [enterprise API](../api/README.md). User registration, organization onboarding, password reset, and desktop authorization belong to the desktop account UI. The console imports the shared `ui-theme` semantic roles, keeps a dark navigation rail, and uses a light operational canvas for dense tables and administration workflows; its compact components and navigation remain owned by this app. The target visual and interaction direction is defined in the [Enterprise Client and Admin Visual Design System](../../docs/visual-design-system.md). It is not the DSH chat UI.

The browser title uses the locale-owned 智域OS name. [`app/icon.png`](app/icon.png) mirrors the [shared product artwork](../web/public/favicon.png).

## Table of Contents

- [Development](#development)
- [Limitations](#limitations)
- [Dev Note](#dev-note)

<a id="development"></a>
## Development

`pnpm --filter @deepseek-ai/dsh-enterprise-admin build` builds the console. `pnpm run enterprise:admin` starts its loopback development server at `http://127.0.0.1:4000`. Set `ADMIN_API_URL` when starting the Admin server or container to the HTTP(S) API URL reachable by the browser; the default is `http://127.0.0.1:8787`. The server validates this public value when rendering each page and passes it to the browser without embedding it in the build. Invalid values fail the page request. Restart the container with a new value and reload the page to switch environments using the same image. Model secrets never belong in this variable. The desktop account UI owns user registration, organization membership, password reset, and desktop consent.

The container copies the Next.js standalone server and static assets, then starts it with Node. Workspace source, development dependencies, and build caches stay in the build stage. The [container runtime decision](../../.agents/notes/implemented/architecture/2026-10-21-enterprise-container-runtime-payloads.md) owns artifact selection.

The [domain shell](app/admin-shell.tsx) includes a root-first global organization tree, cross-organization account details, a platform-wide model directory, organization units, member status, devices, synchronization, permissions, identity providers, health, audit, and platform settings. The model editor owns OpenAI protocol, input modalities, whether native video also understands its embedded audio track, file policy, model-call and upload timeouts, per-file and request limits, file TTL and refresh margin, retries, quota cleanup, and CNY token prices; invalid cross-field combinations cannot be saved. A model cannot claim embedded-audio understanding without video input, and standalone `audio` input remains a separate capability. The model configuration page also publishes provider-neutral adapters for embedding, image, video, and audio operations. Adapter credentials, request templates, status mappings, usage extraction, prices, and reservations are platform-admin-only; the client consumes only the published model catalog. The redemption-code page creates batches of 1–1000 fixed-point CNY credits, exposes plaintext only in the creation result for immediate export, pages later records by hint and status, and revokes only unused codes. The usage dashboard defaults to the latest 30 Asia/Shanghai calendar days and presents platform totals, daily trends, protocol/modality filters, file upload dimensions, pending-reconciliation causes, grouped breakdowns, and paged records. Enabled models are available to every organization; the console does not provide per-organization model grants or user registration and desktop consent.

The domain shell exposes shareable routes for `/organizations`, `/accounts`, `/sync`, `/permissions`, `/models`, `/identity`, and `/platform`. Synchronization previews retain diff rows, approvals use versions, and rollback creates a compensating run. Identity mappings, login failures, session approvals, Runtime details, and health probes have dedicated views and tenant-scoped API owners.

At `/platform/plugins`, a platform administrator can select multiple standard `.dsh-plugin.zip` files. Each upload receives a digest-checked platform approval before the page reports it as published; failed approvals remain in the review list for manual recovery. Published platform releases appear in every organization's desktop plugin catalog after it refreshes.

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
