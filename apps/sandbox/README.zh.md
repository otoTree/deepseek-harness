---
description: "不执行代码的 Hono 沙箱原型及其默认拒绝响应。"
---

# 企业沙箱原型

[English](README.md) | 中文

## 概述

此原型不执行代码。[路由](src/index.ts) 对就绪和执行请求均返回 HTTP 503，执行响应包含 `accepted: false`。导入此模块不会打开网络监听。

## 目录

- [开发](#development)
- [限制](#limitations)
- [开发备注](#dev-note)

<a id="development"></a>
## 开发

`pnpm --filter @deepseek-ai/dsh-enterprise-sandbox test` 检查原型不会确认不存在的执行。此目录不提供独立的 Node 应用启动器。

<a id="limitations"></a>
## 限制

企业桌面工具必须接入现有[本地沙箱提供方](../../packages/sandbox/sandbox-local/README.zh.md)，而不是此原型。这些 HTTP 响应不能证明 Seatbelt 执行、进程限制或企业策略已生效。

<a id="dev-note"></a>
## 开发备注

[验收矩阵](../../docs/developer/discussion/enterprise-client-acceptance.md) 记录了必需的原生沙箱测试。
