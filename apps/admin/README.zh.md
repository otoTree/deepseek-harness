---
description: "本地企业管理界面、认证表单和共享 Web 主题。"
---

# 企业管理后台

[English](README.md) | 中文

## 概述

Next.js 16.3.4 控制台通过[企业 API](../api/README.zh.md) 提供管理登录和企业管理页面。用户注册、组织入驻、密码重置和桌面授权由独立 Portal 负责。控制台复用现有 Web 主题，没有另建颜色体系。它不是 DSH 聊天界面。

## 目录

- [开发](#development)
- [限制](#limitations)
- [开发备注](#dev-note)

<a id="development"></a>
## 开发

`pnpm --filter @deepseek-ai/dsh-enterprise-admin build` 构建控制台。`pnpm run enterprise:admin` 启动回环开发服务器。API 地址通过 `NEXT_PUBLIC_ENTERPRISE_API_URL` 配置，其中不包含模型密钥。用户注册、组织关系、密码重置和桌面授权由桌面端账户界面负责。

[控制台](app/console.tsx) 包含管理登录、根节点优先的全局组织树、跨组织账号详情、全平台模型目录、组织单元、邀请、成员状态、设备、会话读取、用量、审计、插件审核和平台设置。启用的模型对所有组织可用；控制台不提供按组织分配模型。它不提供用户注册或桌面授权。

<a id="limitations"></a>
## 限制

- 管理功能需要已初始化的 API 部署。用户注册和组织关系在独立 Portal 中完成；仅当设置 `ENTERPRISE_REQUIRE_EMAIL_VERIFICATION=true` 时本地注册才需要 SMTP。
- 部分高级操作仍仅提供 API，包括作用域单元移动／删除和邀请撤销；全局组织与账号主流程已在控制台提供。
- 管理文案由中文词典维护；Portal 提供中文和英文用户文案。
- 这些页面不能替代原生 Keychain 存储、设备管理、Web 聊天或本地执行服务。

<a id="dev-note"></a>
## 开发备注

分发此开发构建前请先阅读[验收矩阵](../../docs/developer/discussion/enterprise-client-acceptance.zh.md)。
