---
description: "企业 Electrobun Host 使用的已校验账户操作与浏览器账户入口。"
kind: "package-library"
---

# @deepseek-ai/dsh-client-ui-enterprise-account

[English](README.md) | 中文

## 概述

企业 Electrobun 代码可以在原生 Host 与账户页面之间共用一组已校验的登录、注册、组织和退出操作。该包从主入口导出 Zod 记录，并从 `./client` 导出浏览器账户入口。它不负责 API 凭据或传输。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

### 适用场景

原生账户处理器需要共用操作和展示状态记录时使用主入口。只把 `./client` 作为 Electrobun 专用账户页面入口加载；它不是 Cordis 插件或 Profile 层。

### 入口

```text
import { accountAction } from '@deepseek-ai/dsh-client-ui-enterprise-account'

const action = accountAction.parse(input)
```

校验成功会返回允许的账户命令。字段无效时会在原生 Host 分发 API 请求前失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

主入口导出与浏览器无关的 Zod 记录。客户端入口渲染账户文档，并且只调用 Electrobun 壳提供的原生 Host 端点。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [企业桌面端](../../../apps/electrobun/README.zh.md) — 原生账户传输与凭据所有权。
- [企业 API](../../../apps/api/README.zh.md) — 认证与组织操作。

-----

<a id="model-experience"></a>
## 模型体验

无直接影响，因为账户页面和操作记录不会注册任何模型可见输入。

#### KV Cache 影响

该包不会创建模型请求，因此不影响提示词前缀或缓存复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 浏览器入口依赖 Electrobun 账户 Host，无法自行完成认证或持久化凭据。
- 该包只提供账户和组织入口操作；平台管理仍由独立的管理应用负责。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
