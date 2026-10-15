---
description: "嵌入现有 DSH Web 用户端的企业账户与受治理插件视图。"
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-client

[English](README.md) | 中文

## 概述

此 Cordis 客户端插件将组织账户、团队钱包、成员用量、邀请、平台模型、设备和桌面插件市场视图加入现有 DSH Web 壳。页面布局使用共享 `ui-theme` 语义调色板，并保留 Web 用户端较宽的阅读轨道；它不渲染管理后台。目标视觉规则见[企业级客户端与 Admin 视觉设计系统](../../../docs/visual-design-system.zh.md)。

## 目录

- [挂载](#mounting)
- [浏览器桥接](#browser-bridge)
- [验证](#verification)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="mounting"></a>
## 挂载

设置按任务划分唯一入口：企业账户包含组织身份、订阅、角色和设备；模型包含默认选择及能力目录；通讯录包含成员、邀请和受权限控制的成员用量；账单包含共享钱包、兑换、有限的个人近期用量和账本。企业插件设置页会关闭设置面板并打开插件市场，由市场统一提供目录浏览和安装操作。个人用量仅汇总返回的近期记录页，不代表完整月度总量。

企业桌面 profile 会在 Web bundle 后插入此插件，并注入本地 `connection` 句柄。Host 侧从 macOS Keychain 读取组织凭据，调用企业 API，使用 Zod 验证响应记录，然后只返回浏览器可用的账户和目录数据。

此插件是 profile 组件，不是第二套聊天应用。Web profile 负责聊天、会话、工具、工作区、附件、计划、目标、任务、搜索、导出和定时任务视图。企业策略会在加载此插件前禁用本地模型和个人插件设置。企业“模型”页面只列出平台启用的目录，并通过本地 Host 写入选中的 `enterprise` 模型；网关会在每次调用时再次检查平台可用性。

触发器页以规则管理为主要列表，并将执行队列与运行历史合并为一个标签区域。没有规则时，紧凑空状态可直接打开规则编辑器；规则启用状态和 Runtime 监听状态仍分别显示。

规则编辑器按触发条件、执行目标和 Agent 指令分成三组。长表单滚动时，标题和保存操作保持可见；提示词可用变量可在指令字段下展开查看。

<a id="browser-bridge"></a>
## 浏览器桥接

相同私有包重复上传会幂等成功。相同 plugin ID 和版本的私有包内容变化时，会替换该私有 release 并重启其安装；公开 release 仍不可覆盖。

插件市场同时列出已发布的平台版本和当前账号或组织可见的版本。平台管理员发布插件包后，可通过刷新控件重新读取目录。打开市场不会自动上传本地 ZIP；用户主动选择的私有上传仍只对创建者可见。

上传区域将可见范围选择和插件包上传放在一起。插件卡片将名称与运行状态和底部操作栏分开呈现；运行详情和移除操作按需展开，激活错误保持可见。

经过校验的 MCP 连接元数据提供官方 URL，并指定 OAuth、服务商 Token 或无认证访问。市场只为自建服务要求用户输入地址。OAuth 使用 MCP SDK 发现、动态客户端注册、PKCE 和校验 state 的本地回调；安装级授权保存在 Host 凭据中，运行时刷新更新同一记录。取消或关闭桌面会关闭监听，不保存未完成的授权。缺少授权显示为待连接；就绪仍要求 MCP 工具发现成功。

OAuth 发现读取服务的 `WWW-Authenticate` 提示，包括带查询参数或跨域的资源元数据地址。经过校验的 `mcpConnection.oauth` 配置可指定 `authorizationServerMetadataUrl`，或仅在服务端缺少对应字段时补充 `responseTypesSupported: [code]`；服务端明确提供的值与 SDK 的其他校验仍然有效。发现元数据随授权一起保存，供换码和刷新复用。重新连接 OAuth 版本会替换已保存的 Token 认证模式，并保留其他安装配置。Client 对发现、注册、换码、拒绝和取消失败提供本地化提示，不暴露服务端响应。

在原生桌面中，Host 通过受限的外部链接桥接打开 OAuth 地址和服务商凭据页面，因此即使 WebView 阻止弹窗也会启动系统浏览器；浏览器部署仍回退到 WebView 的 `window.open`。关闭连接弹窗或离开市场会取消对应授权，包括仍在等待登录地址的发现请求。迟到响应不会打开过期登录页或更改其他服务的连接状态。重新打开同一服务时，会等待上一次授权清理完成。

Connection RPC 桥接提供账户操作和插件市场。已校验 ZIP 安装到组织 package store；`CordisPluginManager` 将 Host package 加入 Loader group，浏览器模块加载器独立挂载每个 Client bundle。Loader fiber 管理 Tool、Skill、MCP 和 UI 注册。市场核对注册归属、Agent 可见 schema、Skill 目录、MCP 连接和发现、preset，以及 Client 上报的 slot。诊断失败会显示返回的错误。平台 Runtime token 保留在 Host；获准的集成凭据仅通过激活作用域凭据门面提供给受信任 Host package。Host import 支持 Node 内置模块及 Harness runtime 提供的声明依赖。权限、回滚和释放见[安装生命周期](../../../docs/developer/plugin-installation-lifecycle.zh.md)。

账户操作使用现有 Web locale 服务注册的本地化字典。设备撤销要求再次点击，失败请求会继续向用户显示；仪表盘返回服务端计算的插件能力，当前账号没有相应权限时，组织插件变更控件和非私有上传选项保持不可用。插件卡片会展示任一 target 上报的激活错误，并保留有权限的升级、停用、卸载和强制清除操作用于恢复；过期的 target preparing 记录不会覆盖活跃安装状态。强制清除使用应用内确认，并把 API 撤销结果与本地 Client 的尽力协调分开报告；桥接失败会显示返回的错误信息。Client 和 Host target 的失败彼此隔离，因此其他插件仍可协调；被撤销的卸载租约会在下一次读取设备 target 时回收。原生壳负责组织切换和退出登录，以便停止旧 Runtime 并删除其 Keychain 凭据。

市场在后台协调完成后重新读取安装和设备 target 状态。准备期间仍可停用或卸载并保留数据；未完成的旧读取不能覆盖较新的刷新，也不能更新已卸载的页面。

Host 与 Client 准备阶段有可配置的截止时间（`activationTimeoutMs`，默认三十秒）。Host 会把超时 target 上报为失败并撤销其租约，浏览器则从每次运行时快照接收相同截止时间。Host 租约撤销以及 Host 或 Client 贡献清理使用 `cleanupTimeoutMs`（默认十秒）。这些截止时间保证串行协调仍可处理其他插件操作。

<a id="verification"></a>
## 验证

Client 就绪状态遵循 [manifest 插槽选择值](../../plugin/protocol/README.zh.md#use-this-package)。可选的 `DSH_MEDIA_PLUGIN_ZIP` 测试输入指向已构建的 Media Canvas ZIP，通过市场挂载流程验证其真实 Client bundle、插槽上报和释放；上报快照与 Client runtime 测试放在一起。

在此包目录运行 Host 与客户端测试：

```sh
pnpm --filter @deepseek-ai/dsh-enterprise-client test
```

Host 测试验证凭据隔离、团队角色授权、响应验证、fail-closed 模型选择和插件包生命周期状态。jsdom 套件验证设置槽注册、中文渲染、钱包兑换、个人与成员用量、邀请控制、平台模型显示、设备二次确认、已发布目录字段，以及标准 Client bundle 的激活、移除和再次启用。

<a id="model-experience"></a>
## 模型体验

模型体验由 Host 持有的默认模型选择间接产生，该选择会用于后续请求。

#### KV Cache 影响

更改选中模型会在该 Provider 和模型的缓存命名空间中发起请求；这些浏览器视图本身不改变提示词 token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 此插件不实现平台管理、SSO、SCIM、支付收款或 Cloud target 执行。模型用量由 API 持有的团队钱包扣款；浏览器不计算或结算费用。
- 本地 Host 激活和回滚仍由桌面插件管理器负责。市场页记录账号级安装和启用状态，不传输设备本地凭据或操作系统权限。
- 团队用量摘要和成员分页数据来自 API。客户端不会根据最近记录窗口推算组织总量，也不会暴露其他成员的 Session 正文。
- 使用此插件必须提供可用的企业 API、Keychain 辅助程序和组织隔离的桌面 Runtime。浏览器插件不能自行完成认证。

<a id="dev-note"></a>
### 开发备注

[企业平台蓝图](../../../docs/developer/discussion/enterprise-agent-platform.zh.md)定义产品分工。[桌面 README](../../../apps/electrobun/README.zh.md)记录原生 Host 及其发布检查。
