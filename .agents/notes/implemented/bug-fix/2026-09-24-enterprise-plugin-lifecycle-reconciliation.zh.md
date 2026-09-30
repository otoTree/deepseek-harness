# Agent Note: 企业插件协调只保留一个活动版本

Status: implemented

[English](2026-09-24-enterprise-plugin-lifecycle-reconciliation.md) | 中文

## 问题

企业市场把每个不可变插件版本当成独立安装，激活回报失败时也可能在租约撤销后保留 Cordis 贡献。因此同一设备可以激活同一插件的两个版本，最终重复注册同名 Agent 工具。

## 决策

安装记录按插件身份和所有者选择，不可变版本通过升级操作切换。市场按插件身份合并已发布版本，为新版本提供升级入口。API 拒绝同一设备和 target 上同一插件的第二个启用安装，不区分所有者类型。运行时在活动 heartbeat 失败时先释放 target，再重试激活。停用完成后将设备状态折叠回安装记录，使安装状态显示为已停用。

## 备选方案

**允许多个版本并依赖 Cordis scope：** 不采用，因为 Agent 工具位于 Host 工具层的全局注册表中，同名贡献不能共存。

**下一次协调前保留失败 target：** 不采用，因为撤销的 SDK 租约和仍存在的 Cordis 贡献会在这段时间内不一致。

## 影响

升级保留安装和数据空间，同时替换 release 与授权修订。一个设备的同一插件 target 至多有一个活动安装。失败激活只有在本地 disposer 执行后才回报失败，因此重试不会继承旧贡献。市场现在按插件身份显示一个卡片，并使用已有的权限确认升级接口。Host bridge 只向升级接口发送其允许的字段。同一用户在同一设备切换同一插件的残留个人安装时，会先撤销旧设备目标再启用新安装；组织所有或其他用户的目标仍由冲突响应保护。

Host 与 Client 清理默认有十秒上限，可通过 `cleanupTimeoutMs` 配置；卡住的 disposer 会记录为清理失败，不能无限期占用串行协调队列。Host 会在该失败的指数退避期限到达时再次调度协调，并持续重试，直到 target 停用与卸载完成状态收敛。

Host 与 Client 准备阶段默认有三十秒上限，可通过 `activationTimeoutMs` 配置。Host 会随 target 快照向浏览器发送两个生命周期截止时间。target 超时后会请求 Cordis 释放、上报激活失败并释放租约，使另一插件可以在同一轮协调中完成。

标准 Host bundle 将 `@deepseek-ai/cordis` 保留为外部依赖，使其中的 service 使用当前 Host 的 Cordis 实例。包加载器解析模块请求，通过 DSH 安装锚点链接该导入，保留 Node 内置模块，并在执行前拒绝其他外部导入或非字面量动态导入。加载器会在私有临时包目录中执行每个已验证 bundle，而不是使用 `data:` URL，因此对 bundle 依赖而言，`import.meta.url` 仍是有效文件位置；模块执行完成后会删除该目录。

企业 Client 会在隔离上下文访问 Client 模块系统前，把它声明为 Cordis 注入。它订阅 Connection generation 状态，并只在 generation 就绪后启动浏览器协调，因此无需轮询定时器即可覆盖两种模块激活顺序。

同一轮协调会使用 `Promise.allSettled` 并行处理相互独立的安装和 target；某个插件停止、启动、租约续期或卸载完成失败时只记录该插件的错误，其他插件继续运行。市场操作锁按安装记录或 release 分开维护，因此一个插件的请求等待时不会禁用其他插件的操作按钮。

设备 target 目录使用带类型的时间戳比较来处理租约过期。安装状态只聚合租约有效的 target，因此已退出 Runtime 遗留的过期 `preparing` 记录不会阻止活动 target 将安装收敛为已激活。该目录暂时不可用时，Host 会记录目录错误并继续协调插件目录和安装记录，包括完成没有本地贡献的安装卸载。

Host bridge 在卸载请求修改服务端状态后立即启动协调，使撤销动作到达本地 Host；保留数据的安装记录无需等待下一次连接重置即可离开“停用中”。

## 测试

Client 运行时测试覆盖 heartbeat 失败后的 disposer 执行和重新激活、Host 与 Client 清理卡住、从文件型包目录链接外部 Cordis、Connection generation 启动，以及 Host 与 Client 准备超时的相互隔离。Client 与 API 检查覆盖升级请求校验、残留个人 target 切换、安装状态聚合时的过期 Runtime 租约、同一插件两个版本安装返回同一安装记录、标准激活与升级以及保留数据恢复。真实企业 Host 加 Chromium Client 已激活打包版 `media.canvas` 的两个 target，并渲染其 Client 贡献。Host 与 Client 类型检查、包测试和企业 API 测试均已通过。
