---
description: "跟随会话的详情工作区，提供成果、终端、浏览器和文件标签。"
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-workbench

[English](README.md) | 中文

## 概述

Workbench 拥有 `details` 栏，并为会话成果、终端、浏览器和文件面板提供稳定的子插槽。永久存在的开始标签会列出所有内建面板和已注册插件入口，因此面板导航不依赖浮层菜单。成果标签可以关闭并从开始页重新打开。每个聊天会话都会为 Workbench 使用一个隐藏且能力完整的 Runtime Session。

deliverables 包通过 `workbench.panel` 提供成果内容。成果页聚合当前会话所有已加载 Turn 的成功变更工具产出并删除重复路径。选择成果、对话轮次末尾标签项或匹配的行内提及后，Workbench 会切换到文件页，打开所在目录，并在编辑器或预览区中加载该文件。详情栏可从 Session header 中的图标打开，并可展开至主内容区的 80%。

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

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

此包拥有标签壳和 keyed 面板插槽。可关闭标签关闭后仍保留内建定义；插件 dispose 会同时移除定义和 body。开始标签按 key 打开定义，当前标签关闭后壳会回退到开始页。面板命令使用带隐藏 Runtime Session ID 的 Workbench Remote，聊天 Session 仍是 UI owner。桌面面板挂载 Electrobun WebView，并让非活动视图隐藏且启用指针穿透；Web 客户端挂载 iframe。迟到的 readiness 事件会重新应用同一可见性状态。Runtime 按聊天单飞创建，使用标准能力 preset，并从普通 Session 列表中过滤。Runtime dispose 会释放 AgentHandle 以及其终端、浏览器和作用域资源。

浏览器和终端面板绑定当前 Connection 代次。重新连接会取消旧读取器，并在接受输入前发现当前 Session 资源。浏览器跟随流的基线提供当前上下文 identity，基线为空时会打开空白标签；启动时不会查询缓存的浏览器 id。终端发现优先复用已选择且仍在运行的进程，其次选择正在运行的 `Workbench` 终端，再选择其他运行中的终端。若没有运行中的终端，它会关闭已退出的 `Workbench` 记录，再创建同名 shell。错误提供“重新连接”操作。Host 重启后的恢复会创建可用资源，但不会还原已终止的 shell 进程或丢失的浏览器标签。

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

- Electrobun 原生 WebView 与 Session Playwright provider 是两个独立的浏览器引擎。原生导航和语义 observation 会更新 provider 镜像，但 provider 操作不会驱动可见原生页面，直接在原生页面中的操作也不会以完全相同的 Playwright 操作序列重放。
- XLSX 编辑覆盖可见单元格值与工作表切换。它不计算公式；公式单元格保留原 XML 与缓存结果。图片和常见图表作为只读图层渲染，未知图表类型显示保留占位。宏、外部链接和高级条件格式保持只读。
- DOCX 编辑覆盖正文段落和表格单元格文字，不提供完整 Word 分页与版式。当一个被编辑文字块跨多个 run 时，替换文字会写入第一个 run，其余 run 文字会被清空，因此该文字块内混合的局部样式可能减少。页眉、页脚、媒体与其他未修改压缩包条目会保留。
- PDF、CSV、图片、音频与视频展示保持只读。PPTX 支持受限的幻灯片文本编辑，并保留媒体、形状、关系和未知 XML；完整幻灯片布局编辑留待后续。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
