---
description: "Shared providers, durable media operations, CNY settlement, and forward-only deployment recovery."
kind: "reference"
---

# Enterprise model platform

English | [中文](model-platform.zh.md)

## Summary

Providers hold immutable credential and connection revisions. Platform model UUIDs identify text and media capabilities; operation revisions hold parameters, mappings, and CNY prices. Text uses the metered relay; media uses durable tasks. [The SDK](../../packages/plugin/sdk/README.md) exposes both through one catalog.

## Table of Contents

- [Configuration and APIs](#configuration-and-apis)
- [Accounting and delivery](#accounting-and-delivery)
- [Seedance configuration](#seedance-configuration)
- [Deployment and recovery](#deployment-and-recovery)
- [Acceptance evidence](#acceptance-evidence)

## Configuration and APIs

Platform administrators manage `/v1/platform/model-providers`, `/v1/platform/models`, and `/v1/platform/model-adapters`. Provider updates append a revision; an omitted update key retains the encrypted credential. Models retain their UUID when the provider changes. Deleting a model disables it. Publishing an operation deactivates its preceding revision for new requests; accepted tasks retain their encrypted connection, prices, parameters, and reference condition snapshots.

Organization endpoints under `/v1/organizations/:organizationId` expose `models`, `model-tasks/preview`, `model-tasks`, `model-tasks/:taskId`, `model-assets`, and `model-assets/:assetId/access`. Creation returns a queued task after the task and wallet reservation commit. GET reads platform state without provider traffic. Lists return the latest 100 caller-owned tasks. Plugin capabilities revalidate the enabled installation, release, permission revision, device, and activation; task and asset access also check organization, account, and installation ownership.

The operation configuration accepts `template-v1` and `crl-seedance-v1`. Parameter defaults and constraints resolve before reservation. Reference requests contain platform asset IDs; provider URL fragments require explicit `referenceMapping` entries. A video reference additionally requires confirmed `videoReferencePrices`. The platform does not execute arbitrary TypeScript or import Kinelyx scripts.

The [profile patch](../../apps/api/cordis.patch.yml) maps validated environment settings to runtime configuration. Defaults are: `ENTERPRISE_MODEL_TASK_ACCEPTING=true`, scan interval 1,000 ms, concurrency 4, lease 120,000 ms, maximum tracking age 86,400,000 ms, retry ceiling 1,800,000 ms, and asset limit 536,870,912 bytes. Their names use `ENTERPRISE_MODEL_TASK_` followed by `SCAN_INTERVAL_MS`, `CONCURRENCY`, `LEASE_MS`, `MAX_AGE_MS`, `RETRY_MAX_MS`, or `ASSET_MAX_BYTES`. Provider timeout and retryable HTTP statuses are revisioned settings. Seedance polling defaults to 30,000 ms and its call timeout to 300,000 ms.

## Accounting and delivery

All amounts use integer micro-yuan: 1 CNY equals 1,000,000 micro-yuan. Text preserves its existing rounding convention. Media rounds each configured measure upward to a micro-yuan and sums the measures. Token prices are micro-yuan per million tokens; other prices are micro-yuan per declared unit. Preview returns the reservation, resolved parameters, selected condition, prices, and settlement denominators; creation validates them again.

Media reserves funds once per organization and idempotency key. A repeated key with different model, operation, input, parameters, account, or installation fails. Completed provider usage settles the immutable price snapshot. Zero is valid usage. Missing or malformed final usage uses the reservation when `missingUsagePolicy=use_reserved`, with `billingBasis=reservation_fallback`; `await_usage` retains the hold for review. Confirmed free failures release the hold. A supplier-completed response with unusable output fails delivery but still settles reported usage or the configured reservation fallback; an invalid result does not establish a free supplier failure. Supplier HTTP errors retain a safe `provider_http_<status>` diagnostic without response bodies. An uncertain submission retains the hold and enters review; the Worker never automatically repeats a possibly accepted POST.

Text and media share wallet locking and integer charge utilities. Media overage collects available funds and retains the rest as visible debt. The immutable task ledger records reserve, release, settlement, overage, and audited corrections; the wallet history includes those movements. The tenant-protected `model_usage` view combines final text and media consumption without counting reservations and refunds twice. Compatibility subscription amounts retain their original currency and do not become CNY budgets.

Provider execution, asset persistence, and billing have separate task fields. Downloads require public HTTPS addresses, reject redirects and credential-bearing URLs, enforce MIME and size checks, and record a checksum. Each stored result has an owned asset ID and object key. A signed access URL is temporary. Asset failures retry independently without regenerating or charging again; the delivery tracking deadline ends automatic retries and exposes review. External canvas storage version 2 accepts version 1 records, keeps historical URLs readable, and writes asset IDs for new results.

## Seedance configuration

The CRL driver submits `/videos/generations` and queries `/tasks/{id}`. Submission accepts an ID without a status and selects `id`, `task_id`, then `data.id`. Query maps completed, failed, cancelled, expired, and processing states. A successful status without a valid HTTPS video URL becomes `provider_output_invalid`. The driver uses only `usage.completion_tokens`, never adds `total_tokens`, preserves `duration=-1`, and gives `withAudio` priority over `generate_audio` and the default `true`.

The user-supplied official price reference converts at 15 credits per CNY: Seedance 2.0 and `doubao-seedance-2-0-260128` reserve 1 CNY per second, with an automatic-duration quantity of 15 and an official 46 CNY per million tokens; Seedance 2.5 reserves 1.5 CNY per second, with automatic quantity 30 and official rate 70. Official video-reference rates are 28 and 42 CNY per million tokens. These are reference prices, **not verified CRL charges**. Configure actual rates only after account-specific confirmation. Image generation, including Seedream 5.0 Pro, remains unpublished until its API is documented. Image-reference fields and roles require documentation before activation. Actual CRL rates require account-specific confirmation before paid video acceptance; no lower reference price is assumed.

[Seedance publication templates](model-platform-seedance.examples.json) contain all three schemes with mandatory model-ID and confirmed-price substitutions. The supplied CRL guide documents video references as `video_url: { url }` with `role=reference_video`; the separate publication patch requires a confirmed video-reference rate before activation. Image reference fields remain undocumented. The 2.0 and 2.5 schemas include `ratio=adaptive`; xu retains fixed ratios.

The supplied 2026-10-17 investigation records a CRL HTTP 400 pricing-range rejection for Seedance 2.5 with 720p, adaptive ratio, automatic duration, video reference, and audio disabled. The rejected field is unconfirmed. This combination remains unaccepted until supplier confirmation and real testing; editing requests must retain `duration=-1` and `ratio=adaptive` rather than silently becoming fixed-duration generation.

## Deployment and recovery

1. Back up PostgreSQL and object storage; verify restore access, encryption-key availability, application-role grants, and existing pending tasks. Retain the preceding application artifact and the new compatible Worker artifact.
2. Apply [migration 0035](../../apps/api/migrations/0035_unified_model_platform.sql) with the existing migration runner. The journal makes reapplication a no-op. Existing text UUIDs, task snapshots, ledger amounts, and Session JSONL remain intact; historical tasks retain engine version 1. Grant application access to new tables and the usage view without granting ledger mutation.
3. Build the API, administrator console, protocol, SDK, and external plugin separately. Verify ZIP manifest, integrity, SDK versions, and both target entries. Start the API only through the supported `dsh --profile enterprise-api` path.
4. Start with `ENTERPRISE_MODEL_TASK_ACCEPTING=false`; verify directory, credentials, storage signing, migration mapping, read permissions, and pending-task recovery. The setting rejects new tasks while accepted tasks and idempotent reads continue. Enable admission after the checks pass.
5. Observe review tasks at `GET /v1/platform/model-tasks`. Resolve through `POST /v1/platform/model-tasks/:taskId/resolve`, providing `expectedVersion` and documentary `evidence`. Actions link a confirmed provider task ID, confirm a free failure, retry assets, collect debt, or append a charge adjustment. Do not infer free failure from elapsed time or repeat an uncertain submission.
6. For recovery, stop new admissions, retain processing of accepted tasks, and deploy a compatible forward fix. Do not downgrade the schema, rewrite ledger history, replace committed Session generations, or restore an old database over live charges. Restore backups only as a coordinated disaster-recovery operation with provider and financial reconciliation.

## Acceptance evidence

Keyless tests use isolated PostgreSQL databases, an explicit supplier fixture, controlled clock advancement, submission barriers, and in-memory object storage. They verify migration preservation, concurrent idempotency and Worker claims, restart continuation, missing and zero usage, frozen reference prices, late-result fencing, debt, audited adjustment, and installed-plugin capabilities. Fixture reference fields are intentionally named as fixtures and are not CRL documentation.

Production readiness also requires an installed external-plugin flow on the local formal application, a recorded Agent tool scenario, and authorized real supplier calls. The video acceptance scope records text sync/stream, all three Seedance schemes, automatic durations, documented video references, restart recovery, final usage, prices, ledger movements, checksums, and media playback. Image generation and image references remain deferred until documented. Request keys and a bounded task/amount allowance only after keyless checks pass. Stop new paid tasks if a submission is uncertain or the allowance is exhausted. Redact credentials, signed URLs, and source-material addresses from reports and GIFs. Local acceptance does not assert remote production deployment.
