# Agent Note：企业级客户端与 Admin 共用深色视觉系统

Status: implemented

[English](2026-09-29-enterprise-admin-visual-system.md) | 中文

## Problem

企业级客户端与管理员后台需要同一套视觉方向，但两者的任务要求不同的布局密度和信息节奏。仓库已有语义化 `ui-theme`，但现有文档没有定义客户端与 admin 如何收敛到一套视觉语言。

## Decision

跨产品视觉基线采用提供的 Arivo 参考中的深色系统：`#141414` 画布、分层中性色表面、`#68C5FF` 普通强调色、克制的组件微光和有限的关键数据微光。`#E06E5C` 只保留给最小范围的失败状态处理。排版、间距、边框、层级、图标、焦点、浮层和响应式规则共享；客户端与 admin 可以选择不同的密度和页面轨道。

`packages/client/ui-theme/src/styles/visual-system.css` 持有共享视觉角色，并将它们映射到现有别名。客户端偏好未设置时解析为深色；已保存的 `light` 与 `system` 值继续受支持。`ui-primitives` 按钮和输入框使用紧凑控件圆角与共享焦点色。企业页面继承语义调色板，Electrobun 账户页导入主题样式并选择深色，Admin 设置深色主题属性并在 `apps/admin/app/global.css` 中保留紧凑布局。`docs/visual-design-system.md` 是跨产品视觉 owner，`docs/web-styling.md` 继续作为浏览器 CSS 实现参考。

现有 `light` 与 `system` 主题选择继续支持，并通过语义角色映射实现。它们不会创建第二套组件结构或第二套状态词汇。CSS 优先声明 Noto Sans SC 和 Space Grotesk，再回退到平台字体；仓库没有这两个字体系列的授权 WOFF2 文件，且实现时字体来源不可达，因此当前产品构建使用已安装的系统回退字体。Arivo 的页面专属组件和单文件截图工作流只作为参考，不属于产品要求。

## Alternatives considered

- **让客户端与 admin 保持独立视觉系统** —— 可以保留局部自由，但会在每个功能中重复色板、状态、焦点和浮层决策。
- **直接把 Arivo 文档复制进仓库** —— 可以保留测量值，但会带入另一个产品的页面假设并绕过现有 token owner。
- **只保留深色主题** —— 可以简化视觉基线，但会在没有产品决策的情况下移除现有 `light` 与 `system` 偏好约定。

## Consequences

- 新的共享视觉值先进入 `ui-theme`，再由功能包消费。
- 客户端页面可以使用舒适阅读密度，admin 页面可以使用紧凑扫描密度，但颜色和状态语义不分叉。
- 新页面使用视觉参考中的共享内容轨道、层级、焦点、浮层、响应式和 locale-owned 文案规则。
- 影响两个产品的高保真测量先更新跨产品视觉参考及其中文配对，再修改实现。
- 本次视觉参考不是网站页面，不增加网站 allowlist 条目。

## Verification

双语视觉参考与本文均以完整 Markdown 配对和翻译 sidecar 维护。指定配对检查、仓库 Markdown 链接检查与 whitespace 检查通过。`pnpm run test:docs` 和 `pnpm run doc-sync` 均运行到汇总门禁，但被无关工作树状态阻断：`docs/config-catalog.md` 存在未记录的配对改动，其他失败报告 trigger/Workbench JSDoc、缺失包元数据、过期生成路径和 tsconfig 路径。本决策不包含产品代码变更。
