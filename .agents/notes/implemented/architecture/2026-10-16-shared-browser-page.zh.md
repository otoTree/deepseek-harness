# Agent Note：Workbench 与 Agent 工具共享一个原生 Chromium 页面

Status: implemented

[English](2026-10-16-shared-browser-page.md) | 中文

## 问题

原生 WebView 与单独启动的 Playwright 页面具有不同的 DOM、Cookie 和表单状态。同步 URL 无法让 Agent 工具操作用户看到的页面。将 Workbench 浏览器调用路由到隐藏的能力 Runtime，也会使其与聊天 Session 拥有的工具分离。

## 决策

桌面端嵌入 CEF Chromium 客体页面，浏览器提供方通过回环 CDP 连接这些确切页面。聊天 Session 拥有 Workbench Remote 与 Agent 工具共用的浏览器注册表；隐藏 Runtime 仅负责终端能力。此决策部分取代[跟随 Session 的 Workbench 决策](2026-09-19-session-following-workbench.zh.md)中的浏览器呈现与资源身份规则，同时保留原生持久存储隔离。

提供方先签发不可猜测的空白连接 URL，再由 Client 挂载原生客体页面。连接先在 HTTP 目标发现中等待该确切 URL，再建立每个标签独立的 CDP 连接，只导航一次，并让并发操作共享同一个就绪 Promise。CEF 不会可靠地向已有 CDP 连接通告新建的原生客体。客体缺失或匹配不唯一时明确报错。提供方不会创建替代的自动化页面。每个持久客体分区包含组织 Runtime 身份与聊天 Session 身份。工具读取所连接页面的真实无障碍树；原生观察更新标签元数据。

Workbench 在切换面板、收起详情或重连时保留客体页面。Electrobun 2.0.1 在具名 CEF 请求上下文初始化期间可能首次同步创建客体失败；可配置的启动期限允许对尚未就绪的客体重建一次。该期限不会重建已就绪页面。切换聊天 Session 会重新挂载 Session 视图，导致未保存的 DOM 状态丢失，但分区存储保留。释放时断开 CDP；原生视图负责销毁页面，桌面负责 Chromium 进程。在 macOS 上，Electrobun 2.0.1 移除已加载 CEF 客体时会额外发出宿主窗口关闭请求。桌面跟踪客体导航提交，并为每次移除消费一次该请求，后续用户主动关闭窗口仍然有效。启动期限从第一个动画帧开始计算，因为 WKWebView 在隐藏时会暂停原生标签初始化。

原生客体创建时透明且允许输入穿透。Electrobun 在异步原生创建分配标签 id 之前忽略可见性方法；CSS 可见性无法隐藏原生图层。Workbench 观察该 id 注册，并按当前面板与所选标签同步原生可见性，不依赖文档就绪事件。隐藏客体保留实时页面，且不会遮挡其他面板或拦截输入。

上游 [Electron 客体宿主](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/src/browser-guests.ts)拥有 Chromium 客体生命周期与分区，其[原生 Stagehand 提供方](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/browser-use-stagehand-native/src/native.ts)连接明确的 CDP 页面目标。Electrobun 提供对应的内嵌 Chromium 渲染器，注册表签发的连接 URL 将客体绑定到提供方标签。

## 考虑过的替代方案

**在两个引擎之间同步 URL 和 Cookie。** 这无法复现实时 DOM、内存状态、焦点或待完成导航，并可能产生重复请求。

**显示截图并转发输入。** 这会失去原生浏览器交互、布局重排、剪贴板集成和连续媒体呈现。桌面视口直接呈现实际原生客体页面。

## 后果

在已挂载的 Session 内，手动输入与 Agent 操作共享同一个文档和认证状态。桌面端随包提供 CEF，并在回环地址开放调试监听；普通 Web 部署无法嵌入此原生视口。启动模式的浏览器设置仅在提供方自行启动浏览器时生效。网站仍可能根据浏览器、账号或网络检查要求人机验证。

聚焦的 Client、浏览器服务、提供方和 Controller 回归覆盖原生挂载、连接归属、并发就绪、标签生命周期、元数据更新及重连。无需密钥的[录制 Session](../../../../snapshots/session/browser-shared-page/snapshot.yml)验证 Agent 工具读取并提交手动输入，且不会发生第二次导航。

原生 CEF 冒烟验证共享表单输入、Agent 填写和提交、文档仅加载一次，以及移除被测客体后宿主窗口与其他客体仍然保留。
