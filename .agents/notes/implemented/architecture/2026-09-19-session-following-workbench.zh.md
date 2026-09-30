# Agent Note：跟随 Session 的 Workbench 分离 UI owner 与 capability 状态

Status: implemented

[English](2026-09-19-session-following-workbench.md) | 中文

## Problem

桌面端和 Web 客户端需要一个跟随 Session 的详情工作区，同时终端、文件和浏览器 capability 继续保留各自的 Host 状态与清理规则。

## Decision

`ui-workbench` 是布局 `details` slot 的唯一 owner。其按 Session 作用域的 keyed 子 slot 管理成果、终端、浏览器和文件面板，因此切换 Session 会切换面板状态而不改变三栏布局 owner。成果页复用 `ui-deliverables` 的 Turn 数据，并按当前已加载 Chat timeline 的首次出现顺序聚合成功变更路径。成果 key props 向成果页传入文件打开回调；选择路径后，一次 Workbench store action 会同时更改当前标签、目录和文件选择，随后文件面板通过有界的 Workbench Remote 读取该文件。Chat 通过根作用域的 Workbench 文件打开器处理轮次尾部 chip 和消息正文链接，因此这些入口会打开同一个 Session 文件页；没有 Workbench 的组合才回退到 Host 工作区 opener。终端继续复用 `ctx.terminals`，文件通过 expected version 使用 `ctx.fs`，浏览器是独立 capability，不改变 `ctx.web` 的 search/fetch 语义。

浏览器 capability 管理不透明的 context 和 tab identity 以及 provider 生命周期。Host Controller、模型工具和 Client 面板访问同一个按 Session 管理的 context。桌面面板渲染沙箱化的 Electrobun 原生 WebView，Web 客户端渲染 iframe；两个面板都不渲染 provider screenshot。桌面端让非当前原生视图保持隐藏并启用输入穿透；readiness 事件会先根据 Client 选中的标签协调所有视图，再允许指针输入。同一个企业 Runtime 打开的每个原生视图跨 Session 和浏览器上下文使用同一个 `persist:dsh-workbench-runtime-<runtimeStorageIdentity>` Electrobun 分区。桌面端使用部署 origin、组织 id 和 Runtime id 派生非秘密的存储 identity；该 identity 不包含凭据 token，另一个 Runtime 会获得独立分区。当前原生 WebView 管理可见导航、持久化存储和历史记录，且视图创建后 `src` 保持固定。地址提交和工具栏命令操作该视图；随后产生的导航会镜像到 Session Playwright 页面，有界的原生标题、URL、导航状态和语义 DOM observation 会更新 Session 浏览器状态。provider 跟随状态不能重新加载或导航原生视图。模型工具通过 `browser_tabs` 发现该 context，并优先读取当前原生 observation，再回退到 provider snapshot。

原生 WebView 与 Playwright provider 是两个独立的浏览器引擎。原生导航与 observation 会馈送到 provider 镜像，但 provider 导航不会驱动原生历史记录。直接的原生操作不等同于 Playwright 操作。因此，桌面验收会分别验证原生渲染和操作，以及 provider 自动化与模型可读的 Session 状态。

launcher 通过 `conversation.session.header.utilities` 贡献只显示图标的 action，因此用户关闭 Workbench 后仍可从 Session header 打开它。终端面板绑定按 Session 管理的持久终端，并使用 xterm renderer。键盘字节直接进入 PTY，原始 PTY 输出保留 ANSI 和光标控制序列，renderer 尺寸用于调整 provider。Bash 负责行编辑、历史、补全和前台信号；面向模型的发送继续读取独立的净化输出视图。

文件面板通过 `ctx.fs` 在 Session 工作区内读取。文件夹、普通文件和其他条目使用不同图标、颜色、元数据和无障碍描述。有效 UTF-8 文件通过 expected-version 替换保持可编辑，白名单则把常用图片、音频、视频和 PDF 文件扩展名映射到浏览器原生媒体元素。可回收的 Blob URL 让浏览器 PDF viewer 读取有界字节，而不再使用沙箱化的 `data:` 文档。DOCX、PPTX、XLSX 和 CSV 字节以有界文档 payload 通过 Remote。[内置 Office 决策](../feature/2026-09-22-built-in-office-editing.zh.md)拥有 OOXML 渲染、有限编辑与保留压缩包的保存机制。`ctx.fs.writeBytes` 让本地、沙箱和 E2B provider 共享文本写入的原子发布、陈旧版本保护与每次调用 sandbox policy，且不伪造文本 diff 字段。所有预览均不执行宏、脚本或嵌入对象，未识别的二进制文件仍会关闭式失败。企业桌面 profile 让 Session 从 `workspace-write` 启动，因此可以替换组织工作区内的文件，但不会授权工作区外的路径。

浏览器操作在产品层默认自动允许。当前 capability 强制校验 URL 协议、标签页数量、observation 大小、资源大小和进程清理限制。完整浏览器导航 SSRF 防护仍待实现；当前 URL 校验不是 DNS 固定的公网地址策略。

Workbench 资源 id 仅是活跃 Host 生命周期内的提示，不是持久的归属证明。Connection 代次控制浏览器与终端读取器的生命周期。浏览器跟随流基线替换缓存的上下文 id；终端发现仅选择运行中的进程，并在重新生成前释放已退出的 Workbench 名称。这样保留了 Host 归属校验，不会把归属失败当作使用其他 Session 资源的许可。恢复保证可用性，不还原进程内存或丢失的页面状态。

## Alternatives considered

- **继续让 `ui-chat` 拥有 details** —— 可以保留原有组合方式，但每个新面板都会争用同一个布局插槽，切换 Session 也会把 UI 选择状态和 capability 状态混在一起。
- **在浏览器面板中渲染 Playwright screenshot** —— 可以让可见像素与模型操作使用同一个引擎，但网页无法按面板 viewport 重排，也无法提供原生浏览器行为。
- **宣称原生 WebView 与 Playwright 是同一个页面** —— 会掩盖两个引擎各自的状态，并使操作与验收结论失真。

## Consequences

- 切换 Session 会重新挂载面板内容，同时保留外层三栏布局。
- 成果页是 Workbench 默认页签，只列出已加载轮次中的成功变更工具路径；终端创建的文件仍不在这套词表中。
- 成果选择会在文件页内打开，且 Workbench 不导入 deliverables runtime code；Session 工作区之外的路径仍由文件 capability 拒绝。
- 浏览器、终端和文件操作继续受现有 provider 与 Remote contract 限制；Workbench 不增加第二套 capability registry。
- 原生 WebView 在同一个 Runtime 内跨原生标签、Session 和浏览器上下文共享 Cookie 与站点存储，并在工具栏刷新时保留历史记录；provider 操作会留在 Agent 镜像中，直到原生导航更新该镜像。
- 文本读取与二进制文档 payload 具有独立可配置的字节限制。DOCX、PPTX 和 XLSX 使用白名单二进制替换路径；PDF、CSV、媒体与未识别二进制内容保持只读，也不会通过文本变更 API 变为可写。
- Office 保存会留下未修改的 OOXML 压缩包条目。XLSX 公式和绘图对象保持只读，DOCX 与 PPTX 提供有界文本编辑，但不声称具备完整 Microsoft Office 版式兼容性。
- 直接终端输入绕过面向模型的发送预留，但仍受 owner 授权并在后端串行化；并发 writer 必须协调各自的输入。
- 桌面验收证明原生 WebView 的渲染和操作；provider 测试分别证明自动化、observation 存储和模型可读页面内容。
- 详情栏可扩展至主内容区的 80%，同时为中间栏保留 240 像素下限；当详情栏下限无法与中间栏下限同时满足时，详情栏会关闭。
- 浏览器 URL 校验目前只强制协议和生命周期限制；需要 DNS 固定公网 SSRF 策略的部署必须先补上该策略，才能把导航视为已加固。

## Verification

定向 Client 回归覆盖旧浏览器 identity 替换、空的替换基线、运行中终端选择、已退出名称释放，以及终端发现完成前的取消。

本次变更运行 Client 和 Host TypeScript project references 以及 Workbench/layout 与 browser/controller 聚焦测试，覆盖动态详情栏宽度、稳定的原生 WebView 挂载、按 Runtime 管理的持久化存储、非当前视图指针隔离、observation 限制、observation 失效、provider 回退、版本校验文本编辑、媒体类型选择、媒体字节限制以及浏览器原生图片、音频、视频和 PDF 展示。文件面板测试还覆盖 Blob URL 释放、生成的双工作表 XLSX（包括具名标签切换、行列标题、合并单元格、已保存尺寸、格式化数字、冻结窗格和基础样式），以及嵌入图片使用绝对 drawing target、同时保留非绘图关系和可读单元格内容的工作簿。聚焦的原生浏览器测试还证明：同一个 Runtime 内的 Session 和浏览器上下文获得同一个持久化分区，另一个 Runtime 获得不同分区，provider URL 变化不会替换已挂载 WebView 的 source，桌面端地址提交会等待原生导航后再镜像，原生历史或刷新控件不会调用 Playwright provider，较晚到达的 readiness 事件不能重新激活非当前视图。重新构建的企业桌面端 bundle 已携带更新后的 Client 启动，文档快速检查和完整同步检查均通过。自动化的真实模型 Web 验收通过 Session Playwright provider 打开并读取 httpbin 表单，在实时 iframe 中渲染页面，将 Workbench 从 359 像素拖宽到 1,106 像素（主内容区的 79.9%），并在不提交表单的情况下编辑一个表单控件；这项验收只证明 Web fallback，不证明原生 WebView。已登录的企业级桌面端验收从 Session header 打开 Workbench，并通过 xterm shell 验证直接命令输入、ArrowUp 历史、Tab 补全和 Ctrl-C 中断。连接同一 Runtime 的浏览器录制把 Workbench 扩展到 1,311 像素，渲染 ANSI 绿色输出，并重复历史、补全与中断流程；它验证共享的企业 Runtime 和 Web renderer，不验证原生浏览器 WebView。原生浏览器页面操作、viewport 重排、导航同步和模型可读语义内容仍需在登录后完成人工验收。

4 个聚焦测试文件的 120 个测试全部通过，仓库 TypeScript 检查、Workbench bundle 构建与文档快速检查均通过。企业桌面端命令会重新构建生产 Client，并启动 API、Admin、renderer 与 Electrobun 进程。现有的 5 工作表 XLSX 和 9 页 DOCX 通过往返验收后能重新读取编辑值，保留每个 ZIP entry，且只更改选中的工作表 XML 或 `word/document.xml`；LibreOffice 可打开并导出两个保存后的文件，原始和编辑后 DOCX 的导出页数与布局保持一致。内置 LibreOffice renderer 缺少部分中文字体，因此原始与编辑后 DOCX 导出会出现相同的缺字方框。由于测试自动化 bridge 无法控制 Electrobun 原生界面，原生窗口中的 Office 直接编辑仍需要人工验收。
