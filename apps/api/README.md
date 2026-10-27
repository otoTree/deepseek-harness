---
description: "Enterprise identity, tenant authorization, model metering, and session API development."
kind: "package-bundle"
---

# @deepseek-ai/dsh-enterprise-api

English | [中文](README.zh.md)

## Summary

This development API supports verified accounts, organization membership, administrative actions, runtime registration, and platform-owned model selection. It also exposes a permission catalog, organization-scoped custom roles, versioned identity providers, and directory sync script lifecycle endpoints. Script test requests remain explicit previews until an execution worker is configured. Enabled platform models are available only to teams included in their publication audience. It uses Better Auth, Hono, Zod, Drizzle, and an isolated PostgreSQL database. It is not a complete enterprise Agent product or a desktop runtime.

[The model platform reference](../../docs/developer/model-platform.md) defines shared providers, operation revisions, durable background tasks, owned assets, CNY settlement, and deployment recovery.

[Team administration](../../docs/developer/enterprise-team-governance.md) defines exact-team permissions, required default budgets, monthly attribution, retained capacity, and lifecycle recovery.

## Table of Contents

- [Local development](#local-development)
- [Container images](#container-images)
- [Desktop releases](#desktop-releases)
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

`pnpm run enterprise:api` builds the bundle, prepares an isolated Harness home, and starts `dsh --profile enterprise-api`. An unprovisioned deployment exits with an error before opening its HTTP listener. The [provisioner](scripts/provision.ts) creates a fresh deployment only when none exists. The `--if-needed` mode used by `enterprise:start` verifies the existing deployment root without reconstructing memberships or revoked Owner grants; it fails loudly if the existing deployment has no platform administrator. Set `ENTERPRISE_BOOTSTRAP_EMAIL` and `ENTERPRISE_BOOTSTRAP_PASSWORD`, or run `pnpm run enterprise:provision` in a TTY and answer its two prompts. This development initializer accepts a simple local password and stores only its Better Auth hash. Non-interactive runs must provide both variables. Real deployment provisioning is not verified. Do not substitute another project's database credentials.

Email verification is disabled by default for this local development stack, so registration does not require SMTP. Set `ENTERPRISE_REQUIRE_EMAIL_VERIFICATION=true` to require verification; that mode requires a configured `ENTERPRISE_SMTP_URL` and `ENTERPRISE_MAIL_FROM`.

Use `pnpm run enterprise:start` for the complete local stack. The command rebuilds the Host and Client libraries, and with `--desktop` also rebuilds the Electrobun frontend and plugins, before it checks and starts this project's infrastructure, runs migrations, performs idempotent provisioning, and starts the API and administration console. Set the two `ENTERPRISE_BOOTSTRAP_*` variables on the first run; later runs reuse the existing deployment. Add `--desktop` to also start the Electrobun development client; unsupported arguments fail before the build begins. Pressing Ctrl-C stops the application processes but leaves the owned infrastructure running for the next start. If an older stack is still listening on ports 8787 or 4000, stop it before retrying.

After the local stack is running, `pnpm run enterprise:plugins:publish-local` validates the 20 selected plugin ZIPs under `/Users/hjr/Desktop/plugins`, logs in with the platform administrator, uploads missing versions, approves platform-review releases, and verifies that every selected version is published. Set `ENTERPRISE_BOOTSTRAP_EMAIL` and `ENTERPRISE_BOOTSTRAP_PASSWORD` in the invoking environment or in an ignored, owner-readable `.env.enterprise.admin` file at the repository root. Set `DSH_PLUGIN_IDS` to a comma-separated subset when publishing only selected plugin directories. The command does not print the password. Re-running it is idempotent for an unchanged plugin digest.

Verified plugin uploads preserve the optional embedded manifest icon, and the organization catalog returns it to authorized clients. Publication and catalog validation share the [plugin protocol icon rules](../../packages/plugin/protocol/README.md#use-this-package); public releases remain immutable.

[Configuration](src/config.ts) and the [bundle patch](cordis.patch.yml) own startup settings. Configure SMTP and a sender before enabling email flows. `ENTERPRISE_MODEL_REQUEST_BODY_BYTES` controls the authenticated model request-body limit (default 64 MiB, validation ceiling 512 MiB); set it above the encoded size when enabling large media. Model endpoints may use any public HTTPS origin; the gateway rejects credentials, literal IP addresses, and a complete DNS answer set when any address is invalid or private. Model keys remain encrypted at rest. Only the platform-administrator model API returns the configured base URL and upstream model name; organization and Runtime catalogs expose the platform model ID, display metadata, capabilities, and limits. The model directory stores the selected wire protocol, declared input modalities, video embedded-audio mode, and file-input policy alongside the legacy image flag; defaults preserve existing text-only OpenAI-compatible models and conservatively classify omitted video-audio metadata as frame-only. The API binds `127.0.0.1` by default. Container deployments must set `ENTERPRISE_API_HOST=0.0.0.0` and put the service behind a secured ingress. The `/model/*` data-plane namespace is an authenticated relay: it removes only the namespace prefix, preserves the remaining path, method, query, provider JSON fields, request headers, and safe response headers, and replaces only the configured model ID and Authorization header. Redirect, service-identity, cookie, reporting, and provider CORS response headers do not reach the caller. Text responses replace exact provider origin, hostname, and upstream-model literals while retaining protocol framing; binary responses remain byte-preserving. A request must select the same enabled platform model UUID in its JSON body and `X-DSH-Model` header when both are present; a provider model name or unknown UUID never reaches upstream. Request failures, response-stream failures, upstream error statuses, and post-response metering failures log the platform model ID, relayed path, method, and applicable error classification without the configured endpoint, credentials, request headers, query parameters, or body content. `ENTERPRISE_MODEL_USAGE_MAX_EVENT_CHARS` bounds the SSE record memory inspected by the meter.

Desktop account requests use the configured API origin for authentication and cookie-protected organization operations. The API includes its own origin in the explicit origin allowlist; the desktop needs only `ENTERPRISE_API_URL`, independently of Admin or Portal availability. Existing API deployments need this allowlist behavior, or an explicit `ENTERPRISE_PORTAL_ORIGIN` equal to the API origin, before accepting the updated desktop. Other browser origins remain explicit and unknown origins are rejected for cookie-authenticated mutations.

-----

<a id="desktop-releases"></a>
## Desktop releases

Deploy migration `0036_desktop_releases` and set `ENTERPRISE_DESKTOP_UPDATE_PUBLIC_KEY` to the base64 SPKI Ed25519 public key embedded in the desktop installer. The API uses its configured MinIO bucket for private installer objects and a temporary local file during verification. Keep the private signing key offline. `ENTERPRISE_DESKTOP_INSTALLER_MAX_BYTES` defaults to 1 GiB; reserve at least that much temporary disk per concurrent upload and configure the ingress body limit and upload timeout accordingly.

At Admin `/platform/desktop-releases`, a platform administrator selects the installer and its signed `.update.json` file. The API authenticates the signature, application identity, platform, version, HTTPS download URL, signed size and SHA-256 before publication. The signed URL must be `ENTERPRISE_API_URL/desktop/updates/<target>/<version>/installer`, where target is `darwin-arm64` or `win32-x64`. A failed upload remains a draft; selecting the same signed pair again reuses its draft. A cancelled request can still publish if the server already committed it, so refresh the version list before retrying.

The anonymous read-only feed at `/desktop/updates/<target>/latest` returns the signed envelope of the highest published semantic version, or 204 before the first publication. Installer reads stream immutable bytes through the API over HTTPS. Publication serializes per platform and rejects equal or older versions; existing published artifacts cannot be overwritten. A lost database commit response retains the uploaded object to avoid deleting a possibly published installer; unreferenced objects require storage maintenance. [Desktop publishing](../electrobun/README.md#desktop-updates) owns key creation and signing commands.

<a id="implementation"></a>
## Implementation

<details>
<summary>Implementation internals</summary>

Registration policy controls account creation. Both deployment modes require exact-team membership and team-local roles; private companies use departments rather than child teams. Seat limits and Runtime revocation apply only to the selected team. [Team administration](../../docs/developer/enterprise-team-governance.md) owns the authorization and onboarding rules.

Desktop login authorizations are revocable opaque tokens stored hashed on the server. `ENTERPRISE_LOGIN_SESSION_SECONDS` sets inactivity expiry (default 30 days). An authenticated request verifies membership and expiry, then extends a still-valid authorization during the second half of its lifetime. Expired or revoked tokens cannot renew. There is no device heartbeat or device quota; authorization records describe cloud access, not online presence. [Login renewal](src/login-session.ts) is independent of local process lifetime.

[Authorization](src/security.ts) resolves membership before selecting transaction-local tenant context. Forced RLS protects organization data when the application account is neither a superuser nor granted `BYPASSRLS`. Organization locks protect seat changes, hierarchy edits, and final-Owner checks. Platform administration does not implicitly grant customer conversation access.

The administration workflow routes in [application.ts](src/application.ts) and [admin-governance.ts](src/admin-governance.ts) persist synchronization diffs and compensating rollbacks, identity field mappings and masked login failures, session approvals, Runtime detail reads, and explicit health states. These records are permission-checked, audited, tenant-scoped, and migrated by `0033_admin_workflows`. Sync previews require non-empty string or numeric external IDs; invalid records produce a failed run without persisted diffs.

[Session routes](src/sessions.ts) retain tenant-scoped cloud archives and fenced remote-writer leases. The desktop stores conversations locally. Explicit uploads use `POST sessions/:id/archive` in batches of up to 500 events: each transaction locks the archive, verifies immutable metadata and overlapping events, and appends only a contiguous suffix without a writer lease. An active remote writer refuses the upload; divergent histories return a conflict. Identical retries and shorter identical uploads preserve the stored history. Downloads use paged account-owned list and event reads. Non-owner content reads require an organization Owner or administrator and append an audit record.

[Model calls](src/gateway.ts) authenticate the device, resolve an enabled platform model, validate declared modalities and media locations, replace the configured upstream model ID and Authorization header, and relay either Chat Completions or Responses without response re-framing. Each model owns an upstream-call timeout; the desktop transport allows its configured request timeout after that deadline so an API timeout response reaches the caller. Provider-file requests upload verified bytes with server credentials, reject permanent media URLs, and enforce per-file and aggregate request limits before dispatch. The gateway accepts a provider file reference only while its process-local receipt belongs to the calling organization, account, and model; a missing receipt causes the native adapter to invalidate its cache and perform one bounded re-upload. A side-channel observer settles complete usage with uncached input, cached input, output, reasoning, total tokens, file upload dimensions, CNY price snapshots, and component costs; incomplete or invalid usage remains pending for explicit reconciliation. Platform analytics expose protocol, modality, upload, failure, and reconciliation dimensions while retaining legacy Chat records. The [plugin review routes](src/plugins.ts) separate source scanning, AI review, human approval, and digest-checked publication.

The plugin catalog reads product targets from both manifest schemas and exposes declared category, description, and setup mode. HTTP authorization combines the package host allowlist with exact hostnames from saved URL fields explicitly marked `network: true` in verified configuration metadata. Other strings and non-HTTP URLs grant no network access. Configured addresses are reached by the API server, so loopback refers to that server.

[Team wallets](src/wallet.ts) start at zero and admit a model call only while the current organization balance is positive. Redemption atomically consumes one HMAC-indexed code, credits the selected organization, and appends an immutable ledger entry; plaintext codes appear only in the platform batch-creation response. Settled CNY usage locks the usage row and wallet, appends one usage-unique debit, and may leave a small negative balance after concurrent calls. Pending, failed, unpriced, and upload-only records do not debit the wallet. A later redemption first clears any negative balance, and the next model call resumes only after the balance becomes positive.

The gateway and [native model provider](../electrobun/src/gateway-provider.ts) share Zod request/catalog schemas. The API observes Chat and Responses SSE usage without consuming, storing, or rebuilding response bytes; Responses reasoning-summary records are valid framing but their text is not retained by the meter. The native provider independently validates the selected stream required by DSH. Missing, malformed, oversized, interrupted, non-SSE, and non-2xx responses remain transparent and enter pending reconciliation rather than settled usage. Metering and database failures do not change the relayed response.

Platform operators can resolve a `pending_reconciliation` entry with `POST /v1/platform/organizations/:organizationId/usage/:id/reconcile`. The endpoint requires platform authority and an explicit settled or failed outcome. A CNY claim retains its three price snapshots and accepts input, cached-input, output, and reasoning token totals to reconstruct the component costs; a compatibility claim retains the existing billed-micro-unit path. Reconciliation updates usage, the team wallet ledger, and the audit log in one transaction without allowing a second debit for the same usage ID.

</details>

-----

The [cloud drive](src/drive.ts) keeps personal ownership separate from organization-scoped sharing. A file or folder can grant view or edit access to named members, departments with an explicit subdepartment choice, or every active member of the selected organization. Folder children inherit the nearest explicit policy. New roots are private; organization-file creators  retain management access. Existing organization roots retain their committed organization audience. A personal file remains in its owner's space when shared; the shared view exposes authorized roots without granting access to the owner's other files.

The database permission function filters lists, search, trash and change feeds before pagination, and checks direct file, description, version and download requests. Upload commit rechecks the writer and destination after permission changes. Moving a node requires management access and preserves its effective policy. Sharing changes are audited; revoked access stops new signed downloads, while issued URLs remain valid until their configured expiry. The [isolated HTTP test](tests/drive-sharing.test.ts) verifies department transfers, inherited grants, cross-organization denial and revoked upload commits.

<a id="verification"></a>
## Verification

[Tests](tests/identity.test.ts) allocate a private PostgreSQL container and remove it after closing pools. They cover authorization, seats, invitations, login tokens, archive writer leases and auditing. The [profile smoke](tests/profile-smoke.ts) runs the built bundle through DSH and verifies listener shutdown. Docker is required; tests do not silently skip an absent database.

<a id="limitations"></a>
## Limitations

- Department role bindings do not grant organization administration. File-sharing audiences use department assignments independently of administrative roles.
- Cancellation remains covered by the local upstream fixture rather than a real provider. Streaming and non-streaming requests through the production HTTPS and DNS transport are verified manually against an enabled DeepSeek model. Providers and paths that do not return valid OpenAI-compatible SSE usage remain usable through the relay and create pending-reconciliation entries; automatic upstream-status reconciliation is absent.
- Trusted ingress IP handling, account suspension, and complete security audit coverage remain open. Redis limiting is available when the deployment configures `ENTERPRISE_REDIS_URL`; deployments that omit it use the explicit in-process development fallback.
- Desktop conversations are local; cloud models, drive operations and plugin management still use database transactions. Removing device heartbeats does not remove plugin activation renewals or trigger polling. Cloud concurrency still needs a bounded connection pool and request capacity planning.
- Marketplace installation records do not yet activate or unload DSH plugins. Source scans do not generate SBOMs or validate an installed dependency closure.
- Bootstrap account provisioning, email delivery, GUI login, and private deployment acceptance need end-to-end verification. The native loopback client and actual API code exchange are covered together in the isolated database tests; this does not verify packaged desktop activation.


<a id="container-images"></a>
## Container images

After logging in to the Tencent Cloud Container Registry, run `pnpm run image:push` from the repository root. The command builds and pushes `linux/amd64` images named `ccr.ccs.tencentyun.com/imags/admin` and `ccr.ccs.tencentyun.com/imags/backend`, using the current commit as the immutable tag and also updating `latest`. Configure the [Admin API URL](../admin/README.md#development) at container startup. Set `REGISTRY_PREFIX` and `IMAGE_TAG` to override the registry namespace or tag.

Both image builds attempt package-index updates and build-dependency installation up to five times, waiting five seconds between failed attempts. APT also retries transient downloads up to five times within each attempt. Persistent failures stop the build.

The Backend runtime contains the built CLI and API, migrations, bundle patch, initialization entrypoint, prepared profile, and production dependencies deployed by pnpm. The [deployment hook](../../infra/enterprise/docker/api-deploy.pnpmfile.cjs) includes the supported `dsh` launcher in that dependency set. The two workspace `link:` overrides are copied as compiled libraries with their manifests and licenses. Development dependencies, workspace source and desktop artifacts stay outside the runtime image.

The Backend image initializes its database before launching the supported `dsh --profile enterprise-api` process. Provide a dedicated PostgreSQL database through `ENTERPRISE_DATABASE_URL`; initialization and the API use that URL's account and password, including a supplied `postgres` account. The account needs permission to create schemas and apply migrations. The initializer creates the enterprise schemas and installation marker, applies pending migrations under a database advisory lock, and creates the first platform administrator. Without an installation marker, it refuses existing relations in `enterprise`, `enterprise_auth`, `drizzle`, or `public`; PostgreSQL extension members in `public` are allowed. Objects in other schemas, including platform monitoring and account-management schemas, remain untouched. A refusal identifies the conflicting relation.

Add these variables to the Backend deployment alongside its API, authentication, Redis and object-storage settings:

```ini
ENTERPRISE_DATABASE_URL=postgres://YOUR_ACCOUNT:YOUR_PASSWORD@DATABASE_HOST:5432/dsh_enterprise
ENTERPRISE_BOOTSTRAP_EMAIL=owner@example.com
ENTERPRISE_BOOTSTRAP_PASSWORD=REPLACE_WITH_A_PASSWORD_OF_AT_LEAST_12_CHARACTERS
```

URL-encode special characters in usernames and passwords. An optional `ENTERPRISE_MIGRATION_URL` selects separate initialization credentials for the same host, port and database; an absent or empty value uses `ENTERPRISE_DATABASE_URL`. Initialization grants target the actual connected application account; the initializer creates no roles and changes no database passwords. Bootstrap values are required only when the deployment is absent. After initialization, open the Admin URL and sign in with the bootstrap email and password. Repeated starts apply pending migrations and preserve existing accounts, passwords, registration policy and memberships; changing bootstrap variables does not reset an account. An existing deployment with no administrator or a different `ENTERPRISE_MODE` fails before the API starts. Concurrent starts serialize initialization. The application process does not inherit the migration URL or bootstrap credentials. Containers read deployment variables directly and need no mounted `.env.enterprise` file.

A superuser or account with `BYPASSRLS` bypasses database row-level security. Sharing a table-owning account with the API also weakens ownership-based and append-only protections. Deployments requiring database-enforced isolation should use separate non-privileged accounts; the [credential policy decision](../../.agents/notes/implemented/architecture/2026-10-21-enterprise-single-database-connection.md) records this trade-off.

<a id="dev-note"></a>
## Dev Note

The [identity proposal](../../.agents/notes/proposed/architecture/2026-09-05-enterprise-identity-and-organization.md) remains proposed. The [acceptance matrix](../../docs/developer/discussion/enterprise-client-acceptance.md) separates backend evidence from desktop delivery.
