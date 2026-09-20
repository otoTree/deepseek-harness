---
description: "面向模型的浏览器工具，用于打开、导航、检查、交互和关闭 Session 共享的标签。"
kind: "package-reference"
---
# @deepseek-ai/dsh-tool-browser

[English](README.md) | 中文

## 概述

`dsh-tool-browser` 在按 Session 管理的 `dsh-browser` context 上注册十个面向模型的工具。工具覆盖标签创建和选择、HTTP(S) 导航、click/fill/press 操作、accessibility snapshot、screenshot 以及 context 清理。将它与 `dsh-browser-playwright` 等已注册 provider 一起挂载；注册本身不会启动浏览器。snapshot 字符数和解码后的 screenshot bytes 在结果进入 Session 日志前受到限制。

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

在 `dsh-browser`、`dsh-tools` 和浏览器 provider 之后挂载此包，使 initiating Agent 能调用浏览器工具。

### 何时选择

当模型需要在 Workbench UI 显示的同一个 context 中受控导航和检查页面时选择它。仅需 Client 操作且不应成为模型工具时，使用 Host Controller。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-browser'
- name: '@deepseek-ai/dsh-browser-playwright'
- name: '@deepseek-ai/dsh-tool-browser'
  config:
    maxSnapshotChars: 200000
    maxScreenshotBytes: 5242880
```

`maxSnapshotChars` 默认 `200000`，`maxScreenshotBytes` 默认 `5242880`；二者都必须是正的安全整数。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

每个工具解析 initiating Agent 的 Session，调用 `ctx.browsers`，并以 JSON 渲染有界结果。调用 `browser_tabs` 时可以省略 `browserId`，以发现 Workbench 已为该 Session 打开的 context。操作工具返回已提交的 `BrowserTab`；snapshot 和 screenshot 工具在返回 ARIA 文本或 base64 PNG 前应用配置限制。工具名称、schema、持久事件和 provider 要求见生成的[工具目录](../../../docs/tool-catalog.zh.md#tool-package-map)。源码见 [`src/index.ts`](src/index.ts)。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [浏览器工具目录](../../../docs/tool-catalog.zh.md#tool-package-map) — 生成的 schema 和 Session 影响。
- [`dsh-browser`](../browser/README.zh.md) — 共享浏览器状态。
- [`dsh-browser-playwright`](../browser-playwright/README.zh.md) — provider 实现。
- [`dsh-client-ui-workbench`](../../client/ui-workbench/README.zh.md) — 浏览器面板。

-----

<a id="model-experience"></a>
## 模型体验

### Browser tool schemas

#### 模型看到什么

模型会收到生成的 [`dsh-tool-browser` 目录](../../../docs/tool-catalog.zh.md#tool-package-map)中的十个 schema 和说明。模型可以不带 id 调用 `browser_tabs` 来发现 Workbench 的 Session 浏览器，然后读取任意已列出标签的 ARIA snapshot 文本或 base64 PNG。

#### Token effect

工具调用参数和 JSON 结果消耗请求 token；`maxSnapshotChars` 限制文本结果，`maxScreenshotBytes` 在记录前限制解码图像 payload。

#### KV Cache effect

每次浏览器调用都会向对话添加一对工具调用和结果；未改变的 system 与 tool 前缀可按 provider 规则复用缓存。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 工具在执行时必须有 provider；没有注册名为 `playwright` 的 provider 时会失败。
- URL 校验目前检查 HTTP(S) 语法和 capability 限制，但不是 DNS 固定的公网 SSRF 策略。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
