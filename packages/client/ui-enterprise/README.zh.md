---
description: "嵌入现有 DSH Web 用户端的企业账户与受治理插件视图。"
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-client

[English](README.md) | 中文

## 概述

此 Cordis 客户端插件将组织账户、团队钱包、成员用量、邀请、平台模型、设备和桌面插件市场视图加入现有 DSH Web 壳。它保持 [Web 用户端](../../../apps/web/src/main.ts) 的用户界面布局与交互，不渲染管理后台。

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

企业桌面 profile 会在 Web bundle 后插入此插件，并注入本地 `connection` 句柄。Host 侧从 macOS Keychain 读取组织凭据，调用企业 API，使用 Zod 验证响应记录，然后只返回浏览器可用的账户和目录数据。

此插件是 profile 组件，不是第二套聊天应用。Web profile 负责聊天、会话、工具、工作区、附件、计划、目标、任务、搜索、导出和定时任务视图。企业策略会在加载此插件前禁用本地模型和个人插件设置。企业“模型”页面只列出平台启用的目录，并通过本地 Host 写入选中的 `enterprise` 模型；网关会在每次调用时再次检查平台可用性。

<a id="browser-bridge"></a>
## 浏览器桥接

桥接通过本地 Connection RPC 通道提供仪表盘读取、钱包兑换和账本读取、个人用量、受权限控制的团队管理、平台模型选择、插件目录、包上传、账号级安装和启用、设备撤销。市场只接受 Client 和 Host `.dsh-plugin.zip`；公开可见版本提交管理员审核，私有版本由创建者立即安装。Runtime 令牌保留在 Host 进程中，不进入 WebView 状态、命令参数或插件环境变量。Host 会在每次请求前检查 Keychain 凭据的 API 来源和组织绑定；企业 API 检查当前服务端 Runtime 租约。浏览器可用数据返回前仍会受到响应大小限制。

账户操作使用现有 Web locale 服务注册的本地化字典。设备撤销要求再次点击，失败请求会继续向用户显示。原生壳负责组织切换和退出登录，以便停止旧 Runtime 并删除其 Keychain 凭据。

<a id="verification"></a>
## 验证

在此包目录运行 Host 与客户端测试：

```sh
pnpm --filter @deepseek-ai/dsh-enterprise-client test
```

Host 测试验证凭据隔离、团队角色授权、响应验证和 fail-closed 模型选择。jsdom 套件验证设置槽注册、中文渲染、钱包兑换、个人与成员用量、邀请控制、平台模型显示、设备二次确认以及已发布目录字段。

<a id="model-experience"></a>
## 模型体验

模型体验由 Host 持有的默认模型选择间接产生，该选择会用于后续请求。

#### KV Cache 影响

更改选中模型会在该 Provider 和模型的缓存命名空间中发起请求；这些浏览器视图本身不改变提示词 token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 此插件不实现平台管理、SSO、SCIM、支付收款或 Cloud target 运行时。模型用量由 API 持有的团队钱包扣款；浏览器不计算或结算费用。
- 本地 Host 激活和回滚仍由桌面插件管理器负责。市场页记录账号级安装和启用状态，不传输设备本地凭据或操作系统权限。
- 团队用量摘要和成员分页数据来自 API。客户端不会根据最近记录窗口推算组织总量，也不会暴露其他成员的 Session 正文。
- 使用此插件必须提供可用的企业 API、Keychain 辅助程序和组织隔离的桌面 Runtime。浏览器插件不能自行完成认证。

<a id="dev-note"></a>
### 开发备注

[企业平台蓝图](../../../docs/developer/discussion/enterprise-agent-platform.zh.md)定义产品分工。[桌面 README](../../../apps/electrobun/README.zh.md)记录原生 Host 及其发布检查。
