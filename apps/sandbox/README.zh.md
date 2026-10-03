---
description: "云端组织工作区生命周期服务和可注入的远程沙箱后端。"
---

# 企业云端工作区服务

[English](README.md) | 中文

## 概述

此服务提供组织范围的工作区创建、列表、启动、停止、租约和销毁接口。[内存后端](src/index.ts) 只用于契约测试；生产部署应注入 E2B 远程工作区实现。缺少远程后端时不得回退到未受限执行。

## 目录

- [开发](#development)
- [限制](#limitations)
- [开发备注](#dev-note)

<a id="development"></a>
## 开发

`pnpm --filter @deepseek-ai/dsh-enterprise-sandbox test` 检查工作区生命周期和组织隔离。此目录不提供独立的 Node 应用启动器。

<a id="limitations"></a>
## 限制

内存后端不提供进程隔离或远程执行。E2B 接入、租户认证、持久化租约、配额和文件/进程适配器仍需部署实现；远程后端不可用时必须快速失败。

<a id="dev-note"></a>
## 开发备注

[验收矩阵](../../docs/developer/discussion/enterprise-client-acceptance.zh.md) 记录了必需的原生沙箱测试。
