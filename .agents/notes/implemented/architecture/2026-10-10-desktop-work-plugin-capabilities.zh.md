# Agent Note：桌面工作插件使用已校验的 Host 包

Status: implemented

[English](2026-10-10-desktop-work-plugin-capabilities.md) | 中文

## Problem

桌面插件协议可以安装已校验的 ZIP，但清单和 SDK 只描述身份、模型、存储和缓存。飞书、邮箱、企业检索、MCP 服务和运维技能没有可声明的能力位置。产品还需要一个独立源码工作区，为每个能力生成可单独安装的 ZIP，同时不能让桌面客户端信任源码目录。

## Decision

协议提供可选的 Host 网络域名白名单和凭据描述字段。权限词表包含网络请求、Host 凭据、授权、MCP 连接、Skill 注册和安装配置。schema v2 保留产品级 target；schema v3 在 Cordis package 下分组 Host 和 Client target，并要求每个 package 的 `package.json` 元数据与 manifest 一致。SDK 提供可选能力门面，安装包解析器会在激活前校验声明。

`/Users/hjr/Desktop/plugins` 是独立工作插件源码工作区。每个产品都有独立身份和 ZIP 产物。Esbuild 把共享源码和第三方库合并到各 Host 入口；Harness 原生 service package 保持为声明的外部依赖，以保留运行时 service 身份。构建生成完整性记录和 package 元数据。Memory 和 Agent 编排仍不在工作区范围内。

桌面端在写入 Host package 文件前校验 ZIP，并将文件放入组织专属 DSH Home。每个 Host 入口由 `ctx.loader` 加载到 Cordis group，Loader fiber 管理 Host 注册和释放。Host 把 Client bundle 提供给浏览器，再由浏览器模块加载器挂载；不同 `moduleId` 允许一个产品 release 独立加载和移除多个 Client package。Host 外部 import 必须声明为 package 依赖，并能从当前 Harness runtime 解析。

桌面 Host 还提供可复用的发现函数，只读取 `<workspace>/<pluginId>/dist/*.dsh-plugin.zip`，使用发布流程相同的解析器校验每个包，并忽略无效归档或目录身份不匹配的文件。源码目录不会成为激活输入。manifest 声明不能证明 Tool 或 Skill 对 Agent 可见；Cordis package 必须向 Harness runtime 注册它们。

Electrobun 企业 profile 覆盖 Web bundle 已有的 `agent-presets` 条目，避免插入重复的 Loader id。它保留内置根以提供默认 `standard` preset，将 `<组织 DSH_HOME>/.agent-presets` 显式配置为 `user` 信任根，并关闭派生的个人 Home 根。因此 roster 能发现内置和插件管理器安装的 preset，同时不会读取无关的个人 preset 文件。真实 profile 启动测试覆盖已配置模型和无模型两种情况。

激活在提交就绪状态前检查 package fiber 对 Tool、Skill 注册的归属，并投影 Tool schema。MCP 证据包含归属正确的连接状态和发现工具。Client 诊断要求各 module 的实际 slot 注册。Agent preset 文件和持续 preset 挂载随 activation 释放；AgentPresets 管理组合和子 Agent 继承。升级失败会恢复上一份可用产品，但当前授权修订禁止时不会恢复。无密钥 Agent 验收将持久化 Session 事件重放结果与实际模型请求核对，市场标签不作为能力证据。

独立的 `cordis-reference` 验收产品在安装配置未提供 `mcpUrl` 时，于系统分配的端口启动随包提供的本地 MCP 服务。Host fiber 管理其监听器和 MCP 会话。显式 `mcpUrl` 选择外部服务，连接错误仍导致激活失败。按需运行的真实 ZIP 回归测试使用空安装配置，验证无密钥模型请求，并检查停用产品后监听端口关闭。仅使用合成组合 fixture 无法证明已发布产品能以市场默认配置启动。

Client 插槽校验读取 Cordis 的实际插槽声明。Manifest contribution id 在 keyed 插槽中选择注册的 `key`，在 list 插槽中选择注册的 `id`，不是独立的 UI 标签。真实 Media Canvas ZIP 回归覆盖两种选择值、Client 就绪上报和释放。错误的选择值导致激活失败并释放已挂载的 bundle。此机制保留 Cordis 注册语义，不增加另一套注册表。

经过校验的 MCP 产品在运行入口配置之外声明连接 URL 和授权模式。市场仅暴露必须由用户提供的字段，官方 URL 保持固定。OAuth 授权使用 MCP SDK 发现、动态注册、PKCE 和校验 state 的本地回调。保存授权前，Host 重新检查安装管理权限和权限修订。取消、版本替换、卸载和 Host 释放会使待处理授权失效。HTTP MCP 桥接器接收仅存在于进程内的 OAuth Provider，因此刷新通过安装级凭据接口持久化。缺少授权保持非就绪状态，界面显示待连接。SDK fixture 测试验证回调 state、授权码交换、Host 持久化和监听清理；Client 回归覆盖登录、Token 和自建 URL 输入。真实服务登录需要用户账号。在原生桌面中，Host 通过受限的外部链接桥接打开 OAuth 地址；WebView 的 `window.open` 仍是浏览器部署的回退路径。Client 为每个连接弹窗分配授权代次，关闭时取消对应的 Host 流程，并忽略过期的发现结果，因此第二个 MCP 连接不会继承第一个服务的浏览器状态。

MCP 授权发现遵循首次服务响应的 `WWW-Authenticate` 元数据地址和 scope，因此查询参数和独立授权域名会保留到发现流程中。经过校验的产品元数据声明两类兼容例外：授权元数据文档位于 issuer 之外的地址，以及缺少 `response_types_supported` 字段。服务端明确给出的响应类型不会被替换，MCP SDK 仍校验元数据、PKCE 和凭据。发现记录随授权一起保存在 Host 凭据中，使刷新能够复用同一份服务信息。重新连接会用 `auth: oauth` 覆盖已保存的 Token 模式。各阶段错误码传到 Client 的本地化提示；上游响应正文和凭据错误不会进入浏览器桥接。

## Alternatives considered

- **将每个 package 隔离到 worker 或子进程** —— 延期，因为原生 Cordis service 和 Loader fiber 共享 Host 进程。本设计信任上传的 Host 代码；SDK 权限不限制任意 Node 访问。不受信任的 package 需要独立执行环境。
- **把所有工作集成放进 Harness 仓库** —— 拒绝，因为独立 ZIP 安装和升级需要独立源码工作区及包身份。
- **保持原权限词表，把能力写在 README 中** —— 拒绝，因为 Host 无法强制执行未声明的网络、凭据、MCP 或 Skill 请求。

## Consequences

原生退出请求（包含 Electrobun 的信号处理）在桌面清理完成前通过同步 `before-quit` 响应阻止退出。清理先停止所管理的 DSH 进程组，再允许原生退出。清理失败会保持应用运行并允许再次请求退出；单元测试以清理完成信号验证顺序和重试。仅监听进程信号无法保证这一顺序，因为 Electrobun 也处理该信号，可能在异步清理完成前退出。

- 新 SDK 字段是可选的，旧插件继续兼容，旧清单继续可解析。
- 第三方服务验收需要相应配置和凭据。配置缺失会显示失败；fixture 调用证明运行时接通，不证明可访问真实外部账户。
- 市场接受用户主动选择的本地 ZIP，且不执行源码。原生工作区发现能力仍可供安装流程使用，但打开市场不会发布发现的插件包；平台管理员通过独立的上传和批准流程发布 ZIP。
- 新能力实现必须在 Host 传输层执行清单策略，并确保密钥不进入 Client bundle、日志或工具结果。
