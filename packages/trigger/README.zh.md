---
description: "向 Session 交付托管的定时器和文件事件。"
kind: "package-group"
---

# trigger/ — 托管事件交付

[English](README.md) | 中文

## 摘要

[Trigger 包](trigger/README.zh.md)负责定时器、本地文件和云端文件提供者、持久化规则修订、批处理以及 Session 交付。企业 Host 注册云端访问能力，并通过 RPC 提供规则管理界面。

## 目录

- [职责归属](#ownership)
- [开发说明](#dev-note)

<a id="ownership"></a>
## 职责归属

[Session 子系统](../../docs/subsystems/session.zh.md)负责目标收件箱和持久化 Session 标识。Trigger 交付将普通用户消息放入队列；成功入队不代表 Agent 已完成执行。

<a id="dev-note"></a>
## 开发说明

参见[企业触发器决策](../../.agents/notes/implemented/feature/2026-09-24-enterprise-triggers.zh.md)。
