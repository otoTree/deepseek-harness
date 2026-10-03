# 开发索引

[English](development-index.md) | 中文

本索引是面向 AI agent 和贡献者的仓库导航参考。它把目录层级映射到代码所有者、运行时入口、测试和约束文档。它只用于查找，不替代包 README、架构文档、生成目录或源代码。

## 目录

- [使用本索引](#use-this-index)
- [索引层级](#index-layers)
- [仓库根目录](#repository-roots)
- [运行时路径](#runtime-paths)
- [包组](#package-groups)
- [文件约定](#file-conventions)
- [维护](#maintenance)

-----

<a id="use-this-index"></a>
## 使用本索引

修改代码前：

1. 在[运行时路径](#runtime-paths)中找到对应的改动类型，再在[包组](#package-groups)中定位包组。
2. 阅读链接的包或子系统 README、最近的 `AGENTS.md`、涉及 `packages/` 时阅读架构页，然后阅读目标源文件和测试。
3. 修改共享约定前，先追踪所有者文档列出的生成目录、会话快照、SDK 投影和包消费者。
4. 从[贡献者参考](development.zh.md)选择覆盖所有者的最小检查；不要从本索引推断行为。

修改代码或仓库结构后：

1. 目录、包、入口、源代码所有者、生成产物或开发路径发生变化时，在同一改动中更新本索引。
2. 按改动约定更新所有者 README、子系统页、JSDoc、快照或 Agent Note；本索引只记录导航事实。
3. 修复链接并删除不存在的路径。生成页面必须由其生成器维护。
4. 确认英文/中文配对，并在文档相关改动中运行 `pnpm run test:docs`、`pnpm run doc-sync` 和 `git diff --check`。

-----

<a id="index-layers"></a>
## 索引层级

| 层级 | 要回答的问题 | 真源 |
| --- | --- | --- |
| 0. 仓库 | 哪个顶层区域负责这个问题？ | 本页和根 `AGENTS.md` |
| 1. 应用 | 哪个受支持的应用或运行时启动它？ | `apps/*/package.json`、应用源代码和[架构页](architecture.zh.md) |
| 2. 能力包组 | 哪个 `packages/<group>/` 负责服务、提供方或消费方？ | 包组 README 和[包总览](../packages/README.zh.md) |
| 3. 包 | 哪个 `packages/<group>/<package>/` 负责实现？ | 包的 `package.json`、`src/`、`tests/` 和 README |
| 4. 文件 | 必须阅读哪个入口、类型、测试、fixture 或生成器？ | 文件本身和最近的 `AGENTS.md` |

-----

<a id="repository-roots"></a>
## 仓库根目录

| 路径 | 责任 | 首先阅读 |
| --- | --- | --- |
| `apps/` | 受支持的应用入口和私有应用宿主。 | [`apps/cli/src/bin.ts`](../apps/cli/src/bin.ts)、[`apps/api/src/index.ts`](../apps/api/src/index.ts)、应用 `package.json` 和应用 `AGENTS.md` |
| `packages/` | 已发布和私有的 Cordis 插件、服务、提供方、消费者及支持包。 | [包组总览](../packages/README.zh.md)、[架构](architecture.zh.md)、`packages/<group>/README.md` 和 `packages/AGENTS.md` |
| `native/` | 原生代码真源和打包的 Landlock runner。 | [`native/README.zh.md`](../native/README.zh.md)、[`native/landlock-run/AGENTS.md`](../native/landlock-run/AGENTS.md) |
| `python/` | Python SDK 和捆绑运行时。 | [`python/README.zh.md`](../python/README.zh.md)、[`python/development.zh.md`](../python/development.zh.md) |
| `scripts/` | 构建、生成、校验、发布、文档和测试编排。 | [`scripts/AGENTS.md`](../scripts/AGENTS.md)、[`scripts/run-gates.ts`](../scripts/run-gates.ts) 和指定脚本 |
| `docs/` | 架构、子系统约定、贡献者指南、生成参考和事故复盘。 | [`docs/AGENTS.md`](AGENTS.md)，再读所有者页面 |
| `website/` | 显式发布文档白名单的 VitePress 投影。 | [`website/AGENTS.md`](../website/AGENTS.md)、[`website/docs.ts`](../website/docs.ts) |
| `snapshots/` | 会话、SDK、Web 和 ACP 预期输出。 | [`snapshots/AGENTS.md`](../snapshots/AGENTS.md)，再读测试指定的快照所有者 |
| `vendor/` | 固定版本的上游 Cordis 源代码副本。 | [`vendor/README.md`](../vendor/README.md)、[`vendor/AGENTS.md`](../vendor/AGENTS.md) |
| `.agents/` | 可复用 agent 工作流和有效决策记录。 | [Agent Note 规则](../.agents/notes/README.zh.md)，再读指定的 skill 或 note |
| `infra/` | 企业部署和基础设施材料。 | `infra/` 下最近的 README 或 `AGENTS.md` |

根 `package.json`、`pnpm-workspace.yaml`、`tsconfig*.json`、`vitest*.config.ts` 和 `scripts/run-gates.ts` 定义工作区成员、编译器面、测试分区和门禁所有权。改动工具或仓库级执行时必须阅读这些文件。

-----

<a id="runtime-paths"></a>
## 运行时路径

按改动行为选择对应行。编辑共享接口前必须阅读该行列出的全部路径。

| 改动类型 | 首先阅读 | 相关测试和文档 |
| --- | --- | --- |
| 应用启动或 profile 组合 | [`apps/cli/src/bin.ts`](../apps/cli/src/bin.ts)、[`apps/cli/src/profile-boot.ts`](../apps/cli/src/profile-boot.ts)、[`packages/boot/app-boot/src`](../packages/boot/app-boot/src)、[`packages/bundle`](../packages/bundle) | [应用启动](architecture.zh.md)、[profile 文档](../apps/cli/composition.md)、`apps/cli/tests/`、快照 profile |
| Agent 轮次、工具调用或循环生命周期 | [`packages/core/agent-loop/src`](../packages/core/agent-loop/src)、[`packages/core/agent/src`](../packages/core/agent/src)、[`packages/core/tools/src`](../packages/core/tools/src) | [`docs/agent-lifecycle.zh.md`](agent-lifecycle.zh.md)、[`docs/tool-execution-pipeline.zh.md`](tool-execution-pipeline.zh.md)、`packages/core/*/tests/`、会话快照 |
| 会话事件、持久化 JSONL、投影、标题或 telemetry | [`packages/core/session/src`](../packages/core/session/src)、[`packages/session`](../packages/session)、[`packages/session-query`](../packages/session-query) | [会话子系统](subsystems/session.zh.md)、[持久化](subsystems/persistence.zh.md)、[会话测试](testing.zh.md)、`snapshots/session/` |
| 新增或修改面向模型的工具 | [`packages/core/tools/src`](../packages/core/tools/src)、所有者 `packages/*/tool-*` 和提供方包 | [工具目录](tool-catalog.zh.md)、[添加工具](cookbook/adding-a-tool.zh.md)、包测试、会话快照 |
| 新增独立插件或能力 | 所有者 Service Definition、Provider、Consumer、`cordis.yml` 或 bundle 以及包 README | [独立插件指南](cookbook/developing-an-independent-plugin.zh.md)、[插件分类](plugin-classification.zh.md)、[添加包](cookbook/adding-a-package.zh.md)、真实组合测试 |
| 带 Host/Client target 的企业级组合插件 | manifest、target 入口、包归档、安装作用域 SDK、企业 API、桌面 verifier/loader 和验收 fixture | [企业级组合插件指南](cookbook/developing-an-enterprise-composition-plugin.zh.md)、[企业插件模型](enterprise-plugins.zh.md)、[安装生命周期](developer/plugin-installation-lifecycle.zh.md)、[插件数据 SDK](developer/plugin-data-sdk.zh.md)、[`packages/plugin/acceptance`](../packages/plugin/acceptance) |
| 能力服务、提供方或消费者 | 包组 README、Service Definition 包、提供方包和 [`packages/`](../packages) 下的消费者包 | [能力 seam](capability-seams.zh.md)、对应[子系统页](subsystems/README.zh.md)、真实组合测试 |
| 模型提供方、流式输出、重试或 token 统计 | [`packages/llm`](../packages/llm)、[`packages/llm/llm/src`](../packages/llm/llm/src)、提供方适配器和 [`packages/llm/token-meter`](../packages/llm/token-meter) | [LLM 子系统](subsystems/llm-streaming.zh.md)、[LLM 适配器手册](cookbook/adding-an-llm-adapter.zh.md)、e2e 或回放测试 |
| 文件系统、shell、terminal、subprocess、sandbox 或代码执行 | 对应 Service Definition，以及 [`packages/fs`](../packages/fs)、[`packages/shell`](../packages/shell)、[`packages/terminal`](../packages/terminal)、[`packages/subprocess`](../packages/subprocess)、[`packages/sandbox`](../packages/sandbox) 或 [`packages/code-runtime`](../packages/code-runtime) | [防御模式](defensive-patterns.zh.md)、对应子系统页、本地/提供方测试、平台检查 |
| Web 或浏览器访问 | [`packages/web`](../packages/web)、[`packages/browser`](../packages/browser)、[`packages/webhook`](../packages/webhook) 及其 `tool-*` 消费者 | [Web 子系统](subsystems/web.zh.md)、[浏览器子系统](subsystems/browser.zh.md)、`packages/web/*/tests/`、Web 快照 |
| Subagent 委派或 workflow worker | [`packages/subagent`](../packages/subagent)、[`packages/workflow`](../packages/workflow) 及其工具消费者 | [Subagent 子系统](subsystems/subagent.zh.md)、[workflow 子系统](subsystems/workflow.zh.md)、worker 生命周期测试 |
| 远程 API、RPC 或 Web UI 约定 | [`packages/api`](../packages/api)、[`packages/typert`](../packages/typert)、[`packages/host`](../packages/host)、[`packages/client`](../packages/client) 和 [`apps/web`](../apps/web) | [API gateway](api-gateway.zh.md)、client 和 Web 子系统页、构建 Web 测试、UI 快照 |
| SDK 或外部协议 | [`packages/sdk`](../packages/sdk)、[`python/sdk`](../python/sdk) 和协议所有者 | [SDK 包组 README](../packages/sdk/README.zh.md)、[Python SDK](../python/sdk/README.zh.md)、SDK 快照和协议测试 |
| 设置、凭据、权限、审批或用户问题 | [`packages/settings`](../packages/settings)、[`packages/credentials`](../packages/credentials)、[`packages/interaction`](../packages/interaction) 及对应 client UI 包 | 对应子系统页、[权限预设](subsystems/permission-presets.zh.md)、UI locale 检查、所有者测试 |
| Client UI 或 locale 所有的文案 | [`packages/client`](../packages/client)、所有者 `ui-*` 包、[`apps/web`](../apps/web) 和 locale 字典 | [Client 模块](subsystems/client-modules.zh.md)、[Web client](subsystems/web-client.zh.md)、`verify-client-ui-i18n`、UI 快照 |
| 构建、生成目录、门禁或发布行为 | [`scripts/run-gates.ts`](../scripts/run-gates.ts)、指定生成器或校验器、根 `package.json` 和相关 `tsconfig` | [开发指南](development.zh.md)、[测试](testing.zh.md)、`scripts/` 测试、`pnpm run doc-sync` 或所有者门禁 |
| 文档、索引或 Agent Note | 目标页面、[`docs/AGENTS.md`](AGENTS.md)、[i18n 规则](i18n/README.zh.md) 和所有者源代码或生成器 | `pnpm run test:docs`、`pnpm run doc-sync` 和 `git diff --check` |

-----

<a id="package-groups"></a>
## 包组

每个包都位于 `packages/<group>/<package>/`。先读包组 README 了解包约定，再读实际存在的包 `src/`、`tests/`、`package.json`、`tsconfig*.json`、`cordis.yml` 和最近的 `AGENTS.md`。下表是当前目录清单；生成的[模块图](module-graph.zh.md)负责 peer 边，不得手工编辑。

| 包组 | 包目录 | 约定 |
| --- | --- | --- |
| `packages/acp/` | `acp` | [README](../packages/acp/README.zh.md) |
| `packages/api/` | `gateway`、`remotes`、`session-controller`、`settings-controller`、`workbench-controller`、`workspace-controller` | [README](../packages/api/README.zh.md) |
| `packages/attachment/` | `attachment`、`attachment-local` | [README](../packages/attachment/README.zh.md) |
| `packages/boot/` | `app-boot`、`cmdline` | [README](../packages/boot/README.zh.md) |
| `packages/browser/` | `browser`、`browser-playwright`、`tool-browser` | [README](../packages/browser/README.zh.md) |
| `packages/bundle/` | `acp-app`、`base`、`headless`、`sdk-app`、`sdk-minimal`、`web-app` | [README](../packages/bundle/README.zh.md) |
| `packages/client/` | `connection`、`file-upload`、`hmr`、`locale`、`modules`、`store`、`ui-agent-preset`、`ui-approval`、`ui-attachment`、`ui-brand-official`、`ui-chat`、`ui-commands`、`ui-conversation`、`ui-deliverables`、`ui-directory-picker-browse`、`ui-directory-picker-native`、`ui-enterprise`、`ui-enterprise-account`、`ui-goal`、`ui-input-trigger`、`ui-jobs`、`ui-layout`、`ui-message-feedback`、`ui-model-selection`、`ui-permission-presets`、`ui-plan`、`ui-primitives`、`ui-reference`、`ui-renderer`、`ui-schedule`、`ui-session`、`ui-settings`、`ui-settings-general`、`ui-settings-models`、`ui-settings-plugin-inventory`、`ui-settings-plugins`、`ui-sidebar`、`ui-skill`、`ui-slots`、`ui-subagent`、`ui-theme`、`ui-tool`、`ui-trajectory`、`ui-user-questions`、`ui-workbench`、`ui-workflow-run`、`ui-workspace`、`web` | [README](../packages/client/README.zh.md) |
| `packages/code-runtime/` | `code-runtime`、`code-runtime-worker-thread` | [README](../packages/code-runtime/README.zh.md) |
| `packages/compaction/` | `command-compact`、`compaction`、`compaction-basic`、`compaction-tool-result-pruner` | [README](../packages/compaction/README.zh.md) |
| `packages/context/` | `agent-instructions`、`file-reference`、`file-reference-local`、`session-reference`、`time-context`、`tmux-context` | [README](../packages/context/README.zh.md) |
| `packages/core/` | `agent`、`agent-default-model`、`agent-loop`、`agent-tool-presentation`、`scope`、`session`、`system-prompt`、`tools` | [README](../packages/core/README.zh.md) |
| `packages/credentials/` | `authorization`、`credentials`、`credentials-local` | [README](../packages/credentials/README.zh.md) |
| `packages/e2b/` | `e2b`、`fs-e2b`、`subprocess-e2b` | [README](../packages/e2b/README.zh.md) |
| `packages/experimental/` | `agent-team`、`agent-team-profile`、`agent-team-web-profile`、`client-ui-agent-team`、`code-runtime-python`、`inspector`、`tool-agent-team`、`webworker-packer`、`webworker-runtime` | [README](../packages/experimental/README.zh.md) |
| `packages/extensions/` | `cordis-client-runner`、`cordis-host-runner`、`tool-cordis`、`ui-cordis` | [README](../packages/extensions/README.zh.md) |
| `packages/feedback/` | `command-feedback`、`message-feedback` | [README](../packages/feedback/README.zh.md) |
| `packages/fs/` | `fs`、`fs-local`、`fs-observation-policy`、`fs-sandbox`、`tool-fs`、`tool-fs-search`、`tool-str-replace-editor` | [README](../packages/fs/README.zh.md) |
| `packages/goal/` | `command-goal`、`goal`、`goal-round-driver`、`tool-goal` | [README](../packages/goal/README.zh.md) |
| `packages/guard/` | `repeat-tool-reminder`、`timeout-policy` | [README](../packages/guard/README.zh.md) |
| `packages/hooks/` | `hook-protocol`、`hooks-claude-code`、`hooks-codex` | [README](../packages/hooks/README.zh.md) |
| `packages/host/` | `directory-picker`、`directory-picker-auto`、`directory-picker-browse`、`directory-picker-native`、`frontend-static`、`plugin-inventory`、`webserver` | [README](../packages/host/README.zh.md) |
| `packages/identity/` | `anonymous-user-id` | [README](../packages/identity/README.zh.md) |
| `packages/interaction/` | `commands`、`permission-presets`、`tool-ask-user`、`user-approval`、`user-questions` | [README](../packages/interaction/README.zh.md) |
| `packages/jobs/` | `jobs`、`jobs-local`、`tool-jobs` | [README](../packages/jobs/README.zh.md) |
| `packages/llm/` | `deepseek-llm-api-extensions`、`llm`、`llm-deepseek`、`llm-files`、`llm-pi-ai`、`llm-retry`、`plugin-package-inventory-deepseek`、`token-meter` | [README](../packages/llm/README.zh.md) |
| `packages/lsp/` | `lsp`、`lsp-stdio`、`tool-lsp` | [README](../packages/lsp/README.zh.md) |
| `packages/mcp/` | `mcp-client` | [README](../packages/mcp/README.zh.md) |
| `packages/model/` | `model-tasks`、`tool-model-tasks` | `package.json` 和源代码 |
| `packages/plan/` | `plan-mode` | [README](../packages/plan/README.zh.md) |
| `packages/plugin/` | `acceptance`、`protocol`、`runtime`、`sdk` | [README](../packages/plugin/README.zh.md) |
| `packages/preset/` | `agent-presets`、`persona` | [README](../packages/preset/README.zh.md) |
| `packages/runtime-diagnostics/` | `invariants` | [README](../packages/runtime-diagnostics/README.zh.md) |
| `packages/sandbox/` | `sandbox`、`sandbox-local`、`sandbox-policy`、`sandbox-windows-acl` | [README](../packages/sandbox/README.zh.md) |
| `packages/schedule/` | `schedule` | [README](../packages/schedule/README.zh.md) |
| `packages/sdk/` | `client`、`protocol`、`server` | [README](../packages/sdk/README.zh.md) |
| `packages/session/` | `session-checkpoint-policy`、`session-format`、`session-format-catalog`、`session-format-v0-to-v1`、`session-format-v1-to-v2`、`session-log-deepseek`、`session-persistence`、`session-persistence-jsonl`、`session-projection`、`session-projection-cache`、`session-stats`、`session-telemetry`、`session-telemetry-otel`、`session-title`、`session-title-all-prompts-llm`、`session-title-first-prompt-llm`、`session-title-llm`、`session-turn-outline` | [README](../packages/session/README.zh.md) |
| `packages/session-query/` | `session-log-export`、`session-query`、`session-query-sqlite`、`tool-session-query` | [README](../packages/session-query/README.zh.md) |
| `packages/settings/` | `settings`、`settings-file` | [README](../packages/settings/README.zh.md) |
| `packages/shell/` | `bash-local`、`bash-sandbox`、`pwsh-local`、`pwsh-sandbox`、`shell`、`shell-env`、`tool-bash`、`tool-bash-persistent`、`tool-pwsh`、`tool-pwsh-persistent` | [README](../packages/shell/README.zh.md) |
| `packages/skill/` | `skill`、`skill-badge`、`skill-filesystem`、`tool-skill` | [README](../packages/skill/README.zh.md) |
| `packages/spill/` | `spill`、`spill-local`、`spill-policy` | [README](../packages/spill/README.zh.md) |
| `packages/storage/` | `storage`、`storage-domain`、`storage-json`、`storage-sqlite` | [README](../packages/storage/README.zh.md) |
| `packages/subagent/` | `subagent`、`subagent-acp`、`subagent-claude-code`、`subagent-codex`、`subagent-dsh-sdk`、`subagent-fork-in-process`、`subagent-in-process-driver`、`subagent-spawn-in-process`、`tool-subagent`、`tool-subagent-control` | [README](../packages/subagent/README.zh.md) |
| `packages/subprocess/` | `subprocess`、`subprocess-local`、`win32-process` | [README](../packages/subprocess/README.zh.md) |
| `packages/terminal/` | `terminal`、`terminal-bash`、`tool-terminal` | [README](../packages/terminal/README.zh.md) |
| `packages/test-support/` | `agent-loop-testkit`、`client-runtime`、`llm-mock-server`、`llm-replay`、`loader-smoke`、`session-snapshot` | [README](../packages/test-support/README.zh.md) |
| `packages/todo/` | `tool-todo` | [README](../packages/todo/README.zh.md) |
| `packages/trigger/` | `trigger` | `package.json` 和源代码 |
| `packages/typert/` | `generator`、`loader`、`protocol`、`registry` | [README](../packages/typert/README.zh.md) |
| `packages/util/` | `atomic-write`、`brand`、`crypto`、`deque`、`home-paths`、`http-proxy`、`launch-environment`、`native-command`、`output-retention`、`time`、`timeout`、`values`、`workspace-path` | [README](../packages/util/README.zh.md) |
| `packages/web/` | `tool-web`、`web`、`web-fetch-http`、`web-search-deepseek`、`web-search-exa`、`web-search-perplexity` | [README](../packages/web/README.zh.md) |
| `packages/webhook/` | `webhook`、`webhook-github` | [README](../packages/webhook/README.zh.md) |
| `packages/workflow/` | `tool-ralph`、`tool-workflow`、`workflow`、`workflow-worker-thread` | [README](../packages/workflow/README.zh.md) |
| `packages/workspace/` | `workspace` | [README](../packages/workspace/README.zh.md) |

`packages/experimental/` 是私有目录，不应套用正式发布假设。当前树包含 `packages/model/`，虽然较早的顶层摘要没有列出它；它的清单和源代码是权威来源。

-----

<a id="file-conventions"></a>
## 文件约定

| 文件或目录 | 含义 |
| --- | --- |
| `src/index.ts` | 包入口，以及公开注册或导出。 |
| `src/types.ts` | 公开和内部类型声明；包规则禁止在此放运行时代码。 |
| `src/*.generated.ts` | 生成源文件；修改生成器或输入后重新生成。 |
| `tests/` | 包级行为测试，通常使用包实际导出的入口。 |
| `package.json` | 包身份、exports、依赖、Cordis 插件元数据和脚本。 |
| `cordis.yml` 或 `*.cordis.patch.yml` | 组合输入；编辑前检查 resolver 依赖和 profile 所有者。 |
| `tsconfig*.json` | Host/Client 编译器面和 Project Reference 成员关系。 |
| `README.md` 和 `docs/subsystems/*.md` | 当前包和子系统约定；代码变更时同步更新所有者文档。 |
| `scripts/gen-*.ts` 和 `scripts/verify-*.ts` | 生成器和新鲜度/验收所有者；不得手工修改生成结果。 |
| `snapshots/` 和 `*.snap` | 记录模型、用户、协议或构建输出行为；遵循最近的 `AGENTS.md`。 |

-----

<a id="maintenance"></a>
## 维护

本页由人工维护，因为它记录开发所有权和阅读顺序，而生成目录记录签名和关系。新增、重命名、删除或移动包或应用时，在同一改动中更新对应根目录或包组行、链接以及运行时路径行。只改变源文件而没有改变所有权或导航时，不要增加清单项；更新所有者约定即可。

更新本索引前先生成受影响的参考：`pnpm run gen-module-graph`、`pnpm run gen-doc-graphs`、`pnpm run gen-tool-catalog`、`pnpm run gen-config-catalog`，以及受影响页面指定的生成器。使用 `pnpm run verify-md-links` 和 `pnpm run verify-translation-pairing --write docs/development-index.md` 校验链接和双语配对；文档改动最后运行 `pnpm run test:docs`、`pnpm run doc-sync` 和 `git diff --check`。

只有路径可解析、包清单与工作区一致、按改动类型的指引仍指向源代码所有者时，本索引才是最新的。陈旧行属于文档缺陷：应在引入改动的同时修复索引，不要让 agent 自行补偿。
