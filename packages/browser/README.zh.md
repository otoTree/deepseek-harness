---
description: "浏览器 capability 家族的包映射：按 Session 管理的状态、Playwright provider 和面向模型的浏览器工具。"
kind: "package-group"
---

# browser/：交互式浏览器 capability 家族

[English](README.md) | 中文

## 概述

`browser/` 组为每个产品 Session 提供一个共享的交互式浏览器 context。核心服务管理不透明的 context 和 tab identity、已提交状态、限制与清理；Playwright provider 管理页面自动化；工具包把共享 context 提供给模型。桌面 Client 可以渲染独立的原生浏览器视图，并把导航与有界语义 observation 同步到同一份 Session 状态。原生视图与 Playwright 仍是两个不同的浏览器引擎。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

三个包共同组成完整的浏览器 capability seam。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`browser/`](browser/README.zh.md) | 管理 Session 浏览器 identity、标签状态、修订、限制、observation 与清理 | `ctx.browsers` |
| [`browser-playwright/`](browser-playwright/README.zh.md) | 提供隔离的 Playwright context 与页面自动化 | 注册到 `ctx.browsers` |
| [`tool-browser/`](tool-browser/README.zh.md) | 向模型公开导航、交互、snapshot 与 screenshot | 注册到 `ctx.tools` |

-----

<a id="related-documentation"></a>
## 相关文档

- [交互式浏览器子系统](../../docs/subsystems/browser.zh.md)——共享状态、原生 observation、provider 自动化、生命周期与安全限制。
- [跟随 Session 的 Workbench 决策](../../.agents/notes/implemented/architecture/2026-09-19-session-following-workbench.zh.md)——UI 归属、原生渲染、provider 同步与验收限制。
- [Workbench Client 包](../client/ui-workbench/README.zh.md)——原生 Electrobun WebView 与 Web iframe 展示。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
