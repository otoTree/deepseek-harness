---
description: "Electrobun 桌面原型限制与企业集成要求。"
---

# 企业 macOS 原型

[English](README.md) | 中文

## 概述

此目录固定 Electrobun 2.0.1，可构建带内置账号页面的原生桌面宿主。账号页面负责登录、注册、组织关系和团队选择；主界面不会加载管理后台或 Portal。进入团队后，窗口打开打包在 `frontend/` 下的组织隔离 Web 风格 Agent 用户界面，不读取 `apps/web/dist`。原生宿主不会把 API Cookie 暴露给 WebView，会完成桌面 PKCE 授权，启动本地 DSH 进程、续租 Runtime，并在租约或设备会话结束时停止它。Apple Silicon 内置 DSH 可执行文件和完整 Web profile 在分发前仍需通过打包冒烟测试；该发布门槛不会阻塞开发阶段的 Runtime 集成。

## 目录

- [集成要求](#integration-requirements)
- [原生模型提供方](#native-model-provider)
- [远程会话 Provider](#remote-session-provider)
- [企业沙箱](#enterprise-sandbox)
- [开发备注](#dev-note)

<a id="integration-requirements"></a>
## 集成要求

企业客户端通过自己的 `frontend/` 入口复用共享 Web 客户端包和视觉语言，本地运行时组合 [Web profile](../../packages/bundle/web-app/cordis.patch.yml)。Electrobun 将该前端打包到自身资源中，不读取 `apps/web/dist`。不能将不受限制的个人 profile 宣称为受治理的企业运行时。仅有后台 API 无法约束本地模型提供方或动态插件 loader。

「[原生登录](src/desktop-auth.ts)」使用 S256 PKCE、单次且校验 state 的回环回调以及共享 API Schema。[钥匙串辅助程序](native/keychain.swift) 通过 stdin 接收凭据，不使用命令行参数或环境变量；只有条目不存在才返回缺失。原生菜单通过系统浏览器发起登录，不向 WebView 传递凭据。登录成功后，[DesktopSession](src/desktop-session.ts) 从钥匙串读取凭据，启动组织隔离的[运行时管理器](src/runtime.ts)，并通过 [RuntimeHeartbeat](src/runtime-heartbeat.ts) 续租服务端 Runtime。退出登录会停止进程组并删除当前钥匙串条目。运行时管理器要求绝对可执行路径、明确组织以及已配置的 `enterprise-desktop` profile；它会移除继承的凭据，并等待进程组终止。

[LaunchAgent 辅助模块](src/launch-agent.ts) 只写入应用拥有的 plist，支持替换应用自己的注册，并保留 launchctl 错误。[EnterpriseRuntimeController](src/runtime-controller.ts) 负责启动／停止顺序，在登录启动时写入组织专属 `DSH_HOME`，处理注册失败后的清理，支持显式登录启动开关，并且只移除自己安装的 agent。[DesktopSession](src/desktop-session.ts) 切换组织时不会重叠运行时，并在租约续租失败后停止本地工作。原生登录成功后保存的是 Runtime 令牌，而不是刷新令牌协议。[enterprise profile 冒烟测试](tests/profile-smoke.test.ts) 会启动真实 CLI profile，确认已认证的 loopback 重定向，并终止所拥有的进程。

`pnpm --filter @deepseek-ai/dsh-enterprise-desktop typecheck:runtime` 检查 Node 辅助模块及其测试。Electrobun `build` 下载固定版本 SDK 后，`typecheck` 还会依据该 SDK 检查原生桌面壳。`test` 验证回环登录和进程组。原生 Keychain 测试要求先运行 `build:native`，再设置 `ENTERPRISE_TEST_KEYCHAIN=1`；测试创建并删除唯一的测试账号，并验证分块输入凭据。[API 集成测试](../api/tests/identity.test.ts) 组合真实 Better Auth 授权、PostgreSQL 与回环客户端。Electrobun `build` 会把 CLI 生产依赖树、内置 Node 启动器和 Web 前端资源放在应用资源旁边；干净机器上的 GUI 登录和原生模块可移植性检查仍属于发布验收工作。

<a id="native-model-provider"></a>
## 原生模型提供方

`pnpm --filter @deepseek-ai/dsh-enterprise-desktop build:provider` 构建 [Cordis 插件](src/gateway-provider.ts)，导出路径为 `@deepseek-ai/dsh-enterprise-desktop/gateway`。它在 `ctx.llm` 注册 `enterprise` 路由。可信 profile 提供 API origin、Keychain 辅助程序及账号定位信息、请求超时和事件／响应限制，不提供模型提供方密钥。适配器验证凭据与部署／设备的绑定，续期 Runtime 租约，并在发送调用前读取授权模型 ID。网关受理调用时再次检查授权和所提交的策略修订号。

[请求与流转换](src/gateway-wire.ts) 保留系统消息、文本、推理、原始工具参数、工具结果、停止序列，以及先用量后结束的顺序。辅助压缩和 Session 标题用途进入同一网关。适配器仅支持文本，并拒绝未配置的推理控制。缺少完成标记／用量、流格式错误、工具身份变化和模型未授权均会失败，不回退到本地提供方。取消会关闭所持响应。自动重试被禁用，因为结果不确定的计费尝试不能静默变成另一次请求。

生成的企业 profile 会将此提供方与远程 SessionPersistence、企业客户端桥接和 Web profile 组合。源码测试使用仓库的源码解析映射。设置 `ENTERPRISE_TEST_KEYCHAIN=1` 的原生测试还要求先运行 `build:provider` 和根目录的 `pnpm run build`；[profile 测试](tests/gateway-profile.ts) 使用唯一的 Keychain 账号，通过 `dsh --profile` 运行构建后的提供方。API 测试将原生 LLM 调用与真实 PostgreSQL 预留、结算组合验证。完整录制会话回归与真实模型验证仍属于发布验收工作。

<a id="remote-session-provider"></a>
## 远程会话 Provider

`pnpm --filter @deepseek-ai/dsh-enterprise-desktop build:persistence` 构建[远程 Provider](src/session-provider.ts)，导出为 `@deepseek-ai/dsh-enterprise-desktop/session-persistence`。它实现原生 create/open/stat/list/flush 及读写句柄。配置提供 API 来源、Keychain 辅助程序与账号、请求超时和响应字节上限。创建操作立即持久化空 Session 并取得写入权；关闭空 Session 不会删除它。已发布事件路由到持有写入权的句柄；flush 和 close 等待排队的写入完成。释放 Provider 时，先等待进行中的打开操作，再关闭其句柄。

API 确认已提交的 PostgreSQL 写入，将 fork 继承数量与事件分别保存，对列表和事件读取进行分页，并将写入者绑定到已认证的 Runtime。原生读取使用 DSH 验证器重建当前逻辑 Session，拒绝未知的必需事件。目前读取会先获取完整日志再切片；大历史记录仍需优化。追加和 flush 会续租写入者租约。续租失败或追加结果不确定会永久封禁该句柄的写入；恢复时必须关闭它，重新打开服务端日志并检查已提交状态。不会自动重放，也不会回退到本地 JSONL。

[API 测试](../api/tests/identity.test.ts) 使用真实 PostgreSQL 验证原生句柄，包括确认丢失和创建期间释放。设置 `ENTERPRISE_TEST_KEYCHAIN=1` 后，还会通过具名 DSH profile 和真实 Keychain 验证构建后的插件。共享持久化及实时写入测试、空闲期间周期续租、执行准入检查、中断操作恢复界面、历史日志导入、附件和搜索/导出仍未验证或未完成。生成的企业 profile 会为桌面会话挂载此 Provider。

<a id="enterprise-sandbox"></a>
## 企业沙箱

[企业沙箱](src/enterprise-sandbox.ts) 为具名桌面 profile 包装现有 `sandbox-local` Provider。在 macOS 上，受限调用使用平台 Seatbelt 运行器；功能探测失败时返回 `SANDBOX_UNAVAILABLE`，不会返回未受限命令。调用方每次传入绝对工作区路径，并选择 `read-only` 或 `workspace-write`。`danger-full-access` 仍是 Provider 之外的显式用户选择。该包装不承诺网络隔离或防止本机管理员篡改，完整桌面 profile 仍需挂载其消费者。

<a id="dev-note"></a>
## 开发备注

[验收要求](../../docs/developer/discussion/enterprise-client-acceptance.md) 区分 Web 基线行为与经过验证的企业行为。
