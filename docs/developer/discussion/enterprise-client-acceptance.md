# Enterprise client acceptance

English | [中文](enterprise-client-acceptance.zh.md)

## Summary

This reference records the enterprise macOS delivery requirements and the evidence available for the development backend. There is no beta installer. Stage one is sealed for the development host: runtime lifecycle, credential storage, local-window trust, native bridge policy, missed-task handling, and focused integration tests pass. Release packaging and Apple signing are a final delivery stage, not a prerequisite for the earlier runtime and platform stages.

## Table of Contents

- [Feature baseline](#feature-baseline)
- [Delivery stages](#delivery-stages)
- [Stage-one acceptance report](#stage-one-acceptance-report)
- [Stage-two acceptance report](#stage-two-acceptance-report)
- [Release packaging and installation](#release-packaging-and-installation)
- [Local verification](#local-verification)
- [Dev Note](#dev-note)

<a id="feature-baseline"></a>
## Feature baseline

The [Web profile](../../../packages/bundle/web-app/cordis.patch.yml), [Web entry](../../../apps/web/src/main.ts), and [Web tests](../../../apps/web/tests/README.md) define the baseline. Experimental packages are not implicitly included. Native integrations outside stage one remain unverified.

| Web function | Enterprise adaptation required | Acceptance evidence required |
|---|---|---|
| Chat, conversation, workspace | Reuse existing client plugins; isolate organization runtime and cache | Real streaming conversation after organization switching; no cross-organization data |
| Attachments and tool cards | Tenant object storage plus native workspace selection and existing presenters | Upload, execute, render, retrieve, and deny another organization's attachment |
| Subagents, plans, goals | Same authorized model provider and authoritative events for all nested work | Recorded-session regression with delegated tools and policy rejection |
| Background jobs and schedules | Local user service surviving window exit; approval pauses and missed-task handling | Close UI during work; verify continuation, notification, safe resume, and complete stop |
| Search, export, sessions | Remote SessionPersistence, paging, lease renewal, audited administrator access | Search/export/fork, two-device conflict, network failure, and released-log compatibility |
| Settings and model selection | Replace provider/key settings, default model, commands, titles, and compaction sources | Tampered IDs/addresses rejected; no local-key fallback in any model call |
| Plugin creation and activation | Immutable approval digests and signatures enforced at every load path | Unapproved, changed, cross-tenant, and revoked code cannot execute |
| Native permissions and tools | Existing Seatbelt providers; user read-only/write/full-access choices | Real filesystem and symlink tests; unavailable sandbox refuses work |

<a id="delivery-stages"></a>
## Delivery stages

The [API](../../../apps/api/README.md), [admin](../../../apps/admin/README.md), [desktop](../../../apps/electrobun/README.md), and [sandbox prototype](../../../apps/sandbox/README.md) own component details. Stage one has a complete development implementation and focused test evidence. Stage two has implementation and local Redis integration evidence, but remains open until a real model provider is verified.

| Stage | Available evidence | Missing delivery |
|---|---|---|
| macOS runtime | Native window host with its own bundled Web-style frontend, separate user Portal for registration and PKCE consent, organization-scoped DSH profile, authenticated loopback Web URL, Keychain helper, process-group cleanup, heartbeat fencing, organization switching, native bridge with sandboxed remote authentication and trusted local-window facade, missed-task state handling, a real `enterprise-desktop` CLI profile smoke test, live LaunchAgent install/bootstrap/bootout/uninstall smoke test, Electrobun development build and clean signal shutdown | Full interactive GUI login and organization switching still require a configured human identity provider; packaged Runtime and installer checks are intentionally deferred to the final release stage |
| Models and costs | Native LlmAdapter, built DSH profile/Keychain smoke, authorized catalog, cancellation and tool-stream tests; real PostgreSQL concurrent budget, settlement and truncated-call tests; atomic Redis request/concurrency limiter and explicit pending-call reconciliation tests | Desktop composition, automatic reconciliation, multimodal support, recorded Sessions and real model flows |
| Authoritative sessions | Tenant API event append and lease rejection tests; native provider through built `dsh` profile with real Keychain/PostgreSQL, paging, fork metadata, fencing and uncertain-write recovery | Desktop Web composition, shared persistence/live-write contract suite, periodic idle lease renewal, attachments, search/export and interrupted-action UI |
| Seatbelt | Existing provider passes five real macOS kernel tests | Enterprise profile composition, FS/Shell/Terminal consumers, user permission selection and end-to-end fail-closed execution |
| Plugin supply chain | Submission, conservative scan, AI-review handler, human signing and revocation routes; rejection tests | Dependency build/SBOM/scans, real AI review, all-loader enforcement, unload on revocation and recorded-session regressions |
| Administration | Better Auth/PostgreSQL tests, Next build, DSH API profile start/stop, separated Admin console and user Portal with real registration/login/team creation browser flow | Full organization/roles/sessions/plugins UI, bootstrap deployment verification, real email flows and browser end-to-end acceptance for every management operation |

<a id="stage-one-acceptance-report"></a>
## Stage-one acceptance report

The development implementation covers the local runtime lifecycle without claiming a distributable application. The runtime isolates each organization under its own DSH home, binds the local Web endpoint to loopback, validates the startup token, keeps the Agent alive after the window closes, and tears down the owned process group on stop or logout. Electrobun ships its own frontend build and reuses shared Web client packages without loading `apps/web/dist`. The user Portal owns registration, organization membership, password reset, and desktop consent; the Admin console exposes management functions only. The controller registers heartbeat and lease handling, stops work after revocation, and switches organizations by stopping the old profile before starting the new isolated profile. The Keychain helper keeps long-lived credentials outside WebView storage, command arguments, and plugin environments. Remote authentication pages open in a sandboxed window with no RPC; after the runtime reports a validated loopback URL, a new trusted window receives only the allow-listed native bridge and a browser facade. Local scheduled work is marked missed on logout, runtime stop, or connectivity loss and is never replayed automatically. LaunchAgent plist generation, lifecycle controls, and a real host lifecycle smoke test are covered by the focused suite.

The focused evidence is:

```sh
pnpm run lint
pnpm run typecheck
pnpm --filter @deepseek-ai/dsh-enterprise-desktop typecheck
pnpm --filter @deepseek-ai/dsh-enterprise-desktop typecheck:runtime
ENTERPRISE_TEST_KEYCHAIN=1 pnpm --filter @deepseek-ai/dsh-enterprise-desktop test
git diff --check
```

The desktop test suite reports 36 passing tests with two platform-gated skips covering PKCE, Keychain, process-group cleanup, heartbeat, the built `enterprise-desktop` profile, native providers, plugin loading, sandbox selection, organization switching, native-window trust policy, and missed-task handling. A host smoke test installed, bootstrapped, booted out, and removed the application-owned LaunchAgent plist, leaving no plist behind. Electrobun development build and signal shutdown were also exercised; no owned process remained. A real browser flow also registered a new user without SMTP verification, created a team, selected the organization, and confirmed that Admin exposes neither user registration nor desktop consent. Interactive GUI identity-provider login and a clean-machine packaged runtime remain release/environment checks, not silent passes.

Stage one is sealed for development and integration work. The next unique entry is stage two, remote model Provider and metering. The distributable Runtime, complete bundle, Apple signing, notarization, installation, upgrade, and uninstall remain owned by the final release stage.

<a id="stage-two-acceptance-report"></a>
## Stage-two acceptance report

The gateway reserves PostgreSQL budget before dispatch, authenticates the Runtime, validates the authorized model and policy revision, and settles complete streams by observed usage. Incomplete streams remain `pending_reconciliation`; platform operators can settle or fail them exactly once through the audited reconciliation endpoint. Redis is connected during API startup when configured and applies atomic per-organization, per-account, per-model request and concurrency limits. The native provider and integration tests use bounded SSE fixtures, so no real paid model call is claimed.

The focused evidence is:

```sh
pnpm --filter @deepseek-ai/dsh-enterprise-api typecheck
pnpm --filter @deepseek-ai/dsh-enterprise-api test
pnpm exec tsx --tsconfig tsconfig.base.json --test apps/api/tests/rate-limit.test.ts
```

Stage two is not sealed because a real provider round-trip, cancellation against that provider, and automatic upstream-status reconciliation remain unverified. The next implementation entry is to obtain that evidence; stage three must not start before the stage-two gate is closed.

<a id="release-packaging-and-installation"></a>
## Release packaging and installation

This final stage starts only after the six product stages pass their own acceptance gates. It owns the distributable Apple Silicon Runtime, complete Electrobun application bundle, signing and notarization, clean-machine installation, upgrade, uninstall, Keychain migration, LaunchAgent persistence, and residual-process cleanup. The absence of a signed installer does not block development or enterprise-beta integration work, but no public or customer installation claim is valid until this stage passes.

<a id="local-verification"></a>
## Local verification

Run the focused checks against this project's isolated infrastructure:

```sh
pnpm run enterprise:infra check
pnpm --filter @deepseek-ai/dsh-enterprise-api test
pnpm --filter @deepseek-ai/dsh-enterprise-admin build
pnpm --filter @deepseek-ai/dsh-enterprise-sandbox test
pnpm --filter @deepseek-ai/dsh-enterprise-desktop build
pnpm --filter @deepseek-ai/dsh-enterprise-desktop typecheck
pnpm --filter @deepseek-ai/dsh-enterprise-desktop typecheck:runtime
ENTERPRISE_TEST_KEYCHAIN=1 pnpm --filter @deepseek-ai/dsh-enterprise-desktop test
pnpm exec vitest run --config vitest.e2e.config.ts packages/sandbox/sandbox-local/tests/seatbelt.e2e.ts
```

The API tests allocate their own PostgreSQL database and temporary profile; the profile listener uses an OS-assigned loopback port. Desktop tests create only unique test Keychain accounts and temporary execution homes; they do not install a LaunchAgent. Tests close owned resources before cleanup. They do not create production users, call paid models, or touch other project databases. The existing Seatbelt tests validate the provider, not an enterprise Agent workflow.

The application database is migrated but not provisioned with a bootstrap administrator. Run `pnpm run enterprise:provision` with the two `ENTERPRISE_BOOTSTRAP_*` variables, or answer the prompts in a TTY; an existing deployment is rejected before prompting. Starting the API without provisioning fails closed. SMTP is required only when `ENTERPRISE_REQUIRE_EMAIL_VERIFICATION=true`; model credentials and a chosen bootstrap identity remain external prerequisites, and their absence is not evidence that the corresponding workflows pass.

<a id="dev-note"></a>
## Dev Note

This implementation does not change existing DSH product behavior or Session JSONL generations. The [platform blueprint](enterprise-agent-platform.md) and [identity proposal](../../../.agents/notes/proposed/architecture/2026-09-05-enterprise-identity-and-organization.md) remain broader than the code delivered here.
