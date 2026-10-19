---
description: "构建并验证 macOS 与 Windows 企业桌面客户端。"
---

# 企业桌面客户端

[English](README.md) | 中文

## 概述

此包固定 Electrobun 2.0.1，可构建带内置账号页面的原生桌面宿主。账号页面负责登录、注册、组织关系和团队选择；主界面不会加载管理后台或 Portal。进入团队后，窗口打开打包在 `frontend/` 下的组织隔离 Web 风格 Agent 用户界面，不读取 `apps/web/dist`。工作区和独立插件窗口使用平台原生标题栏，以及支持复制、粘贴、撤销、重做、剪切和全选的原生 Edit 菜单角色。原生宿主不会把 API Cookie 暴露给 WebView，会完成桌面 PKCE 授权，启动本地 DSH 进程、续租 Runtime，并在租约或设备会话结束时停止它。宿主平台的本机安装包构建会在生成产物前，使用本地 fixture 启动包内 DSH profile；这些检查不代表原生模块可在全新机器上运行。

## 目录

- [本机 macOS 安装包](#local-macos-installer)
- [本机 Windows 安装包](#local-windows-installer)
- [安装包产物保护](#installer-artifact-protection)
- [集成要求](#integration-requirements)
- [原生模型提供方](#native-model-provider)
- [远程会话 Provider](#remote-session-provider)
- [企业沙箱](#enterprise-sandbox)
- [开发备注](#dev-note)

<a id="local-macos-installer"></a>
## 本机 macOS 安装包

使用已安装 Bun、Xcode Command Line Tools、工作区依赖和桌面开发所需固定版本 Electrobun SDK 投影的 Apple Silicon macOS，再从仓库根目录运行下列命令。它会重新构建工作区库、桌面前端、插件、原生辅助程序和打包运行时，生成 `apps/electrobun/artifacts/local/deepseek-harness-enterprise-<version>-macos-arm64-local.dmg` 及 SHA-256 校验文件。版本来自本应用的包清单。获取已发布的校验和及尚未缓存的运行时归档需要访问 nodejs.org。构建暂存使用独立的 Electrobun 项目，因此正在运行的开发应用不会持有安装包构建锁。

```sh
pnpm run enterprise:package:desktop
pnpm --filter @deepseek-ai/dsh-enterprise-desktop verify:installer
```

验证器以只读方式挂载 DMG，将应用复制到仓库外的私有临时 Applications 目录，检查签名和已保护资源，并通过本地模拟 API 与凭据辅助程序启动包内企业 Web profile。它无需模型密钥，即可覆盖有模型和空模型目录、认证后的 HTML 以及运行时关闭。随后会删除临时安装。交互使用时，打开 DMG，将应用拖入 Applications 后启动。客户端需要可访问的企业 API 和 Portal；原生宿主从启动环境读取 `ENTERPRISE_API_URL` 和 `ENTERPRISE_PORTAL_URL`，默认分别为 `http://127.0.0.1:8787` 和 `http://127.0.0.1:3001`。

应用使用 ad-hoc 签名，没有 Apple Developer ID，也未经过公证。下载后的副本首次启动时，可能需要在 macOS「隐私与安全性」中明确批准。此安装包验证构建机器上的安装，不代表 Gatekeeper 信任、Intel 兼容性或全新机器上的原生模块可移植性。

<a id="local-windows-installer"></a>
## 本机 Windows 安装包

在 x64 Windows 主机上构建，需要 Node.js 22.19.x 或 24+、pnpm、Bun，以及 Zig 或带 Windows SDK 的 Visual Studio C++ Build Tools。首次准备 Electrobun 和下载未缓存的官方 Node 运行时需要网络。从仓库根目录安装工作区依赖并运行：

~~~sh
pnpm install
pnpm run enterprise:package:desktop
pnpm --filter @deepseek-ai/dsh-enterprise-desktop verify:installer
~~~

构建会生成 `apps/electrobun/artifacts/local/deepseek-harness-enterprise-<version>-windows-x64-local.zip` 及 SHA-256 校验文件。ZIP 内含 `deepseek-harness-enterprise-Setup.exe` 和包含元数据、压缩应用载荷的 `.installer/` 目录。请完整解压 ZIP，并从解压目录运行 Setup.exe，以便安装器读取 `.installer/`。验证器检查校验文件、x64 PE 文件头、stable 应用元数据和 Zstandard 载荷。构建会在生成 ZIP 前混淆第一方 JavaScript，并使用本地模拟 API 冒烟测试打包后的 profile。

`verify:installer` 检查归档内容，但不会运行 Setup.exe 界面。请在 x64 Windows 机器上完成一次交互式安装检查。Windows 构建不会添加 Authenticode 签名或发布者身份，因此不代表发布者已受信任，也不代表原生模块可在全新机器上运行。

<a id="installer-artifact-protection"></a>
## 安装包产物保护

macOS 和 Windows 安装包会混淆主进程、前端、内置插件及运行时依赖树中的第一方 JavaScript。每个安装包都包含对应构建宿主平台的官方 Node 运行时，并使用 Node 发布的 SHA-256 校验和验证；Node 许可证也随包分发。macOS 启动器会将自身替换为 Node；Windows 启动器会在关闭时终止其 Job Object 中的 Node 运行时。

暂存资源会移除 TypeScript、source map、source-map 注释、原生源码文件和 `.env` 文件。第三方 JavaScript 保持可执行，第三方许可证保留在依赖树中。公开导出、属性名和通过反射读取的服务名保持稳定。`protection.json` 记录受保护模块的哈希；验证器拒绝新增、变更或缺失的第一方脚本，以及泄漏的源码和调试文件。这些措施提高逆向成本，但不会加密浏览器代码、隐藏公开协议、保护内嵌密钥，也不能阻止本机管理员检查可执行逻辑。参见[打包决策](../../.agents/notes/implemented/architecture/2026-10-19-local-desktop-installer-protection.zh.md)。

<a id="integration-requirements"></a>
## 集成要求

企业客户端通过自己的 `frontend/` 入口复用共享 Web 客户端包和视觉语言，本地运行时组合 [Web profile](../../packages/bundle/web-app/cordis.patch.yml)。Electrobun 将该前端打包到自身资源中，不读取 `apps/web/dist`。不能将不受限制的个人 profile 宣称为受治理的企业运行时。仅有后台 API 无法约束本地模型提供方或动态插件 loader。

「[原生登录](src/desktop-auth.ts)」使用 S256 PKCE、单次且校验 state 的回环回调以及共享 API Schema。macOS 钥匙串辅助程序和 Windows DPAPI 辅助程序通过 stdin 接收凭据，不使用命令行参数或环境变量；只有条目不存在才返回缺失。原生菜单通过系统浏览器发起登录，不向 WebView 传递凭据。登录成功后，[DesktopSession](src/desktop-session.ts) 从系统凭据存储读取凭据，启动组织隔离的[运行时管理器](src/runtime.ts)，并通过 [RuntimeHeartbeat](src/runtime-heartbeat.ts) 续租服务端 Runtime。已认证页面只接收哈希后的 Runtime 存储 identity，不接收凭据 token；原生 Workbench 视图根据该 identity 和聊天 Session 生成持久分区，分别隔离 Runtime 与 Session 的站点存储。退出登录会停止所管理的 Runtime 并删除当前凭据。运行时管理器要求绝对可执行路径、明确组织以及已配置的 `enterprise-desktop` profile；它会移除继承的凭据并等待进程退出。Windows 启动器使用关闭时自动终止的 Job Object 管理 Node 运行时。

桌面随包提供 CEF Chromium，用于沙箱内的原生浏览器 guest。可信应用壳使用原生 renderer。[`browser-config.ts`](src/browser-config.ts) 配置回环 CDP（默认端口 `9333`，构建及运行环境变量为 `DSH_DESKTOP_CDP_PORT`）；组织 profile 将 Playwright 连接到该端点。[Workbench 浏览器](../../packages/client/ui-workbench/README.zh.md)渲染 Agent 工具控制的同一页面。 [`browser-lifecycle.ts`](src/browser-lifecycle.ts) 在 macOS 上拦截 Electrobun 2.0.1 移除已加载 CEF 客体时额外发出的宿主窗口关闭请求。

原生账号入口服务器接受最大 64 KiB 的请求头，并在 HTML 响应中让旧的 `dsh-auth-*` Cookie 失效。这样，带有旧 Runtime 端口 Cookie 的桌面窗口仍能打开登录页，并在加载认证 Web UI 前完成清理。

[LaunchAgent 辅助模块](src/launch-agent.ts) 只写入应用拥有的 plist，支持替换应用自己的注册，并保留 launchctl 错误。[EnterpriseRuntimeController](src/runtime-controller.ts) 负责启动／停止顺序，在登录启动时写入组织专属 `DSH_HOME`，处理注册失败后的清理，支持显式登录启动开关，并且只移除自己安装的 agent。[DesktopSession](src/desktop-session.ts) 切换组织时不会重叠运行时，并在租约续租失败后停止本地工作。原生登录成功后保存的是 Runtime 令牌，而不是刷新令牌协议。[enterprise profile 冒烟测试](tests/profile-smoke.test.ts) 会启动真实 CLI profile，确认已认证的 loopback 重定向，并终止所拥有的进程。

`typecheck:runtime` 检查 Node 辅助模块和测试；`typecheck` 使用固定 SDK 检查原生壳。原生 Keychain 测试需要 `build:native` 和 `ENTERPRISE_TEST_KEYCHAIN=1`。Electrobun 将 DSH 可执行文件、原生辅助程序、前端和插件产物放入应用。共享 Cordis 和 MCP runtime package 保持外部依赖并放在同一依赖树，保留 service 身份。`verify:build` 使用隔离的原生 Node 解析导入 Host 入口，并拒绝应用外依赖。全新机器上的原生模块可移植性仍属于发布验收。

原生退出保护在窗口、账户服务和所管理 runtime 停止前，通过 Electrobun 的同步 `before-quit` 事件阻止退出；清理失败后可以重试退出。

<a id="native-model-provider"></a>
## 原生模型提供方

`pnpm --filter @deepseek-ai/dsh-enterprise-desktop build:provider` 构建 [Cordis 插件](src/gateway-provider.ts)，导出路径为 `@deepseek-ai/dsh-enterprise-desktop/gateway`。它在 `ctx.llm` 注册 `enterprise` 路由。可信 profile 提供 API origin、Keychain 辅助程序及账号定位信息、传输宽限超时和事件／响应限制，不提供模型提供方密钥。适配器验证凭据与部署／设备的绑定，续期 Runtime 租约，并在发送调用前读取平台启用的模型 ID。它通过 API 的 `/model/*` namespace 发送 Chat、Responses 和 Files 操作，并保留此前缀后的每条原生协议路径；每个请求都指定选中的平台模型 ID，而不是上游提供方模型名。模型调用先使用目录中的超时，再等待传输宽限超时，因此 API 拥有上游截止时间，并能在桌面取消前返回失败。API 验证 Runtime 并解析平台模型后转发调用。

[请求与流转换](src/gateway-wire.ts) 按所选目录条目把 DSH 消息映射为 OpenAI Chat Completions 或 Responses。它通过附件服务解析持久图片、视频、音频和文档；提供方文件策略使用共享 `llm-files` 协调器，有界内联策略则生成请求范围内的 Base64。媒体读取使用 profile 的 `maxMediaBytes` 限制，并与模型输出和网关元数据使用的 `maxResponseChars` 限制分开。当 Files API 上传仍处于处理状态时，适配器会按已配置的间隔轮询原生 `/files/:id` 资源，直到文件可用、处理失败或达到模型的上传超时；取消会同时停止等待和状态请求。目录元数据会另外说明原生视频只覆盖画面，还是也理解内嵌音轨；独立音频输入仍使用 `audio` 模态，两种视频模式则使用相同的提供方视频协议项。Responses 历史把 assistant 文本生成为已完成的原生消息项，并保留它与 reasoning 及后续媒体输入的顺序。Responses 工具结果把文本保留为有关联关系的 `function_call_output` 字符串，并把媒体放入相邻的用户输入项，因为 Ark 会拒绝结构化的 `function_call_output.output` 值。企业 API 校验模态声明与限制，使用服务端凭据上传提供方文件，并在不转换协议的情况下转发所选响应。适配器接受初始事件省略 `arguments` 的 Responses 函数调用项，累积后续参数增量，并要求完成项包含最终字符串。它把 reasoning-summary 记录投影为 DSH reasoning 块，并把每个非空的加密 reasoning 项与对应的原生函数调用一起存入带版本且按块对齐的适配器回放状态。后续工具轮次会在 `function_call_output` 之前按原顺序恢复这些原生项；初始事件中的空 `encrypted_content` 会被忽略，已经出现但不是字符串的协议字段则会关闭式失败。回放状态不包含附件数据或提供方文件标识符。适配器把 HTTP 429 分类为 `RATE_LIMIT`，把网关超时分类为 `TIMEOUT`，严格拒绝未知流式事件，并在取消时关闭附件读取、上传、状态轮询和模型响应。

生成的企业 profile 会将此提供方与远程 SessionPersistence、企业客户端桥接和 Web profile 组合。源码测试使用仓库的源码解析映射。设置 `ENTERPRISE_TEST_KEYCHAIN=1` 的原生测试还要求先运行 `build:provider` 和根目录的 `pnpm run build`；[profile 测试](tests/gateway-profile.ts) 使用唯一的 Keychain 账号，通过 `dsh --profile` 运行构建后的提供方。完整录制会话回归与真实模型验证仍属于发布验收工作。

生成的 profile 覆盖 Web bundle 已有的 `agent-presets` 条目，保留内置 preset 并将 `standard` 设为默认 preset，同时加入组织 DSH Home 的 `.agent-presets` 目录以发现插件安装器管理的 Agent preset。这样组织 roster 不会读取个人 preset 文件，同时允许插件生命周期安装和移除 Agent composition。

<a id="remote-session-provider"></a>
## 远程会话 Provider

`pnpm --filter @deepseek-ai/dsh-enterprise-desktop build:persistence` 构建[远程 Provider](src/session-provider.ts)，导出为 `@deepseek-ai/dsh-enterprise-desktop/session-persistence`。它实现原生 create/open/stat/list/flush 及读写句柄。配置提供 API 来源、Keychain 辅助程序与账号、请求超时和响应字节上限。创建操作立即持久化空 Session 并取得写入权；关闭空 Session 不会删除它。已发布事件路由到持有写入权的句柄；flush 和 close 等待排队的写入完成。释放 Provider 时，先等待进行中的打开操作，再关闭其句柄。

API 确认已提交的 PostgreSQL 写入，将 fork 继承数量与事件分别保存，对列表和事件读取进行分页，并将写入者绑定到已认证的 Runtime。原生读取使用 DSH 验证器重建当前逻辑 Session，拒绝未知的必需事件。目前读取会先获取完整日志再切片；大历史记录仍需优化。追加、空闲续租和 flush 会续租写入者租约。续租失败或追加结果不确定会永久封禁该句柄的写入；恢复时必须关闭它，重新打开服务端日志并检查已提交状态。不会自动重放，也不会回退到本地 JSONL。

[API 测试](../api/tests/identity.test.ts) 使用真实 PostgreSQL 验证原生句柄，包括确认丢失和创建期间释放。设置 `ENTERPRISE_TEST_KEYCHAIN=1` 后，还会通过具名 DSH profile 和真实 Keychain 验证构建后的插件。共享持久化及实时写入测试、空闲期间周期续租、执行准入检查、中断操作恢复界面、历史日志导入、附件和搜索/导出仍未验证或未完成。生成的企业 profile 会为桌面会话挂载此 Provider。

<a id="enterprise-sandbox"></a>
## 企业沙箱

[企业沙箱](src/enterprise-sandbox.ts) 为具名桌面 profile 包装现有 `sandbox-local` Provider。在 macOS 上，受限调用使用平台 Seatbelt 运行器；在 Windows 上使用 ACL 受限令牌运行器。所选后端不可用时，调用会失败关闭。生成的桌面 profile 让 Session 从 `workspace-write` 启动，因此 Workbench 和 agent 可以更新组织工作区内的文件，同时仍拒绝工作区外的路径。调用方传入绝对工作区路径，并可为范围更窄的调用选择 `read-only`。`danger-full-access` 仍是 Provider 之外的显式用户选择。该包装不承诺网络隔离或防止本机管理员篡改，完整桌面 profile 仍需挂载其消费者。

<a id="dev-note"></a>
## 开发备注

[验收要求](../../docs/developer/discussion/enterprise-client-acceptance.zh.md) 区分 Web 基线行为与经过验证的企业行为。
