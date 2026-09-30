---
description: "Web GUI 的外壳布局：三栏 AppFrame、拖动手柄与让步行为、面板几何服务与主题呈现；供窗口外观的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-layout

[English](README.md) | 中文

## 概述

本包提供 Web GUI 的外壳布局：固定 56px 一级导航 rail、可缩放的会话侧栏、顶栏、对话主区与 Workbench details 区。`MainNavigation` 在一个状态中管理会话和企业页面；`ctx.layout` 打开或关闭 Workbench 时不会改变当前 Session 的 active tab。宽度计算始终为对话保留至少 560px；空间足够时显示 300–360px 的并列 Workbench，空间不足时改为右侧覆盖层。它还承载主题呈现器，把解析后的配色方案、别名 token、正文字号与 `theme-color` 元数据投影到 document。

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

在 root 槽位挂载本插件；它随即围绕占据侧栏、会话、主页面和详情栏的内容渲染应用框架。插件可以调用 `ctx.mainNavigation.openPluginMarket()` 或 `openConversation()` 切换页面，同时保留当前会话。用户拖动不可见命中条带缩放侧栏、拖动浮动胶囊缩放详情面板；窗口变窄时只有详情栏收缩，随后自动关闭。关闭的侧栏保留 56px 控制栏；详情栏关闭到零宽度。

### 主题呈现

呈现器消费解析后的主题快照，并投影到 document：`html { color-scheme }` 驱动原生 UA 控件，依据当前配色方案设置 `body[data-ds-dark-theme]`，把主题的别名 token 与 `--dsh-content-font-size` 设为 body 上的内联变量，并持有一个 `<meta name="theme-color">`，其内容随计算后的 body 背景色更新。释放呈现器时，它会连同其他全局写入一起移除自己的元数据节点。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

一次 `register()` 调用把 `AppFrame` 贡献进运行时的内建 `'root'` 槽位，并声明 rail、顶栏、会话侧栏、会话、主页面、details 与 shell overlay 槽位。顶栏同时声明按 Session 作用域的 Workbench 标签子席位，功能包可以追加控件而不接管外壳。布局 store 固定 rail 可见性，独立记录会话侧栏宽度与开关，并以 Workbench 关闭启动。AppFrame 保持对话与 Workbench 子树挂载；市场页面出现时关闭 Workbench 但保留当前会话。宽度计算根据 AppFrame 容器决定并列或覆盖模式。主题呈现器是第二个 effect：从解析后的快照做纯 DOM 写入。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当布局面不够用时阅读以下页面。它们从框架进入它所渲染的栏与它所呈现的主题。

- [ui-sidebar](../ui-sidebar/README.zh.md)——占据 `sidebar` 栏及其座位。
- [ui-conversation](../ui-conversation/README.zh.md)——占据 `conversation` 与 `details` 栏。
- [ui-theme](../ui-theme/README.zh.md)——呈现器消费其解析快照的主题 seam。
- [Web 客户端架构](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md)——浏览器插件行如何加载并注册槽位。

-----

<a id="model-experience"></a>
## 模型体验

无。布局外壳管理浏览器查看状态；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前布局行为。它们是当前包约束，不是通用窗口管理器对比或任务积压。

- **面板几何是瞬时状态**——重新加载会恢复侧栏默认值并保持详情栏关闭；在不同会话 id 之间切换同样会关闭详情栏并忘记拖动后的宽度，而未选中表面以零宽度渲染详情栏却不修改几何。
- **让步链自动关闭通过推导零宽度实现，不触碰偏好宽度**——窗口变宽时面板自行恢复；消费方不得把 store 中的详情宽度当作渲染真值。
- **挤压重排期间无滚动锚定**——布局变化可能移动读者的视口。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。`ctx.layout` 后的 viewing-state store 不发出 Cordis 事件；clamp、prune 与 concession-chain 顺序由本包测试覆盖。
