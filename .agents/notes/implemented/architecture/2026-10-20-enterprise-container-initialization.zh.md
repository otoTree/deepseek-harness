# Agent Note: Backend 容器在提供 HTTP 服务前初始化部署

Status: implemented

English | [中文](2026-10-20-enterprise-container-initialization.md)

## Problem

只启动 API 的 Backend 镜像无法服务新数据库，也无法创建登录 Admin 所需的管理员。要求操作人员挂载本地开发环境文件，并单独运行迁移和初始化脚本，使容器部署不完整。

## Decision

Backend 入口在执行受支持的 `dsh` profile 前运行编译后的数据库初始化器，直接读取部署变量，并要求独立 PostgreSQL 数据库。[单连接凭据决策](2026-10-21-enterprise-single-database-connection.zh.md)负责账号选择和 DDL 权限。初始化器通过[按 Schema 范围检查冲突](../bug-fix/2026-10-21-enterprise-platform-schema-initialization.zh.md)后创建 Schema 和安装标记。该决策负责与平台 Schema 和 PostgreSQL 扩展共存；未标记的应用关系仍会阻止启动。

[迁移执行器](../../../../apps/api/src/migrations.ts)使用 PostgreSQL 标识符引号规则，将历史 GRANT 和 REVOKE 的接收者绑定为实际连接的业务账号。Drizzle 继续负责迁移事务、顺序和日志写入，保留原始迁移文件哈希。Schema 授权使用配置的业务身份，而非开发账号名称。这样既能保留已有迁移日志的有效性，也不需要额外的数据库角色。

私有的单连接迁移池在 Schema 创建、Drizzle 迁移和应用角色初始化期间持有会话级咨询锁。初始化事务复用开发初始化器的事务锁和首个管理员创建函数。仅当部署不存在时才接受初始化凭据，密码至少需要 12 个字符。已有部署保留账号凭据、注册策略和成员状态；缺少管理员或模式不匹配时明确失败。入口在启动 API 进程前移除迁移和初始化变量，并在初始化期间转发终止信号。

[容器发布决策](2026-10-17-enterprise-container-images.zh.md)负责镜像发布。[本地修复决策](../bug-fix/2026-10-04-enterprise-local-provisioning-repair.zh.md)继续负责显式开发修复；容器自动启动不会重新激活已暂停的成员关系。

## Alternatives considered

**要求单独手动执行迁移和初始化命令。** 操作人员期望新启动的 Backend 能创建管理员并服务 Admin，无需第二条应用命令。

**使用应用角色升级 Schema。** 向 API 进程授予 Schema 所有权或特权绕过权限，会削弱保护租户数据的角色隔离。[凭据决策](2026-10-21-enterprise-single-database-connection.zh.md)负责选择这一取舍的部署。

**每次重启都重置管理员或修复全部根记录。** 初始化环境变量不得替换已有密码或重新激活已暂停的访问。显式修复仍是独立操作。

## Consequences

Backend 启动会等待数据库升级；初始化失败会阻止 HTTP 服务。可选的独立迁移凭据在 API 进程启动前被移除。PostgreSQL 基础设施、数据库登录账号和对象存储 bucket 仍需在 Backend 镜像外准备。Redis 和对象存储行为保持不变。

## Testing

隔离的 PostgreSQL fixture 使用自定义账号名称和不同密码，运行真实 shell 入口和编译后的初始化器；名称包含引号、点号和 URL 编码字符。它检查受支持的 API profile、管理员登录、原始迁移日志哈希、函数授权、归属本应用的预期启动输出、待应用迁移、重启保留行为、仅追加权限、并发启动锁，以及无效数据库或凭据的拒绝行为。
