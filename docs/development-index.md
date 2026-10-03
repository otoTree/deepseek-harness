# Development index

English | [中文](development-index.zh.md)

This index is the repository navigation reference for AI agents and contributors. It maps directory layers to their source owners, runtime entry points, tests, and governing documents. It is a lookup aid, not a replacement for package READMEs, architecture documents, generated catalogs, or source code.

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

Use the row that describes the behavior being changed. Read every path in the row before editing a shared interface.

| Change type | Read first | Related tests and docs |
| --- | --- | --- |
| Application launch or profile composition | [`apps/cli/src/bin.ts`](../apps/cli/src/bin.ts), [`apps/cli/src/profile-boot.ts`](../apps/cli/src/profile-boot.ts), [`packages/boot/app-boot/src`](../packages/boot/app-boot/src), [`packages/bundle`](../packages/bundle) | [Application launch](architecture.md), [profile docs](../apps/cli/composition.md), `apps/cli/tests/`, snapshot profiles |
| Agent turn, tool calls, or loop lifecycle | [`packages/core/agent-loop/src`](../packages/core/agent-loop/src), [`packages/core/agent/src`](../packages/core/agent/src), [`packages/core/tools/src`](../packages/core/tools/src) | [`docs/agent-lifecycle.md`](agent-lifecycle.md), [`docs/tool-execution-pipeline.md`](tool-execution-pipeline.md), `packages/core/*/tests/`, session snapshots |
| Session events, durable JSONL, projection, title, or telemetry | [`packages/core/session/src`](../packages/core/session/src), [`packages/session`](../packages/session), [`packages/session-query`](../packages/session-query) | [Session subsystem](subsystems/session.md), [persistence](subsystems/persistence.md), [session testing](testing.md), `snapshots/session/` |
| New or changed model-facing tool | [`packages/core/tools/src`](../packages/core/tools/src), the owning `packages/*/tool-*`, and its provider package | [Tool catalog](tool-catalog.md), [adding a tool](cookbook/adding-a-tool.md), package tests, recorded-session snapshots |
| New independent plugin or capability | The owning Service Definition, Provider, Consumer, `cordis.yml` or bundle, and package README | [Independent plugin guide](cookbook/developing-an-independent-plugin.md), [plugin classification](plugin-classification.md), [adding a package](cookbook/adding-a-package.md), real-composition tests |
| Enterprise composition plugin with Host/Client targets | The manifest, target entries, package archive, installation-scoped SDK, enterprise API, desktop verifier/loader, and acceptance fixture | [Enterprise composition plugin guide](cookbook/developing-an-enterprise-composition-plugin.md), [enterprise plugin model](enterprise-plugins.md), [installation lifecycle](developer/plugin-installation-lifecycle.md), [plugin data SDK](developer/plugin-data-sdk.md), [`packages/plugin/acceptance`](../packages/plugin/acceptance) |
| Capability service, provider, or consumer | The group README, its Service Definition package, provider packages, and consumer packages under [`packages/`](../packages) | [Capability seams](capability-seams.md), the matching [subsystem page](subsystems/README.md), real-composition tests |
| Model provider, streaming, retries, or token accounting | [`packages/llm`](../packages/llm), [`packages/llm/llm/src`](../packages/llm/llm/src), provider adapter, and [`packages/llm/token-meter`](../packages/llm/token-meter) | [LLM subsystem](subsystems/llm-streaming.md), [LLM adapter cookbook](cookbook/adding-an-llm-adapter.md), e2e or replay tests |
| Filesystem, shell, terminal, subprocess, sandbox, or code execution | The matching Service Definition plus [`packages/fs`](../packages/fs), [`packages/shell`](../packages/shell), [`packages/terminal`](../packages/terminal), [`packages/subprocess`](../packages/subprocess), [`packages/sandbox`](../packages/sandbox), or [`packages/code-runtime`](../packages/code-runtime) | [Defensive patterns](defensive-patterns.md), matching subsystem page, local/provider tests, platform checks |
| Web or browser access | [`packages/web`](../packages/web), [`packages/browser`](../packages/browser), [`packages/webhook`](../packages/webhook), and their `tool-*` consumers | [Web subsystem](subsystems/web.md), [browser subsystem](subsystems/browser.md), `packages/web/*/tests/`, web snapshots |
| Subagent delegation or workflow workers | [`packages/subagent`](../packages/subagent), [`packages/workflow`](../packages/workflow), and their tool consumers | [Subagent subsystem](subsystems/subagent.md), [workflow subsystem](subsystems/workflow.md), worker lifecycle tests |
| Remote API, RPC, or Web UI contract | [`packages/api`](../packages/api), [`packages/typert`](../packages/typert), [`packages/host`](../packages/host), [`packages/client`](../packages/client), and [`apps/web`](../apps/web) | [API gateway](api-gateway.md), client and web subsystem pages, built web tests, UI snapshots |
| SDK or external wire protocol | [`packages/sdk`](../packages/sdk), [`python/sdk`](../python/sdk), and the protocol owner | [SDK group README](../packages/sdk/README.md), [Python SDK](../python/sdk/README.md), SDK snapshots and protocol tests |
| Settings, credentials, permissions, approval, or user questions | [`packages/settings`](../packages/settings), [`packages/credentials`](../packages/credentials), [`packages/interaction`](../packages/interaction), and related client UI packages | Matching subsystem page, [permission presets](subsystems/permission-presets.md), UI locale checks, owner tests |
| Client UI or locale-owned copy | [`packages/client`](../packages/client), the owning `ui-*` package, [`apps/web`](../apps/web), and locale dictionaries | [Client modules](subsystems/client-modules.md), [web client](subsystems/web-client.md), `verify-client-ui-i18n`, UI snapshots |
| Build, generated catalog, gate, or release behavior | [`scripts/run-gates.ts`](../scripts/run-gates.ts), the named generator or verifier, root `package.json`, and the relevant `tsconfig` | [Development guide](development.md), [testing](testing.md), `scripts/` tests, `pnpm run doc-sync` or the owning gate |
| Documentation, index, or Agent Note | The target page, [`docs/AGENTS.md`](AGENTS.md), [i18n rules](i18n/README.md), and the owning source or generator | `pnpm run test:docs`, `pnpm run doc-sync`, and `git diff --check` |

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
| `packages/model/` | `model-tasks`, `tool-model-tasks` | `package.json` and source code |
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
| `packages/trigger/` | `trigger` | `package.json` and source code |
| `packages/typert/` | `generator`, `loader`, `protocol`, `registry` | [README](../packages/typert/README.md) |
| `packages/util/` | `atomic-write`, `brand`, `crypto`, `deque`, `home-paths`, `http-proxy`, `launch-environment`, `native-command`, `output-retention`, `time`, `timeout`, `values`, `workspace-path` | [README](../packages/util/README.md) |
| `packages/web/` | `tool-web`, `web`, `web-fetch-http`, `web-search-deepseek`, `web-search-exa`, `web-search-perplexity` | [README](../packages/web/README.md) |
| `packages/webhook/` | `webhook`, `webhook-github` | [README](../packages/webhook/README.md) |
| `packages/workflow/` | `tool-ralph`, `tool-workflow`, `workflow`, `workflow-worker-thread` | [README](../packages/workflow/README.md) |
| `packages/workspace/` | `workspace` | [README](../packages/workspace/README.md) |

The `packages/experimental/` row is private and excluded from official release assumptions. `packages/model/` is present in the current tree even though it is not listed in older top-level summaries; its manifest and source are authoritative.

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
