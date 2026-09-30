---
description: "跟随会话的详情工作区，提供成果、终端、浏览器和文件标签。"
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-workbench

[English](README.md) | 中文

## 概述

Workbench 拥有按会话作用域的 `details` 栏，并为会话成果、终端、浏览器和文件面板提供稳定的子插槽。它还通过按 Session 作用域的槽位向全局顶栏提供 Files、Terminal、Browser 标签。客户端顶栏负责打开它，本包的 Session store 仍是 active tab 的唯一状态来源。关闭 Workbench 会保留 active tab；具体能力通过 Cordis 插槽注入。

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

此包拥有顶部标签壳和按 Session 管理的子插槽。内建的成果、终端、浏览器和文件面板以紧凑标签显示；添加标签按钮打开网格选择器，列出这些面板及插件提供的标签。选择面板会调用现有 Session store action 并关闭选择器，不会创建第二份 active tab 注册表。Session header 提供只显示图标的入口来打开 details 栏，全局顶栏提供 Workbench 展开图标。面板命令使用 Workbench Remote 和各 capability 的状态。成果 key 的 dispatch 提供文件打开回调；该回调将以工作区为根的绝对成果路径转换为相对路径，并通过一次 store action 更新文件页、目录和选择。浏览器标签从 `about:blank` 开始。桌面面板挂载沙箱化的 Electrobun 原生 WebView，Web 客户端挂载 iframe；两者都按面板的真实 viewport 大小渲染网页，而不展示 provider screenshot。resize observer 会在面板尺寸变化时重新同步原生 WebView 边界。只有当前原生视图接收指针输入；每个非当前视图保持隐藏并启用输入穿透，较晚到达的 readiness 事件重新同步标签集时也不会解除该状态。同一个企业 Runtime 打开的所有原生标签跨 Session 和浏览器上下文使用同一个具名 Electrobun 持久化分区，因此共享 Cookie 和站点存储。每个 Runtime 使用独立分区；分区由部署、组织和 Runtime identity 派生，不包含凭据 token。原生 WebView 管理可见导航、持久化存储和历史记录。视图创建后，其 `src` 保持固定；地址提交与工具栏命令操作原生视图，随后产生的导航及有界语义 observation 会更新 Session Playwright 镜像。provider 跟随状态可以更新地址栏，但不能重新加载原生视图。xterm renderer 将键盘数据直接发送到 PTY，消费保留及实时的原始 PTY 输出，并在面板缩放后同步测得的行列数。因此，Bash 在同一个自动聚焦的 terminal surface 中负责行编辑、历史、补全、信号、ANSI 样式和光标行为。文件面板用不同图标、颜色、元数据和无障碍描述区分文件夹、普通文件和其他条目，通过 expected-version 写入编辑有效 UTF-8 文件，并在保存成功后保持文件打开。PDF 字节通过可回收的 Blob URL 交给浏览器 PDF viewer；SVG、PNG、JPEG、GIF、WebP、AVIF、BMP 图片，MP3、WAV、Ogg、FLAC、M4A 音频，以及 MP4、WebM、Ogg、QuickTime 视频使用对应的浏览器原生元素。内置 Office 界面渲染并编辑 XLSX 工作表网格（包括全部标签、样式、合并、冻结窗格、图片和常见图表占位）、DOCX 段落与表格，以及 PPTX 幻灯片文本，同时保留不支持的 OOXML 对象。保存仅修改原始压缩包中被编辑的 XML part，保留媒体、绘图、关系和未知 entry，并通过 Workbench Remote 发送带防护的二进制替换。面板 dispose 会中止跟随流，并释放 Blob URL、renderer、resize observer 和 input listener。源码入口为 [`src/client/index.ts`](src/client/index.ts)、[`src/client/Workbench.tsx`](src/client/Workbench.tsx) 和 [`src/client/panels`](src/client/panels)。

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
