# Agent Note：智域OS 产品名称

Status: implemented

[English](2026-09-29-zhiyu-os-product-name.md) | 中文

## Problem

Web 标题、PWA 元数据、客户端侧栏、locale 字典和官方品牌文档中的用户可见产品身份仍显示为 `AgentOS`。

## Decision

产品名称为“智域OS”。Web 文档标题、PWA 的 `name` 与 `short_name`、官方品牌 locale 值、本地构建标签、测试、快照和品牌文档统一使用此名称。包名、环境变量、profile id、API 标识和内部实现名称保持不变。

## Alternatives considered

- **英文 locale 保留 `AgentOS`** —— 这会让 locale 字典与指定品牌之间的产品身份不一致。
- **重命名包和协议标识** —— 这会把产品文案修改扩大为 API 与分发迁移，但当前没有修改技术标识的要求。

## Consequences

浏览器标题、安装后的应用名称、侧栏品牌和测试预期呈现同一个产品名。技术集成继续使用现有稳定标识。
