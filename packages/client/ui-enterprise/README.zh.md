---
description: "嵌入现有 DSH Web 用户端的企业账户与受治理插件视图。"
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-client

[English](README.md) | 中文

## 概述

此 Cordis 客户端插件将组织账户、平台模型、用量、设备和已发布插件视图加入现有 DSH Web 设置壳。它保持 [Web 用户端](../../../apps/web/src/main.ts) 的用户界面布局与交互，不渲染管理后台。

## 目录

- [挂载](#mounting)
- [浏览器桥接](#browser-bridge)
- [验证](#verification)
- [限制](#limitations)
- [开发备注](#dev-note)

-----

<a id="mounting"></a>
## 挂载

企业桌面 profile 会在 Web bundle 后插入此插件，并注入本地 `connection` 句柄。Host 侧从 macOS Keychain 读取组织凭据，调用企业 API，使用 Zod 验证响应记录，然后只返回浏览器可用的账户和目录数据。

此插件是 profile 组件，不是第二套聊天应用。Web profile 负责聊天、会话、工具、工作区、附件、计划、目标、任务、搜索、导出和定时任务视图。企业策略会在加载此插件前禁用本地模型和个人插件设置。企业“模型”页面只列出平台启用的目录，并通过本地 Host 写入选中的 `enterprise` 模型；网关会在每次调用时再次检查平台可用性。

<a id="browser-bridge"></a>
## 浏览器桥接

桥接通过本地 Connection RPC 通道提供仪表盘读取、平台模型选择、已发布插件目录读取和设备撤销。Runtime 令牌保留在 Host 进程中，不进入 WebView 状态、命令参数或插件环境变量。Host 会在每次请求前检查 Keychain 凭据的 API 来源和组织绑定；企业 API 检查当前服务端 Runtime 租约。登录响应中的 `leaseUntil` 字段只是初始租约快照，因为原生心跳会续租服务端记录，但不会重写 Keychain。浏览器可用数据返回前仍会受到响应大小限制。

账户操作使用现有 Web locale 服务注册的本地化字典。设备撤销要求再次点击，失败请求会继续向用户显示。原生壳负责组织切换和退出登录，以便停止旧 Runtime 并删除其 Keychain 凭据。

<a id="verification"></a>
## 验证

在此包目录运行 Host 与客户端测试：

```sh
pnpm --filter @deepseek-ai/dsh-enterprise-client test
```

Host 测试验证凭据隔离和 fail-closed 授权。jsdom 套件验证设置槽注册、中文渲染、平台模型与用量显示、设备二次确认以及已发布目录字段。

<a id="limitations"></a>
## 限制

- 此插件不实现管理操作、SSO、SCIM、结算支付或公共市场发布。
- 目录只列出已发布记录，不在本地 loader 中安装、激活、热切换或撤销插件；这些检查仍由桌面插件管理器负责。
- 仪表盘目前在客户端聚合个人用量。组织级报表和会话正文访问由管理后台与 API 负责。
- 使用此插件必须提供可用的企业 API、Keychain 辅助程序和组织隔离的桌面 Runtime。浏览器插件不能自行完成认证。

<a id="dev-note"></a>
## 开发备注

[企业平台蓝图](../../../docs/developer/discussion/enterprise-agent-platform.zh.md)定义产品分工。[桌面 README](../../../apps/electrobun/README.zh.md)记录原生 Host 及其发布检查。
