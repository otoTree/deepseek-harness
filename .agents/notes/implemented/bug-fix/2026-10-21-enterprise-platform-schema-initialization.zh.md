# Agent Note: 企业初始化保留平台 Schema

Status: implemented

English | [中文](2026-10-21-enterprise-platform-schema-initialization.md)

## Problem

已配置的 PostgreSQL 数据库可能在应用创建第一张表前就包含监控或账号管理关系。即使企业 Schema 和 public 业务表尚不存在，扫描整个数据库的关系仍会因数据库非空而拒绝启动。要求操作人员删除平台对象，使自动初始化无法适用于托管数据库。

## Decision

创建安装标记前，[初始化器](../../../../apps/api/src/initialize.ts)检查 `enterprise`、`enterprise_auth`、`drizzle` 和 `public` 中的关系。企业或迁移 Schema 中的任何关系都会阻止未标记的安装。public 关系也会阻止初始化，除非 PostgreSQL 通过 `pg_depend` 将它记录为扩展成员。错误会指出冲突的 Schema 和关系。

其他 Schema 中的对象不在检查范围内。初始化和重启保留它们的名称、所有者和内容。初始化器通过 PostgreSQL 扩展成员关系区分 public 扩展对象和业务数据，而非依赖关系名称。

本决策取代[容器初始化决策](../architecture/2026-10-20-enterprise-container-initialization.zh.md)中检查整个数据库为空的要求。该记录继续负责安装标记验证、迁移锁和管理员保留行为。[提供凭据决策](../architecture/2026-10-21-enterprise-single-database-connection.zh.md)继续负责数据库账号选择。

## Alternatives considered

**要求整个数据库没有用户关系。** 平台可能在应用启动前就创建 Schema 中的对象，因此这会拒绝本来可用的部署数据库。

**忽略指定名称的平台 Schema 或全部 public 对象。** 服务商专用名称需要不断扩大的例外名单。忽略全部 public 对象又会接受无关的 public 业务表。按 Schema 范围和扩展成员关系检查，可以保留对这类数据的拒绝，且不依赖服务商命名约定。

**移除安装和冲突检查。** 未标记的应用 Schema 可能包含客户数据或不兼容的迁移历史。初始化不得静默接管它，也不得创建替代管理员。

## Consequences

部署可以与平台 Schema 和 public 扩展视图共存，无需删除这些对象。检查范围内已有业务关系时，仍在创建安装标记前阻止启动。此检查不证明整个数据库仅供本应用使用：其他 Schema 中的业务数据同样不在检查范围内。操作人员仍负责选择目标数据库并配置权限。

## Testing

隔离的 PostgreSQL fixture 使用监控表和视图、账号管理表，以及 public 中的 `pg_stat_statements` 扩展复现拒绝。回归测试验证初始化和重启保留关系标识符、所有者和平台数据。独立入口测试验证各检查 Schema 中未标记的数据都会阻止应用启动、指出冲突、保留数据，且不留下安装标记；public 用例同时包含扩展视图。
