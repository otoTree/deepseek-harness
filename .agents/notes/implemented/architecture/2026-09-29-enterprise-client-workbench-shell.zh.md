# Agent Note：企业客户端外壳拆分 rail、会话侧栏与 Workbench

Status: implemented

[English](2026-09-29-enterprise-client-workbench-shell.md) | 中文

## 问题

企业客户端需要稳定的一级导航，同时允许用户收起 Session 浏览器并打开 Workbench 面板，而不丢失 Session 上下文。

## 决策

`ui-layout` 拥有固定 56px rail、48px 顶栏、可缩放的 Session 侧栏、对话主区和 Workbench details 栏。rail 不可关闭。Session 侧栏独立保存宽度和打开状态，在窄屏断点以下转为左侧抽屉。顶栏通过槽位接收客户端内容，并使用 `ctx.layout` 完成侧栏和 Workbench 切换。

Workbench 仍是客户端核心 details 能力。它按 Session 作用域的 store 是 Files、Terminal、Browser、Results 和插件标签的唯一 active tab 来源。Canvas 不占用基础外壳栏，只能注册为 Workbench 面板。Workbench 默认关闭，关闭后保留 active tab；容器能为对话保留 560px 时与对话并列显示，否则使用右侧覆盖层，最小宽度 300px、默认宽度 360px。

Workbench 使用紧凑顶部标签列和添加标签按钮。按钮打开网格选择器，其中包含内建面板以及来自同一个选择器槽位的插件项。选择面板调用现有 Session store 的 `setActiveTab`；关闭选择器后焦点回到添加标签按钮，不建立第二份标签注册表。

Workbench 使用共享视觉系统中的层级表面、发丝边框、文字层级和冰蓝激活状态。外壳与面板控件使用共享圆角、稳定的 36px 紧凑操作尺寸、可见焦点样式和 reduced-motion 行为。激活标签与选中文件行同时使用强调表面及文字或位置表达选中状态，不依赖颜色单独传达状态。

浏览器面板只有在宿主自定义元素和经过验证的 Runtime 存储标识同时可用时才选择 Electrobun 原生 WebView。原生桥接不可用时先使用 iframe，桥接派发就绪事件后再切换，因此桌面端延迟注入不会导致 Workbench 渲染失败。

企业云盘、触发器和插件市场操作注册到 rail，同时继续调用 `mainNavigation`；页面数据和权限流程保持不变。

rail 与顶栏通过 `slots.inject()` 等待 `ui-layout` 的声明后再注册。侧栏把 `mainNavigation` 声明为显式依赖，再创建 rail 入口。企业功能统一使用 `sidebar.rail.item`，不再重复渲染内建入口，也不回退到旧的底部动作槽位。

## Alternatives considered

把一级导航继续放在可收起的 Session 侧栏中会隐藏企业入口，并让窄屏布局变得不明确。单独建立 Canvas 外壳会复制 Workbench 状态，因此 Canvas 保持为可注册到 Workbench 的插件面板。

## 结果

- 收起 Session 侧栏不会隐藏 rail，也不会改变一级导航。
- 切换 Session 时关闭 Workbench 视图，但不卸载 details 子树，也不改变 capability 所有权。
- 窄屏通过覆盖层保留对话宽度，不把列压缩到不可读。
- Escape 先关闭打开的 Workbench，再交给页面级浮层处理。

## 验证

重新生成依赖的客户端声明后，layout、sidebar、Workbench 和 enterprise 客户端类型检查通过。聚焦的 layout 与 sidebar 测试覆盖新的槽位声明及现有 Session/details 生命周期；旧几何断言需要迁移到包含 rail 的四栏模板。
