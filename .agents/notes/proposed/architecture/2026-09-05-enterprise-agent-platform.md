# Agent Note: Enterprise client runtimes and cloud control plane

Status: proposed

English | [中文](2026-09-05-enterprise-agent-platform.zh.md)

## Problem

DeepSeek Harness is a configurable local Agent harness rather than an enterprise service. Its current composition can run a capable Agent, persist Sessions, expose a browser UI, and add dynamic Cordis packages, but those mechanisms do not define organizations, account identity, tenant authorization, centrally governed model credentials, durable plugin releases, commercial metering, or a security boundary for untrusted plugin code.

Moving the complete runtime to a shared server would make governance straightforward, but it would also move local files, Git, Shell, native applications, and customer context away from the devices that own them. Keeping everything on user devices preserves those capabilities and lets the Agent own scheduled and long-running automation, while a cloud service still needs to provide governed model access, short plugin calls, enterprise audit, cost control, and plugin distribution. The platform needs an explicit allocation of execution, policy, and data authority before individual capabilities are added.

Cloud plugins add a separate trust problem. The current dynamic-package runner provides useful immutable-version and Cordis-lifecycle semantics inside one process, but its `node:vm` context is not a security boundary and its registry is neither durable nor distributed. An enterprise marketplace cannot treat that mechanism as tenant isolation, install dependencies in live workers, or let a reviewed tool schema drift from the code that receives calls.

## Proposal

The platform will use client-primary Agent execution with a shared cloud control plane. A Browser Runtime will host browser-safe Agent work and automation, a Desktop Runtime will host local and native capabilities plus automation that must outlive one turn, and a Cloud Plugin Service will provide short, on-demand plugin calls and capability brokers. The cloud service will not own schedules, Agent loops, or long-running workflow state. Each location will run only the tools allowed by its runtime and tenant policy.

The control plane will own account and organization identity, authorization, Runtime registration, policy, model routing, plugin publication, approval, quotas, metering, billing, and audit. The data plane will be authoritative for enterprise Session events and platform records. SaaS will isolate tenants in vendor-operated services; the private distribution will deploy the same logical protocols and release artifacts in the customer's environment. The enterprise beta will be online-first and will not define offline mutation reconciliation.

Platform-managed model credentials will remain in the model gateway. Browser and desktop runtimes will send governed requests through it and receive streamed results. Bring-your-own-provider credentials will be tenant Secret bindings resolved at the gateway, not values returned to a client.

### Desktop credential and lifecycle constraints

The [desktop authentication client](../../../../apps/electrobun/src/desktop-auth.ts) exchanges one-time PKCE codes and persists the resulting runtime credential through a native Security.framework helper. Credential bytes use private stdio, not `security -w` command arguments; process listings must not become a credential channel. Callback servers bind an OS-assigned loopback port, validate state and Host, refuse replay, and close on completion or cancellation. The app does not start an unrestricted personal profile while the governed providers are missing. This deliberately gives up immediate local Agent execution rather than claiming that an isolated home enforces enterprise model or plugin policy.

The [process supervisor](../../../../apps/electrobun/src/runtime.ts) owns a POSIX process group, excludes inherited secrets, and waits for close after TERM/KILL escalation. Sending a signal is not evidence of process exit. Keychain, callback, built-profile, LaunchAgent-host, and API database tests cover the development lifecycle; interactive GUI sign-in still requires a configured human identity provider, and remote-provider integration belongs to the later platform stage. A distributable Runtime, installer, signing, and notarization are deliberately deferred to the final release stage after the six product stages; they are not prerequisites for enterprise-beta integration. The [gateway](../../../../apps/api/src/gateway.ts) authenticates the device before serializing an idempotency key with PostgreSQL transaction locks; duplicate responses expose only that device's existing call ID and status, never initiate another upstream request, and do not replay a completed stream.

The [EnterpriseRuntimeController](../../../../apps/electrobun/src/runtime-controller.ts) owns the local process supervisor and the optional login-start registration as one lifecycle. It starts the organization-scoped process before installing a LaunchAgent, includes the organization `DSH_HOME` in login-start launches, rolls back the process when registration fails, and removes only an agent it installed. [DesktopSession](../../../../apps/electrobun/src/desktop-session.ts) reads the authenticated credential from Keychain, starts that controller, renews the Runtime lease, stops local work after lease loss, switches organizations without overlapping processes, and deletes the credential on logout. The packaged executable and complete Web profile still require the desktop installation smoke test.

### Native model transport

The [enterprise adapter](../../../../apps/electrobun/src/gateway-provider.ts) implements the native LLM interface instead of exposing a client-side upstream key or rewriting Agent Loop requests. It advertises only the server's authorized directory, checks the Keychain credential's origin/device binding, renews the device lease, and maps auxiliary purposes without modifying model-visible messages. Text and tool streaming use shared validated gateway records. The provider disables automatic retry: uncertain accounting cannot safely infer that a new model request is free. This costs automatic recovery and initial image/reasoning-control support, which remain explicit delivery gaps.

The gateway validates and meters the stream before forwarding a completion marker. Real PostgreSQL tests verify overlapping reservations, actual settlement, stale policy refusal, and retained reservations for truncated streams; a built named-profile smoke verifies native loading and Keychain access. The generated desktop profile composes the provider with remote SessionPersistence, the original Web UI, and the enterprise account bridge. Automatic cost reconciliation, recorded Agent Session coverage, and approved plugin activation remain separate delivery gaps.

### Plugin execution and publication

One plugin identity may publish immutable target artifacts for `browser`, `desktop`, and `cloud`. Every release will bind its tool schemas, artifacts, dependency lockfiles, permissions, resource limits, reliability declarations, and commercial policy to reviewed digests. Any relevant change will create a new version and invalidate the earlier approval for that version's replacement.

Developers will submit source and lockfiles. Platform-controlled builders will resolve dependencies through approved npm and PyPI proxies, scan the source and dependency closure, run declared checks, create an SBOM, and sign immutable Node.js or Python artifacts. An AI reviewer will produce explainable findings and a risk classification; a human enterprise reviewer will approve or reject the exact artifact and permission digests. Runtime sandboxes will mount code read-only and will not install dependencies. Publisher-provided arbitrary OCI images will remain outside the enterprise beta.

Each cloud plugin version will execute through the project's existing unified sandbox adapter. The service may keep a small warm pool for short calls, but it will not own automation state or long-running work. Deployment will preload and health-check a candidate, route a bounded canary, atomically send new calls to the approved version, and release idle capacity. Every instance will accept one concurrent call by default; a reviewed reentrancy declaration may permit more.

Cloud plugin calls will use at-least-once delivery with a stable `callId`, idempotency key, deadline, attempt, and version digest. Automatic retry will require an approved idempotency classification. Object storage, plugin KV/SQL, enterprise database connections, Secrets, egress, queues, and observability will be brokered and enforced outside the sandbox under default-deny policy.

### Commercial allocation

SaaS will combine organization subscription, active seats, and metered model and cloud-resource usage. Credits will present budgets and consumption but will not replace the resource and currency ledger. Private deployment will use an annual platform license and support plan while retaining internal usage allocation. Private plugins will precede the public marketplace; public plugins will require platform review plus enterprise approval, and commercial entitlement will remain separate from executable permission.

The complete product, architecture, protocol subjects, delivery gates, and unit-economics model live in the [enterprise platform blueprint](../../../../docs/developer/discussion/enterprise-agent-platform.md). This note owns only the cross-system allocation and its rationale.

### Relationship to existing decisions

This proposal extends rather than supersedes the [browser dynamic-package proposal](2026-08-08-cordis-web-dynamic-packages.md). That proposal owns temporary Host/Client packages, approvals, and lifecycle within a DSH process; this proposal requires a durable tenant-scoped release and routing service outside that process.

This proposal also retains the [self-referential Cordis toolset](../../implemented/feature/2026-07-08-self-referential-cordis-toolset.md) as a trusted local development mechanism and the [WebWorker preview](../../implemented/architecture/2026-08-20-webworker-pack-lowering-and-preview.md) as browser compatibility evidence. Neither decision promises an enterprise security boundary. Their active rationale remains independently useful, so no existing Agent Note is superseded or archived.

## Alternatives considered

**Run every Agent on the server.** This gives the server one execution and persistence model, but forces local files, repositories, shells, and native integrations through remote upload or privileged connectors. It weakens the main value of a local harness and increases the volume of sensitive customer data handled by the platform.

**Keep all execution on devices and make the service only an account and billing backend.** Device-only execution cannot provide governed short plugin calls, centralized release revocation, shared capability brokers, durable enterprise audit, or consistent cost enforcement. It also makes every external integration depend on device reachability.

**Run cloud plugins as Cordis fibers in a shared worker process.** Cordis disposal solves lifecycle cleanup but not hostile-code isolation, CPU or memory containment, tenant filesystem separation, or failure independence. A shared process would let one plugin crash or starve unrelated tenants.

**Install dependencies when a cloud call starts.** Live installation makes latency and executed code depend on mutable registries, requires package-manager credentials in the runtime, and breaks the reviewed source-to-artifact link. Isolated builds and immutable artifacts make the executing bytes auditable and reusable.

**Allow publisher-provided arbitrary OCI images from the first release.** Arbitrary images support more languages, but greatly expand supply-chain review, kernel attack surface, private-deployment compatibility, and operational variance. Version-pinned platform Node.js and Python images cover the intended beta workloads with a bounded policy surface.

**Ship SaaS first and design private deployment later.** That path reduces initial operations, but risks embedding vendor infrastructure and identity assumptions into every protocol. Building both distributions against one conformance target costs more initially but keeps the enterprise data and deployment model credible.

## Acceptance criteria

- A browser and a managed desktop runtime can register with opaque tenant and actor identity, obtain the authorized tool view, use the model gateway, and append reconstructable Session events to the authoritative enterprise store.
- SaaS and private distributions pass one protocol conformance suite for identity, policy, Runtime leases, Session persistence, audit, metering, plugin release verification, and revocation.
- A developer can submit one private plugin with locked Node.js or Python dependencies, and the platform can build, scan, review, sign, canary, activate, roll back, and revoke its immutable version without restarting the control plane.
- A cloud plugin cannot access storage, a database, a Secret, the network, or a queue except through an approved broker operation, and every allowed or refused operation is attributable to the tenant, actor, plugin version, and call.
- A stalled, crashing, over-budget, or revoked plugin instance cannot route new calls to another tenant or unapproved version, and its failure does not stop another plugin version's pool.
- Model and plugin usage reconcile with an idempotent resource-and-currency ledger; organization, team, user, model, and plugin budgets can warn or reject before new cost is admitted.
- Enterprise administrators can reproduce the identity, policy revision, release digests, capability decisions, Session settlements, usage, and outcome for one request without receiving unrelated tenant content.
- Public marketplace execution cannot bypass platform review, enterprise approval, purchase entitlement, digest pinning, or emergency revocation when that stage ships.

## Risks

- Supporting SaaS and private deployment together increases release, support, upgrade, and observability cost. Shared protocols, artifacts, and conformance tests must prevent two products from emerging.
- A browser Agent cannot provide the same native capabilities as a desktop process. Capability discovery and activation must fail before a model relies on an unavailable tool.
- Central Session authority improves audit and recovery but increases privacy, residency, breach, and retention obligations. Tenant policy and private data-plane deployment must remain part of the first architecture, not a later UI setting.
- Sandboxing untrusted Node.js and Python code remains a high-risk security program even with microVM or container isolation. External capability enforcement, resource controls, patching, incident response, and rapid revocation are continuing operational requirements.
- At-least-once delivery exposes plugins with non-idempotent side effects to indeterminate outcomes. The platform must refuse blind retries and make manual recovery visible.
- Seat and usage pricing can hide negative margin when supplier prices or plugin resource profiles change. Original measurements and supplier cost must remain in the ledger so commercial policy can change without rewriting history.
- Online-first policy makes control-plane availability part of the user experience. The beta gives up offline policy-sensitive execution to avoid stale authorization and conflict semantics.

## User-facing model selection

The enterprise client keeps the original Web settings shell but replaces the personal model editor with an enterprise-owned Models page. It reads the authorized catalog and current `enterprise` selection through the trusted Host RPC, writes only a catalog model through the local default-model service, and leaves final authorization to the gateway on every call. This keeps the visual surface familiar without exposing upstream URLs, credentials, or an ungoverned provider choice to the user.
