# Agent Note：Admin 参考界面采用浅色工作画布

Status: implemented

[English](2026-09-30-enterprise-admin-reference-alignment.md) | 中文

## Problem

提供的企业超级管理员界面导出使用深色导航栏和浅色工作画布，而之前的跨产品视觉基线让整个 Admin 保持深色。现有 Admin 还将多个平台页面渲染为通用 JSON 表格，组织、用量、健康和审计工作流不便于扫描。

## Decision

Admin 继续使用共享的 `ui-theme` 语义角色、状态词汇、焦点处理和响应式规则，但 `apps/admin/app/global.css` 将内容画布、卡片、控件和表格表面映射为浅色参考界面。导航栏保持深色，并负责全局作用域切换器、分组导航、健康摘要和管理员账户区。企业客户端继续使用[共享视觉系统](2026-09-29-enterprise-admin-visual-system.zh.md)定义的跨产品深色呈现。

平台总览由管理员专用的单次 `/v1/platform/overview` 事务提供。接口返回统计范围、组织/成员/Runtime 与用量总数、上海时区趋势点、待办、健康行和最近审计事件。Admin 使用 typed Zod 视图模型校验响应，再渲染指标卡、趋势、待办、健康和审计行。

Admin 导航使用领域路由保存当前工作区，查询参数继续用于组织作用域和列表筛选。现有资源 API 仍是动作 owner；参考工作流需要时，领域页面增加持久化审批和历史接口。

## Alternatives considered

- **让整个 Admin 保持深色** —— 可以保留之前的色板，但无法符合提供的管理员参考界面；浅色工作区是其扫描层级的一部分。
- **在产品内直接渲染 PNG 导出图** —— 可以得到截图匹配，但没有可用、可访问的界面，也无法使用实时数据和操作。
- **由浏览器分别请求总览卡片** —— 不同请求可能来自不同时间；服务端聚合保证统计范围和事务一致。

## Consequences

- Admin 与企业客户端共享语义角色和交互状态，同时在表面明暗和信息密度上有意区分。
- 总览拥有稳定的 typed 响应和单一刷新点，详情页面继续使用各资源已有 API。
- 文案继续由 `apps/admin/app/messages.ts` 负责；参考图示例数字只用于测试 fixture。
- 剩余视觉工作主要是逐页细化详情表格和抽屉；共享壳层和总览已经确定它们的 owner 与间距规则。

## Verification

`pnpm --filter @deepseek-ai/dsh-enterprise-admin typecheck`、单元测试和生产构建均通过。API typecheck 通过。Playwright 使用本地响应 fixture 验证了 1440px 登录页和已认证总览；总览展示了参考布局、指标卡、趋势、待办、健康和审计面板。
