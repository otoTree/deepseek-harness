---
description: "Local enterprise administration UI, authentication forms, and shared Web theme."
---

# Enterprise administration

English | [中文](README.zh.md)

## Summary

The Next.js 16.3.4 console provides management login and enterprise administration pages over the [enterprise API](../api/README.md). User registration, organization onboarding, password reset, and desktop authorization belong to the desktop account UI. The console imports the existing Web theme instead of defining a separate color system. It is not the DSH chat UI.

## Table of Contents

- [Development](#development)
- [Limitations](#limitations)
- [Dev Note](#dev-note)

<a id="development"></a>
## Development

`pnpm --filter @deepseek-ai/dsh-enterprise-admin build` builds the console. `pnpm run enterprise:admin` starts its loopback development server. The API URL is configured through `NEXT_PUBLIC_ENTERPRISE_API_URL`; it contains no model secret. The desktop account UI owns user registration, organization membership, password reset, and desktop consent.

The [console](app/console.tsx) includes management login, a root-first global organization tree, cross-organization account details, model directory and grants, organization units, invitations, member status, devices, session reads, usage, audit, plugin review, and platform settings. It does not expose user registration or desktop consent.

<a id="limitations"></a>
## Limitations

- A provisioned API deployment is required for management access. User registration and membership flows run in the desktop account UI; local development registration does not require SMTP unless `ENTERPRISE_REQUIRE_EMAIL_VERIFICATION=true`.
- Some advanced operations remain API-only, including scoped unit move/delete and invitation revocation; the global organization and account workflows are available in the console.
- Management copy is owned by a Chinese dictionary; the Portal provides Chinese and English user-facing copy.
- These pages do not replace native Keychain storage, device management, Web chat, or the local execution service.

<a id="dev-note"></a>
## Dev Note

See the [acceptance matrix](../../docs/developer/discussion/enterprise-client-acceptance.md) before distributing this development build.
