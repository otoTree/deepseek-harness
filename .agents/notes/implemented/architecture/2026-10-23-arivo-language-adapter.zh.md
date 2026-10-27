# Agent Note: Arivo 原生语言适配器

Status: implemented

[English](2026-10-23-arivo-language-adapter.md) | 中文

## 问题

Arivo 需要自己的鉴权与计费模型传输，同时保留原始 OS Agent 循环、工具权限和持久 Session 历史。另建对话运行时会重复这些职责，使恢复归属不明确。

## 决策

[启动 Host](../../../../apps/electrobun/src/distribution/arivo-shell/host/index.ts)通过已验证创作产物的 v1 Host 操作注册 Arivo LlmAdapter。原始 OS 组装请求、执行工具并记录结果。适配器转换有序结构化消息和流，不接收原生凭证，也不直接调用 Provider。

每个命令由持久 Session 和未结束步骤序号派生。更换模型路由不会为同一步骤创建另一命令：插件的不可变请求日志拒绝冲突输入。云端调用 ID 为 Provider 工具 ID 提供命名空间。推理内容仅用于显示；纯文本函数输入在准入前拒绝不支持的媒体和生成选项。

自动付费重试被禁用。不确定响应要求恢复原调用。用户对活动 Agent 的显式中止请求持久原生停止；插件卸载仅关闭订阅并等待生成器清理。Arivo profile 禁用默认官方适配器，并拒绝非 Arivo Agent 路由。企业组合保留自己的模型策略。

[项目默认模型决策](../feature/2026-10-26-arivo-project-model-defaults.zh.md)规定按目录自动选择模型并移除全局手动控件。原对话菜单保留明确改选，已有 Session 选择继续有效；浏览不提交模型或预留积分。

原生预算、积分、成员额度和报价拒绝保留允许列表内的错误码，经过原适配器显示内置中文说明，指向账号中的项目预算或团队积分页。不展示远端任意错误文本；其他不确定错误沿用原恢复指引。重试与权限策略不变。

## 考虑过的替代方案

独立 Arivo Agent 循环会重复 Session 与工具职责。直接回退官方 Provider 会绕过 Arivo 计费。随机命令 ID 允许传输丢失后重复准入。跨调用复用 Provider 工具 ID 会破坏历史工具关联。这些方案均未采用。

## 影响

适配器保留现有工具、权限、预设和 Session 机制。模型路由要求真实的空间/项目/适配器组合，并由原生目录鉴权。通过真实本地 Arivo HTTP 和打包 profile 的官方模型验收覆盖本地写入及关联续答；原生窗口与打包产品中的工具崩溃恢复仍需独立完成 D3 验收，本实现不代表发行完成。

## 测试

[定向桥接测试](../../../../apps/electrobun/tests/arivo-language.test.ts)使用真实 OS 循环与本地文件副作用，验证不支持输入、稳定命令、不确定状态及停止/卸载。[会话回放场景](../../../../snapshots/session/arivo-native-agent/snapshot.yml)通过正式 headless profile 启动，将记录流经过此适配器回放，并使用独立的最终工作区判据。原生桥接是 fixture，不是真实 Provider 调用证据。 [硬崩溃验证](../../../../apps/electrobun/tests/fixtures/arivo-tool-crash.ts)在检查点后的工具副作用完成、结果尚未返回时终止进程。新 OS 进程持久化 `TOOL_OUTCOME_UNKNOWN`，保留副作用且不自动调用模型；显式续问才通过此适配器传递原工具 ID 和恢复指示。
