---
description: "Electrobun desktop prototype limitations and enterprise integration requirements."
---

# Enterprise macOS prototype

English | [中文](README.zh.md)

## Summary

This directory pins Electrobun 2.0.1 and builds a native desktop host with a bundled account page. The account page handles sign-in, registration, organization membership and team selection; it never loads the Admin console or Portal as its main surface. After entering a team, the window opens the organization-scoped Web-style Agent UI bundled under `frontend/`, not `apps/web/dist`. The native host keeps API cookies out of the WebView, completes desktop PKCE authorization, starts the local DSH process, renews its Runtime lease, and stops it when the lease or device session ends. The packaged DSH executable and complete Web profile require an Apple Silicon packaging smoke test before distribution; that release gate does not block development-stage runtime integration.

## Table of Contents

- [Integration requirements](#integration-requirements)
- [Native model provider](#native-model-provider)
- [Remote session provider](#remote-session-provider)
- [Enterprise sandbox](#enterprise-sandbox)
- [Dev Note](#dev-note)

<a id="integration-requirements"></a>
## Integration requirements

The enterprise client reuses the shared Web client packages and visual language through its own `frontend/` entry, while the local runtime composes the [Web profile](../../packages/bundle/web-app/cordis.patch.yml). Electrobun ships that frontend in its own resources and does not load `apps/web/dist`. An unrestricted personal profile must not be presented as a governed enterprise runtime. The backend API alone does not constrain a local model provider or dynamic plugin loader.

The [native login](src/desktop-auth.ts) uses S256 PKCE, a single-use state-checked loopback callback, and shared API schemas. The [Keychain helper](native/keychain.swift) receives credential bytes through stdin rather than argv or environment variables; only missing items return absence. The native menu starts browser login without passing credentials to the WebView. A successful login starts [DesktopSession](src/desktop-session.ts), which reads the credential from Keychain, starts the organization-scoped [runtime supervisor](src/runtime.ts), and renews the server lease through [RuntimeHeartbeat](src/runtime-heartbeat.ts). Logout stops the process group and deletes the active Keychain item. The supervisor requires an absolute executable, an explicit organization, and a provisioned `enterprise-desktop` profile; it strips inherited credentials and waits for process-group shutdown.

The [LaunchAgent helper](src/launch-agent.ts) writes only the application-owned plist, supports replacement of an application-owned registration, and preserves errors from launchctl. [EnterpriseRuntimeController](src/runtime-controller.ts) owns start/stop ordering, includes the organization `DSH_HOME` in login-start launches, cleans up failed registration, supports an explicit login-start toggle, and removes only an agent it installed. [DesktopSession](src/desktop-session.ts) switches organizations without overlapping runtimes and stops local work after a failed lease renewal. A successful native login stores a runtime token, not a refresh-token protocol. The [enterprise profile smoke test](tests/profile-smoke.test.ts) starts the real CLI profile, confirms the authenticated loopback redirect, and terminates the owned process.

`pnpm --filter @deepseek-ai/dsh-enterprise-desktop typecheck:runtime` checks the Node helpers and their tests. After Electrobun `build` downloads its pinned SDK, `typecheck` also checks the native shell against that SDK. `test` exercises loopback login and process groups. Native Keychain tests require `build:native` followed by `ENTERPRISE_TEST_KEYCHAIN=1`; they create and delete a unique test account and verify chunked credential input. The [API integration test](../api/tests/identity.test.ts) combines actual Better Auth authorization, PostgreSQL, and the loopback client. Electrobun `build` stages the CLI production dependency tree, a bundled Node launcher, and Web frontend resources beside the app. A clean-machine GUI login and native-module portability check remain release acceptance work.

<a id="native-model-provider"></a>
## Native model provider

`pnpm --filter @deepseek-ai/dsh-enterprise-desktop build:provider` builds the [Cordis plugin](src/gateway-provider.ts), exported as `@deepseek-ai/dsh-enterprise-desktop/gateway`. It registers the `enterprise` route on `ctx.llm`. The trusted profile supplies the API origin, Keychain helper/account locator, request timeout, and event/response limits; it never supplies a provider key. The adapter verifies the credential's deployment/device binding, renews the Runtime lease, and retrieves enabled platform model IDs before dispatch. The API authenticates the runtime and resolves the platform model before forwarding the call.

The [request and stream projection](src/gateway-wire.ts) maps DSH messages to either OpenAI Chat Completions or Responses according to the selected catalog entry. It resolves durable images, video, audio, and documents through the attachment service; provider-file policies use the shared `llm-files` coordinator, while bounded inline policies emit request-local Base64. The enterprise API validates modality claims and limits, uploads provider files with server credentials, and forwards the selected protocol response without converting it. The adapter projects Responses reasoning-summary records as DSH reasoning blocks, strictly rejects unknown streaming events, and closes attachment reads, uploads, and the model response on cancellation.

The generated enterprise profile composes this provider with remote SessionPersistence, the enterprise client bridge, and the Web profile. Source tests use the repository's source-resolution map. Native tests with `ENTERPRISE_TEST_KEYCHAIN=1` also require `build:provider` and a root `pnpm run build`; the [profile test](tests/gateway-profile.ts) runs the built provider through `dsh --profile` with a unique Keychain account. Full recorded-session regressions and real-model verification remain required for release acceptance.

<a id="remote-session-provider"></a>
## Remote session provider

`pnpm --filter @deepseek-ai/dsh-enterprise-desktop build:persistence` builds the [remote provider](src/session-provider.ts), exported as `@deepseek-ai/dsh-enterprise-desktop/session-persistence`. It implements native create/open/stat/list/flush and read/write handles. Configuration supplies the API origin, Keychain helper/account, request timeout, and response-byte limit. Creation immediately persists an empty Session and claims its writer; closing an empty Session does not erase it. Published events route to the owned handle; flush and close await queued writes. Disposal waits for in-flight opens before closing their handles.

The API acknowledges committed PostgreSQL writes, stores fork-inherited counts separately from events, pages lists and event reads, and binds a writer to the authenticated Runtime. Native reads reconstruct the current logical Session through DSH validators and refuse unknown required events. They currently fetch the complete log before slicing; large-history optimization remains necessary. Appends, idle renewal, and flushes renew the writer lease. Failed renewal or an uncertain append permanently fences that handle; recovery requires closing it, reopening the server log, and inspecting committed state. No automatic replay or local JSONL fallback occurs.

The [API tests](../api/tests/identity.test.ts) exercise native handles with real PostgreSQL, including lost acknowledgements and disposal during creation. With `ENTERPRISE_TEST_KEYCHAIN=1`, they also exercise the built plugin through a named DSH profile and actual Keychain. The shared persistence/live-write suites, periodic idle lease renewal, execution-admission guards, interrupted-action recovery UI, historical-log import, attachments, and search/export remain unverified or incomplete. The generated enterprise profile mounts this provider for desktop sessions.

<a id="enterprise-sandbox"></a>
## Enterprise sandbox

The [enterprise sandbox](src/enterprise-sandbox.ts) wraps the existing `sandbox-local` provider for a named desktop profile. Restricted calls use the platform Seatbelt runner on macOS and fail with `SANDBOX_UNAVAILABLE` when its functional probe fails; the wrapper never returns an unconfined command. Consumers pass an absolute workspace root and choose `read-only` or `workspace-write` per call. `danger-full-access` remains an explicit user choice outside this provider. The wrapper does not claim network isolation or protection from a local administrator, and the complete desktop profile still needs to mount its consumers.

<a id="dev-note"></a>
## Dev Note

[Acceptance requirements](../../docs/developer/discussion/enterprise-client-acceptance.md) distinguish Web baseline behavior from verified enterprise behavior.
