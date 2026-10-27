# Development index

Arivo [canvas sidebar management](../apps/electrobun/src/distribution/arivo-shell/client/canvas-rail.ts) registers below conversations and forwards metadata-only create/open/rename/delete intents to the separately built creative editor. [Bridge regressions](../apps/electrobun/tests/arivo-canvas-rail.test.ts) own binding/disposal checks; [packaged Workbench acceptance](../apps/web/tests/arivo-workbench-direct.e2e.ts) owns creation, switching and retained input.

Arivo [managed trigger composition](../apps/electrobun/src/distribution/arivo-shell/host/triggers.ts) reuses the original runtime and [shared editor](../packages/client/ui-enterprise/src/client/triggers.tsx); [native RPC regressions](../apps/electrobun/tests/arivo-triggers.test.ts) own account and project-model checks.

Arivo creative Start cards and icons are owned by [workbench-entries](../apps/electrobun/src/distribution/arivo-shell/client/workbench-entries.ts); `ui-workbench` owns passive panel registration and the startup Host resolves each direct view from the current Session project folder.

English | [中文](development-index.zh.md)

This index is the repository navigation reference for AI agents and contributors. It maps directory layers to their source owners, runtime entry points, tests, and governing documents. It is a lookup aid, not a replacement for package READMEs, architecture documents, generated catalogs, or source code.

The client-only [palette](../packages/client/ui-theme/src/styles/client-palette.css) maps Arivo’s neutral surfaces to semantic aliases after the shared Admin roles. Shared [conversation and Workbench presentation](../packages/client/ui-theme/src/styles/workspace.css) consumes semantic UI attributes for Web, 智域OS and Arivo; the [startup acceptance](../apps/web/tests/arivo-startup.e2e.ts) verifies product tab/menu behavior and both palettes.

Chat rail virtualization and active-Turn lookup belong to [TurnNavigator](../packages/client/ui-chat/src/client/chat/TurnNavigator.tsx) and [visible-turn](../packages/client/ui-chat/src/client/chat/visible-turn.ts); [navigator tests](../packages/client/ui-chat/tests/turn-navigator.client.spec.tsx), [geometry tests](../packages/client/ui-chat/tests/visible-turn.client.spec.ts), and [browser scroll acceptance](../apps/web/tests/chat-scroll-contract.e2e.ts) own their regressions. [Recorded Chat core acceptance](../apps/web/tests/chat-core-upgrade.e2e.ts) owns tool-disclosure ARIA expectations with Trajectory enabled or disabled. The opt-in [switch benchmark](../apps/web/tests/complex-history.perf.ts) accepts `DSH_PERF_PACKAGED_RESOURCES` pointing to a staged or installed `app` directory and reports plugin lifecycle counts alongside browser timings. Deferred history segments and measured remount geometry belong to [LazyChatHistory](../packages/client/ui-chat/src/client/chat/LazyChatHistory.tsx); [Chat view regressions](../packages/client/ui-chat/tests/chat-view.client.spec.tsx) cover thousand-Turn initial mounts, reveal, selection, and saved reading positions. [Thousand-Turn browser acceptance](../apps/web/tests/chat-lazy-history.e2e.ts) owns the restored-head snapshot and complete Select All behavior. `DSH_PERF_HISTORY_TURNS` selects larger benchmark histories in multiples of 100, starting at 1,000.

Client settings navigation and theme previews belong to [settings-general](../packages/client/ui-settings-general/README.md) and [ui-theme](../packages/client/ui-theme/README.md). The [enterprise views](../packages/client/ui-enterprise/src/client/enterprise.tsx) own market and drive layouts; [market-illustration](../packages/client/ui-enterprise/src/client/market-illustration.ts) bundles the exported design asset. The [retained design decision](../.agents/notes/implemented/architecture/2026-10-27-client-settings-design-alignment.md) links design scope and browser validation.

## Table of Contents

- [Use this index](#use-this-index)
- [Index layers](#index-layers)
- [Repository roots](#repository-roots)
- [Runtime paths](#runtime-paths)
- [Package groups](#package-groups)
- [File conventions](#file-conventions)
- [Maintenance](#maintenance)

-----

## Use this index

Before changing code:

1. Identify the affected change type in [Runtime paths](#runtime-paths), then locate its package group in [Package groups](#package-groups).
2. Read the linked package or subsystem README, the nearest `AGENTS.md`, the architecture page when `packages/` is involved, and the target source and tests.
3. Trace generated catalogs, session snapshots, SDK projections, and package consumers named by the owner documents before editing a shared contract.
4. Select focused checks from the owning package and [the contributor reference](development.md); do not infer behavior from this index.

After changing code or repository structure:

1. Update this index when a directory, package, entry point, source owner, test owner, generated artifact, or development path changed.
2. Update the owning README, subsystem page, JSDoc, snapshots, or Agent Note required by the changed contract; this index only records navigation facts.
3. Repair links and remove paths that no longer exist. Keep generated pages owned by their generators.
4. Reconfirm the English/Chinese pair and run `pnpm run test:docs`, `pnpm run doc-sync`, and `git diff --check` when the change is documentation-facing.

-----

## Index layers

| Level | Lookup question | Source of truth |
| --- | --- | --- |
| 0. Repository | Which top-level area owns the concern? | This page and the root `AGENTS.md` |
| 1. Application | Which supported application or runtime launches it? | `apps/*/package.json`, app source, and [architecture](architecture.md) |
| 2. Capability group | Which `packages/<group>/` owns the service, provider, or consumer? | The group README and [packages/README.md](../packages/README.md) |
| 3. Package | Which `packages/<group>/<package>/` owns the implementation? | The package `package.json`, `src/`, `tests/`, and README |
| 4. File | Which entry, type, test, fixture, or generator must be read? | The file and its nearest `AGENTS.md` |

-----

## Repository roots

| Path | Responsibility | First files to read |
| --- | --- | --- |
| `apps/` | Supported application entry points and private application hosts. | [`apps/cli/src/bin.ts`](../apps/cli/src/bin.ts), [`apps/api/src/index.ts`](../apps/api/src/index.ts), app `package.json`, and app `AGENTS.md` files |
| `packages/` | Published and private Cordis plugins, services, providers, consumers, and support packages. | [Package group map](../packages/README.md), [architecture](architecture.md), `packages/<group>/README.md`, and `packages/AGENTS.md` |
| `native/` | Native source of record and packaged Landlock runner. | [`native/README.md`](../native/README.md), [`native/landlock-run/AGENTS.md`](../native/landlock-run/AGENTS.md) |
| `python/` | Python SDK and bundled runtime. | [`python/README.md`](../python/README.md), [`python/development.md`](../python/development.md) |
| `scripts/` | Build, generation, validation, release, documentation, and test orchestration. | [`scripts/AGENTS.md`](../scripts/AGENTS.md), [`scripts/run-gates.ts`](../scripts/run-gates.ts), and the named script |
| `docs/` | Architecture, subsystem contracts, contributor guides, generated references, and postmortems. | [`docs/AGENTS.md`](AGENTS.md), then the owning page |
| `website/` | VitePress projection of the explicitly published documentation allowlist. | [`website/AGENTS.md`](../website/AGENTS.md), [`website/docs.ts`](../website/docs.ts) |
| `snapshots/` | Recorded session, SDK, web, and ACP expected outputs. | [`snapshots/AGENTS.md`](../snapshots/AGENTS.md), then the snapshot owner named by the test |
| `vendor/` | Pinned upstream Cordis source copies. | [`vendor/README.md`](../vendor/README.md), [`vendor/AGENTS.md`](../vendor/AGENTS.md) |
| `.agents/` | Reusable agent workflows and active decision records. | [Agent Note rules](../.agents/notes/README.md), then the named skill or note |
| `infra/` | Enterprise deployment and infrastructure material. | The nearest README or `AGENTS.md` under `infra/` |

The root `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `vitest*.config.ts`, and `scripts/run-gates.ts` define workspace membership, compiler faces, test partitions, and gate ownership. Read those files when a change affects tooling or repository-wide execution.

-----

## Runtime paths

[Project folder controls](../apps/electrobun/src/distribution/arivo-shell/host/project-folders.ts) connect unified folder/cloud project creation and recovery to the original Workspace Registry; the [Client listener](../apps/electrobun/src/distribution/arivo-shell/client/project-folders.ts) rejects arbitrary iframe paths. Workbench resolves the current Session folder before opening its project. [Packaged creation acceptance](../apps/web/tests/arivo-project-creation.e2e.ts) exercises cancellation, cloud creation, existing-folder adoption and restart. See the [decision](../.agents/notes/implemented/architecture/2026-10-25-arivo-project-folder-binding.md).

The [Arivo topbar](../apps/electrobun/src/distribution/arivo-shell/client/topbar.ts) projects the original OS topbar runtime, including Session and panel controls, with product presentation. The native builder consumes the public creative release’s offline `theme.css`; the startup theme maps OS roles to its shared Web palette. See the [appearance decision](../.agents/notes/implemented/architecture/2026-10-24-arivo-shared-appearance.md).

[Packaged Arivo image acceptance](../apps/web/tests/arivo-images.e2e.ts) owns the opt-in real-cloud project, quote, download and offline backup path; its private fixture is supplied by the isolated cloud orchestrator.

[Packaged Arivo tool recovery](../apps/web/tests/arivo-tool-recovery.e2e.ts) owns Bash interruption, persisted unknown outcomes and normal history continuation; see the [acceptance decision](../.agents/notes/implemented/testing/2026-10-23-arivo-bundled-image-acceptance.md). These Host-only acceptance specs are checked by `tsconfig.host.json` and excluded from the Web client project.

Product plugin-market composition belongs to the [Host adapter](../packages/client/ui-enterprise/src/market-host.ts), [Client adapter](../packages/client/ui-enterprise/src/client/market.tsx) and [archive verifier](../packages/plugin/protocol/src/archive.ts). The [decision](../.agents/notes/implemented/architecture/2026-10-26-product-plugin-market.md) owns native authentication and execution/display catalog separation.

Arivo native composition and installed-artifact verification are owned by [the desktop builder](../apps/electrobun/scripts/build-arivo.ts), [macOS bootstrap](../apps/electrobun/native/arivo-bootstrap.c), [native supervisor](../apps/electrobun/src/distribution/arivo-runtime.ts) and [DMG verifier](../apps/electrobun/scripts/verify-arivo.ts). Desktop product selection is owned by the [distribution configuration](../apps/electrobun/src/distribution/config.ts), [child build wrapper](../apps/electrobun/scripts/run-distribution.ts) and [product inputs](../apps/electrobun/distributions); [distribution tests](../apps/electrobun/tests/distribution.test.ts) enforce the [identity decision](../.agents/notes/implemented/architecture/2026-10-23-desktop-distribution-isolation.md). The [startup Host adapter](../apps/electrobun/src/distribution/arivo-shell/host/index.ts) and [Client adapter](../apps/electrobun/src/distribution/arivo-shell/client/index.ts) add creative navigation to the original OS shell; [packaged browser acceptance](../apps/web/tests/arivo-startup.e2e.ts) owns that composition. Arivo builds require explicit Web/API origins; missing service configuration fails before building. Arivo account settings are validated by [the account configuration](../apps/electrobun/src/distribution/arivo-identity.ts) and embedded only by its native builder; the supervisor passes non-secret settings and its product-specific credential helper to the independent plugin. Creative iframe geometry belongs to the [startup theme](../apps/electrobun/src/distribution/arivo-shell/client/theme.ts); its active page reserves only the permanent OS rail.

[Creative tools](../apps/electrobun/src/distribution/arivo-shell/host/studio-tools.ts) register local script, storyboard and [canvas operations](../apps/electrobun/src/distribution/arivo-shell/host/canvas-tools.ts) in the original Harness registry. [Creative product checks](../apps/web/tests/arivo-studio-acceptance.ts) read the same data through Workbench; see the [decision](../.agents/notes/implemented/architecture/2026-10-24-arivo-creative-tools.md).

Arivo Agent language mapping is owned by [the native LLM adapter](../apps/electrobun/src/distribution/arivo-shell/host/language-adapter.ts) and [structured event mapping](../apps/electrobun/src/distribution/arivo-shell/host/language-mapping.ts). [Bridge regressions](../apps/electrobun/tests/arivo-language.test.ts) own loop integration and stop/disposal behavior; the [hard-crash subprocess fixture](../apps/electrobun/tests/fixtures/arivo-tool-crash.ts) exercises checkpointed effects and unknown-outcome recovery; [recorded-session replay](../snapshots/session/arivo-native-agent/snapshot.yml) owns the shipped headless composition and final local file effect. [Project catalogs](../apps/electrobun/src/distribution/arivo-shell/host/session-catalog.ts) and the Session Controller default resolver own automatic project selection; the [decision](../.agents/notes/implemented/feature/2026-10-26-arivo-project-model-defaults.md) records removal of global manual configuration; [product browser acceptance](../apps/web/tests/arivo-models.e2e.ts) exercises real scoped cloud HTTP through the packaged profile.

Arivo Agent account directories are owned by [the scope selector](../apps/electrobun/src/distribution/arivo-account-scope.ts); [runtime regressions](../apps/electrobun/tests/arivo-runtime.test.ts) exercise native-credential scope handshakes, full Host replacement and persisted Session/preset isolation. The creative plugin emits only a versioned non-secret scope after durable credential changes; the native supervisor selects every DSH home.

Use the row that describes the behavior being changed. Read every path in the row before editing a shared interface.

| Change type | Read first | Related tests and docs |
| --- | --- | --- |
| Application launch or profile composition | [`apps/cli/src/bin.ts`](../apps/cli/src/bin.ts), [`apps/cli/src/profile-boot.ts`](../apps/cli/src/profile-boot.ts), [`packages/boot/app-boot/src`](../packages/boot/app-boot/src), [`packages/bundle`](../packages/bundle) | [Application launch](architecture.md), [profile docs](../apps/cli/composition.md), `apps/cli/tests/`, snapshot profiles |
| Desktop account authentication through the API | [`local-account.ts`](../apps/electrobun/src/local-account.ts), [`desktop-auth.ts`](../apps/electrobun/src/desktop-auth.ts), [`desktop-session.ts`](../apps/electrobun/src/desktop-session.ts), [`API origin settings`](../apps/api/src/config.ts) | [Desktop integration](../apps/electrobun/README.md#integration-requirements), [`desktop-auth.test.ts`](../apps/electrobun/tests/desktop-auth.test.ts), [`desktop-session.test.ts`](../apps/electrobun/tests/desktop-session.test.ts), [`container-initialization.test.ts`](../apps/api/tests/container-initialization.test.ts), [`account request expectations`](../apps/api/tests/expected/desktop-account.json) |
| Desktop local conversations, manual cloud transfers and login expiry | [`desktop-session.ts`](../apps/electrobun/src/desktop-session.ts), [`login-session.ts`](../apps/api/src/login-session.ts), [`session-import.ts`](../packages/client/ui-enterprise/src/session-import.ts) | [Local storage](../apps/electrobun/README.md#local-session-storage), [transfer tests](../packages/client/ui-enterprise/tests/session-import.test.ts), [settings replay](../snapshots/web/enterprise-settings/snapshot.yml) |
| Enterprise native quit and owned Host shutdown | [`apps/electrobun/src/index.ts`](../apps/electrobun/src/index.ts), [`shutdown.ts`](../apps/electrobun/src/shutdown.ts), [`runtime.ts`](../apps/electrobun/src/runtime.ts) | [Desktop README](../apps/electrobun/README.md), [`shutdown.test.ts`](../apps/electrobun/tests/shutdown.test.ts), [`runtime.test.ts`](../apps/electrobun/tests/runtime.test.ts) |
| Desktop installer and artifact protection | [`macOS launcher`](../apps/electrobun/native/runtime-launcher.c), [`Windows launcher`](../apps/electrobun/native/runtime-launcher-windows.c), [`Windows credential helper`](../apps/electrobun/native/keychain-windows.c), [`desktop-config.ts`](../apps/electrobun/scripts/desktop-config.ts), [`compile-windows-native.ts`](../apps/electrobun/scripts/compile-windows-native.ts), [`run-pnpm.ts`](../apps/electrobun/scripts/run-pnpm.ts), [`build-installer.ts`](../apps/electrobun/scripts/build-installer.ts), [`macos-signing.ts`](../apps/electrobun/scripts/macos-signing.ts), [`macos-notarization.ts`](../apps/electrobun/scripts/macos-notarization.ts), [`notarize-installer.ts`](../apps/electrobun/scripts/notarize-installer.ts), [`protect-build.ts`](../apps/electrobun/scripts/protect-build.ts), [`protect-wrapper.ts`](../apps/electrobun/scripts/protect-wrapper.ts), [`verify-installer.ts`](../apps/electrobun/scripts/verify-installer.ts), [`windows-installer.ts`](../apps/electrobun/scripts/windows-installer.ts) | [Local macOS installer](../apps/electrobun/README.md#local-macos-installer), [Local Windows installer](../apps/electrobun/README.md#local-windows-installer), [`macos-notarization.test.ts`](../apps/electrobun/tests/macos-notarization.test.ts), [`protect-build.test.ts`](../apps/electrobun/tests/protect-build.test.ts), [`run-pnpm.test.ts`](../apps/electrobun/tests/run-pnpm.test.ts), [`windows-installer.test.ts`](../apps/electrobun/tests/windows-installer.test.ts), [`profile-smoke.test.ts`](../apps/electrobun/tests/profile-smoke.test.ts) |
| Desktop signed update feed and installer handoff | [`brand.ts`](../apps/electrobun/src/brand.ts), [`favicon.png`](../apps/web/public/favicon.png), [`Settings and workspace notification`](../packages/client/ui-enterprise/src/client/enterprise.tsx), [`Account notification`](../packages/client/ui-enterprise-account/src/client/account.tsx), [`account-server.ts`](../apps/electrobun/src/account-server.ts), [`native-bridge.ts`](../apps/electrobun/src/native-bridge.ts), [`desktop-updates.ts`](../apps/electrobun/src/desktop-updates.ts), [`update-manifest.ts`](../apps/electrobun/src/update-manifest.ts), [`update-download.ts`](../apps/electrobun/src/update-download.ts), [`update-installer.ts`](../apps/electrobun/src/update-installer.ts), [`sign-update.ts`](../apps/electrobun/scripts/sign-update.ts), [`create-update-key.ts`](../apps/electrobun/scripts/create-update-key.ts) | [Desktop updates](../apps/electrobun/README.md#desktop-updates), [`desktop-updates.test.ts`](../apps/electrobun/tests/desktop-updates.test.ts), [`API publishing`](../apps/api/src/desktop-releases.ts), [`installer storage`](../apps/api/src/desktop-storage.ts), [`Admin upload`](../apps/admin/app/desktop-releases-workspace.tsx), [`publication acceptance`](../apps/api/tests/desktop-release-acceptance.ts), [identity refresh regression](../apps/admin/tests/shell-refresh.test.ts) |
| Agent turn, tool calls, or loop lifecycle | [`packages/core/agent-loop/src`](../packages/core/agent-loop/src), [`packages/core/agent/src`](../packages/core/agent/src), [`packages/core/tools/src`](../packages/core/tools/src) | [`docs/agent-lifecycle.md`](agent-lifecycle.md), [`docs/tool-execution-pipeline.md`](tool-execution-pipeline.md), `packages/core/*/tests/`, session snapshots |
| Session events, durable JSONL, projection, title, or telemetry | [`packages/core/session/src`](../packages/core/session/src), [`packages/session`](../packages/session), [`packages/session-query`](../packages/session-query) | [Session subsystem](subsystems/session.md), [persistence](subsystems/persistence.md), [session testing](testing.md), `snapshots/session/` |
| New or changed model-facing tool | [`packages/core/tools/src`](../packages/core/tools/src), the owning `packages/*/tool-*`, and its provider package | [Tool catalog](tool-catalog.md), [adding a tool](cookbook/adding-a-tool.md), package tests, recorded-session snapshots |
| New independent plugin or capability | The owning Service Definition, Provider, Consumer, `cordis.yml` or bundle, and package README | [Independent plugin guide](cookbook/developing-an-independent-plugin.md), [plugin classification](plugin-classification.md), [adding a package](cookbook/adding-a-package.md), real-composition tests |
| Enterprise composition plugin with Host/Client targets | The manifest, target entries, package archive, installation-scoped SDK, enterprise API, desktop verifier/loader, local ZIP publication script, and acceptance fixture | [Enterprise composition plugin guide](cookbook/developing-an-enterprise-composition-plugin.md), [standalone enterprise plugin kit](cookbook/enterprise-plugin-kit/README.md), [enterprise plugin model](enterprise-plugins.md), [installation lifecycle](developer/plugin-installation-lifecycle.md), [plugin data SDK](developer/plugin-data-sdk.md), [`apps/api/scripts/upload-and-approve-local-plugins.ts`](../apps/api/scripts/upload-and-approve-local-plugins.ts), [`packages/plugin/acceptance`](../packages/plugin/acceptance), [`CordisPluginManager`](../packages/plugin/runtime/src/manager.ts), [Host credential facade](../packages/client/ui-enterprise/src/plugin-credentials.ts), [MCP authorization](../packages/client/ui-enterprise/src/plugin-oauth.ts), [Agent acceptance](../packages/client/ui-enterprise/tests/agent-capabilities.test.ts) |
| Capability service, provider, or consumer | The group README, its Service Definition package, provider packages, and consumer packages under [`packages/`](../packages) | [Capability seams](capability-seams.md), the matching [subsystem page](subsystems/README.md), real-composition tests |
| Enterprise model directory, media tasks, or CNY billing | [`apps/api/src/model-providers.ts`](../apps/api/src/model-providers.ts), [`model-tasks.ts`](../apps/api/src/model-tasks.ts), [`model-task-rules.ts`](../apps/api/src/model-task-rules.ts), [`wallet.ts`](../apps/api/src/wallet.ts), [`packages/plugin/sdk`](../packages/plugin/sdk) | [Model platform reference](developer/model-platform.md), [`model-platform.test.ts`](../apps/api/tests/model-platform.test.ts), external plugin SDK artifacts, [installed SDK Session replay](../snapshots/session/model-platform-sdk/snapshot.yml) |
| Model provider, streaming, retries, or token accounting | [`packages/llm`](../packages/llm), [`packages/llm/llm/src`](../packages/llm/llm/src), provider adapter, and [`packages/llm/token-meter`](../packages/llm/token-meter) | [LLM subsystem](subsystems/llm-streaming.md), [LLM adapter cookbook](cookbook/adding-an-llm-adapter.md), e2e or replay tests |
| Filesystem, shell, terminal, subprocess, sandbox, or code execution | The matching Service Definition plus [`packages/fs`](../packages/fs), [`packages/shell`](../packages/shell), [`packages/terminal`](../packages/terminal), [`packages/subprocess`](../packages/subprocess), [`packages/sandbox`](../packages/sandbox), or [`packages/code-runtime`](../packages/code-runtime) | [Defensive patterns](defensive-patterns.md), matching subsystem page, local/provider tests, platform checks |
| Web or browser access | [`packages/web`](../packages/web), [`packages/browser`](../packages/browser), [`packages/webhook`](../packages/webhook), and their `tool-*` consumers | [Web subsystem](subsystems/web.md), [browser subsystem](subsystems/browser.md), `packages/web/*/tests/`, [browser Session replay](../snapshots/session/browser-shared-page/snapshot.yml), [`attached.ts`](../packages/browser/browser-playwright/src/attached.ts), [`browser-config.ts`](../apps/electrobun/src/browser-config.ts), [`browser-lifecycle.ts`](../apps/electrobun/src/browser-lifecycle.ts), web snapshots |
| Subagent delegation or workflow workers | [`packages/subagent`](../packages/subagent), [`packages/workflow`](../packages/workflow), and their tool consumers | [Subagent subsystem](subsystems/subagent.md), [workflow subsystem](subsystems/workflow.md), worker lifecycle tests |
| Shared settings controls and task tabs | [`Select.tsx`](../packages/client/ui-primitives/src/Select.tsx), [`TabGroup.tsx`](../packages/client/ui-primitives/src/TabGroup.tsx) | [Primitive contracts](../packages/client/ui-primitives/README.md), [enterprise settings](../packages/client/ui-enterprise/README.md), [browser replay](../snapshots/web/enterprise-settings/snapshot.yml) |
| Enterprise account entry and department management | [`API application`](../apps/api/src/application.ts), [`account entry`](../packages/client/ui-enterprise-account/README.md), [`department UI`](../packages/client/ui-enterprise/src/client/departments.tsx) | [Team isolation](../apps/api/tests/team-isolation.test.ts), [native account browser test](../apps/web/tests/enterprise-account.e2e.ts), [Directory browser replay](../snapshots/web/enterprise-settings/snapshot.yml), [client README](../packages/client/ui-enterprise/README.md) |
| Enterprise cloud-drive ownership and sharing | [`apps/api/src/drive.ts`](../apps/api/src/drive.ts), [sharing migration](../apps/api/migrations/0037_drive_sharing.sql), [`ui-enterprise`](../packages/client/ui-enterprise/README.md) | [HTTP authorization tests](../apps/api/tests/drive-sharing.test.ts), [browser replay](../apps/web/tests/drive-sharing.e2e.ts), [recorded Session](../snapshots/web/drive-sharing/snapshot.yml) |
| Enterprise team permissions, budgets, capacity and recovery | [`team-governance.ts`](../apps/api/src/team-governance.ts), [`subscription-plans.ts`](../apps/api/src/subscription-plans.ts), [`drive-capacity.ts`](../apps/api/src/drive-capacity.ts), [Admin teams](../apps/admin/app/team-administration.tsx), [public account](../apps/admin/app/account/page.tsx), [desktop management](../packages/client/ui-enterprise/src/client/team-management.tsx) | [Team administration](developer/enterprise-team-governance.md), [HTTP regressions](../apps/api/tests/team-governance.test.ts), [current SDK Session](../snapshots/session/team-settlement-sdk/snapshot.yml) |
| Remote API, RPC, or Web UI contract | [`packages/api`](../packages/api), [`packages/typert`](../packages/typert), [`packages/host`](../packages/host), [`packages/client`](../packages/client), and [`apps/web`](../apps/web) | [API gateway](api-gateway.md), client and web subsystem pages, built web tests, UI snapshots |
| SDK or external wire protocol | [`packages/sdk`](../packages/sdk), [`python/sdk`](../python/sdk), and the protocol owner | [SDK group README](../packages/sdk/README.md), [Python SDK](../python/sdk/README.md), SDK snapshots and protocol tests |
| Arivo local editor departure before page, tab or explicit Session navigation | [`startup coordinator`](../apps/electrobun/src/distribution/arivo-shell/client/departure.ts), [`main navigation`](../packages/client/ui-layout/src/client/service.ts), [`Workbench`](../packages/client/ui-workbench/src/client/Workbench.tsx), [`selection owner`](../packages/api/session-controller/src/client/sessions/service.ts) | [Departure decision](../.agents/notes/implemented/architecture/2026-10-24-arivo-editor-departure.md), [`protocol tests`](../apps/electrobun/tests/arivo-departure.test.ts), [`installed-profile product regression`](../apps/web/tests/arivo-departure.e2e.ts) |
| Settings main page and section selection | [`SettingsPage.tsx`](../packages/client/ui-settings-general/src/client/SettingsPage.tsx), [`settings-view-store.ts`](../packages/client/ui-settings-general/src/client/settings-view-store.ts), [`main navigation`](../packages/client/ui-layout/src/client/service.ts) | [Slot locations](subsystems/slot-locations.md#settings), [`settings-root.client.spec.tsx`](../packages/client/ui-settings-general/tests/settings-root.client.spec.tsx) |
| Settings, credentials, permissions, approval, or user questions | [`packages/settings`](../packages/settings), [`packages/credentials`](../packages/credentials), [`packages/interaction`](../packages/interaction), and related client UI packages | Matching subsystem page, [permission presets](subsystems/permission-presets.md), UI locale checks, owner tests |
| Client UI or locale-owned copy | [`packages/client`](../packages/client), the owning `ui-*` package, [`apps/web`](../apps/web), and locale dictionaries | [Client modules](subsystems/client-modules.md), [web client](subsystems/web-client.md), [Slot UI locations](subsystems/slot-locations.md), `verify-client-ui-i18n`, [marketplace icon replay](../apps/web/tests/plugin-market-icons.e2e.ts), UI snapshots |
| Build, generated catalog, gate, or release behavior | [`scripts/run-gates.ts`](../scripts/run-gates.ts), the named generator or verifier, root `package.json`, and the relevant `tsconfig` | [Development guide](development.md), [testing](testing.md), `scripts/` tests, `pnpm run doc-sync` or the owning gate |
| Admin Figma presentation and page acceptance | [Shell](../apps/admin/app/admin-shell.tsx), [styles](../apps/admin/app/global.css), [trend](../apps/admin/app/cost-trend.tsx), [modal focus](../apps/admin/app/use-dialog-focus.ts), [assets](../apps/admin/public/admin), [enterprise configuration](../apps/admin/app/enterprise-workspace.tsx), [identity editor](../apps/admin/app/enterprise-identity-form.tsx) | [Admin README](../apps/admin/README.md), [page fixtures](../apps/admin/tests/page-fixtures.ts), [page snapshots and interactions](../apps/admin/tests/admin-pages.test.ts) |
| Enterprise container image publication | [`scripts/build-and-push-images.sh`](../scripts/build-and-push-images.sh), [`infra/enterprise/docker`](../infra/enterprise/docker), [Admin standalone configuration](../apps/admin/next.config.mjs), [API production deployment hook](../infra/enterprise/docker/api-deploy.pnpmfile.cjs), [Admin runtime layout](../apps/admin/app/layout.tsx), [browser API requests](../apps/admin/app/client-api.ts), [startup initialization](../apps/api/src/initialize.ts), [deployment-account migrations](../apps/api/src/migrations.ts), and [container entrypoint](../infra/enterprise/docker/api-entrypoint.sh) | [Admin README](../apps/admin/README.md), [API README](../apps/api/README.md), `pnpm run image:push`, [initialization tests](../apps/api/tests/container-initialization.test.ts), Docker Buildx checks |
| Documentation, index, or Agent Note | The target page, [`docs/AGENTS.md`](AGENTS.md), [i18n rules](i18n/README.md), and the owning source or generator | `pnpm run test:docs`, `pnpm run doc-sync`, and `git diff --check` |

The [native departure callback](../apps/electrobun/src/distribution/arivo-native-departure.ts) owns Arivo menu/window-close acknowledgement; [transport tests](../apps/electrobun/tests/arivo-native-departure.test.ts) verify its one-use loopback admission.

-----

## Package groups

Every package is under `packages/<group>/<package>/`. Read the group README for the package contract, then the package `src/`, `tests/`, `package.json`, `tsconfig*.json`, `cordis.yml`, and nearest `AGENTS.md` that exist. The package names below are the current directory inventory; the generated [module graph](module-graph.md) owns peer edges and must not be hand-edited.

| Group | Package directories | Contract |
| --- | --- | --- |
| `packages/acp/` | `acp` | [README](../packages/acp/README.md) |
| `packages/api/` | `gateway`, `remotes`, `session-controller`, `settings-controller`, `workbench-controller`, `workspace-controller` | [README](../packages/api/README.md) |
| `packages/attachment/` | `attachment`, `attachment-local` | [README](../packages/attachment/README.md) |
| `packages/boot/` | `app-boot`, `cmdline` | [README](../packages/boot/README.md) |
| `packages/browser/` | `browser`, `browser-playwright`, `tool-browser` | [README](../packages/browser/README.md) |
| `packages/bundle/` | `acp-app`, `base`, `headless`, `sdk-app`, `sdk-minimal`, `web-app` | [README](../packages/bundle/README.md) |
| `packages/client/` | `connection`, `file-upload`, `hmr`, `locale`, `modules`, `store`, `ui-agent-preset`, `ui-approval`, `ui-attachment`, `ui-brand-official`, `ui-chat`, `ui-commands`, `ui-conversation`, `ui-deliverables`, `ui-directory-picker-browse`, `ui-directory-picker-native`, `ui-enterprise`, `ui-enterprise-account`, `ui-goal`, `ui-input-trigger`, `ui-jobs`, `ui-layout`, `ui-message-feedback`, `ui-model-selection`, `ui-permission-presets`, `ui-plan`, `ui-primitives`, `ui-reference`, `ui-renderer`, `ui-schedule`, `ui-session`, `ui-settings`, `ui-settings-general`, `ui-settings-models`, `ui-settings-plugin-inventory`, `ui-settings-plugins`, `ui-sidebar`, `ui-skill`, `ui-slots`, `ui-subagent`, `ui-theme`, `ui-tool`, `ui-trajectory`, `ui-user-questions`, `ui-workbench`, `ui-workflow-run`, `ui-workspace`, `web` | [README](../packages/client/README.md) |
| `packages/code-runtime/` | `code-runtime`, `code-runtime-worker-thread` | [README](../packages/code-runtime/README.md) |
| `packages/compaction/` | `command-compact`, `compaction`, `compaction-basic`, `compaction-tool-result-pruner` | [README](../packages/compaction/README.md) |
| `packages/context/` | `agent-instructions`, `file-reference`, `file-reference-local`, `session-reference`, `time-context`, `tmux-context` | [README](../packages/context/README.md) |
| `packages/core/` | `agent`, `agent-default-model`, `agent-loop`, `agent-tool-presentation`, `scope`, `session`, `system-prompt`, `tools` | [README](../packages/core/README.md) |
| `packages/credentials/` | `authorization`, `credentials`, `credentials-local` | [README](../packages/credentials/README.md) |
| `packages/e2b/` | `e2b`, `fs-e2b`, `subprocess-e2b` | [README](../packages/e2b/README.md) |
| `packages/experimental/` | `agent-team`, `agent-team-profile`, `agent-team-web-profile`, `client-ui-agent-team`, `code-runtime-python`, `inspector`, `tool-agent-team`, `webworker-packer`, `webworker-runtime` | [README](../packages/experimental/README.md) |
| `packages/extensions/` | `cordis-client-runner`, `cordis-host-runner`, `tool-cordis`, `ui-cordis` | [README](../packages/extensions/README.md) |
| `packages/feedback/` | `command-feedback`, `message-feedback` | [README](../packages/feedback/README.md) |
| `packages/fs/` | `fs`, `fs-local`, `fs-observation-policy`, `fs-sandbox`, `tool-fs`, `tool-fs-search`, `tool-str-replace-editor` | [README](../packages/fs/README.md) |
| `packages/goal/` | `command-goal`, `goal`, `goal-round-driver`, `tool-goal` | [README](../packages/goal/README.md) |
| `packages/guard/` | `repeat-tool-reminder`, `timeout-policy` | [README](../packages/guard/README.md) |
| `packages/hooks/` | `hook-protocol`, `hooks-claude-code`, `hooks-codex` | [README](../packages/hooks/README.md) |
| `packages/host/` | `directory-picker`, `directory-picker-auto`, `directory-picker-browse`, `directory-picker-native`, `frontend-static`, `plugin-inventory`, `webserver` | [README](../packages/host/README.md) |
| `packages/identity/` | `anonymous-user-id` | [README](../packages/identity/README.md) |
| `packages/interaction/` | `commands`, `permission-presets`, `tool-ask-user`, `user-approval`, `user-questions` | [README](../packages/interaction/README.md) |
| `packages/jobs/` | `jobs`, `jobs-local`, `tool-jobs` | [README](../packages/jobs/README.md) |
| `packages/llm/` | `deepseek-llm-api-extensions`, `llm`, `llm-deepseek`, `llm-files`, `llm-pi-ai`, `llm-retry`, `plugin-package-inventory-deepseek`, `token-meter` | [README](../packages/llm/README.md) |
| `packages/lsp/` | `lsp`, `lsp-stdio`, `tool-lsp` | [README](../packages/lsp/README.md) |
| `packages/mcp/` | `mcp-client` | [README](../packages/mcp/README.md) |
| `packages/plan/` | `plan-mode` | [README](../packages/plan/README.md) |
| `packages/plugin/` | `acceptance`, `protocol`, `runtime`, `sdk` | [README](../packages/plugin/README.md) |
| `packages/preset/` | `agent-presets`, `persona` | [README](../packages/preset/README.md) |
| `packages/runtime-diagnostics/` | `invariants` | [README](../packages/runtime-diagnostics/README.md) |
| `packages/sandbox/` | `sandbox`, `sandbox-local`, `sandbox-policy`, `sandbox-windows-acl` | [README](../packages/sandbox/README.md) |
| `packages/schedule/` | `schedule` | [README](../packages/schedule/README.md) |
| `packages/sdk/` | `client`, `protocol`, `server` | [README](../packages/sdk/README.md) |
| `packages/session/` | `session-checkpoint-policy`, `session-format`, `session-format-catalog`, `session-format-v0-to-v1`, `session-format-v1-to-v2`, `session-log-deepseek`, `session-persistence`, `session-persistence-jsonl`, `session-projection`, `session-projection-cache`, `session-stats`, `session-telemetry`, `session-telemetry-otel`, `session-title`, `session-title-all-prompts-llm`, `session-title-first-prompt-llm`, `session-title-llm`, `session-turn-outline` | [README](../packages/session/README.md) |
| `packages/session-query/` | `session-log-export`, `session-query`, `session-query-sqlite`, `tool-session-query` | [README](../packages/session-query/README.md) |
| `packages/settings/` | `settings`, `settings-file` | [README](../packages/settings/README.md) |
| `packages/shell/` | `bash-local`, `bash-sandbox`, `pwsh-local`, `pwsh-sandbox`, `shell`, `shell-env`, `tool-bash`, `tool-bash-persistent`, `tool-pwsh`, `tool-pwsh-persistent` | [README](../packages/shell/README.md) |
| `packages/skill/` | `skill`, `skill-badge`, `skill-filesystem`, `tool-skill` | [README](../packages/skill/README.md) |
| `packages/spill/` | `spill`, `spill-local`, `spill-policy` | [README](../packages/spill/README.md) |
| `packages/storage/` | `storage`, `storage-domain`, `storage-json`, `storage-sqlite` | [README](../packages/storage/README.md) |
| `packages/subagent/` | `subagent`, `subagent-acp`, `subagent-claude-code`, `subagent-codex`, `subagent-dsh-sdk`, `subagent-fork-in-process`, `subagent-in-process-driver`, `subagent-spawn-in-process`, `tool-subagent`, `tool-subagent-control` | [README](../packages/subagent/README.md) |
| `packages/subprocess/` | `subprocess`, `subprocess-local`, `win32-process` | [README](../packages/subprocess/README.md) |
| `packages/terminal/` | `terminal`, `terminal-bash`, `tool-terminal` | [README](../packages/terminal/README.md) |
| `packages/test-support/` | `agent-loop-testkit`, `client-runtime`, `llm-mock-server`, `llm-replay`, `loader-smoke`, `session-snapshot` | [README](../packages/test-support/README.md) |
| `packages/todo/` | `tool-todo` | [README](../packages/todo/README.md) |
| `packages/trigger/` | `trigger` | [README](../packages/trigger/README.md) |
| `packages/typert/` | `generator`, `loader`, `protocol`, `registry` | [README](../packages/typert/README.md) |
| `packages/util/` | `atomic-write`, `brand`, `crypto`, `deque`, `home-paths`, `http-proxy`, `launch-environment`, `native-command`, `output-retention`, `time`, `timeout`, `values`, `workspace-path` | [README](../packages/util/README.md) |
| `packages/web/` | `tool-web`, `web`, `web-fetch-http`, `web-search-deepseek`, `web-search-exa`, `web-search-perplexity` | [README](../packages/web/README.md) |
| `packages/webhook/` | `webhook`, `webhook-github` | [README](../packages/webhook/README.md) |
| `packages/workflow/` | `tool-ralph`, `tool-workflow`, `workflow`, `workflow-worker-thread` | [README](../packages/workflow/README.md) |
| `packages/workspace/` | `workspace` | [README](../packages/workspace/README.md) |


-----

## File conventions

| File or directory | Meaning |
| --- | --- |
| `src/index.ts` | Package entry point and public registration or exports. |
| `src/types.ts` | Public and internal type declarations; package rules forbid runtime code here. |
| `src/*.generated.ts` | Generated source; update the generator or input and regenerate it. |
| `tests/` | Package-level behavior tests, normally using the package's real exported entry path. |
| `package.json` | Package identity, exports, dependencies, Cordis plugin metadata, and scripts. |
| `cordis.yml` or `*.cordis.patch.yml` | Composition input; inspect resolver dependencies and profile ownership before editing. |
| `tsconfig*.json` | Host/Client compiler face and Project Reference membership. |
| `README.md` and `docs/subsystems/*.md` | Current package and subsystem contracts; update the owner with code changes. |
| `scripts/gen-*.ts` and `scripts/verify-*.ts` | Generator and freshness/acceptance owner; never patch generated output by hand. |
| `snapshots/` and `*.snap` | Recorded model, user, wire, or built-output behavior; follow the owning `AGENTS.md`. |

-----

## Maintenance

This page is manually curated because it records development ownership and reading order, while generated catalogs record signatures and relationships. When a package or app is added, renamed, removed, or moved, update the corresponding root or package-group row, links, and any runtime-path row in the same change. When a source file changes without changing ownership or navigation, do not add an inventory entry; update the owning contract instead.

Regenerate generated references before checking this index: `pnpm run gen-module-graph`, `pnpm run gen-doc-graphs`, `pnpm run gen-tool-catalog`, `pnpm run gen-config-catalog`, and the generator named by the affected page. Validate links and the bilingual pair with `pnpm run verify-md-links` and `pnpm run verify-translation-pairing --write docs/development-index.md`; finish documentation changes with `pnpm run test:docs`, `pnpm run doc-sync`, and `git diff --check`.

The index is current only when its paths resolve, its package inventory matches the workspace, and its change-to-file guidance still points at the source owner. A stale row is a documentation defect: fix the index in the introducing change instead of teaching agents to compensate for it.

The Arivo Tasks and Assets Rail entries use the same startup Client/Host adapters and packaged startup test; the [task-entry decision](../.agents/notes/implemented/feature/2026-10-26-arivo-task-rail.md) owns its fixed-page protocol and plugin responsibility.
