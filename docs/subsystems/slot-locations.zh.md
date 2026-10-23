# Client Slot UI 位置参考

[English](slot-locations.md) | 中文

## 摘要

按界面位置查找 Client Slot（客户端插槽），可据此选择插件 UI 的接入点。当前源码声明了 57 个 key；有声明不代表界面上有可见位置。`sidebar.brand.name` 没有渲染调用，`conversation.details.tool` 在当前 Workbench 组合中没有已挂载的声明者。下表覆盖全部 57 个 key，并标明这些限制。

本文描述 Harness Web Client 及使用该界面的桌面客户端。独立的企业管理后台 Admin 不属于这套插槽系统。位置依据当前源码组合整理；本文是布局参考，不是运行中部署的截图。

## 目录

- [理解可用条件](#availability)
- [UI 总览](#overview)
- [应用框架](#frame)
- [导航与侧边栏](#sidebar)
- [会话标题与视图](#session)
- [新会话页面](#hero)
- [输入区](#composer)
- [消息流与工具卡片](#transcript)
- [工作台](#workbench)
- [设置](#settings)
- [选择扩展点](#choose)
- [延伸阅读](#further-exploration)
- [开发备注](#dev-note)

-----

<a id="availability"></a>
## 理解可用条件

声明某个插槽的 entry 注册后，该插槽才存在，并随该 entry 的生命周期存续。是否真正渲染还取决于导航、选中对象和界面状态。替换父级可能移除它声明的子插槽。[插槽系统参考](slots.zh.md)定义类型、作用域、优先级、props 和注册语义；[发行目录](../cookbook/enterprise-plugin-kit/docs/slots.zh.md)及其 [JSON](../cookbook/enterprise-plugin-kit/docs/slot-catalog.json)提供各 key 的注册细节。

下表中的“需要 Session”表示必须存在当前 Session 绑定。root 作用域不代表始终可见。空白新会话页面可能尚未创建 Session，因此需要 Session 的控件不一定出现在该页面。企业配置与本地配置可以提供不同占用者，也可以替换整个设置页面。

-----

<a id="overview"></a>
## UI 总览

桌面宽屏下的大概布局如下，图中使用 slot key 标注。Workbench 可以收起，并可在窄屏下覆盖主区域。设置在主内容区域打开。

```text
root
+-----------------------------------------------------------------------+
| topbar: product title | topbar.session: title / actions / utilities     |
+------+----------------+-----------------------------+------------------+
| rail | sidebar        | conversation                | details          |
|      |                |                             | Workbench        |
| extra| workspaces /   | hero OR conversation.view   | workbench.tabs   |
| items| sessions       | chat nodes / tool cards     | workbench.panel  |
|      |                |                             |                  |
|      |                | conversation.input.dock     |                  |
|      |                | conversation.composer       |                  |
|      |                |   attachments / text        |                  |
|      |                |   plan / left / right/model |                  |
|      | footer.action  | conversation.composer.dock  |                  |
|  S   |                |                             |                  |
+------+----------------+-----------------------------+------------------+
S = sidebar.settings (bottom of rail)
main.surface: replaces conversation for application pages
shell.overlay: floating layer above all columns
```

-----

<a id="frame"></a>
## 应用框架

框架提供主要分栏与顶部栏。具体渲染位置见 [AppFrame](../../packages/client/ui-layout/src/client/AppFrame.tsx)。

| Slot key | UI 大概位置 | 显示条件与用途 |
| --- | --- | --- |
| `root` | 整个应用 | 界面根入口；替换它会替换整个框架。 |
| `rail` | 最左侧常驻的窄导航栏 | 包含导航项与设置入口。 |
| `sidebar` | 窄导航栏右侧的会话侧边栏 | 承载工作区与会话列表，可以收起。 |
| `topbar` | 全局顶部横栏 | 产品名称与框架控件。 |
| `topbar.session` | 顶部栏内的会话区域 | 需要 Session；包含标题、操作、实用按钮与视图导航。 |
| `conversation` | 中央主区域 | 承载空白新会话页和已有会话。 |
| `main.surface` | 与 conversation 共用主内容位置 | 按 key 显示设置、插件市场、云盘和触发器页面，替代会话区域。 |
| `details` | 右侧分栏，或窄屏覆盖区域 | 当前承载 Workbench；关闭时仍保持挂载，并接收 `open`。 |
| `shell.overlay` | 所有分栏之上的浮层 | 适合全局徽标或通知；需要交互的 entry 须启用自身指针事件。 |

-----

<a id="sidebar"></a>
## 导航与侧边栏

常驻窄导航栏与可收起的会话侧边栏是两个独立分栏。见 [NavigationRail](../../packages/client/ui-sidebar/src/client/NavigationRail.tsx)、[SidebarRoot](../../packages/client/ui-sidebar/src/client/SidebarRoot.tsx) 和 [WorkspaceBrowser](../../packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx)。

| Slot key | UI 大概位置 | 显示条件与用途 |
| --- | --- | --- |
| `sidebar.rail.item` | 最左侧窄导航栏，会话入口之后、底部设置之前 | 追加导航项。 |
| `sidebar.settings` | 常驻窄导航栏底部 | 设置导航入口与新手引导协调器。 |
| `sidebar.workspaces` | 会话侧边栏的主体 | 工作区、会话浏览、搜索及相关对话框。 |
| `sidebar.workspaces.directoryFlow` | 从侧边栏工作区浏览区域打开的目录选择界面 | 目录选择流程触发时显示；浏览器与原生实现可以不同。 |
| `sidebar.footer.action` | 会话侧边栏底部 | 追加操作，例如 Cordis 面板；与窄导航栏内的设置入口分开。 |
| `sidebar.brand.mark` | 会话侧边栏收起后的展开按钮内 | 仅在收起状态渲染，不是展开侧边栏的 Logo 位置。 |
| `sidebar.brand.name` | 当前没有可见位置 | SidebarRoot 注册时有声明、可注册，但 SidebarRoot 没有渲染它。 |

-----

<a id="session"></a>
## 会话标题与视图

这些位置都需要 Session。会话标题区域渲染在全局顶部栏内，视图正文渲染在中央区域。见 [ConversationSession](../../packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx)。

| Slot key | UI 大概位置 | 显示条件与用途 |
| --- | --- | --- |
| `conversation.session` | 输入区上方的会话正文 | 承载当前会话视图。 |
| `conversation.session.header.lineage` | 顶部栏的标题、面包屑片段 | 用于会话层级与子智能体标题展示。 |
| `conversation.session.header.actions` | 紧邻会话标题 | 追加 Agent preset、任务列表或定时任务等入口。 |
| `conversation.session.header.utilities` | 会话标题区域右侧 | 追加会话日志下载等实用按钮。 |
| `conversation.view` | 会话主内容；视图导航位于标题区域 | list entry 对应可选视图，每次显示一个正文；存在多个视图时显示导航。 |

-----

<a id="hero"></a>
## 新会话页面

这些位置属于空白新会话的 Hero 区域。见 [ConversationRoot](../../packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx) 和 [WorkspacePicker](../../packages/client/ui-workspace/src/client/WorkspacePicker.tsx)。

| Slot key | UI 大概位置 | 显示条件与用途 |
| --- | --- | --- |
| `conversation.hero.workspace` | 空白页工作区标签打开的选择界面 | 工作区标签由父组件绘制，本插槽承载选择器内容。 |
| `conversation.hero.workspace.directoryFlow` | 上述工作区选择器打开的目录选择流程 | 触发目录选择流程时显示。 |
| `conversation.hero.agentPreset` | 空白新会话页面上的 Agent preset 控件 | 为新会话选择待应用的 preset。 |

-----

<a id="composer"></a>
## 输入区

常驻输入卡片内包含附件、正文和底部工具栏；上方 dock 与下方 dock 位于卡片外。见 [InputBar](../../packages/client/ui-conversation/src/client/skeleton/InputBar.tsx)、[ConversationRoot](../../packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx) 和 [ApprovalPanel](../../packages/client/ui-approval/src/client/ApprovalPanel.tsx)。

| Slot key | UI 大概位置 | 显示条件与用途 |
| --- | --- | --- |
| `conversation.composer` | 会话底部的整个输入区域 | 需要 Session；chain entry 可在审批、用户问答或只读子智能体状态下接管。 |
| `conversation.composer.bar` | 常驻输入卡片 | 也覆盖创建 Session 前的未激活状态；注册会替换卡片，不是追加按钮。 |
| `conversation.input.dock` | 输入卡片上方的整行区域 | 需要 Session；队列、待办、目标面板按状态显示在这里。 |
| `conversation.composer.dock` | 输入卡片下方 | 需要 Session；追加统计等辅助信息。 |
| `conversation.input.attachments` | 输入卡片内，正文编辑器之前 | 附件条与拖放目标，可在无 Session 绑定时渲染。 |
| `conversation.input.overlay` | 锚定在输入卡片内部的浮动菜单 | 需要 Session；命令菜单和斜杠菜单打开时在此渲染。 |
| `conversation.input.plan` | 底部工具栏的左侧控件组 | 需要 Session；位于权限控件旁的 Plan 控件。 |
| `conversation.input.left` | 工具栏左侧，Plan 控件组之后 | 需要 Session 与输入状态；追加紧凑控件。 |
| `conversation.input.right` | 工具栏右侧控件组，模型选择器之前 | 需要 Session 与输入状态；追加紧凑控件。 |
| `conversation.input.model` | 工具栏右侧控件组，input.right 之后 | 需要 Session；模型选择器，位于上下文用量与发送、停止控件之前。 |
| `conversation.approval.detail` | 接管输入区的审批卡片内部 | 仅在待审批请求关联了工具调用时显示。 |

-----

<a id="transcript"></a>
## 消息流与工具卡片

这些位置都需要 Session，以及对应的消息、节点、工具调用或视图。见 [ChatNodeSeat](../../packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx)、[TurnTailNodeView](../../packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx)、[ToolCallTree](../../packages/client/ui-tool/src/client/tool/ToolCallTree.tsx) 和 [Cordis 插槽声明](../../packages/extensions/ui-cordis/src/client/slots.ts)。

| Slot key | UI 大概位置 | 显示条件与用途 |
| --- | --- | --- |
| `conversation.chat.node` | 中央 Chat 消息流中的单个节点 | 按节点种类分派；覆盖已有 key 会替换该类节点的展示。 |
| `conversation.chat.commandview` | Chat 内的命令节点 | 按命令名称分派。 |
| `conversation.chat.turnTail` | 一轮对话尾部，操作按钮行之前 | 通过 selector 选择的 chain；用于展示产出文件。 |
| `conversation.chat.assistant-actions` | 轮次末尾的已完成助手消息操作行 | 消息反馈等操作，需要持久化消息 id。 |
| `conversation.message.images` | Chat 消息内的图片组 | 仅在消息包含图片时出现。 |
| `conversation.trajectory.images` | Trajectory 记录视图内的图片组 | 需要打开 Trajectory 视图，且记录包含图片。 |
| `tool.call.toolview` | Chat 内单个工具调用行或卡片 | 按协议中的工具名称分派，用于自定义某个工具的展示。 |
| `tool.call.images` | 已完成工具调用内的图片内容 | 需要包含图片的工具结果及对应渲染 entry。 |
| `tool.view.cordis` | 最新符合条件的 cordis_run 卡片内部交互区 | 按 Package 标识分派，需要匹配的 Cordis 卡片。 |

-----

<a id="workbench"></a>
## 工作台

右侧区域由 [Workbench](../../packages/client/ui-workbench/src/client/Workbench.tsx) 承载。内置面板与插件面板并非全部经过同一个分派路径。

| Slot key | UI 大概位置 | 显示条件与用途 |
| --- | --- | --- |
| `workbench.tabs` | 右侧 Workbench 顶部标签栏 | 无 Session 时也可渲染；entry 接收注册标签与切换标签的回调。 |
| `workbench.panel` | Workbench 标签栏下方的正文 | 需要 Session；按当前标签 key 分派；内置浏览器有独立渲染路径。 |
| `conversation.details.tool` | 独立 DetailsPanel 组件的工具结果正文 | 当前组合没有可用位置：Workbench 注册到 details，而 DetailsPanel 未被注册，也没有 entry 声明此子插槽。 |

-----

<a id="settings"></a>
## 设置

设置入口打开主页面，左侧为设置分类导航，右侧为内容。窄内容栏将分类导航放在内容上方。操作弹窗显示在页面之上。见 [SettingsPage](../../packages/client/ui-settings-general/src/client/SettingsPage.tsx)、[ModelsSection](../../packages/client/ui-settings-models/src/client/ModelsSection.tsx) 和 [ConfigurablePluginsTab](../../packages/client/ui-settings-plugins/src/client/ConfigurablePluginsTab.tsx)。配置若替换整个分类，也可能不提供该分类的子插槽。

| Slot key | UI 大概位置 | 显示条件与用途 |
| --- | --- | --- |
| `settings.trigger` | 窄导航栏底部设置入口的内容 | 图标与标签；当前窄导航栏以视觉隐藏方式呈现标签。 |
| `settings.header` | 页面分类导航上方的标题 | 标题文本，不是整个标题栏。 |
| `settings.action` | 右侧内容列顶部 | 追加标题栏操作。 |
| `settings.section` | 一个左侧分类入口及其右侧页面 | 新增独立设置页；只渲染当前选中页面的正文。 |
| `settings.general.item` | “通用”分类内部的设置行 | 追加单项偏好设置，无需新增独立页面。 |
| `settings.onboarding` | 由 SettingsRoot 控制的新手引导层 | 步骤按各自条件触发，不是“通用”页面内的常驻设置行。 |
| `settings.models.provider-card` | “模型”页面内每张提供商卡片的扩展区 | key 为提供商设置命名空间；手动声明但未保存的草稿尚不会分派。 |
| `settings.models.footer` | “模型”页面内，提供商列表与新增控件之后 | 在模型页面末尾追加内容。 |
| `settings.plugins.tab` | “插件”分类内的标签导航与当前内容 | 在共享的插件设置分类内追加子页面。 |
| `settings.plugin.item` | “插件 → 可配置插件”内的单张卡片 | key 为该页面枚举到的 Host 设置命名空间；只注册 key 不会新增命名空间。 |

-----

<a id="choose"></a>
## 选择扩展点

选择能满足需求的最小可见位置。以下是常见的追加方式；注册前仍需核对上表中的所有者与显示条件。

- 追加顶部操作：`conversation.session.header.actions`；追加最左侧导航入口：`sidebar.rail.item`。
- 追加输入按钮：`conversation.input.left` 或 `conversation.input.right`；追加输入卡片上方面板：`conversation.input.dock`。
- 追加设置页：`settings.section`；追加通用设置项：`settings.general.item`。
- 追加右侧面板：配合使用 `workbench.tabs` 与 `workbench.panel`；自定义单个工具卡片：`tool.call.toolview`。
- 追加全局浮层：`shell.overlay`。`root`、`conversation`、`details` 等整体插槽会替换大块 UI。

-----

<a id="further-exploration"></a>
## 延伸阅读

注册细节与可执行的布局证据见以下来源。

- [插槽系统参考](slots.zh.md)：生命周期、四种组合类型与组件输入。
- [发行版插槽目录](../cookbook/enterprise-plugin-kit/docs/slots.zh.md)：逐项 props 与相邻 JSON 内的注册示例。
- [框架测试](../../packages/client/ui-layout/tests/app-frame.client.spec.tsx)、[导航测试](../../packages/client/ui-sidebar/tests/navigation-rail.client.spec.tsx)、[输入区测试](../../packages/client/ui-conversation/tests/skeleton.client.spec.tsx)、[设置测试](../../packages/client/ui-settings-general/tests/settings-root.client.spec.tsx)与 [Workbench 测试](../../packages/client/ui-workbench/tests/workbench.client.spec.tsx)：布局与条件渲染。

-----

<a id="dev-note"></a>
## 开发备注

无。
