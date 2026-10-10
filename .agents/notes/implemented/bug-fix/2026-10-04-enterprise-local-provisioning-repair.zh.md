# Agent Note: Enterprise local provisioning repairs tenant roots

Status: implemented

[English](2026-10-04-enterprise-local-provisioning-repair.md) | 中文

## Problem

本地数据库可能同时存在安装标记和部署记录，但根组织或租户访问记录不完整。这样 API 会在执行强制清除撤销版本之前拒绝组织插件请求。

## Decision

`enterprise:start` 使用 `--if-needed` 运行初始化器。新建本地部署使用 Desktop profile 所需的固定根组织。已有部署保留账号和组织身份；初始化器在一个带 advisory lock 的事务中修复缺失的根组织引用、根组织、根单元、有效管理员成员关系、Owner 角色、单元分配、订阅或钱包。已有部署没有平台管理员时会明确失败，不会选择或替换账号。

## Alternatives considered

**继续拒绝所有已有部署。** 否决，因为带有标记的本地数据库可能在初始化中断后处于半初始化状态；拒绝会让 API 无法进入执行恢复所需的租户。

**删除并重新创建本地组织。** 否决，因为安装记录、用户和 Runtime 记录可能已经引用该组织；修复可以保留这些持久化身份。

**猜测替代管理员。** 否决，因为没有明确的平台管理员记录时选择账号可能会把租户权限授予错误用户。

## Consequences

本地启动命令会修复导致插件强制清除返回访问错误的不完整状态，同时保留已有开发数据。修复路径是幂等的，并限制在部署记录选定的根组织内。没有管理员的部署仍会作为可操作的 provisioning 错误明确报告，需要显式修复，不会静默接管账号。

## Testing

初始化器 TypeScript 检查通过。`enterprise:provision -- --if-needed` 已修复当前本地数据库，实时 API 在修复后接受组织概览、目录、上传、安装和强制清除请求。Enterprise Client、Host 和 plugin-runtime 聚焦测试通过。
