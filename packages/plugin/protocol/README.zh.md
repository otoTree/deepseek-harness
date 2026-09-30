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

在包边界使用 `pluginManifest`，并使用导出的类型描述 SDK 和平台消息。解析器支持 Client、Host 目标以及对象存储、数据库和缓存声明。Client target 必须声明标准 `window.__ModuleLoader__.load(...)` bundle 注册的模块表 `moduleId`。协议不提供 Cloud target。

清单权限使用固定词汇：`identity.read`、`models.text`、`models.media`，分别用于对象读取和写入、数据库查询和事务、缓存读取和写入的独立授权。运行时会在每次能力调用时检查对应授权。媒体模型调用使用异步任务类型，并暴露供应商无关的状态、结果、用量和账务字段。

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
