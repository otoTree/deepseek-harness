---
description: "为跟随 Session 的 Workbench 提供终端会话、工作区相对文件和共享浏览器状态的 Remote 命令。"
kind: "package-reference"
---
# @deepseek-ai/dsh-api-workbench-controller

[English](README.md) | 中文

## 概述

Workbench Controller 在一个 `workbench` Remote 命名空间中提供 Client 终端、工作区文件和浏览器面板所需的操作。需要由 Web 或桌面 Client 调用按 Session 管理的操作时挂载它。文件读写限制在 Session 工作区，写入携带 expected version，终端和浏览器调用继续委托给已有 capability provider。识别出的 DOCX、PPTX、XLSX 和 CSV 文件会返回有界 payload 供 Client 渲染；DOCX 和 XLSX 还接受带防护的二进制替换。这是 Host 包，不替代终端、文件系统或浏览器服务。

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

在构成 Workbench 的 Session、文件系统、终端、浏览器、gateway 和 Remote client 包旁挂载 Controller。

### 何时选择

当 Client 需要一个用于 Workbench 面板的 Host Remote 时选择此包。不需要 Client Remote 时直接使用较低层的 capability 包。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-api-workbench-controller'
```

可选的 `maxFileBytes` 限制 `fileRead` 返回的解码文本，默认值为 `2000000` 字节。`maxMediaBytes` 单独限制浏览器原生媒体、文档读取与可编辑 Office 替换 payload，默认值为 `32000000` 字节。其他限制属于终端和浏览器 capability provider。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`WorkbenchController` 把请求的 Session 解析为精确的 `Agent`，然后分别通过 `TerminalSessionService`、`ctx.fs` 和 `ctx.browsers` 分派终端、工作区路径和浏览器操作。终端 Client 可以写入原始键盘数据而不预留面向模型的发送操作、调整 PTY 尺寸、读取保留的原始输出，并跟随一个 baseline 及其后的单调原始 delta；ANSI 与光标控制序列会完整保留给 renderer。浏览器 Remote 接收原生语义 observation，并提供 provider 导航、自动化、snapshot 和 screenshot 操作。文件路径规范化为工作区相对 POSIX 路径；有效 UTF-8 文件返回带版本的文本用于受保护替换，识别出的图片、音频、视频和 PDF 文件则返回有界 Base64 payload 及白名单内的浏览器媒体类型，DOCX、PPTX、XLSX 和 CSV 文件则返回有界文档 payload。文本写入调用 `ctx.fs.writeText`；DOCX 和 XLSX 替换必须是规范 Base64、不超过 `maxMediaBytes`、以 ZIP 签名开头、与请求文件扩展名匹配，并调用 `ctx.fs.writeBytes`。两条路径都把解析后的 Session sandbox policy 传给 `ctx.fs`，因此 `workspace-write` 以 Session 工作区而不是部署 fallback root 作为判断范围。源码见 [`src/index.ts`](src/index.ts) 和 [`src/types.ts`](src/types.ts)。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`dsh-client-ui-workbench`](../../client/ui-workbench/README.zh.md) — Client 面板和按 Session 管理的布局。
- [`dsh-browser`](../../browser/browser/README.zh.md) — 共享浏览器 context 和 provider seam。
- [`dsh-terminal`](../../terminal/terminal/README.zh.md) — 按 owner 管理的 PTY 服务。
- [`dsh-fs`](../../fs/fs/README.zh.md) — 工作区文件系统 capability。

-----

<a id="model-experience"></a>
## 模型体验

### Remote Workbench 结果

#### 模型看到什么

不会直接看到：`workbench` Remote 调用服务 Client，终端、文件系统和浏览器的模型工具负责各自的模型可见 schema 与结果。

#### Token effect

除非另一个模型消费方把 capability 结果渲染进请求，否则不增加 token。

#### KV Cache effect

Controller 不修改模型请求前缀或 provider cache 状态。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- Controller 要求请求的 Session 已挂载相应 capability；它不会创建终端或文件系统 provider。
- 二进制替换只接受 `.docx` 和 `.xlsx`；PDF、PPTX、CSV、媒体与未识别的二进制文件在此 Remote 中保持只读。
- 浏览器截图继续作为有界 Remote payload 供模型和自动化消费方使用；Workbench UI 渲染原生 WebView 或 Web iframe，而不展示这些 payload。
- Controller 会把原生 observation 与 Session 浏览器状态同步，但不会把原生 WebView 与 Playwright provider 变成同一个浏览器引擎。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
