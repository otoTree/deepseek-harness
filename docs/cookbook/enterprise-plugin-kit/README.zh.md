# 企业插件开发包

[English](README.md) | 中文

这个目录是可信 Harness 企业插件的独立开发包，特意把文档、SDK 发行包、Host/Client/Skill/MCP 标准样例、manifest 和打包脚本放在同一个特殊目录中。开始开发前，把整个目录复制到 Harness 仓库之外的独立代码仓库。解压后的目录是开发工作区，最终的 `.dsh-plugin.zip` 才是提交给平台的唯一文件。

## 内容

| 路径 | 用途 |
| --- | --- |
| `docs/sdk.md` | SDK 能力、包版本、传输规则和生命周期说明。 |
| `docs/slots.md` | 当前 58 个 Client Slot key 的索引；`docs/slot-catalog.json` 保留注册选项、owner props、框架 props、示例和源码指针。 |
| `sdk/*.tgz` | 与平台版本匹配、可离线安装的 `protocol`、`sdk` 和 `runtime` 包。 |
| `src/host.ts` | 通过注入 SDK 注册 Tool、Skill 和可选 MCP bridge 的 Host 样例。 |
| `src/client.ts` | 通过 `settings.section` 提供设置面板的 Client 样例。 |
| `packages/standard/package.json` | schema v3 要求的 Cordis package 元数据。 |
| `presets/default/agent.cordis.yml` | 组合样例 package 且不替换 Agent loop 的声明式 Agent preset。 |
| `scripts/build.mjs` | 把 Host 和 Client 入口打包到 schema v3 目录。 |
| `scripts/package.mjs` | 写入 lockfile 摘要、计算入口完整性并生成 `.dsh-plugin.zip`。 |
| `scripts/verify.mjs` | 重新打开 ZIP，校验 manifest、路径、package metadata 和哈希。 |

## 从开发包开始

1. 把这个目录复制到独立仓库，修改 `pluginId`、package 名称、展示文案和 contribution id。
2. 执行 `pnpm install`。`sdk/*.tgz` 提供 Harness 插件 protocol 和 SDK 依赖，不需要 Harness checkout 或访问 registry。
3. 同步修改 `src/host.ts`、`src/client.ts`、`manifest.json` 和 `packages/standard/package.json`；产品不提供某个 target 时删除对应入口和声明。
4. 执行 `pnpm run typecheck`、`pnpm run build`、`pnpm run package` 和 `pnpm run verify:package`。
5. 通过平台管理员流程上传 `dist/acme-enterprise-plugin-1.0.0.dsh-plugin.zip`。平台会继续执行兼容性、权限、完整性和激活校验。

这个开发包是参考实现，不是平台运行时。它不包含凭据、Agent loop、Host 进程或 Client shell。验证后的入口加载时，平台负责注入 `pluginSdk`、`tools` 和 `slots`。

## 贡献方式

- Host Tool 使用 `ctx.tools.register()`，Host fiber 激活后 Agent 才能看到它。
- Skill 使用 `ctx.pluginSdk.skills.register()`，activation 释放时自动移除。
- MCP 在 `src/host.ts` 中是可选桥接：选择服务器和授权模式后，再增加 `mcp.connect`、`mcp:*` contribution 以及平台要求的 `contributions.mcpConnection` metadata。启用后，辅助函数调用 `ctx.pluginSdk.mcp.connect()`，发现工具并把带限定名的名称注册进 `ctx.tools`。
- Agent 类型使用 `presets/` 下的 preset 文件声明；preset 只组合 package，不实现 Agent loop。
- Client UI 使用 `ctx.slots.inject()` 再调用 `ctx.slots.register()`。建议从 [Slot 目录](docs/slots.zh.md) 中的 additive `list` 或 `keyed` Slot 开始。`single` Slot 会替换内置占用者，只有产品确实拥有整块界面时才使用。

## 发行边界

`sdk/` 中的 SDK 包是带版本的快照。只有平台发布兼容版本时才替换它们，并从同一版本重新生成 Slot 目录。不要把 Harness 的 `apps/`、`packages/`、数据库模块或桌面源码导入开发包。
