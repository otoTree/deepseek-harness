---
description: "企业身份、租户授权、模型计量与会话 API 的开发说明。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-enterprise-api

[English](README.md) | 中文

## 概述

开发中的 API 支持已验证账号、组织成员关系、管理操作、运行时注册和服务端控制的模型选择。它使用 Better Auth、Hono、Zod、Drizzle 以及独立 PostgreSQL 数据库。它不是完整的企业 agent（智能体）产品，也不是桌面运行时。

## 目录

- [本地开发](#local-development)
- [实现](#implementation)
- [验证](#verification)
- [限制](#limitations)
- [开发备注](#dev-note)

-----

<a id="local-development"></a>
## 本地开发

在仓库根目录执行基础设施命令，并确保 Docker 可用。归属检查会拒绝冲突的容器或数据卷；启动不会停止其他项目。

```sh
pnpm run enterprise:infra check
pnpm run enterprise:infra up
pnpm --filter @deepseek-ai/dsh-enterprise-api db:migrate
pnpm --filter @deepseek-ai/dsh-enterprise-api test
```

[基础设施初始化脚本](../../scripts/enterprise-infra.ts) 在显式使用 `init` 时创建被 Git 忽略、仅所有者可读的 `.env.enterprise` 文件。默认回环端口为 PostgreSQL 55439、Redis 56389、MinIO 59010/59011。数据库、Compose 网络、数据卷和对象存储 bucket 均归本项目所有。迁移凭据与应用凭据具有不同权限。

`pnpm run enterprise:api` 构建组合包、准备独立 Harness home，然后启动 `dsh --profile enterprise-api`。未初始化的部署会在打开 HTTP 监听之前报错退出。[初始化脚本](scripts/provision.ts) 会在询问凭据前拒绝已有部署。设置 `ENTERPRISE_BOOTSTRAP_EMAIL` 和 `ENTERPRISE_BOOTSTRAP_PASSWORD`，或在 TTY 中运行 `pnpm run enterprise:provision` 并回答两个问题。这是开发环境初始化器，接受简单的本地密码，但只保存 Better Auth 哈希。非交互运行必须提供两个变量。真实部署初始化尚未验证。不要替换成其他项目的数据库凭据。

本地开发栈默认关闭邮箱验证，因此注册不需要 SMTP。设置 `ENTERPRISE_REQUIRE_EMAIL_VERIFICATION=true` 可强制邮箱验证；该模式需要配置 `ENTERPRISE_SMTP_URL` 和 `ENTERPRISE_MAIL_FROM`。

使用 `pnpm run enterprise:start` 可以启动完整本地栈。该命令检查并启动本项目的基础设施，执行迁移，幂等地初始化部署，然后启动 API 和管理后台。首次运行时设置两个 `ENTERPRISE_BOOTSTRAP_*` 变量；后续运行会复用已有部署。添加 `--desktop` 可同时启动 Electrobun 开发客户端。按 Ctrl-C 会停止应用进程，但保留本项目的基础设施供下次启动使用。

[配置](src/config.ts) 与[组合包补丁](cordis.patch.yml) 定义启动设置。启用邮件流程前需配置 SMTP 和发件人。上游模型地址必须进入部署允许列表，模型密钥加密保存。API 绑定回环地址，远程使用需要单独配置安全入口。配置 `ENTERPRISE_REDIS_URL` 后，每次模型调用都会使用按组织、账号和模型隔离的 Redis 请求数与并发限流；Redis 无法连接时启动失败。模型账本和显式核对接口仍以 PostgreSQL 为权威。

-----

<a id="implementation"></a>
## 实现

<details>
<summary>实现细节</summary>

[授权逻辑](src/security.ts) 先解析成员关系，再选择事务内租户上下文。强制 RLS 在非特权应用角色下保护组织数据。组织锁保护席位变更、树结构编辑及最后 Owner 检查。平台管理权限不隐含客户会话访问权。

[会话路由](src/sessions.ts) 提供租户内事件追加、绑定 Runtime 的隔离写入租约、连续序号检查、DSH 事件验证、分页读取／列表、fork 元数据和相同重试检测。原生 [SessionPersistence 适配器](../electrobun/src/session-provider.ts) 将这些路由作为权威存储；写入结果不确定时会封禁句柄并要求显式核对。读取其他成员正文需要组织 Owner 或管理员权限，并追加审计事实。

[模型调用](src/gateway.ts) 先验证设备，并使用 PostgreSQL 事务锁串行处理租户内的每个幂等键，再预留预算。重复调用返回 HTTP 409 及原调用 ID 和状态，不重放流或再次请求上游；其他设备不能查看该状态。只有完整且报告用量的流才结算预留，无法确认的调用保留为待核对。[插件审核路由](src/plugins.ts) 分离源码扫描、AI（人工智能）审核、人工批准和发布签名。当前扫描器是保守的语法与模式检查，不是供应链扫描器或恶意代码沙箱。

网关与[原生模型提供方](../electrobun/src/gateway-provider.ts) 共享 Zod 请求／目录 schema 和[有界 SSE 校验](src/model-stream.ts)。提交的策略修订号在预留前接受检查；未提供修订号的调用方仍使用既有授权检查。网关只在账本事务提交后发送完成标记，不转发格式错误的记录或上游错误正文。集成测试通过上游屏障使原生请求重叠：一个预留可用预算，另一个在发送前被拒绝；完成调用按实际 token 结算，截断调用则保留待核对预留。

平台管理员可以调用 `POST /v1/platform/organizations/:organizationId/usage/:id/reconcile` 处理 `pending_reconciliation` 记录。接口要求平台权限和明确的 settled 或 failed 结果，并在同一事务中释放预留、更新账本和追加审计记录。

</details>

-----

<a id="verification"></a>
## 验证

[测试](tests/identity.test.ts) 在本项目 PostgreSQL 实例内创建随机命名的新数据库，并在删除该数据库前关闭连接池。测试覆盖授权、席位、邀请、运行时令牌、会话租约和审计。[Profile 冒烟测试](tests/profile-smoke.ts) 通过 DSH 运行构建产物，绑定操作系统分配的回环端口，并验证进程退出与监听关闭。测试需要独立的本地基础设施，不会静默跳过缺失的数据库。

<a id="limitations"></a>
## 限制

- 部门角色绑定可以保存，但部门委派授权尚未实现。组织级授权仍需显式检查。
- 模型流、取消计量和 AI 审核尚未使用真实提供方验证。平台管理员可以通过账本接口显式核对待处理模型调用；自动上游状态核对任务仍属于部署后续工作。
- 可信入口 IP 处理、账号暂停和完整安全审计仍未完成。配置 `ENTERPRISE_REDIS_URL` 时可使用 Redis 限流；未配置时使用明确的进程内开发回退实现。
- 原生模型提供方和远程 SessionPersistence 已独立测试，但尚未组合进企业桌面端。附件存储、会话导出／搜索、全量策略修订号强制检查、空闲期间周期续租及完整客户端插件验证仍然缺失。
- 发布签名尚未控制 DSH 插件激活或卸载。源码扫描不生成 SBOM，也不验证已安装的依赖闭包。
- 初始管理员初始化、邮件投递、GUI 登录和私有化部署验收仍需端到端验证。隔离数据库测试已组合覆盖原生回环客户端与实际 API 授权码交换；这不代表已验证打包后的桌面激活。

<a id="dev-note"></a>
## 开发备注

[身份提案](../../.agents/notes/proposed/architecture/2026-09-05-enterprise-identity-and-organization.md) 仍为 proposed。[验收矩阵](../../docs/developer/discussion/enterprise-client-acceptance.md) 区分后台证据与桌面交付。
