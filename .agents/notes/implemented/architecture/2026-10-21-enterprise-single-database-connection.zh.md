# Agent Note: 企业部署使用提供的数据库凭据

Status: implemented

English | [中文](2026-10-21-enterprise-single-database-connection.md)

## Problem

操作人员可能只有一个 PostgreSQL 连接字符串，其中包括服务商提供的 `postgres` 登录账号。即使已有账号可以执行所有所需数据库操作，要求额外角色或第二个连接字符串仍会阻止部署初始化。

## Decision

`ENTERPRISE_DATABASE_URL` 同时为自动初始化和 API 运行提供账号与密码。初始化器接受自定义账号名、共用所有者账号、超级用户和 `BYPASSRLS`。它不创建角色、不替换凭据，也不修改数据库密码。实际 PostgreSQL DDL 权限决定能否创建 Schema 和执行迁移；权限不足会阻止启动。

可选的非空 `ENTERPRISE_MIGRATION_URL` 为同一主机、端口和数据库选择单独的初始化账号。未设置或为空时使用 `ENTERPRISE_DATABASE_URL`。迁移授权使用业务连接实际的 `current_user`，对标识符加引号并保留迁移哈希。

本决策取代[初始化决策](2026-10-20-enterprise-container-initialization.zh.md)中的账号分离要求和 Schema 所有者相等检查。该记录继续负责安装标记、咨询锁、管理员初始化和重启保留行为。需要数据库强制隔离的操作人员可以提供两个独立的非特权账号。

## Alternatives considered

**要求两个独立的非特权迁移和应用账号。** 这提供更强的数据库权限隔离，但需要操作人员可能没有的基础设施凭据。可选的迁移 URL 仍支持这种部署。

**通过提供的超级用户自动创建另一个运行时角色。** 这违反操作人员仅使用所提供账号的要求，并会引入部署未配置的生成凭据、角色所有权和密码轮换。

## Consequences

当账号能够创建数据库对象并执行迁移时，一个连接字符串即可完成部署。超级用户或 `BYPASSRLS` 账号会绕过 PostgreSQL RLS，包括强制策略。拥有表的 API 可以修改权限和策略，并绕过未强制执行的策略。仅追加授权不能构成针对表所有者或超级用户的有效安全边界。应用授权仍然必需，这些部署不得宣称拥有独立非特权运行时账号的数据库隔离保证。

安装标记和[按 Schema 范围检查冲突](../bug-fix/2026-10-21-enterprise-platform-schema-initialization.zh.md)防止误接管已有应用关系，但不会限制所提供账号的底层权限。

## Testing

隔离的 PostgreSQL 启动测试覆盖未配置迁移覆盖值的单个 `postgres` URL、单个自定义数据库所有者、两个独立自定义账号、错误密码和 Schema 权限不足。它们运行编译后的入口启动器、API profile，并验证重启保留管理员。amd64 镜像冒烟测试仅使用提供的数据库 URL，验证重启前后的真实 HTTP 管理员登录和已认证 API 读取。
