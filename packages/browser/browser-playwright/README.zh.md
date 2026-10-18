---
description: "为每个 Session 提供隔离浏览器 context、标签操作、snapshot、screenshot 和清理的 Playwright provider。"
kind: "package-reference"
---
# @deepseek-ai/dsh-browser-playwright

[English](README.md) | 中文

## 概述

此包为 `dsh-browser` 注册 `playwright`。它可以启动隔离的 Chromium context，也可以将自动化精确连接到桌面原生 Chromium 页面。两种模式都向 Session 消费方提供导航、输入、ARIA snapshot 和 screenshot；浏览器 identity 和模型工具 schema 由其他包拥有。

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

需要自动导航和交互时选择它，包括嵌入式 Chromium 提供回环 CDP 端点的桌面。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-browser'
- name: '@deepseek-ai/dsh-browser-playwright'
```

未设置 `desktopCdpEndpoint` 时，provider 启动 Playwright 完整 Chromium 的现代无头模式；通过 `pnpm --filter @deepseek-ai/dsh-browser-playwright exec playwright install chromium` 安装。设置该端点后，桌面拥有渲染、存储和进程生命周期；下列启动和 context 选项仅用于启动模式。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `desktopCdpEndpoint` | 未设置 | 通过回环 HTTP 连接原生 Chromium，不启动浏览器。 |
| `desktopTimeoutMs` | `30000` | 连接、操作和导航的正整数超时，单位为毫秒。 |
| `channel` | `chromium` | Playwright 完整 Chromium，或已安装的 `chrome` / `msedge`；所选浏览器不可用时直接失败，不回退。 |
| `headless` | `true` | 不打开独立浏览器窗口。 |
| `locale` | `zh-CN` | 语言和区域格式。 |
| `timezoneId` | `Asia/Shanghai` | IANA 时区。 |
| `viewport` | `1440 × 900` | 页面视口像素尺寸。 |
| `userAgent` | 浏览器默认值 | 可选的部署专用用户代理。 |
| `extraHTTPHeaders` | 未设置 | 部署附加请求头。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

启动模式按需共享一个浏览器进程，并为每个 Session 创建隔离 context。桌面模式生成唯一的空白页连接 URL，等待原生视图暴露该精确 CDP 目标，再导航一次。它不会按目标网址选择其他页面，也不会创建第二份页面。并发操作等待连接就绪。每个标签在 HTTP 发现公布其客体后才建立连接，因为已有 CEF CDP 连接可能不会通告新页面。teardown 断开 Playwright；原生视图负责销毁页面，桌面保留其 Chromium 进程。见 [`src/index.ts`](src/index.ts) 和 [`src/attached.ts`](src/attached.ts)。

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
- 桌面连接要求已挂载的原生视图以及 `127.0.0.1` 上的 HTTP CDP 端点；目标缺失或不唯一时明确失败。
- 启动模式的 context 使用临时 Session 存储。桌面分区在桌面归属下保留站点存储。网站仍可能要求人机验证。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布运行时不变量伴随模块。提供者句柄在操作执行时检查，并由所属上下文的释放函数关闭。
