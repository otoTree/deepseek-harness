# Agent Note: Workbench Agent 工具注入

Status: implemented

[English](2026-10-06-workbench-agent-tool-injection.md) | 中文

## 问题

Workbench 为 Agent runtime 挂载了持久终端服务和后端，但标准 Agent preset 没有挂载面向模型的终端工具插件。界面可以操作终端，Agent 请求却没有任何 `terminal_*` schema。

## 决定

标准 preset 将 `@deepseek-ai/dsh-tool-terminal` 放入与 `@deepseek-ai/dsh-terminal` 及其 shell 后端相同的 `persistent-shell` 隔离组。Web bundle 将该插件声明为运行时依赖，桌面和 Web profile 安装都能解析这一行。Web shipped composition 测试从挂载后的 Agent 目录读取数据，并断言全部 6 个终端工具存在。

## 备选方案

**将工具挂载在 Host 根作用域。** 这样会让工具全局暴露，并使其解析到不同的或不存在的终端 registry，而不是 Agent 自己的隔离 PTY 服务。

**把工具挂载在 `persistent-shell` 之外。** Cordis 注入不能让同级行解析隔离组的子服务 `terminals`，工具会保持 pending 或在组合期间失败。

## 结果

使用标准 preset 的 Agent 可以通过与 Workbench 相同的所有者隔离 registry 使用持久终端会话。终端工具仍然由 preset 选择启用；minimal 和其他 preset 不会自动获得该工具。运行时依赖使打包后的 enterprise profile 包含新插件的完整依赖闭包。

## 测试

Web shipped composition 测试挂载标准 preset，并检查 `ctx.tools.schemas(agent)` 中的 6 个 `terminal_*` schema。Web composition、终端工具和类型检查验证插件能够加载并使用隔离 PTY 服务。
