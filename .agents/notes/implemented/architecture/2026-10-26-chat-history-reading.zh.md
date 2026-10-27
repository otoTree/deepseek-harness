# Agent Note: Chat 历史自动阅读

Status: implemented

[English](2026-10-26-chat-history-reading.md) | 中文

## 问题

长对话只加载 Session 日志尾部的分页窗口。每翻一页都要求点击按钮会打断向上阅读。全局的历史不完整检查还会让完整的已关闭 Turn 保持展开，直到整个对话加载完毕，增加可见的过程内容。

## 决策

读者主动向上滚动到距已加载窗口顶部一个视口以内时，通过现有的锚定分页器请求前一页。分页器保持语义阅读锚点。成功前插后，若页面较短且读者仍在缓冲区内，可以继续请求一页。向下阅读、返回实时尾部及轮次导航会停止该补页。仅打开对话不会触发历史加载。每个窗口顶部最多自动尝试一次；失败或空页保留显式的「加载更早」恢复控件，避免请求循环。

仍存在更早历史时，Compact 折叠检查每个已关闭 Turn 是否加载了自身的 `turn/start`。完整 Turn 立即使用默认收起状态；边缘的部分 Turn 保持展开，避免过程摘要暗示证据已完整。加载其开始事件后即可折叠，并保留用户手动展开的 generation。稳定 Seat 保留工具状态与可搜索内容。

[官方 Chat renderer](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx) 同样根据 Turn 局部呈现事实判断过程是否就绪。其分组过程 renderer 与滚动 hook 需要单独协调接入。本实现保留现有连续窗口分页器与 keyed Seat 归属。

已挂载 Seat 使用自然布局，不使用 `content-visibility: auto`。[延迟渲染决策](2026-10-25-chat-offscreen-rendering.zh.md)拥有分段占位及其协调的锚点补偿规则。继续排除绘制包含，因为它可能裁剪宽表格，并在键盘 End 操作期间移动底部。

[过程折叠](../feature/2026-08-14-web-turn-process-folding.zh.md)决策继续拥有最终正文、焦点与手动展开语义；本决策替换其中的全局历史完整性要求。[提纲导航](../feature/2026-08-30-web-turn-rail-outline-jump.zh.md)与[增量渲染](2026-10-25-chat-offscreen-rendering.zh.md)决策继续有效，因为它们分别拥有导航与渲染保证。

跟随实时尾部时，Chat 在当前滚动容器上关闭浏览器滚动锚定。过程折叠或离屏渲染时，浏览器的位置调整可能被误判为读者移动，从而解除跟随归属。离开尾部后，浏览器锚定继续启用，并与语义前插锚点共同工作。[上游样式表](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-chat/src/client/chat/ChatView.module.css)使用相同的条件归属规则。

## 考虑过的替代方案

**打开时加载全部事件。** 这会消除分页边缘，但会提前为读者可能从不查看的历史执行传输、投影、DOM 与内存工作。

**折叠边缘的部分 Turn。** 这可能显示不完整的过程计数。等待该 Turn 的开始事件可以确认覆盖范围，同时允许后续完整 Turn 独立折叠。

**单独用上游分组 renderer 替换 Seat。** 分组归属、滚动恢复、导航、订阅与工具状态生命周期必须一致。部分替换可能重新挂载工具或使锚点失效；当前改动保持这些归属稳定。

## 影响

正常向上阅读可以推进历史，无需反复点击按钮。加载仍按顺序进行，已加载历史的内存仍会增长。单元覆盖验证失败恢复、阅读意图与逐 Turn 完整性；组装浏览器覆盖在 Chromium 与 WebKit 中验证自动分页、浏览器查找、键盘展开工具、复制、分支与继续对话。WebKit 覆盖不能证明经过保护处理的原生 DMG 构建具有相同的性能。
