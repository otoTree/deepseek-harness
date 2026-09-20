---
description: "为每个 Session 提供隔离浏览器 context、标签操作、snapshot、screenshot 和清理的 Playwright provider。"
kind: "package-reference"
---
# @deepseek-ai/dsh-browser-playwright

[English](README.md) | 中文

## 概述

此包为 `dsh-browser` 注册 `playwright` provider。需要在共享的 Session 浏览器 context 后运行无头 Chromium 页面自动化时选择它。它为每个 Session 创建隔离的 Playwright context，把 selector 和 screenshot viewport 输入映射到页面，提供 ARIA snapshot 和 PNG screenshot，并在 Cordis teardown 期间关闭页面、context 和浏览器。它不拥有 browser id 或模型工具 schema。

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

在同一个组合中挂载 `dsh-browser` 和此 provider，再让浏览器消费方选择 `playwright` provider。

### 何时选择

在受控 Host 进程中执行页面导航和交互时选择它。若部署需要其他引擎或嵌入原生 view，则使用另一个 `BrowserProvider`。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-browser'
- name: '@deepseek-ai/dsh-browser-playwright'
```

provider 以无头模式运行，没有 Cordis 配置字段。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`PlaywrightBrowserProvider` 按需启动 Chromium，为每个 Session 创建一个 context，并为浏览器标签创建页面。它在同一页面上执行 selector 操作、坐标点击、滚轮增量、文本输入和组合键。ARIA snapshot 来自页面 body，PNG screenshot 提供 Client viewport。每个操作把页面标题和 URL 读入 capability 的 `BrowserProviderTab`；并发创建首个标签时共享 context 创建过程，最后一个页面关闭后清理空闲 context。源码见 [`src/index.ts`](src/index.ts)。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`dsh-browser`](../browser/README.zh.md) — 与 provider 无关的 capability 状态。
- [`dsh-tool-browser`](../tool-browser/README.zh.md) — 面向模型的工具。
- [Playwright](https://playwright.dev/) — 上游浏览器自动化 API。

-----

<a id="model-experience"></a>
## 模型体验

### Provider 结果

#### 模型看到什么

间接通过 [`dsh-tool-browser`](../tool-browser/README.zh.md) 看到；该工具把 provider 的标签元数据、accessibility snapshot 文本或有界 PNG bytes 渲染为工具结果。

#### Token effect

只有模型工具返回导航元数据和 snapshot 文本时才消耗 token；screenshot 使用 provider 结果预算而不是文本 token。

#### KV Cache effect

provider 不改变请求前缀；每个工具结果由所属工具消费方追加。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 运行时必须有 Playwright 可用的 Chromium；此包不下载或管理浏览器二进制文件。
- provider 暴露 screenshot 和页面状态，不提供可交互的 Electrobun 原生 BrowserView。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
