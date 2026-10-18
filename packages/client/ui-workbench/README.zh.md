---
description: "跟随会话的详情工作区，提供成果、终端、浏览器和文件标签。"
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-workbench

[English](README.md) | 中文

## 概述

Workbench 拥有 `details` 栏，并为会话成果、终端、浏览器和文件面板提供稳定的子插槽。永久存在的开始标签会列出所有内建面板和已注册插件入口，因此面板导航不依赖浮层菜单。成果标签可以关闭并从开始页重新打开。全局顶栏开关可以在聊天存在前打开 Workbench；Workbench 随后创建并选中一个真实的空白聊天 Session，发送首条消息时继续使用该 `SessionId`。每个聊天会话都会为终端操作使用一个隐藏的能力 Runtime Session；浏览器操作归属于聊天 Session。

deliverables 包通过 `workbench.panel` 提供成果内容。成果页聚合当前会话所有已加载 Turn 的成功变更工具产出并删除重复路径。选择成果、对话轮次末尾标签项或匹配的行内提及后，Workbench 会切换到文件页，打开所在目录，并在编辑器或预览区中加载该文件。详情栏可从全局顶栏打开，并可展开至主内容区的 80%。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

将 Workbench 与 `ui-layout`、Client Remote connection 以及需要按 Session 显示的 capability 面板一起挂载。

### 何时选择

当一个 `details` 栏需要在会话成果、终端、浏览器和文件面板之间切换，同时不改变外层布局 owner 时选择它。

Client 配置 `browserInitializationTimeoutMs` 限制原生视图首次就绪的等待时间（默认 `5000`，正整数毫秒）。未发出就绪事件的视图会以同一目标和持久分区重建一次；已就绪页面会在隐藏面板及 Connection 代次变更时保留。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

此包拥有标签壳和 keyed 面板插槽。面板命令使用聊天 Session 作为地址。浏览器嵌入沙箱内的原生 CEF Chromium 视图，并通过 CDP 将该页面精确连接到 Session provider。原生输入与 Agent 工具共享实时文档；切换面板或折叠 Workbench 时标签页保持挂载。后台视图保持不可见且不拦截输入，包括原生初始化期间。终端操作使用隐藏能力 Runtime。[共享页面决策](../../../.agents/notes/implemented/architecture/2026-10-16-shared-browser-page.zh.md)记录了归属和目标发现。

浏览器和终端面板绑定当前 Connection 代次。重新连接会取消旧读取器，并在接受输入前发现当前 Session 资源。浏览器跟随流的基线提供当前上下文 identity，基线为空时会打开空白标签；地址栏会把裸域名规范化为 HTTPS，并在导航前报告不支持的地址。启动时不会查询缓存的浏览器 id。终端发现优先复用已选择且仍在运行的进程，其次选择正在运行的 `Workbench` 终端，再选择其他运行中的终端。若没有运行中的终端，它会关闭已退出的 `Workbench` 记录，再创建同名 shell。错误提供“重新连接”操作。Host 重启后的恢复会创建可用资源，但不会还原已终止的 shell 进程或丢失的浏览器标签。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [`dsh-client-ui-layout`](../ui-layout/README.zh.md) — 三栏布局 owner。
- [`dsh-api-workbench-controller`](../../api/workbench-controller/README.zh.md) — Host Remote 方法。
- [`dsh-browser`](../../browser/browser/README.zh.md) — 共享浏览器 capability。

<a id="model-experience"></a>
## 模型体验

### Workbench 面板展示

#### 模型看到什么

Workbench 不增加模型可见输入：它展示已记录的 capability 结果，并通过 `workbench` Remote 方法发送 Client 操作；模型工具负责提示词内容和 Session 事件。

#### Token effect

面板壳本身不增加 token；只有独立的模型消费方渲染 capability 结果时才产生 token 使用。

#### KV Cache effect

面板选择和布局状态不改变模型请求前缀或 provider cache。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 交互视口要求可信的桌面原生桥接和嵌入式 Chromium；普通 Web Client 会报告浏览器不可用。切换聊天 Session 会重新挂载原生视图并加载其当前 URL，分区存储保留，但未保存的 DOM 状态丢失。持久分区按 Runtime 和 Session 隔离。
- XLSX 编辑覆盖可见单元格值与工作表切换。它不计算公式；公式单元格保留原 XML 与缓存结果。图片和常见图表作为只读图层渲染，未知图表类型显示保留占位。宏、外部链接和高级条件格式保持只读。
- DOCX 编辑覆盖正文段落和表格单元格文字，不提供完整 Word 分页与版式。当一个被编辑文字块跨多个 run 时，替换文字会写入第一个 run，其余 run 文字会被清空，因此该文字块内混合的局部样式可能减少。页眉、页脚、媒体与其他未修改压缩包条目会保留。
- PDF、CSV、图片、音频与视频展示保持只读。PPTX 支持受限的幻灯片文本编辑，并保留媒体、形状、关系和未知 XML；完整幻灯片布局编辑留待后续。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布运行时不变量伴随模块。面板存储消费控制器快照与修订号，能力提供者持有底层资源。
