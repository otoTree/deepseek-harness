---
description: "可信企业 Cordis 插件当前的安装、激活、升级、禁用和卸载行为。"
---

# 插件安装与运行生命周期

[English](plugin-installation-lifecycle.md) | 中文

本文说明企业 API 为可信 Cordis 插件实现的生命周期。运行时沿用现有 Host 或 Client 进程；manifest 权限用于授权平台能力，不隔离同一进程中的恶意代码。

## 持久记录

平台分别保存 release、安装记录、设备 target 记录、短期激活记录和生命周期状态。公开 release 不可覆盖。所有者可以上传相同 plugin ID 和版本的私有 release；相同字节会幂等返回，字节变化则原地替换私有归档、递增授权修订号并撤销已有激活，使设备重新加载。安装身份和数据空间在升级时保持稳定，并带有授权修订号。期望状态记录所有者的请求，实际状态记录设备的回报。

个人安装由账号本人管理。组织安装由组织所有者或管理员管理，成员选择自己的设备启用 target。组织安装对成员可见，也可以由管理员撤销。

## 控制面操作

`POST /v1/organizations/:organizationId/plugins/:id/install` 创建安装但不启用 target。`PATCH /plugins/installations/:id` 修改安装的期望状态。`PUT /plugins/installations/:id/devices/:deviceId` 修改一个设备 target，`POST /plugins/installations/:id/activate` 在设备请求已启用后签发短期激活凭据。

每次运行时请求都携带 `Bearer` 激活凭据，并重新检查激活、安装、release、设备 target、成员资格和授权修订。停用、卸载、release 撤销或组织成员资格变化都会使凭据失效。heartbeat 携带 activation ID，只有该激活仍与设备版本及授权修订一致时才能更新状态。为同一设备 target 签发替代 lease 时会撤销旧 lease。

升级采用维护窗口。API 要求目标 release 已发布；如果权限增加，还必须显式确认。旧激活先撤销，授权修订递增，设备回到准备状态。卸载先撤销激活并保留数据空间。导出、删除数据和重新授权是独立且有审计记录的操作。

## 运行 target

市场 release 使用 ZIP 容器；schema v2 在顶层声明 target，schema v3 则声明带有独立 `package.json` 和 Host 或 Client target 的 Cordis packages。桌面端在激活前校验 manifest、归档摘要、完整性记录、package 元数据和 target 入口。Host packages 写入组织专属 DSH Home，再由 `ctx.loader` 作为 Cordis group 加载；Cordis fiber 管理每个 package 的注册与释放。package import 可以使用 Node 内置模块、`@deepseek-ai/cordis`，以及 manifest 已声明且 Harness 安装确实提供的依赖。

浏览器从 Host 接收每个活动 Client bundle，再通过模块加载器挂载。同一个产品 release 可以提供多个 Host package 和多个 Client bundle。每个 Client bundle 独立标识和卸载，其 `slot` 或 `window` contribution 跟随各自的 Cordis fiber 生命周期。Client 通过 Host bridge 访问 API，不接触平台或供应商凭据。工具和 Skill 只有在 Cordis package 向 Harness 注册表注册后才会进入 Agent；归档中的声明本身不能证明能力已运行。

激活在提交就绪状态前核对 package fiber 拥有的 Tool、Skill 注册，并投影 Tool schema。MCP 就绪要求归属正确的已连接 client 及发现工具，名称匹配不足以证明成功。市场还检查当前 Skill 目录、preset 发现结果和浏览器上报的 `ctx.slots.entries()` 注册。停用移除 Loader group、自有 preset 文件和持续 preset 挂载，再使激活凭据失效。产品升级在替换加载失败时恢复上一份可用组合；授权修订不匹配会阻止在权限撤销后回滚。

SDK 提供平台数据操作、安装配置、受权限控制的 HTTP 和激活作用域凭据。受信任 Host package 通过凭据门面只读取自身集成凭据，Client bundle 不接收这些密钥。Harness 原生 Tool、Skill 和 MCP 注册仍由 Cordis effect 管理。SDK 不提供 jobs 调度器或 Cloud target。

## 恢复

设备在重启或重连后重新执行准备阶段。激活租约撤销后，失败阶段仍会保留在安装和设备状态中；重新启用安装即可重试。停用安装会清除 target 错误。即使本地 disposer 失败，服务端仍会撤销凭据；可信代码无法停止时，桌面运行时会报告需要重启 Host。
