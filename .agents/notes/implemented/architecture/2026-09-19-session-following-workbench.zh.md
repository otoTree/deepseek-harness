# Agent Note：跟随 Session 的 Workbench 分离 UI owner 与 capability 状态

Status: implemented

[English](2026-09-19-session-following-workbench.md) | 中文

## Problem

桌面端和 Web 客户端需要一个跟随 Session 的详情工作区，同时终端、文件和浏览器 capability 继续保留各自的 Host 状态与清理规则。

## Decision

`ui-workbench` 是布局 `details` slot 的唯一 owner。其按 Session 作用域的 keyed 子 slot 管理成果、终端、浏览器和文件面板，因此切换 Session 会切换面板状态而不改变三栏布局 owner。成果页复用 `ui-deliverables` 的 Turn 数据，并按当前已加载 Chat timeline 的首次出现顺序聚合成功变更路径。成果 key props 向成果页传入文件打开回调；选择路径后，一次 Workbench store action 会同时更改当前标签、目录和文件选择，随后文件面板通过有界的 Workbench Remote 读取该文件。Chat 通过根作用域的 Workbench 文件打开器处理轮次尾部 chip 和消息正文链接，因此这些入口会打开同一个 Session 文件页；没有 Workbench 的组合才回退到 Host 工作区 opener。终端继续复用 `ctx.terminals`，文件通过 expected version 使用 `ctx.fs`，浏览器是独立 capability，不改变 `ctx.web` 的 search/fetch 语义。

[共享浏览器页面决策](2026-10-16-shared-browser-page.zh.md)拥有浏览器展示、存储和聊天 Session identity。本记录拥有 Workbench 壳、终端、文件以及 connection 代次恢复。

launcher 通过 `conversation.session.header.utilities` 贡献只显示图标的 action，因此用户关闭 Workbench 后仍可从 Session header 打开它。终端面板绑定按 Session 管理的持久终端，并使用 xterm renderer。键盘字节直接进入 PTY，原始 PTY 输出保留 ANSI 和光标控制序列，renderer 尺寸用于调整 provider。Bash 负责行编辑、历史、补全和前台信号；面向模型的发送继续读取独立的净化输出视图。

文件面板通过 `ctx.fs` 在 Session 工作区内读取。文件夹、普通文件和其他条目使用不同图标、颜色、元数据和无障碍描述。有效 UTF-8 文件通过 expected-version 替换保持可编辑，白名单则把常用图片、音频、视频和 PDF 文件扩展名映射到浏览器原生媒体元素。可回收的 Blob URL 让浏览器 PDF viewer 读取有界字节，而不再使用沙箱化的 `data:` 文档。DOCX、PPTX、XLSX 和 CSV 字节以有界文档 payload 通过 Remote。[内置 Office 决策](../feature/2026-09-22-built-in-office-editing.zh.md)拥有 OOXML 渲染、有限编辑与保留压缩包的保存机制。`ctx.fs.writeBytes` 让本地、沙箱和 E2B provider 共享文本写入的原子发布、陈旧版本保护与每次调用 sandbox policy，且不伪造文本 diff 字段。所有预览均不执行宏、脚本或嵌入对象，未识别的二进制文件仍会关闭式失败。企业桌面 profile 让 Session 从 `workspace-write` 启动，因此可以替换组织工作区内的文件，但不会授权工作区外的路径。

浏览器操作在产品层默认自动允许。当前 capability 强制校验 URL 协议、标签页数量、observation 大小、资源大小和进程清理限制。完整浏览器导航 SSRF 防护仍待实现；当前 URL 校验不是 DNS 固定的公网地址策略。

Workbench 资源 id 仅是活跃 Host 生命周期内的提示，不是持久的归属证明。Connection 代次控制浏览器与终端读取器的生命周期。浏览器跟随流基线替换缓存的上下文 id；终端发现仅选择运行中的进程，并在重新生成前释放已退出的 Workbench 名称。这样保留了 Host 归属校验，不会把归属失败当作使用其他 Session 资源的许可。恢复保证可用性，不还原进程内存或丢失的页面状态。

## Alternatives considered

- **继续让 `ui-chat` 拥有 details** —— 可以保留原有组合方式，但每个新面板都会争用同一个布局插槽，切换 Session 也会把 UI 选择状态和 capability 状态混在一起。

## Consequences

- 切换 Session 会重新挂载面板内容，同时保留外层三栏布局。
- 成果页是 Workbench 默认页签，只列出已加载轮次中的成功变更工具路径；终端创建的文件仍不在这套词表中。
- 成果选择会在文件页内打开，且 Workbench 不导入 deliverables runtime code；Session 工作区之外的路径仍由文件 capability 拒绝。
- 浏览器、终端和文件操作继续受现有 provider 与 Remote contract 限制；Workbench 不增加第二套 capability registry。
- 文本读取与二进制文档 payload 具有独立可配置的字节限制。DOCX、PPTX 和 XLSX 使用白名单二进制替换路径；PDF、CSV、媒体与未识别二进制内容保持只读，也不会通过文本变更 API 变为可写。
- Office 保存会留下未修改的 OOXML 压缩包条目。XLSX 公式和绘图对象保持只读，DOCX 与 PPTX 提供有界文本编辑，但不声称具备完整 Microsoft Office 版式兼容性。
- 直接终端输入绕过面向模型的发送预留，但仍受 owner 授权并在后端串行化；并发 writer 必须协调各自的输入。
- 详情栏可扩展至主内容区的 80%，同时为中间栏保留 240 像素下限；当详情栏下限无法与中间栏下限同时满足时，详情栏会关闭。
- 浏览器 URL 校验目前只强制协议和生命周期限制；需要 DNS 固定公网 SSRF 策略的部署必须先补上该策略，才能把导航视为已加固。

## Verification

定向 Client 回归覆盖旧浏览器 identity 替换、空的替换基线、运行中终端选择、已退出名称释放，以及终端发现完成前的取消。

聚焦的 Client 和 Host 回归覆盖 Workbench 状态、终端恢复、带版本检查的文件编辑以及媒体/文档展示。浏览器展示验证归属于共享浏览器页面决策。

4 个聚焦测试文件的 120 个测试全部通过，仓库 TypeScript 检查、Workbench bundle 构建与文档快速检查均通过。企业桌面端命令会重新构建生产 Client，并启动 API、Admin、renderer 与 Electrobun 进程。现有的 5 工作表 XLSX 和 9 页 DOCX 通过往返验收后能重新读取编辑值，保留每个 ZIP entry，且只更改选中的工作表 XML 或 `word/document.xml`；LibreOffice 可打开并导出两个保存后的文件，原始和编辑后 DOCX 的导出页数与布局保持一致。内置 LibreOffice renderer 缺少部分中文字体，因此原始与编辑后 DOCX 导出会出现相同的缺字方框。由于测试自动化 bridge 无法控制 Electrobun 原生界面，原生窗口中的 Office 直接编辑仍需要人工验收。
