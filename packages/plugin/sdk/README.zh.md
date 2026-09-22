---
description: "面向插件作者的安装作用域身份、文本模型、对象、数据库和缓存 API。"
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-sdk

[English](README.md) | 中文

## 概述

`createPluginSdk(transport)` 为一个已激活的插件目标创建 SDK。门面提供当前用户、获准文本模型、持久对象、受限 SQL 和临时缓存操作。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

传输由平台提供。插件代码不会取得平台或供应商凭据，也不能选择其他用户、组织、安装或数据空间。传输释放后继续调用会被拒绝。

<a id="model-experience"></a>
## 模型体验

### SDK 模型调用

#### 模型看到的内容

选定的文本模型会接收插件通过 `models.text()` 或 `models.textStream()` 提供的消息。

#### Token 影响

输入和输出 token 会关联当前使用者、组织、安装和模型调用。

#### KV Cache 影响

SDK 不控制模型网关的 KV 缓存，缓存行为由所选模型网关决定。

`models.text()` 将声明的 system 和 user 消息发送到选定的文本模型。插件可以读取文本和用量，平台会按当前账号和组织记录调用。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 没有调度器、队列、worker、后台任务、图片生成、视频生成或 Cloud target API。

<a id="dev-note"></a>
### 开发备注

None.
