---
description: "企业插件作者和平台共享的清单与能力契约。"
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-protocol

[English](README.md) | 中文

## 概述

本包定义带品牌的插件身份、标准包清单、安装状态、能力请求类型和稳定错误。它不包含传输实现或服务状态。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在包边界使用 `pluginManifest`，并使用导出的类型描述 SDK 和平台消息。schema v2 在产品级声明 target；schema v3 则在 Cordis package 下分组一个或多个 Host、Client target，并声明 package 名称、版本和依赖。每个 v3 package 归档条目都包含自己的 `package.json`。Client target 必须声明标准 `window.__ModuleLoader__.load(...)` bundle 注册的模块表 `moduleId`，并使用结构化的 `slot` 或 `window` contribution。Window contribution 包含 surface、shell、locale key、有界默认尺寸，以及显式的 `singleton` 或 `many` multiplicity。协议不提供 Cloud target。

v3 package 可以通过 `presets` 指向 `presets/<id>/agent.cordis.yml`。桌面 Plugin Manager 将这些文件安装到配置好的 AgentPresets 用户根目录，发现、组合和释放仍由 AgentPresets 负责。Preset 只提供声明式组合，不能替换 Agent loop。

Slot contribution 的 `id` 对应 Cordis 注册选择值：keyed 插槽使用 `key`，list 插槽使用 `id`。例如，以 `key: media` 注册的 `workbench.panel` 声明 contribution `id: media`。同一 Client target 内的 contribution id 必须唯一，包括贡献到不同插槽的条目。

Manifest 权限授权身份、模型、存储、网络、凭据、授权、MCP、Skill 和配置等平台 SDK 调用。网络声明指定允许的域名和响应限制。解析器校验声明，Host 执行 SDK 权限检查。受信任的同进程 Node package 可以使用原生 service，这些权限不会对其构成沙箱。

<a id="model-experience"></a>
## 模型体验

### 协议模型上下文

#### 模型看到的内容

本包不产生直接进入模型的内容，运行时负责插件模型请求。

#### Token 影响

本包不直接改变 token 用量，企业网关按 SDK 调用方记录用量。

#### KV Cache 影响

本包不直接控制缓存，模型提供方决定请求的缓存行为。

protocol 包不会调用模型，也不会向 Session 增加内容。插件通过 SDK 发起的模型调用由运行时负责，并由企业网关记录。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 当前清单不提供 Cloud target 声明。

<a id="dev-note"></a>
### 开发备注

None.
