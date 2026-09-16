---
description: "Enterprise identity, tenant authorization, model metering, and session API development."
kind: "package-bundle"
---

# @deepseek-ai/dsh-enterprise-api

English | [中文](README.zh.md)

## Summary

This development API supports verified accounts, organization membership, administrative actions, runtime registration, and platform-owned model selection. Enabled platform models are available to every authenticated organization. It uses Better Auth, Hono, Zod, Drizzle, and an isolated PostgreSQL database. It is not a complete enterprise Agent product or a desktop runtime.

## Table of Contents

- [Local development](#local-development)
- [Implementation](#implementation)
- [Verification](#verification)
- [Limitations](#limitations)
- [Dev Note](#dev-note)

-----

<a id="local-development"></a>
## Local development

Run infrastructure commands from the repository root with Docker available. The ownership check refuses conflicting containers or volumes; startup does not stop other projects.

```sh
pnpm run enterprise:infra check
pnpm run enterprise:infra up
pnpm --filter @deepseek-ai/dsh-enterprise-api db:migrate
pnpm --filter @deepseek-ai/dsh-enterprise-api test
```

[Infrastructure initialization](../../scripts/enterprise-infra.ts) creates an ignored owner-readable `.env.enterprise` file when explicitly invoked with `init`. The default loopback ports are PostgreSQL 55439, Redis 56389, and MinIO 59010/59011. The database, Compose network, volumes, and object-storage bucket belong to this project. Migration and application credentials have separate privileges.

`pnpm run enterprise:api` builds the bundle, prepares an isolated Harness home, and starts `dsh --profile enterprise-api`. An unprovisioned deployment exits with an error before opening its HTTP listener. The [provisioner](scripts/provision.ts) refuses an existing deployment before asking for credentials. Set `ENTERPRISE_BOOTSTRAP_EMAIL` and `ENTERPRISE_BOOTSTRAP_PASSWORD`, or run `pnpm run enterprise:provision` in a TTY and answer its two prompts. This development initializer accepts a simple local password and stores only its Better Auth hash. Non-interactive runs must provide both variables. Real deployment provisioning is not verified. Do not substitute another project's database credentials.

Email verification is disabled by default for this local development stack, so registration does not require SMTP. Set `ENTERPRISE_REQUIRE_EMAIL_VERIFICATION=true` to require verification; that mode requires a configured `ENTERPRISE_SMTP_URL` and `ENTERPRISE_MAIL_FROM`.

Use `pnpm run enterprise:start` for the complete local stack. The command rebuilds the Host and Client libraries, and with `--desktop` also rebuilds the Electrobun frontend and plugins, before it checks and starts this project's infrastructure, runs migrations, performs idempotent provisioning, and starts the API and administration console. Set the two `ENTERPRISE_BOOTSTRAP_*` variables on the first run; later runs reuse the existing deployment. Add `--desktop` to also start the Electrobun development client. Pressing Ctrl-C stops the application processes but leaves the owned infrastructure running for the next start. If an older stack is still listening on ports 8787 or 3000, stop it before retrying.

[Configuration](src/config.ts) and the [bundle patch](cordis.patch.yml) own startup settings. Configure SMTP and a sender before enabling email flows. Model endpoints may use any public HTTPS origin; the gateway rejects credentials, literal IP addresses, and a complete DNS answer set when any address is invalid or private. Model keys remain encrypted at rest. The API binds loopback and needs a separately secured ingress for remote use. The model route is an authenticated relay: it preserves the caller's path, method, body fields, request headers, and upstream response bytes, replacing only the configured model ID and Authorization header. Request failures, response-stream failures, upstream error statuses, and post-response metering failures log the model ID, upstream origin, path, method, and applicable error classification without credentials, request headers, query parameters, or body content. `ENTERPRISE_MODEL_USAGE_MAX_EVENT_CHARS` bounds the SSE record memory inspected by the meter.

-----

<a id="implementation"></a>
## Implementation

<details>
<summary>Implementation internals</summary>

[Authorization](src/security.ts) resolves membership before selecting transaction-local tenant context. Forced RLS protects organization data under the non-privileged application role. Organization locks protect seat changes, hierarchy edits, and final-Owner checks. Platform administration does not implicitly grant customer conversation access.

[Session routes](src/sessions.ts) provide tenant-scoped event append, fenced Runtime-bound writer leases, contiguous sequence checks, DSH event validation, paged reads/lists, fork metadata, and identical-retry detection. The native [SessionPersistence adapter](../electrobun/src/session-provider.ts) uses these routes as authoritative storage; uncertain writes fence the handle and require explicit reconciliation. Non-owner content reads require an organization Owner or administrator and append an audit fact.

[Model calls](src/gateway.ts) authenticate the device, resolve an enabled platform model, replace the configured upstream model ID and Authorization header, and relay the requested HTTP exchange without model grants, option filtering, budget admission, or response re-framing. Before dispatch, the gateway atomically claims the organization and request idempotency key; a duplicate receives a conflict before another upstream call can incur cost. After a successful OpenAI-compatible SSE response reports usage and reaches `[DONE]`, a side-channel observer settles that claim with uncached input, cached input, output, reasoning, total tokens, the three CNY price snapshots, and component costs. Responses without complete usage release the claim, while a settlement-storage failure leaves it pending for explicit reconciliation. Platform summary, daily trend, grouped breakdown, and cursor-paged record routes include compatibility rows in calls and available token totals but mark them unpriced instead of mixing their USD fields into CNY cost. The [plugin review routes](src/plugins.ts) separate source scanning, AI review, human approval, and publication signatures. Their scanner is a conservative syntax/pattern check, not a supply-chain scanner or hostile-code sandbox.

The gateway and [native model provider](../electrobun/src/gateway-provider.ts) share Zod request/catalog schemas. The API observes SSE usage without consuming, storing, or rebuilding response bytes; the native provider independently validates the OpenAI-compatible stream required by DSH after it receives those bytes. Missing, malformed, oversized, interrupted, non-SSE, and non-2xx responses remain transparent but do not produce a settled usage entry. Metering and database failures do not change the relayed response.

Platform operators can resolve a `pending_reconciliation` entry with `POST /v1/platform/organizations/:organizationId/usage/:id/reconcile`. The endpoint requires platform authority and an explicit settled or failed outcome. A CNY claim retains its three price snapshots and accepts input, cached-input, output, and reasoning token totals to reconstruct the component costs; a compatibility claim retains the existing billed-micro-unit path. Reconciliation updates the ledger and appends an audit record in one transaction.

</details>

-----

<a id="verification"></a>
## Verification

[Tests](tests/identity.test.ts) create a fresh randomly named database in this project's PostgreSQL instance and close pools before deleting that database. They exercise authorization, seats, invitations, runtime tokens, session leases, and auditing. The [profile smoke](tests/profile-smoke.ts) runs the built bundle through DSH, binds an OS-assigned loopback port, and verifies process exit and listener closure. Tests need the isolated local infrastructure; they do not silently skip a missing database.

<a id="limitations"></a>
## Limitations

- Department role bindings are stored, but delegated department authorization is not implemented. Organization-level authorization remains explicit.
- Cancellation remains covered by the local upstream fixture rather than a real provider. Streaming and non-streaming requests through the production HTTPS and DNS transport are verified manually against an enabled DeepSeek model. Providers and paths that do not return OpenAI-compatible SSE usage remain usable through the relay but do not produce platform usage entries; automatic upstream-status reconciliation is absent.
- Trusted ingress IP handling, account suspension, and complete security audit coverage remain open. Redis limiting is available when the deployment configures `ENTERPRISE_REDIS_URL`; deployments that omit it use the explicit in-process development fallback.
- The native model provider and remote SessionPersistence are independently tested but not composed into the enterprise desktop. Attachment storage, session export/search, universal policy-revision enforcement, periodic idle lease renewal, and complete client plugin verification remain absent.
- Publication signatures do not yet control DSH plugin activation or unload. Source scans do not generate SBOMs or validate an installed dependency closure.
- Bootstrap account provisioning, email delivery, GUI login, and private deployment acceptance need end-to-end verification. The native loopback client and actual API code exchange are covered together in the isolated database tests; this does not verify packaged desktop activation.

<a id="dev-note"></a>
## Dev Note

The [identity proposal](../../.agents/notes/proposed/architecture/2026-09-05-enterprise-identity-and-organization.md) remains proposed. The [acceptance matrix](../../docs/developer/discussion/enterprise-client-acceptance.md) separates backend evidence from desktop delivery.
