---
description: "Build and verify the enterprise desktop client for macOS and Windows."
---

# Enterprise desktop client

English | [中文](README.zh.md)

## Summary

This package builds the native 智域OS desktop with a bundled account page and Agent workspace. Sign in through the API, then keep conversations and working files on this computer. Closing and reopening restores the selected local account without requiring a successful cloud response. Cloud models, billing, drive access and plugin management require a valid cloud login; login expiry or revocation does not close the local workspace.

Both desktop distributions use the [shared conversation and Workbench theme](../../packages/client/ui-theme/src/styles/workspace.css) for compact controls, panel tabs and composer actions. Arivo supplies its product palette and fonts through semantic tokens.

Team switching awaits old-runtime shutdown and clears the old credential before selection. A saved team must pass renewed membership validation; selection failure leaves the account selector open. [Team administration](../../docs/developer/enterprise-team-governance.md) defines the server authorization and recovery rules.

Arivo editor departure before Rail, Workbench or explicit Session navigation uses the startup-owned [departure coordinator](src/distribution/arivo-shell/client/departure.ts). Exact frame acknowledgements retain input through a synchronous UI commit; unconfirmed saves and edited open forms retain the current page. `leaveTimeoutMs` bounds the Client wait (default 15000, range 1000–60000). The [native gate](src/distribution/arivo-native-departure.ts) also confirms menu quit and user window close, retaining freezes through runtime stop. Its one-use callback accepts only the current OS origin and request, without general native RPC. `ARIVO_EDITOR_LEAVE_TIMEOUT_MS` bounds native acknowledgement (default 20000, range 1000–60000). Account authority, signals and forced termination remain outside the input guarantee; native platform acceptance is still required. See the [decision](../../.agents/notes/implemented/architecture/2026-10-24-arivo-editor-departure.md).

Arivo Workbench scripts start with version history collapsed and omit the embedded Back action. Script and storyboard panels share an episode list below conversations; storyboard creation also creates its empty script and fixed source in the creative plugin. The startup shell registers this list through `sidebar.footer.action`; its exact-frame bridge forwards create, select, rename, delete and storyboard source-binding intents to the original editor. Script text and persistence authority remain in the creative plugin. Closing or replacing the panel disposes its sidebar contribution.

Arivo conversations write storyboard prompts through the original creative tools. Shots can start without script preparation; the creative plugin atomically associates an empty source and returns the revision for each subsequent write. The editor observes saved Agent changes while preserving unsaved input. See the [authoring decision](../../.agents/notes/implemented/simplification/2026-10-27-arivo-harness-storyboards.md).

Arivo Rail and Settings account entries share the outline user icon. The Arivo profile omits the internal plugin configuration and inventory settings; users manage extensions through the Arivo plugin market.

Arivo Workbench canvases use a separate [canvas list](src/distribution/arivo-shell/client/canvas-rail.ts) in the same sidebar slot below conversations. The exact-frame bridge sends create/open/rename/delete intents to the owning editor; it retains drafts and unconfirmed saves. The editor opens the first canvas, hides duplicate library/Back controls and owns metadata dialogs and confirms logical deletion. Standalone creation keeps its library. See the [decision](../../.agents/notes/implemented/feature/2026-10-26-arivo-canvas-sidebar.md).

## Table of Contents

- [Local macOS installer](#local-macos-installer)
- [Local Windows installer](#local-windows-installer)
- [Desktop updates](#desktop-updates)
- [Installer artifact protection](#installer-artifact-protection)
- [Integration requirements](#integration-requirements)
- [Native model provider](#native-model-provider)
- [Local session storage](#local-session-storage)
- [Enterprise sandbox](#enterprise-sandbox)
- [Dev Note](#dev-note)

The desktop application and DMG volume are named 智域OS; installer filenames use the `zhiyu-os` prefix. The [Web favicon](../web/public/favicon.png) is the prepared silver mark from the [product artwork](../../logo.png), with the wordmark and presentation-sheet examples removed. Desktop builds copy it into the Windows PNG and macOS iconset; the [Admin icon](../admin/app/icon.png) uses the same artwork. Application identity, signed-release identity and existing data directories stay stable to retain installed accounts and workspaces. On the first branded macOS installation, quit the old app, drag `智域OS.app` into Applications, then remove `deepseek-harness-enterprise.app` after confirming the new app works; different filenames do not trigger Finder replacement. Legacy Windows updaters recognize only the old package name and require one manual branded installation; branded updaters validate both names. See the [branding and installation identity decision](../../.agents/notes/implemented/architecture/2026-10-21-zhiyu-desktop-brand.md).

macOS credentials use the `com.zhiyu.os.enterprise` service and the 智域OS label. The helper moves a matching legacy service item on the next read or write while preserving its access controls; sign-out removes both service entries for that account. Windows retains its encrypted credential directory. Technical application identifiers do not identify a model supplier account.

The [distribution identities](src/distribution/config.ts) keep enterprise naming and data paths explicit. Root enterprise build/package commands pin Zhiyu in a child environment and remove Arivo service configuration. Direct enterprise composition builds reject another product selector. Arivo has separate version, installation, data, credential and runtime identities. Its [native builder](scripts/build-arivo.ts) accepts a versioned plugin release through `--plugin-release`; `arivo:build:desktop`, `arivo:package:desktop` and `arivo:verify:desktop` build and check the local macOS product without enterprise account composition. See the [distribution isolation decision](../../.agents/notes/implemented/architecture/2026-10-23-desktop-distribution-isolation.md).

Enterprise development and installer runtime trees both include the published dependencies and peers of dynamically loaded desktop plugins; Arivo stages the CLI production dependencies and its verified plugin artifact in its own output tree. [Runtime dependency selection](../../.agents/notes/implemented/bug-fix/2026-10-23-desktop-dynamic-runtime-dependencies.md) explains why a CLI-only production deployment cannot supply that closure.

The Arivo macOS [bootstrap](native/arivo-bootstrap.c) creates its private Electrobun install root before executing the bundled launcher in the same process. It rejects symlinked, foreign-owned or publicly writable directory components. This lets first launch register the uninstaller without relying on a previous CEF launch; enterprise launchers are unchanged.

Native credential helpers pin their product at compile time: default builds retain Zhiyu Keychain migration and Windows DPAPI paths; Arivo outputs use a separate directory, credential service and data directory without reading legacy enterprise services. LaunchAgent declarations take an explicit product and default to the enterprise label. The [bundled verifier](src/distribution/bundled-plugin.ts) checks the application-pinned manifest digest, release, platform, inventory and file hashes before loading; it rejects links and missing resources without a marketplace lease. The [Arivo supervisor](src/distribution/arivo-runtime.ts) uses the loader before launching an isolated DSH profile. The plugin owns an authenticated loopback workbench and a [native home lock](native/arivo-instance.c) released by the kernel when its Host exits; individual launches use separate profile directories. Local Arivo artifacts are ad-hoc signed, have no active update feed, and load the independently released creative plugin. Arivo account acceptance, Windows installation and formal release trust remain separate requirements.

Arivo retains the complete OS `base` and `web-app` composition. The native window opens the project center; a first-party startup plugin retains the original Agent conversation and adds an Arivo Studio rail entry and namespaced page in the same shell. Switching pages preserves the selected Session and its controller-owned draft. The adapter uses public connection RPC and Slot services to embed the verified creative release; only the exact owning OS loopback origin may frame that release. The startup plugin applies lifecycle-owned Arivo token overrides to the entire OS, including body-mounted dialogs, while preserving the saved light/dark/system preference. Versioned rail entries open local projects, backups and the same Arivo account page; account and runtime pages also occupy Settings sections. The frame receives validated page, language and color-scheme fields; a conversation Workbench also receives its registry-resolved project UUID. The Arivo profile omits the DeepSeek credential onboarding plugin; enterprise profiles retain it. Original tools, presets, subagents, Skills/MCP and settings remain owned by their OS plugins. Arivo marketplace cloud adaptation requires separate acceptance.

The [Arivo language adapter](src/distribution/arivo-shell/host/language-adapter.ts) connects the original Agent to the verified plugin’s native v1 model service. It preserves structured tool history, uses stable Session/step commands, disables automatic paid retries, and distinguishes explicit stop from subscription teardown. Only Arivo routes are admitted in this distribution. Output limits and catalog discovery budgets belong to the startup plugin’s Config. The [adapter decision](../../.agents/notes/implemented/architecture/2026-10-23-arivo-language-adapter.md) records recovery semantics and acceptance limits; The shell exposes no global model/billing configuration page or save RPC. New project conversations use the project’s cloud binding and its saved model preference, or the first available tool-capable model. The [Session Controller](../../packages/api/session-controller/README.md) records a directory-scoped default before the first prompt when no durable selection exists. Existing Sessions and concurrent explicit choices retain their routes; the conversation model menu remains available. Discovery creates no generation or reservation. See the [project default decision](../../.agents/notes/implemented/feature/2026-10-26-arivo-project-model-defaults.md). The private `agentToolRoundtrip` browser fixture exercises an official model, a local write and a correlated follow-up through the packaged profile and real Arivo HTTP. Native-window and crash-recovery acceptance remain separate requirements.

The Arivo builder requires `--api-origin` and `--web-origin` together to embed non-secret account settings. Both require HTTPS or explicit HTTP IPv4 loopback origins; missing configuration fails before building. Arivo requires an online account; local persistence and media computation are not an offline creation mode. `--identity-request-timeout-ms` and `--identity-login-timeout-ms` set bounded native operations. The [Arivo account configuration](src/distribution/arivo-identity.ts) reaches only the verified first-party Host profile, with the Arivo native credential helper. Tokens never belong in build arguments, environment variables or profile files. The independent plugin owns browser PKCE, native credentials, refresh and account-scoped projects; this wiring does not establish real-account acceptance.

An Arivo startup first probes native identity in a temporary profile containing only the verified creative plugin. It then launches the full OS with `$DSH_HOME` under `accounts/<origin-and-user-digest>/agent`; signed-out use retains the existing device home. Sessions, search caches, settings, managed credentials, authored presets and workspace defaults follow that home. Account changes clear the native window, await the entire old Host shutdown and navigate to a newly authenticated Host; no live Agent or UI projection is reused. Local data remains on disk, refresh expiry retains the same local owner, and device drafts are not imported into an account. These directories separate application persistence for one OS user; they do not restrict that user’s explicit access to other local files. Real cloud-account, native switching and Windows acceptance remain required.

Arivo [creative tools](src/distribution/arivo-shell/host/studio-tools.ts) expose the verified plugin’s scoped script, storyboard and [canvas](src/distribution/arivo-shell/host/canvas-tools.ts) use cases through the original Harness tool registry. The startup Client contributes a closable Workbench panel beside conversations. The [folder binding decision](../../.agents/notes/implemented/architecture/2026-10-25-arivo-project-folder-binding.md) ties creative tools and the conversation Workbench to the original Session directory. Unified creation joins a selected folder and authorized online project through the verified plugin, then registers that directory with the original Workspace Registry; recovery reuses the same command without another chooser. The plugin owns project-folder data routing; Harness owns ordinary conversation storage. Both panes read the same local records; cloud model execution remains authenticated and metered. See the [decision](../../.agents/notes/implemented/architecture/2026-10-24-arivo-creative-tools.md).

<a id="local-macos-installer"></a>
## Local macOS installer

Use Apple Silicon macOS with Bun, Xcode Command Line Tools, workspace dependencies and the pinned Electrobun SDK projection from desktop development. Run the following command from the repository root. It rebuilds the workspace libraries, desktop frontend, plugins, native helper and packaged runtime, then writes `apps/electrobun/artifacts/local/zhiyu-os-<version>-macos-arm64-local.dmg` and its SHA-256 sidecar. The version comes from this application's package manifest. Official Node checksums and runtime archives are cached per product and Node version; uncached files require nodejs.org access. Every archive is checked against its official SHA-256 before extraction; incomplete downloads are not published to the cache. Build staging uses a separate Electrobun project, so an active development app does not hold the installer build lock.

```sh
pnpm run enterprise:package:desktop
pnpm --filter @deepseek-ai/dsh-enterprise-desktop verify:installer
```

The verifier mounts the DMG read-only, copies the app into a private temporary Applications directory outside the checkout, checks its signature and protected resources, and boots the packaged enterprise Web profile with a local fake API and credential helper. It covers both configured and empty model catalogs, authenticated HTML and runtime shutdown without a model key. The temporary installation is removed afterward. To install for interactive use, open the DMG, drag the app to Applications and launch it. Set only `ENTERPRISE_API_URL` in the installer build environment to select the API. The builder validates HTTPS origins or explicit HTTP loopback origins and embeds them in the main process, so Finder launches use the selected deployment without terminal environment variables. Omitting it selects `http://127.0.0.1:8787`. Source development still reads its launch environment. Packaged account and model operations use the selected API; conversation storage, task execution and workspaces remain local.

The local command uses an ad-hoc signature. A downloaded copy may require explicit approval in macOS Privacy & Security before its first launch. This package validates installation on the build machine; it does not establish Gatekeeper trust, Intel compatibility, or clean-machine native-module portability.

### Signed macOS release

For Developer ID distribution, install a Developer ID Application certificate with its private key and store Apple notarization credentials with `xcrun notarytool store-credentials`. Set the following environment variables in the release terminal. Use the certificate identity and team from your developer account; the profile names an existing Keychain entry. `DSH_MACOS_KEYCHAIN` is optional and selects an explicit keychain for signing and notarization. Retain the deployment and update-feed settings described below.

~~~sh
export DSH_MACOS_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID1234)"
export DSH_MACOS_TEAM_ID="TEAMID1234"
export DSH_MACOS_NOTARY_PROFILE="your-notary-profile"
export DSH_MACOS_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
pnpm --filter @deepseek-ai/dsh-enterprise-desktop build:installer:release
~~~

The release command checks Keychain authentication, builds and protects the app, signs nested native code with hardened runtime and secure timestamps, verifies the packaged profiles, signs the DMG, and uploads it once. It writes `artifacts/release/zhiyu-os-<version>-macos-arm64.dmg` with a `.notary.json` tracking file and refuses an existing release path. Increment the application package version for each new build. Signing processes nested components before their containers without `--deep`. Release entitlements exclude `get-task-allow` and permit the bundled Node/Bun JIT and native libraries.

If Apple returns `In Progress`, the command exits with the submission ID saved. Keep the same settings and run the following command again later; it queries that ID and never uploads. Apple provides no cancellation command for an uploaded submission. An uncertain upload failure keeps a `submitting` record: recover its ID through `notarytool history` before continuing, rather than deleting the record and uploading again. An interrupted finalization may leave `.notary-lock`; confirm no notarization command is running before removing that lock directory.

~~~sh
pnpm --filter @deepseek-ai/dsh-enterprise-desktop notarize:installer /absolute/path/to/release.dmg
~~~

On acceptance, the command saves Apple's audit log, staples and validates the ticket, checks Developer ID signatures and Gatekeeper acceptance for the DMG and a copied application, then replaces the DMG and SHA-256 sidecar with the verified final bytes. A `verified` tracking status marks completion. Rejection saves the log and fails; subsequent queries stop polling that completed submission. A changed DMG fails validation. Sign the [update metadata](#desktop-updates) only after completion because stapling changes the installer's bytes. The script does not publish files or guarantee Apple's processing time. See the [notarization decision](../../.agents/notes/implemented/process/2026-10-21-macos-release-notarization.md).

<a id="local-windows-installer"></a>
## Local Windows installer

Build on an x64 Windows host with Node.js 22.19.x or 24+, pnpm, Bun, and either Zig or Visual Studio C++ Build Tools with the Windows SDK. The first Electrobun preparation and an uncached official Node runtime download require network access. From the repository root, install workspace dependencies and run:

~~~sh
pnpm install
pnpm run enterprise:package:desktop
pnpm --filter @deepseek-ai/dsh-enterprise-desktop verify:installer
~~~

The build writes `apps/electrobun/artifacts/local/zhiyu-os-<version>-windows-x64-local.zip` and its SHA-256 sidecar. The ZIP contains `智域OS-Setup.exe` and a `.installer/` directory with its metadata and compressed application payload. Extract the entire ZIP and run Setup.exe from the extracted directory so the installer can read `.installer/`. The verifier checks the sidecar, x64 PE header, stable application metadata and Zstandard payload. Before creating the ZIP, the build obfuscates first-party JavaScript and smoke-tests the packaged profile against a local fake API.

`verify:installer` checks the archive contents but does not run the Setup.exe interface. Complete an interactive install check on an x64 Windows machine. The Windows build does not add an Authenticode signature or publisher identity, so it does not establish trusted publisher status or clean-machine native-module portability.

<a id="desktop-updates"></a>
## Desktop updates

Choose **Check for updates** under **Settings → General → Software updates**, or **Check for updates…** from the native application menu. Both entry points use the same native updater. A signed release shows its version and publisher notes before download. The app streams the full installer, verifies its exact size and SHA-256, and asks again before stopping local tasks and opening the installer. The menu can cancel a transfer. Declining installation deletes that download; another check downloads it again. Downloads and installation run only on request.

Windows expands the complete ZIP and opens Setup.exe with its adjacent payload. On macOS, drag the app from the opened DMG to Applications and confirm replacement. Reopen the app after installation. Account credentials and organization data live outside the application bundle. Successful handoff keeps its private temporary installer directory available to Setup or the disk image; temporary-directory cleanup is left to the operating system. Neither platform performs a silent replacement, delta update, automatic restart or data downgrade.

### Publisher setup

Keep an Ed25519 private key outside the checkout and build inputs. From this app directory, run the following command with an existing secure parent directory. It prints a new private directory containing `release-private.pem` and `release-public.txt`; retain the same key for subsequent releases. Windows inherits the parent directory’s access permissions, so choose a directory restricted to the release operator:

~~~sh
pnpm run keygen:update --directory /secure/desktop-releases
~~~

Before running the installer build, set `DSH_DESKTOP_UPDATE_URL` to the target's HTTPS feed URL and `DSH_DESKTOP_UPDATE_PUBLIC_KEY` to the contents of `release-public.txt` in the build environment. Use a separate feed for `darwin-arm64` and `win32-x64`. The installer build validates and embeds both values in the native executable; an installed build cannot redirect the feed through environment variables. Omitting both disables updates; supplying only one fails the build. Public-key rotation requires installing a build that trusts the replacement key.

Increment the version in this app's package manifest, build and verify the installer for each host platform, then sign its metadata. From this app directory, the following example signs a Windows release; replace the paths and HTTPS URL with the verified artifact and public download location. For macOS, select `darwin-arm64` and the DMG instead:

~~~sh
pnpm run sign:update --artifact /path/to/installer.zip --url https://updates.example.com/installer.zip --target win32-x64 --notes /path/to/release-notes.txt --key /secure/release-private.pem --output /path/to/latest-win32-x64.json
~~~

The signer takes the package version, artifact size/hash and UTF-8 notes, emits a base64 payload with an Ed25519 signature, and refuses to overwrite an existing output. For Admin publication, set the installer URL to `ENTERPRISE_API_URL/desktop/updates/<target>/<version>/installer`, save the output as `<installer>.update.json`, and select both files at `/platform/desktop-releases`. Build clients with `DSH_DESKTOP_UPDATE_URL=ENTERPRISE_API_URL/desktop/updates/<target>/latest` and deploy the same public key in the [API release settings](../api/README.md#desktop-releases). The feed reports no available update before the first release is published. Static hosting also works: upload the immutable installer first, then publish the signed JSON at the embedded feed URL. Both URLs and redirects require HTTPS without embedded credentials or fragments; public static hosting is sufficient. The client rejects invalid signatures, malformed fields, platform mismatches and equal or older semantic versions. Feed reads time out after 30 seconds and transfers/extraction after 30 minutes; cancellation and quit await active I/O. Each launch checks once in the background without delaying account restoration. A verified newer version appears in a persistent, closable notification on the account page or workspace; Install update opens the same confirmation flow. Dismissal lasts for that launch across navigation and windows. Current versions, missing configuration and failed startup checks stay silent; Settings and the native menu remain available for manual checks.

The release signature authenticates updates for clients that already trust the pinned key. It does not establish first-install trust, Apple notarization or Windows publisher trust. The native shell typechecks, signed-feed/download tests and owner-local dialog expectations cover this flow; interactive Setup, DMG replacement and clean-machine upgrades remain platform-host acceptance work. See the [update decision](../../.agents/notes/implemented/architecture/2026-10-20-signed-desktop-updates.md).

<a id="installer-artifact-protection"></a>
## Installer artifact protection

The macOS and Windows installers obfuscate first-party JavaScript in the main process, frontend, bundled plugins and runtime dependency tree. Each package includes the official Node runtime for its build host, checked against Node’s published SHA-256 checksum with its license. The macOS launcher replaces itself with Node; the Windows launcher starts Node in a kill-on-close Job Object so the runtime stops with its desktop owner.

The runtime dependency tree excludes the API server because the enterprise client bundles its API contracts. The build removes TypeScript, source maps, source-map comments, native source files and `.env` files from staged resources. Third-party JavaScript remains executable and third-party licenses remain in the dependency tree. Generated identifiers have independent per-resource prefixes for concatenated Client scripts. Escaped string literals resolve at parse time, avoiding generated string decoders during rendering. Public exports, property names and reflective service names remain stable. `protection.json` records protected module hashes; verification rejects added, changed or missing first-party scripts and leaked source/debug files. These measures increase reverse-engineering effort; they do not encrypt browser code, hide public protocols, protect embedded secrets or prevent a local administrator from inspecting executable logic. See the [packaging decision](../../.agents/notes/implemented/architecture/2026-10-19-local-desktop-installer-protection.md).

<a id="integration-requirements"></a>
## Integration requirements

The enterprise client reuses the shared Web client packages and visual language through its own `frontend/` entry, while the local runtime composes the [Web profile](../../packages/bundle/web-app/cordis.patch.yml). Both desktop overlays disable the inherited `ui-trajectory` plugin. Electrobun ships that frontend in its own resources and does not load `apps/web/dist`. An unrestricted personal profile must not be presented as a governed enterprise runtime. The backend API alone does not constrain a local model provider or dynamic plugin loader.

The [native login](src/desktop-auth.ts) uses S256 PKCE and a single-use, state-checked loopback callback. Native account requests use only the API origin. macOS Keychain and Windows DPAPI helpers receive credentials through stdin; tokens and API cookies never enter the WebView. [DesktopSession](src/desktop-session.ts) restores the saved account and starts the [runtime supervisor](src/runtime.ts) without contacting the API. The supervisor requires an absolute executable and a provisioned `enterprise-desktop` profile, strips inherited credentials, and waits for process shutdown. Windows owns Node in a kill-on-close Job Object.

Closing the app preserves the credential and a deployment-scoped locator in platform credential storage. Startup permits reading local history even when cloud authorization has expired. Logout stops the runtime, attempts cloud revocation, and removes both credential records while retaining local files. Account cookies remain native and in memory; organization switching can require login. The [account entry](../../packages/client/ui-enterprise-account/README.md#use-this-package) presents SaaS team creation or private-company entry from deployment policy.

The desktop bundles CEF Chromium for sandboxed native browser guests. The trusted application shell uses the native renderer. [`browser-config.ts`](src/browser-config.ts) configures loopback CDP (default port `9333`, build/runtime environment `DSH_DESKTOP_CDP_PORT`); the organization profile attaches Playwright to that endpoint. The [Workbench browser](../../packages/client/ui-workbench/README.md) renders the exact page controlled by Agent tools. [`browser-lifecycle.ts`](src/browser-lifecycle.ts) vetoes the extra parent-window close request emitted by Electrobun 2.0.1 when removing a loaded CEF guest on macOS.

The native account entry server accepts request headers up to 64 KiB and expires stale `dsh-auth-*` cookies on its HTML response. This allows a desktop window with cookies from previous Runtime ports to reach the login page and complete cleanup before loading the authenticated Web UI.

The [LaunchAgent helper](src/launch-agent.ts) replaces only application-owned registrations. [EnterpriseRuntimeController](src/runtime-controller.ts) serializes start and stop, includes the account-scoped `DSH_HOME` in login-start launches, and cleans up failed registration. Account identity combines the deployment origin, account ID and organization ID; login-token replacement preserves the same workspace and Workbench partitions. Device authorization has no quota or heartbeat. Cloud requests check membership, revocation and server expiry, and renew active authorization when needed.

`typecheck:runtime` checks Node helpers and tests; `typecheck` checks the native shell against the pinned SDK. Native Keychain tests require `build:native` and `ENTERPRISE_TEST_KEYCHAIN=1`. Electrobun stages the DSH executable, native helper, frontend and plugin artifacts. Shared Cordis and MCP runtime packages remain external and ship in one dependency tree to preserve service identity. `verify:build` imports the copied Host entry with isolated plain Node resolution and rejects dependencies outside the app. Clean-machine native-module portability remains release acceptance work.

The native quit guard vetoes Electrobun’s synchronous `before-quit` event until windows, account services and the owned runtime have stopped; a cleanup failure keeps quit retryable.

Arivo [real image acceptance](../web/tests/arivo-images.e2e.ts) consumes private opt-in desktop grants and exercises normal creative controls through the packaged Host; the [acceptance decision](../../.agents/notes/implemented/testing/2026-10-23-arivo-bundled-image-acceptance.md) distinguishes paid runs from explicit poll-only reconstruction.

Arivo [packaged tool recovery](../web/tests/arivo-tool-recovery.e2e.ts) checks interrupted Bash effects and ordinary history continuation through unpaid cloud responses. Its [acceptance decision](../../.agents/notes/implemented/testing/2026-10-23-arivo-bundled-image-acceptance.md) defines signal scope and platform limitations.

<a id="native-model-provider"></a>
## Native model provider

`pnpm --filter @deepseek-ai/dsh-enterprise-desktop build:provider` builds the [gateway plugin](src/gateway-provider.ts), exported as `@deepseek-ai/dsh-enterprise-desktop/gateway`. It checks credential binding and fetches authorization and enabled model IDs when a cloud operation needs them. The API relays Chat, Responses and Files requests under `/model/*` using server-owned provider credentials. Each request selects a platform model ID; the adapter allows the API model deadline plus transport grace time.

The [request and stream projection](src/gateway-wire.ts) maps DSH messages to either OpenAI Chat Completions or Responses according to the selected catalog entry. It resolves durable images, video, audio, and documents through the attachment service; provider-file policies use the shared `llm-files` coordinator, while bounded inline policies emit request-local Base64. Media reads use the profile's `maxMediaBytes` limit, separate from the `maxResponseChars` limit for model output and gateway metadata. When a Files API upload remains in a processing state, the adapter polls its native `/files/:id` resource at the configured interval until the file is ready, fails, or reaches the model's upload timeout; cancellation stops both the wait and status request. Catalog metadata separately states whether native video covers frames only or also its embedded audio track; standalone audio input remains the `audio` modality, and both video modes use the provider's same video wire item. Responses history emits assistant text as a completed native message item, preserving its order with reasoning and later media input. Responses tool results preserve the text as a correlated `function_call_output` string and place media in an adjacent user input item because Ark rejects structured `function_call_output.output` values. The enterprise API validates modality claims and limits, uploads provider files with server credentials, and forwards the selected protocol response without converting it. The adapter accepts a Responses function-call item whose initial event omits `arguments`, accumulates subsequent argument deltas, and requires the completed item to contain the final string. It projects reasoning-summary records as DSH reasoning blocks and stores each non-empty encrypted reasoning item with the corresponding native function call in versioned, block-aligned adapter replay state. A later tool round restores those native items in their original order before `function_call_output`; preliminary empty `encrypted_content` values are ignored, while present non-string protocol fields fail closed. The replay state contains neither attachment data nor provider file identifiers. The adapter classifies HTTP 429 as `RATE_LIMIT` and gateway timeouts as `TIMEOUT`, strictly rejects unknown streaming events, and closes attachment reads, uploads, status polling, and the model response on cancellation.

The generated enterprise profile composes this provider with local JSONL Session persistence, the enterprise client bridge and the Web profile. The [profile test](tests/gateway-profile.ts) exercises the built provider through `dsh --profile`; real Keychain checks require `ENTERPRISE_TEST_KEYCHAIN=1`.

Both desktop profiles select the capability-complete `cordis` Bot by default and disable `standard`, `ptc` and `minimal` for new selections. Bot management keeps the organization DSH Home's `.agent-presets` directory available for locally authored and installed plugin Bots. Historical sessions retain their recorded preset and can resume it.

<a id="local-session-storage"></a>
## Local session storage

The desktop keeps the base profile’s [JSONL provider](../../packages/session/session-persistence-jsonl/README.md). Its home is `dataRoot/accounts/<identity>/organizations/<organizationId>`; the identity hashes the API origin, account ID and organization ID. Session events, workspace files and browser state stay within that account’s storage. Reopening and reading history need no cloud request or writer lease. Back up these files; deleting them loses local history.

Open **Settings → Enterprise account → Cloud conversation sync** to upload all local conversations or download cloud conversations. On another device, sign in to the same account and organization and download to continue. Transfers retain longer identical histories and stop on divergence without overwriting existing records. Completed pages survive interruption; retry resumes safely. Close a conversation before downloading a longer cloud history into it. Only conversation events transfer; attachments and working files stay on their original device. Computers do not synchronize automatically. The [client README](../../packages/client/ui-enterprise/README.md#mounting) owns transfer semantics.

The remote [SessionPersistence adapter](src/session-provider.ts) remains available for explicit archive-service consumers and API tests; the desktop profile does not mount it. Its server writer leases protect remote writes only. See the [local-session decision](../../.agents/notes/implemented/architecture/2026-10-22-local-desktop-sessions.md) for authorization and storage tradeoffs.

<a id="enterprise-sandbox"></a>
## Enterprise sandbox

The [enterprise sandbox](src/enterprise-sandbox.ts) wraps the existing `sandbox-local` provider for a named desktop profile. Restricted calls use the platform Seatbelt runner on macOS or the ACL restricted-token runner on Windows, and fail closed when the selected backend is unavailable. The generated desktop profile starts Sessions in `workspace-write`, so the Workbench and agent can update files below the organization workspace while paths outside it remain denied. Consumers pass an absolute workspace root and may select `read-only` for a narrower call. `danger-full-access` remains an explicit user choice outside this provider. The wrapper does not claim network isolation or protection from a local administrator, and the complete desktop profile still needs to mount its consumers.

<a id="dev-note"></a>
## Dev Note

[Acceptance requirements](../../docs/developer/discussion/enterprise-client-acceptance.md) distinguish Web baseline behavior from verified enterprise behavior.

Upgrade note: migration `0039_local_desktop_sessions` replaces device-lease expiry with login expiry and removes device quotas. Credentials without an account ID require one login. Existing cloud conversations remain available through the explicit import action; old local runtime directories are preserved and are not adopted into another account.

The Arivo Rail includes a dedicated Tasks surface after Studio. The fixed embedded page is owned by the built creative plugin, which selects cloud projects and reads authorized task pages. The [task-entry decision](../../.agents/notes/implemented/feature/2026-10-26-arivo-task-rail.md) defines ownership and validation.

Arivo publishes Generation, Script, Story bible, Storyboard, Canvas and Asset library directly on Workbench Start. Each card uses the shared 32px Arivo icon specification and opens the current Session folder’s exact project view through the authenticated embedded route. Missing project bindings fail visibly; editor departure coordination applies to every panel.
