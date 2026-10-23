# Agent Note: 将 Workbench 缩放手柄锚定到网格边界

Status: implemented

[English](2026-10-21-workbench-resize-handle-alignment.md) | 中文

## 问题

Workbench 缩放条带使用根据上次观测的框架宽度计算出的像素偏移。CSS 可能在 ResizeObserver 更新 React 之前调整会话列宽度，导致条带落入会话区或偏离面板。该偏移上独立的过渡效果也使条带位置与实际网格分离。

## 决策

[AppFrame](../../../../packages/client/ui-layout/src/client/AppFrame.tsx) 将每个缩放条带渲染为绝对定位的网格子元素。CSS 网格列把它锚定到对应面板边界；网格行将命中区域限制在顶栏下方的内容区。网格负责动画期间的位置。JavaScript 保留宽度偏好、让步计算和指针位移，不再提供第二套水平坐标或过渡。

[企业外壳决策](../architecture/2026-09-29-enterprise-client-workbench-shell.zh.md) 继续负责列组合和窄窗口覆盖模式。[详情栏生命周期决策](2026-07-29-web-details-session-lifecycle.zh.md) 继续负责随 Session 变化的可见性。条带定位不取代这两项决策。

## 考虑过的替代方案

**观测更多元素或同步更新像素偏移。** 这会增加一条测量路径，同时让同一条可见边界仍由两个独立主体负责。

**把手柄放到面板内部。** 面板的溢出裁剪会截断居中的命中条带；同级网格子元素既能保留完整命中区域，也无需改变内容裁剪。

## 影响

容器宽度变化和列过渡会在同一次布局计算中保持条带对齐。指针捕获、拖动范围限制及 Workbench 可见性保留原有语义。窄窗口覆盖模式不显示缩放条带。

## 验证

[录制会话浏览器回归测试](../../../../apps/web/tests/details-session-lifecycle.e2e.ts) 打开 Workbench，对照实际面板矩形检查两个条带，在观测器通知到达前改变容器宽度，并拖动两个面板。在独立坐标实现下，缩放断言会因 400px 偏移而失败。[手柄快照](../../../../snapshots/web/details-session-lifecycle/handles.expected.md) 记录两个条带及其对齐情况，不依赖平台特定坐标。布局单元测试继续验证宽度、指针和可见性行为。
