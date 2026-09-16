# 企业客户端验收

[English](enterprise-client-acceptance.md) | 中文

## 概述

本文记录企业 macOS 交付要求，以及开发中后台已有的验证证据。目前没有内测安装包。阶段一已针对开发宿主封板：运行时生命周期、凭据存储、本地窗口信任边界、原生桥接策略、错过任务处理和定向集成测试均已通过。可发行打包和 Apple 签名属于最终交付阶段，不是较早运行时和平台阶段的前置条件。

## 目录

- [功能基线](#feature-baseline)
- [交付阶段](#delivery-stages)
- [阶段一验收报告](#stage-one-acceptance-report)
- [阶段二验收报告](#stage-two-acceptance-report)
- [可发行打包与安装](#release-packaging-and-installation)
- [本地验证](#local-verification)
- [开发备注](#dev-note)

<a id="feature-baseline"></a>
## 功能基线

[Web profile](../../../packages/bundle/web-app/cordis.patch.yml)、[Web 入口](../../../apps/web/src/main.ts) 和 [Web 测试](../../../apps/web/tests/README.zh.md) 定义功能基线。实验包不自动纳入。阶段一范围之外的原生集成仍未验证。

| Web 功能 | 所需企业适配 | 所需验收证据 |
|---|---|---|
| 聊天、会话、工作区 | 复用现有客户端插件，隔离组织运行时与缓存 | 切换组织后的真实流式对话，不泄露跨组织数据 |
| 附件与工具卡片 | 租户对象存储、原生工作区选择及现有展示转换器 | 上传、执行、渲染、读取，并拒绝访问其他组织附件 |
| Subagent、计划、目标 | 嵌套任务使用相同的平台启用模型提供方与权威事件 | 含委派工具及策略拒绝的录制会话回归 |
| 后台任务与定时任务 | 窗口退出后继续运行的本地用户服务，审批暂停及错过任务处理 | 工作期间关闭界面，验证继续执行、通知、安全恢复和完全停止 |
| 搜索、导出、会话 | 远程 SessionPersistence、分页、租约续期及管理员审计访问 | 搜索／导出／分叉、双设备冲突、断网及已发布日志兼容性 |
| 设置与模型选择 | 替换提供方／密钥设置、默认模型、命令、标题和压缩来源 | 拒绝篡改 ID／地址，所有模型调用均不能回退到本地密钥 |
| 插件创建与激活 | 所有加载入口强制检查不可变审批摘要和签名 | 未审批、被修改、跨租户及被撤销代码无法执行 |
| 本机权限与工具 | 现有 Seatbelt 提供方，用户选择只读／可写／完全访问 | 真实文件系统和符号链接测试，沙箱不可用时拒绝工作 |

<a id="delivery-stages"></a>
## 交付阶段

[API](../../../apps/api/README.zh.md)、[后台](../../../apps/admin/README.zh.md)、[桌面端](../../../apps/electrobun/README.zh.md) 和[沙箱原型](../../../apps/sandbox/README.zh.md) 分别负责组件详情。阶段一已经完成开发实现并具备定向测试证据。阶段二已经有实现和本地 Redis 集成证据，但在真实模型提供方验证前仍保持开放。

| 阶段 | 已有证据 | 尚缺交付 |
|---|---|---|
| macOS 运行时 | 带自有 Web 风格前端的原生窗口宿主、负责注册和 PKCE 授权的独立用户 Portal、组织隔离的 DSH profile、认证的 loopback Web 地址、Keychain helper、进程组清理、心跳封禁、组织切换、原生桥接（远程认证窗口沙箱化、本地窗口受信）、错过任务状态处理、真实 `enterprise-desktop` CLI profile 冒烟测试、LaunchAgent 安装／bootstrap／bootout／卸载冒烟测试，以及 Electrobun 开发构建和信号退出；`lint`、完整类型检查和桌面测试通过 | 完整交互式 GUI 身份提供方登录需要配置真实身份环境；可发行 Runtime 和安装包检查明确延期到最终交付阶段 |
| 模型与成本 | 原生 LlmAdapter、构建后 DSH profile／Keychain 冒烟测试、授权目录、取消与工具流测试；真实 PostgreSQL 并发预算、结算与截断调用测试；按组织、账号和模型隔离的 Redis 原子请求／并发限流及显式待核对调用测试 | 桌面组合、自动核对、多模态支持、录制 Session 与真实模型流程 |
| 权威会话 | 租户 API 事件追加与租约拒绝测试；通过构建后的 `dsh` profile、真实 Keychain／PostgreSQL 验证原生 Provider、分页、fork 元数据、封禁和不确定写入恢复 | 桌面 Web 组合、共享持久化／实时写入契约测试、空闲期间周期续租、附件、搜索／导出和中断操作界面 |
| Seatbelt | 现有提供方通过五项真实 macOS 内核测试 | 企业 profile 组合、FS／Shell／Terminal 消费者、用户权限选择与端到端失败关闭执行 |
| 插件供应链 | 提交、保守扫描、AI 审核处理、人工签名和撤销路由，以及拒绝测试 | 依赖构建／SBOM／扫描、真实 AI 审核、所有加载入口强制检查、撤销卸载与录制会话回归 |
| 管理后台 | Better Auth／PostgreSQL 测试、Next 构建、DSH API profile 启停、已分离的管理控制台，以及通过真实浏览器完成注册／登录／创建团队的用户 Portal | 完整组织／角色／会话／插件界面、部署初始化验证、真实邮件流程与全部管理操作的浏览器端到端验收 |

<a id="stage-one-acceptance-report"></a>
## 阶段一验收报告

开发实现覆盖本机运行时生命周期，但不宣称已经形成可分发应用。运行时为每个组织隔离 DSH home，将本地 Web 端点绑定到 loopback，验证启动 token，在窗口关闭后保持 Agent 运行，并在停止或注销时清理所属进程组。Electrobun 打包自己的前端构建并复用共享 Web 客户端包，不读取 `apps/web/dist`。用户 Portal 负责注册、组织关系、密码重置和桌面授权；管理后台只暴露管理功能。控制器实现心跳和租约处理，在撤销后停止工作，并在组织切换时先停止旧 profile 再启动新的隔离 profile。Keychain helper 将长期凭据保存在 WebView 存储、命令行参数和插件环境之外。远程认证页面使用无 RPC 的 sandbox 窗口；运行时报告经过校验的 loopback 地址后，才创建带 allow-list 原生桥接和浏览器 facade 的受信窗口。本地定时工作在注销、运行时停止或连接丢失时标记为错过，绝不自动重跑。LaunchAgent plist 生成、生命周期控制和主机生命周期冒烟测试均已覆盖。

定向证据如下：

```sh
pnpm run lint
pnpm run typecheck
pnpm --filter @deepseek-ai/dsh-enterprise-desktop typecheck
pnpm --filter @deepseek-ai/dsh-enterprise-desktop typecheck:runtime
ENTERPRISE_TEST_KEYCHAIN=1 pnpm --filter @deepseek-ai/dsh-enterprise-desktop test
git diff --check
```

桌面测试套件报告 36 项测试通过，另有两项平台条件跳过，覆盖 PKCE、Keychain、进程组清理、心跳、构建后的 `enterprise-desktop` profile、原生提供方、插件加载、沙箱选择、组织切换、原生窗口信任策略和错过任务处理。主机冒烟测试安装、bootstrap、bootout 并移除了应用自有的 LaunchAgent plist，结束后没有残留 plist；Electrobun 开发构建和信号退出也已执行且没有残留所属进程。真实浏览器流程还验证了无需 SMTP 验证即可注册新用户、创建团队、选择组织，并确认管理后台不提供用户注册或桌面授权。交互式 GUI 身份提供方登录及无开发工具的可发行 Runtime 属于发布／环境检查，不会被默认为通过。

因此，阶段一已针对开发和集成工作封板。下一个唯一入口是阶段二：远程模型 Provider 与计量。可发行 Runtime、完整 bundle、Apple 签名、公证、安装、升级和卸载仍由最终发布阶段负责。

<a id="stage-two-acceptance-report"></a>
## 阶段二验收报告

网关会验证 Runtime、解析平台启用的模型，并在发送前以原子方式占用组织与请求幂等键。重复键会在再次调用上游前返回冲突；完整的 OpenAI 兼容流根据观测用量结算占用，不含完整用量的响应会释放占用，结算存储失败则保留为 `pending_reconciliation`，由带审计的核对接口处理。中继路径不执行模型授权、策略修订、预算或限流。原生提供方和集成测试使用有界 SSE fixture，因此不宣称已调用真实付费模型。

定向证据如下：

```sh
pnpm --filter @deepseek-ai/dsh-enterprise-api typecheck
pnpm --filter @deepseek-ai/dsh-enterprise-api test
pnpm exec tsx --tsconfig tsconfig.base.json --test apps/api/tests/rate-limit.test.ts
```

阶段二尚未封板，因为真实提供方往返、针对该提供方的取消结算以及自动上游状态核对仍未验证。下一项实现必须取得这些证据；阶段二门槛关闭前不得开始阶段三。

<a id="release-packaging-and-installation"></a>
## 可发行打包与安装

此最终阶段仅在六个产品阶段各自通过验收门槛后开始。该阶段负责可分发的 Apple Silicon Runtime、完整 Electrobun 应用 bundle、签名与公证、干净机器安装、升级、卸载、Keychain 迁移、LaunchAgent 持久化和残留进程清理。没有已签名安装包不会阻塞开发或企业内测集成工作，但在本阶段通过前不得声称可以公开或交付客户安装。

<a id="local-verification"></a>
## 本地验证

在本项目独立基础设施上执行定向检查：

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

API 测试分配自己的 PostgreSQL 数据库和临时 profile，profile 监听使用操作系统分配的回环端口。桌面测试仅创建唯一的测试 Keychain 账号和临时执行目录，不安装 LaunchAgent。测试先关闭所持资源，再清理。测试不会创建生产用户、调用付费模型或触碰其他项目数据库。现有 Seatbelt 测试验证提供方，不代表企业 Agent 工作流。

应用数据库已迁移，但尚未初始化初始管理员。使用两个 `ENTERPRISE_BOOTSTRAP_*` 变量运行 `pnpm run enterprise:provision`，或在 TTY 中回答提示；已有部署会在询问前被拒绝。未经初始化启动 API 会默认拒绝。仅当设置 `ENTERPRISE_REQUIRE_EMAIL_VERIFICATION=true` 时才需要 SMTP；模型凭据和选定的初始管理员身份仍是外部前提，缺少这些前提不能证明相应流程通过。

<a id="dev-note"></a>
## 开发备注

此实现不改变现有 DSH 产品行为或 Session JSONL 代际。[平台蓝图](enterprise-agent-platform.zh.md) 与[身份提案](../../../.agents/notes/proposed/architecture/2026-09-05-enterprise-identity-and-organization.zh.md) 的范围仍大于此处已交付代码。
