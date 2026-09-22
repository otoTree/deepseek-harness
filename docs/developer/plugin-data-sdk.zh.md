---
description: "当前插件作者 SDK 对身份、文本模型、对象、数据库和缓存的约定。"
---

# 插件数据 SDK

[English](plugin-data-sdk.md) | 中文

插件作者引入 `@deepseek-ai/dsh-plugin-sdk`，由 Host 或 Client 运行时注入安装作用域的 `PluginSdk`。SDK transport 不携带平台、数据库、对象存储或模型供应商凭据；每次调用都绑定创建该 SDK 的激活记录。

`identity.current()` 返回平台稳定用户 id、名称、头像、邮箱、组织上下文和安装主体。插件不能传入其他用户 id 读取他人资料。

清单必须为每项操作申请对应的能力权限。`identity.read` 允许读取资料，`models.text` 允许列出模型并调用文本模型，`objects.read` 与 `objects.write` 分别覆盖对象读取和变更，`database.query` 与 `database.transaction` 是独立的 SQL 授权，`cache.read` 与 `cache.write` 覆盖缓存访问。即使声明了资源，缺少对应权限时服务端仍会拒绝调用。

`models.list()` 返回平台已启用且使用当前已实现的 OpenAI 兼容 Chat 协议的文本模型；尚未实现协议的模型不会进入插件目录。`models.text()` 接受有界的 system、user 和 assistant 消息、模型 id 及幂等键，并返回文本和用量状态。`models.textStream()` 使用相同的授权和幂等规则，返回服务器发送的文本分片，最后返回终止项。

插件提供 Agent 工具时，工具结果已经通过标准 `tool/call` 和 `tool/result` 事件进入 Session。Session 投影会在后续模型请求前重建该结果。Client 页面直接发起的 SDK 调用不属于 Agent Session，因此不会创建 Agent 事件。

对象接口支持带版本的写入、可选字节范围读取、版本列表和删除。对象键在平台数据空间内生成。下载始终经过激活授权检查，不生成可绕过撤销的公开 URL。

数据库接口接受参数化 SQL 和有界事务批次。企业基础设施会在独立于平台数据库的 PostgreSQL 服务上配置 `ENTERPRISE_PLUGIN_DATABASE_URL`。API 为每个安装数据空间使用专用 schema，拒绝管理语句和跨 schema 语句，并在批次失败时整体回滚。未配置该服务时返回 `plugin/data-unavailable`；平台数据库始终不会暴露。

发布清单携带递增的迁移语句。升级会在把新版本标记为可用前，在数据空间事务中执行尚未应用的版本；迁移失败时安装仍保留原版本。

缓存接口支持安装命名空间中的读取、带 TTL 的写入、删除和原子递增。缓存不是授权或计费来源，不能作为业务数据唯一副本。

协议支持的调用都接受 `AbortSignal`。调用方只能使用相同幂等键重试幂等操作。激活撤销、授权修订过期、资源无效、配额超限、超时或取消都会返回稳定的 `plugin/*` 错误码。
