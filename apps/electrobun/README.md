---
description: "Build and verify the enterprise desktop client for macOS and Windows."
---

# Enterprise desktop client

English | [中文](README.zh.md)

## Summary

This package pins Electrobun 2.0.1 and builds a native desktop host with a bundled account page. The account page handles sign-in, registration, organization membership and team selection; it never loads the Admin console or Portal as its main surface. After entering a team, the window opens the organization-scoped Web-style Agent UI bundled under `frontend/`, not `apps/web/dist`. Workspace and independent plugin windows use the platform-native title bar and native Edit menu roles for copy, paste, undo, redo, cut, and select-all. The native host keeps API cookies out of the WebView, completes desktop PKCE authorization, starts the local DSH process, renews its Runtime lease, and stops it when the lease or device session ends. Host-native local installer builds run the packaged DSH profile against a local fixture before writing the artifact; these checks do not establish clean-machine native-module portability.

## Table of Contents

- [Local macOS installer](#local-macos-installer)
- [Local Windows installer](#local-windows-installer)
- [Installer artifact protection](#installer-artifact-protection)
- [Integration requirements](#integration-requirements)
- [Native model provider](#native-model-provider)
- [Remote session provider](#remote-session-provider)
- [Enterprise sandbox](#enterprise-sandbox)
- [Dev Note](#dev-note)

<a id="local-macos-installer"></a>
## Local macOS installer

Use Apple Silicon macOS with Bun, Xcode Command Line Tools, workspace dependencies and the pinned Electrobun SDK projection from desktop development. Run the following command from the repository root. It rebuilds the workspace libraries, desktop frontend, plugins, native helper and packaged runtime, then writes `apps/electrobun/artifacts/local/deepseek-harness-enterprise-<version>-macos-arm64-local.dmg` and its SHA-256 sidecar. The version comes from this application's package manifest. Network access to nodejs.org is required for published checksums and uncached runtime archives. Build staging uses a separate Electrobun project, so an active development app does not hold the installer build lock.

```sh
pnpm run enterprise:package:desktop
pnpm --filter @deepseek-ai/dsh-enterprise-desktop verify:installer
```

The verifier mounts the DMG read-only, copies the app into a private temporary Applications directory outside the checkout, checks its signature and protected resources, and boots the packaged enterprise Web profile with a local fake API and credential helper. It covers both configured and empty model catalogs, authenticated HTML and runtime shutdown without a model key. The temporary installation is removed afterward. To install for interactive use, open the DMG, drag the app to Applications and launch it. The client needs a reachable enterprise API and Portal; the native host accepts `ENTERPRISE_API_URL` and `ENTERPRISE_PORTAL_URL` in its launch environment and defaults to `http://127.0.0.1:8787` and `http://127.0.0.1:3001`.

The app uses an ad-hoc signature and has no Apple Developer ID or notarization. A downloaded copy may require explicit approval in macOS Privacy & Security before its first launch. This package validates installation on the build machine; it does not establish Gatekeeper trust, Intel compatibility, or clean-machine native-module portability.

<a id="local-windows-installer"></a>
## Local Windows installer

Build on an x64 Windows host with Node.js 22.19.x or 24+, pnpm, Bun, and either Zig or Visual Studio C++ Build Tools with the Windows SDK. The first Electrobun preparation and an uncached official Node runtime download require network access. From the repository root, install workspace dependencies and run:

~~~sh
pnpm install
pnpm run enterprise:package:desktop
pnpm --filter @deepseek-ai/dsh-enterprise-desktop verify:installer
~~~

The build writes `apps/electrobun/artifacts/local/deepseek-harness-enterprise-<version>-windows-x64-local.zip` and its SHA-256 sidecar. The ZIP contains `deepseek-harness-enterprise-Setup.exe` and a `.installer/` directory with its metadata and compressed application payload. Extract the entire ZIP and run Setup.exe from the extracted directory so the installer can read `.installer/`. The verifier checks the sidecar, x64 PE header, stable application metadata and Zstandard payload. Before creating the ZIP, the build obfuscates first-party JavaScript and smoke-tests the packaged profile against a local fake API.

`verify:installer` checks the archive contents but does not run the Setup.exe interface. Complete an interactive install check on an x64 Windows machine. The Windows build does not add an Authenticode signature or publisher identity, so it does not establish trusted publisher status or clean-machine native-module portability.

<a id="installer-artifact-protection"></a>
## Installer artifact protection

The macOS and Windows installers obfuscate first-party JavaScript in the main process, frontend, bundled plugins and runtime dependency tree. Each package includes the official Node runtime for its build host, checked against Node’s published SHA-256 checksum with its license. The macOS launcher replaces itself with Node; the Windows launcher starts Node in a kill-on-close Job Object so the runtime stops with its desktop owner.

The build removes TypeScript, source maps, source-map comments, native source files and `.env` files from staged resources. Third-party JavaScript remains executable and third-party licenses remain in the dependency tree. Public exports, property names and reflective service names remain stable. `protection.json` records protected module hashes; verification rejects added, changed or missing first-party scripts and leaked source/debug files. These measures increase reverse-engineering effort; they do not encrypt browser code, hide public protocols, protect embedded secrets or prevent a local administrator from inspecting executable logic. See the [packaging decision](../../.agents/notes/implemented/architecture/2026-10-19-local-desktop-installer-protection.md).

<a id="integration-requirements"></a>
## Integration requirements

The enterprise client reuses the shared Web client packages and visual language through its own `frontend/` entry, while the local runtime composes the [Web profile](../../packages/bundle/web-app/cordis.patch.yml). Electrobun ships that frontend in its own resources and does not load `apps/web/dist`. An unrestricted personal profile must not be presented as a governed enterprise runtime. The backend API alone does not constrain a local model provider or dynamic plugin loader.

The [native login](src/desktop-auth.ts) uses S256 PKCE, a single-use state-checked loopback callback, and shared API schemas. The macOS Keychain helper and Windows DPAPI helper receive credential bytes through stdin rather than argv or environment variables; only missing items return absence. The native menu starts browser login without passing credentials to the WebView. A successful login starts [DesktopSession](src/desktop-session.ts), which reads the credential from the platform store, starts the organization-scoped [runtime supervisor](src/runtime.ts), and renews the server lease through [RuntimeHeartbeat](src/runtime-heartbeat.ts). The authenticated page receives a hashed Runtime storage identity, not the credential token; native Workbench views derive persistent partitions from that identity and the chat Session, isolating site storage across both. Logout stops the owned runtime and deletes the active credential. The supervisor requires an absolute executable, an explicit organization, and a provisioned `enterprise-desktop` profile; it strips inherited credentials and waits for process shutdown. The Windows launcher owns the Node runtime in a kill-on-close Job Object.

The desktop bundles CEF Chromium for sandboxed native browser guests. The trusted application shell uses the native renderer. [`browser-config.ts`](src/browser-config.ts) configures loopback CDP (default port `9333`, build/runtime environment `DSH_DESKTOP_CDP_PORT`); the organization profile attaches Playwright to that endpoint. The [Workbench browser](../../packages/client/ui-workbench/README.md) renders the exact page controlled by Agent tools. [`browser-lifecycle.ts`](src/browser-lifecycle.ts) vetoes the extra parent-window close request emitted by Electrobun 2.0.1 when removing a loaded CEF guest on macOS.

The native account entry server accepts request headers up to 64 KiB and expires stale `dsh-auth-*` cookies on its HTML response. This allows a desktop window with cookies from previous Runtime ports to reach the login page and complete cleanup before loading the authenticated Web UI.

The [LaunchAgent helper](src/launch-agent.ts) writes only the application-owned plist, supports replacement of an application-owned registration, and preserves errors from launchctl. [EnterpriseRuntimeController](src/runtime-controller.ts) owns start/stop ordering, includes the organization `DSH_HOME` in login-start launches, cleans up failed registration, supports an explicit login-start toggle, and removes only an agent it installed. [DesktopSession](src/desktop-session.ts) switches organizations without overlapping runtimes and stops local work after a failed lease renewal. A successful native login stores a runtime token, not a refresh-token protocol. The [enterprise profile smoke test](tests/profile-smoke.test.ts) starts the real CLI profile, confirms the authenticated loopback redirect, and terminates the owned process.

`typecheck:runtime` checks Node helpers and tests; `typecheck` checks the native shell against the pinned SDK. Native Keychain tests require `build:native` and `ENTERPRISE_TEST_KEYCHAIN=1`. Electrobun stages the DSH executable, native helper, frontend and plugin artifacts. Shared Cordis and MCP runtime packages remain external and ship in one dependency tree to preserve service identity. `verify:build` imports the copied Host entry with isolated plain Node resolution and rejects dependencies outside the app. Clean-machine native-module portability remains release acceptance work.

The native quit guard vetoes Electrobun’s synchronous `before-quit` event until windows, account services and the owned runtime have stopped; a cleanup failure keeps quit retryable.

<a id="native-model-provider"></a>
## Native model provider

`pnpm --filter @deepseek-ai/dsh-enterprise-desktop build:provider` builds the [Cordis plugin](src/gateway-provider.ts), exported as `@deepseek-ai/dsh-enterprise-desktop/gateway`. It registers the `enterprise` route on `ctx.llm`. The trusted profile supplies the API origin, Keychain helper/account locator, transport grace timeout, and event/response limits; it never supplies a provider key. The adapter verifies the credential's deployment/device binding, renews the Runtime lease, and retrieves enabled platform model IDs before dispatch. It sends Chat, Responses, and Files operations through the API's `/model/*` namespace while preserving each native protocol path after that prefix; every request names the selected platform model ID rather than an upstream provider model. A model call uses the catalog timeout followed by the transport grace timeout, so the API owns the upstream deadline and can return its failure before the desktop cancels. The API authenticates the runtime and resolves the platform model before forwarding the call.

The [request and stream projection](src/gateway-wire.ts) maps DSH messages to either OpenAI Chat Completions or Responses according to the selected catalog entry. It resolves durable images, video, audio, and documents through the attachment service; provider-file policies use the shared `llm-files` coordinator, while bounded inline policies emit request-local Base64. Media reads use the profile's `maxMediaBytes` limit, separate from the `maxResponseChars` limit for model output and gateway metadata. When a Files API upload remains in a processing state, the adapter polls its native `/files/:id` resource at the configured interval until the file is ready, fails, or reaches the model's upload timeout; cancellation stops both the wait and status request. Catalog metadata separately states whether native video covers frames only or also its embedded audio track; standalone audio input remains the `audio` modality, and both video modes use the provider's same video wire item. Responses history emits assistant text as a completed native message item, preserving its order with reasoning and later media input. Responses tool results preserve the text as a correlated `function_call_output` string and place media in an adjacent user input item because Ark rejects structured `function_call_output.output` values. The enterprise API validates modality claims and limits, uploads provider files with server credentials, and forwards the selected protocol response without converting it. The adapter accepts a Responses function-call item whose initial event omits `arguments`, accumulates subsequent argument deltas, and requires the completed item to contain the final string. It projects reasoning-summary records as DSH reasoning blocks and stores each non-empty encrypted reasoning item with the corresponding native function call in versioned, block-aligned adapter replay state. A later tool round restores those native items in their original order before `function_call_output`; preliminary empty `encrypted_content` values are ignored, while present non-string protocol fields fail closed. The replay state contains neither attachment data nor provider file identifiers. The adapter classifies HTTP 429 as `RATE_LIMIT` and gateway timeouts as `TIMEOUT`, strictly rejects unknown streaming events, and closes attachment reads, uploads, status polling, and the model response on cancellation.

The generated enterprise profile composes this provider with remote SessionPersistence, the enterprise client bridge, and the Web profile. Source tests use the repository's source-resolution map. Native tests with `ENTERPRISE_TEST_KEYCHAIN=1` also require `build:provider` and a root `pnpm run build`; the [profile test](tests/gateway-profile.ts) runs the built provider through `dsh --profile` with a unique Keychain account. Full recorded-session regressions and real-model verification remain required for release acceptance.

The generated profile overrides the Web bundle's existing `agent-presets` entry, retains the shipped presets with `standard` as its default, and adds the organization DSH Home's `.agent-presets` directory for installed plugin presets. This keeps personal preset files out of the organization roster while allowing the managed plugin lifecycle to add and remove Agent compositions.

<a id="remote-session-provider"></a>
## Remote session provider

`pnpm --filter @deepseek-ai/dsh-enterprise-desktop build:persistence` builds the [remote provider](src/session-provider.ts), exported as `@deepseek-ai/dsh-enterprise-desktop/session-persistence`. It implements native create/open/stat/list/flush and read/write handles. Configuration supplies the API origin, Keychain helper/account, request timeout, and response-byte limit. Creation immediately persists an empty Session and claims its writer; closing an empty Session does not erase it. Published events route to the owned handle; flush and close await queued writes. Disposal waits for in-flight opens before closing their handles.

The API acknowledges committed PostgreSQL writes, stores fork-inherited counts separately from events, pages lists and event reads, and binds a writer to the authenticated Runtime. Native reads reconstruct the current logical Session through DSH validators and refuse unknown required events. They currently fetch the complete log before slicing; large-history optimization remains necessary. Appends, idle renewal, and flushes renew the writer lease. Failed renewal or an uncertain append permanently fences that handle; recovery requires closing it, reopening the server log, and inspecting committed state. No automatic replay or local JSONL fallback occurs.

The [API tests](../api/tests/identity.test.ts) exercise native handles with real PostgreSQL, including lost acknowledgements and disposal during creation. With `ENTERPRISE_TEST_KEYCHAIN=1`, they also exercise the built plugin through a named DSH profile and actual Keychain. The shared persistence/live-write suites, periodic idle lease renewal, execution-admission guards, interrupted-action recovery UI, historical-log import, attachments, and search/export remain unverified or incomplete. The generated enterprise profile mounts this provider for desktop sessions.

<a id="enterprise-sandbox"></a>
## Enterprise sandbox

The [enterprise sandbox](src/enterprise-sandbox.ts) wraps the existing `sandbox-local` provider for a named desktop profile. Restricted calls use the platform Seatbelt runner on macOS or the ACL restricted-token runner on Windows, and fail closed when the selected backend is unavailable. The generated desktop profile starts Sessions in `workspace-write`, so the Workbench and agent can update files below the organization workspace while paths outside it remain denied. Consumers pass an absolute workspace root and may select `read-only` for a narrower call. `danger-full-access` remains an explicit user choice outside this provider. The wrapper does not claim network isolation or protection from a local administrator, and the complete desktop profile still needs to mount its consumers.

<a id="dev-note"></a>
## Dev Note

[Acceptance requirements](../../docs/developer/discussion/enterprise-client-acceptance.md) distinguish Web baseline behavior from verified enterprise behavior.
