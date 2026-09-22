# Agent Note：企业插件使用安装作用域的能力租约

Status: implemented

[English](2026-09-21-enterprise-plugin-sdk-lifecycle.md) | 中文

## 问题

企业插件安装需要一个跨设备和版本稳定的身份与授权记录，同时让每次运行时调用都能立即撤销。单一的账号级 enabled 字段无法表达设备状态、激活租约、授权修订或数据保留。

## 决策

企业插件沿用可信 Cordis 执行模型，通过激活租约获得能力 SDK。租约绑定插件 release、安装、设备 target、账号、组织和授权修订。运行时请求会对照控制面记录重新检查这些绑定，不信任插件代码提交的标识。

公共插件包与 Agent JSON-RPC SDK 分离。protocol 包负责品牌化标识和 manifest 声明，作者 SDK 负责身份、文本模型、对象、数据库和缓存接口，runtime 包负责 Cordis 注入与释放。SDK 不包含调度器、队列、worker 或后台任务接口。

manifest 权限使用封闭的能力词汇表；每次调用除检查声明的资源外，运行时还会检查对应权限。

## 影响

个人安装和组织安装共用 release 格式，但管理权限不同。卸载会撤销租约并保留数据空间；导出、删除和重新授权是显式操作。Cloud target 和非文本生成能力不会进入已发布的能力目录。

Host 与 Client 贡献通过同一安装作用域运行时加载。heartbeat 标识对应 activation，只有 release 和权限修订仍为当前值时才会被接受。替换设备 target 租约会撤销旧租约。Agent 工具返回的 SDK 模型输出使用现有 `tool/call` 和 `tool/result` Session 事件；仅由 Client 发起的 SDK 调用不会创建 Agent Session 事件。

## 验证

manifest 测试接受资源、SDK 和迁移声明并拒绝 Cloud target。API 集成测试覆盖 ZIP 上传、安装、设备激活、SDK 身份访问、权限确认升级、旧激活拒绝、卸载、数据保留、PostgreSQL 迁移、Redis 隔离和 MinIO 持久化。运行时测试装载真实 ZIP module，并验证 Host 与 Client 贡献移除。验收 Agent 测试会在下一次模型请求前从 Session 事件重建插件工具结果。

## 备选方案

- **把账号 enabled 字段作为运行时真源**：无法表达设备激活、过期回报和可撤销租约，因此不采用。
- **向插件代码交付平台凭据**：插件可以伪造身份和资源绑定，因此不采用。
- **暴露通用后台 worker API**：调度和恢复属于平台服务，不属于作者 SDK，因此不采用。
