# Agent Note：Arivo Rail 中的项目任务与资产

Status: implemented

[English](2026-10-26-arivo-task-rail.md) | 中文

## 问题

创作者需要从常驻 Rail 检查云端任务和本地资产，无需经过账号管理。两个页面均以项目为首要上下文。

## 决策

[启动 Client](../../../../apps/electrobun/src/distribution/arivo-shell/client/index.ts)通过原 Rail 和主界面插槽，在创作入口之后注册任务与资产库。[Host](../../../../apps/electrobun/src/distribution/arivo-shell/host/index.ts)在既有嵌入工作台请求中允许固定的 `tasks` 与 `assets` 页面。请求均不携带云端范围、账号凭证或文件系统路径。独立构建的创作插件负责项目选择、授权云端读取与本地资产文件夹存储。

## 考虑过的替代方案

仅在账号页提供入口，会把创作活动藏在管理功能中。将创作组件或云端服务导入 Harness 检出目录，会重复插件职责并绕过构建产物边界。

## 影响

对话、离开保护、Workbench、文件夹归属和市场保留原有职责。壳层在 iframe 挂载时安装精确来源的文件夹监听器，接收创作页首次文件夹查询；离开准备仍等待页面加载完成。壳层只选择页面；插件消费已发布的 Web 展示，并将响应限制在当前项目。资产页通过项目文件夹路由读取原件；导入未确认时阻止项目离开。原生媒体原件仍为显式授权的 Web 操作。不改变 Session 格式、Agent 循环、数据库或企业组合。

## 测试

[打包启动测试](../../../../apps/web/tests/arivo-startup.e2e.ts)从真实 Rail 打开任务与资产库，验证当前入口和不同图标，再返回创作页。插件构建 profile 测试在 Chromium 与 WebKit 中覆盖多个项目、延迟列表/详情回复、游标重置、范围错误、键盘菜单和窄屏布局。原生窗口截图与开发包校验单独记录；Rail 测试不代表发布或 Provider 验收完成。
