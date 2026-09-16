# 开发方法

[English](development-method.md) | 中文

## Summary

DeepSeek Harness 以可替换的 Cordis 插件树开发。功能通常通过服务、Provider、Consumer 或事件监听器加入这棵树，再由 Profile 组合成可运行的应用。持久事实存放在 Session 日志中，实时行为使用 Agent 事件和能力事件。本指南给出从需求到已验证代码的重复流程。

## Table of Contents

- [先确定拥有者](#start-with-ownership)
- [选择扩展点](#choose-the-extension-point)
- [设计能力 seam](#design-a-capability-seam)
- [记录模型可见事实](#record-model-visible-facts)
- [组合应用](#compose-the-application)
- [处理客户端与云端插件](#handle-client-and-cloud-plugins)
- [实现并写文档](#implement-and-document)
- [验证改动](#verify-the-change)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

-----

<a id="start-with-ownership"></a>
## 先确定拥有者

编辑前阅读[架构](../architecture.zh.md)、所属包 README 和最近的测试。把需求归类为能力、Provider、Consumer、策略、协议适配器、持久状态变化或展示变化。把行为放进负责该职责的包；只有现有分组无法负责时才新建包。

<a id="choose-the-extension-point"></a>
## 选择扩展点

优先使用已记录的扩展点，而不是修改 Agent Loop。模型工具注册到 `ctx.tools`，模型 Provider 注册到 `ctx.llm`，Shell 实现注册到 `ctx.shell`，UI 或协议适配器通过 `ctx.agents` 和 Session 事件接入。使用对应的 `agent/*` 或 `tools/*` 事件拦截请求和工具执行。瀑布监听器委托后必须调用 `next()`。

<a id="design-a-capability-seam"></a>
## 设计能力 seam

可替换能力包含三个角色：Service Definition 负责稳定词汇和 `ctx` 键，Provider 实现能力，Consumer 使用能力。角色独立演化时拆成不同包。Consumer 依赖 Definition，不依赖具体 Provider；每个注册都通过 Cordis effect 实现可撤销。

<a id="record-model-visible-facts"></a>
## 记录模型可见事实

Session 日志是发送给模型的上下文来源。新的输入、状态或工具结果只要可能进入模型请求，就添加对应的持久事件，并从日志派生模型视图。助手流分片等临时进度使用 Agent 实时事件；回放、恢复、UI 重建和遥测使用 Session 事件。

保持生命周期术语准确：step 是一次模型请求及其工具执行，turn 消耗已接收的输入并可包含多个 step，round 属于 goal 或 Ralph 等外层策略。计数器和限制放在拥有它们的层级。

<a id="compose-the-application"></a>
## 组合应用

应用通过 `dsh` Profile 启动。把插件加入 Bundle 或 Profile patch，然后用 `dsh --profile <name> --dump-config` 检查最终树。部署相关的选择放进已验证配置。不要新增绕过受支持 Profile 入口的包 bin、演示启动器或内联应用树。

<a id="handle-client-and-cloud-plugins"></a>
## 处理客户端与云端插件

要区分用户本地的 Host runtime 和云端 Server Plugin runtime。当前动态 Runner 在本地进程加载 Host half，在 Client 页面加载 Browser half；它还不会从对象存储下载云端插件。未来的云端 resolver 应获取并验证已发布的 Client artifact，再交给 `dsh-cordis-client-runner`；现有 evaluator、guard、Loader 挂载和 disposer 生命周期继续负责加载与卸载。

纯云端 Server Plugin 在用户的本地组合中必须有一个对应插件。本地插件负责注册 Agent 可见的工具、提示词或 UI，并通过仓库现有的类型化 Remote 和 Connection 机制调用云端插件。云端 gateway 再把调用分发给对应的 Server Plugin；Agent 不会得到 Server Plugin 代码或凭证。如果 Agent 本身运行在云端，对应的服务端插件可以在那里直接注册工具；无论 Agent 在哪里运行，工具调用和结果都属于 Session 事实，必须经过正常的 `tools/*` 管线。

本地配对插件是本地 Agent 访问纯云端插件的必要条件。云端发布物单独存在时，不会把工具自动加入任何本地 Agent；本地插件必须先安装、挂载并授予该 Agent，能力才会出现在下一次模型请求中。

把插件的运行状态和 Agent 的能力授予视为两个决定。挂载 Client Plugin 不会自动让所有 Agent 看到全部工具。应在目标 Agent scope 或 preset 中注册工具和提示词贡献，并在插件停止时通过同一个 Cordis disposer 移除它们。

<a id="implement-and-document"></a>
## 实现并写文档

在 TypeScript 和 JSDoc 中明确公共约定。更新所属 README 的用途、配置、扩展点、模型可见行为和已知限制。改动影响这些面时，同时更新 Session 事件、SDK 投影和双语文档。非简单改动还需要 Agent Note，记录已接受的设计和验证要求。

<a id="verify-the-change"></a>
## 验证改动

根据改动面选择检查。局部逻辑使用聚焦单元测试；产品可见插件使用 Loader 真实组合测试；模型、协议或用户可见输出使用快照；发布入口使用构建产物 smoke。拥有凭证时运行真实 API e2e。至少运行改动所需的 `pnpm run typecheck`、`pnpm run lint`、`pnpm run test:docs`、`pnpm run doc-sync` 或 `pnpm run build`，最后运行 `git diff --check`。

验证组件之外的实际结果：重新读取文件、回放 Session，或调用构建后的 Profile。模拟测试通过，不能证明发布组合能加载，也不能证明持久输出正确。

## Further Exploration

- [架构](../architecture.zh.md) — 组合、生命周期、能力 seam 和扩展点。
- [开发指南](../development.zh.md) — 仓库搭建、TypeScript 项目和日常命令。
- [测试](../testing.zh.md) — 测试层级、快照和真实入口验证。
- [扩展 Cookbook](../cookbook/extension-cookbook.zh.md) — 插件实现模式。
- [术语表](../glossary.zh.md) — turn、scope、goal 和 seam 的规范术语。

## Dev Note

None.
