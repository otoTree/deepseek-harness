---
description: "浏览器 capability 家族的包映射：按 Session 管理的状态、Playwright provider 和面向模型的浏览器工具。"
kind: "package-group"
---

# browser/：交互式浏览器 capability 家族

[English](README.md) | 中文

## 概述

`browser/` 组为每个产品 Session 提供一个共享的交互式浏览器 context。核心服务拥有 identity、已提交标签状态、限制与清理；Playwright provider 控制页面；工具包将共享 context 提供给模型。桌面嵌入 Chromium，并通过 CDP 将自动化精确连接到可见页面。

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
- [共享浏览器页面决策](../../.agents/notes/implemented/architecture/2026-10-16-shared-browser-page.zh.md)——原生 guest 归属及自动化连接。
- [Workbench Client 包](../client/ui-workbench/README.zh.md)——原生 Chromium 展示及可用性要求。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
