---
description: "供 Host Remote、模型工具和 Client 面板共享的按 Session 管理浏览器 context 与标签状态。"
kind: "package-reference"
---
# @deepseek-ai/dsh-browser

[English](README.md) | 中文

## 概述

浏览器 capability 为每个 Session 提供一个由 provider 支撑的 context，以及不透明的 browser 和 tab id。需要 Host controller、模型工具和 Client 面板访问同一组标签时挂载它。服务拥有 identity、活动标签、修订事件、标签上限、URL 协议校验和等待 provider 清理；provider 拥有页面自动化。随产品提供的 Playwright 后端见 [`dsh-browser-playwright`](../browser-playwright/README.zh.md)。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

先挂载服务并注册 `BrowserProvider`，再让消费方对服务 Session 调用 `ctx.browsers.ensure`。

### 何时选择

当一个 Session 中的多个消费方需要共享浏览器状态时选择此 capability。实际页面自动化应选择 provider 包；此包不包含浏览器引擎。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-browser'
  config:
    maxTabs: 12
```

`maxTabs` 是每个 Session 的正整数标签上限，默认值为 `12`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`BrowserService` 把一个 Session id 映射到一个 provider 和浏览器 context，保存已提交的 `BrowserTab`，并在 provider 操作成功后发布 `browser/change` 修订。原生 Client 可以为标签附加有界的语义 observation；snapshot 读取会优先使用该 observation，直到成功的 provider 操作使其失效。导航允许 HTTP(S) URL 和精确的内部新标签 URL `about:blank`；其他协议会在 provider 运行前失败。`close` 等待所有 provider 标签关闭，并在清理完成前保留 closing 标记。registry 所有的策略错误会转为稳定的 `BrowserError` code。源码见 [`src/index.ts`](src/index.ts)。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`dsh-browser-playwright`](../browser-playwright/README.zh.md) — Playwright provider。
- [`dsh-tool-browser`](../tool-browser/README.zh.md) — 面向模型的浏览器工具。
- [`dsh-api-workbench-controller`](../../api/workbench-controller/README.zh.md) — Host Remote 操作。
- [`dsh-client-ui-workbench`](../../client/ui-workbench/README.zh.md) — Client 浏览器面板。

-----

<a id="model-experience"></a>
## 模型体验

### Session 浏览器状态

#### 模型看到什么

服务自身不增加提示词文本；[`dsh-tool-browser`](../tool-browser/README.zh.md) 会为模型请求渲染 `BrowserTab` 元数据以及有界 snapshot 或 screenshot。当前原生语义 observation 会优先为 snapshot 提供文本，再回退到 provider。

#### Token effect

token 使用来自消费方的标签元数据、snapshot 文本或 screenshot 结果，并由工具包而非 registry 限制。

#### KV Cache effect

浏览器状态不改变请求前缀；只有新渲染的工具结果会扩展实时对话。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- registry 强制协议、标签数和生命周期限制，但不提供 DNS 固定的公网 SSRF 防护。
- 调用 `ensure` 前必须先注册 provider；此包不会自行启动浏览器引擎。
- 原生 observation 最多包含 4,096 个标题字符和 200,000 个 snapshot 字符；观察页面的 Client 决定包含哪些语义内容。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
