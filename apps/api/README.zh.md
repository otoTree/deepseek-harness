---
description: "企业身份、租户授权、模型计量与会话 API 的开发说明。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-enterprise-api

[English](README.md) | 中文

## 概述

开发中的 API 支持已验证账号、组织成员关系、管理操作、运行时注册和平台控制的模型选择。平台启用的模型对所有已认证组织可用。它使用 Better Auth、Hono、Zod、Drizzle 以及独立 PostgreSQL 数据库。它不是完整的企业 agent（智能体）产品，也不是桌面运行时。

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

使用 `pnpm run enterprise:start` 可以启动完整本地栈。该命令会先重建 Host 和 Client 库；添加 `--desktop` 时还会重建 Electrobun 前端和插件，然后检查并启动本项目的基础设施，执行迁移，幂等地初始化部署，再启动 API 和管理后台。首次运行时设置两个 `ENTERPRISE_BOOTSTRAP_*` 变量；后续运行会复用已有部署。添加 `--desktop` 可同时启动 Electrobun 开发客户端。按 Ctrl-C 会停止应用进程，但保留本项目的基础设施供下次启动使用。如果旧栈仍占用 8787 或 3000 端口，请先停止旧进程再重试。

[配置](src/config.ts) 与[组合包补丁](cordis.patch.yml) 定义启动设置。启用邮件流程前需配置 SMTP 和发件人。模型地址可使用任意公网 HTTPS 地址；网关会拒绝携带凭据的地址、字面 IP 地址，以及包含任何非法或内网地址的完整 DNS 应答集合。模型密钥加密保存。模型目录在旧图片标记之外保存协议、声明的输入模态和文件输入策略；默认值保持现有的纯文本 OpenAI 兼容模型行为。API 绑定回环地址，远程使用需要单独配置安全入口。模型路由是经过设备认证的中转：保留调用方的路径、方法、请求体字段、请求头和上游响应字节，只替换配置的模型 ID 与 Authorization 请求头。请求失败、响应流失败、上游错误状态和响应后的计量失败日志包含模型 ID、上游 origin、路径、方法及相应的错误分类，不包含凭据、请求头、查询参数或请求体内容。`ENTERPRISE_MODEL_USAGE_MAX_EVENT_CHARS` 限制计量器检查 SSE 记录时使用的内存。

-----

<a id="implementation"></a>
## 实现

<details>
<summary>实现细节</summary>

[授权逻辑](src/security.ts) 先解析成员关系，再选择事务内租户上下文。强制 RLS 在非特权应用角色下保护组织数据。组织锁保护席位变更、树结构编辑及最后 Owner 检查。平台管理权限不隐含客户会话访问权。

[会话路由](src/sessions.ts) 提供租户内事件追加、绑定 Runtime 的隔离写入租约、连续序号检查、DSH 事件验证、分页读取／列表、fork 元数据和相同重试检测。原生 [SessionPersistence 适配器](../electrobun/src/session-provider.ts) 将这些路由作为权威存储；写入结果不确定时会封禁句柄并要求显式核对。读取其他成员正文需要组织 Owner 或管理员权限，并追加审计事实。

[模型调用](src/gateway.ts) 验证设备并解析平台启用的模型，校验声明模态与媒体位置，替换配置的上游模型 ID 和 Authorization，然后在不重构响应的情况下中转 Chat Completions 或 Responses。每个模型拥有上游调用超时；桌面传输会在该截止时间后继续等待自身配置的请求超时时长，使 API 超时响应能够到达调用方。提供方文件请求使用服务端凭据上传已校验字节，拒绝永久媒体 URL，并在分发前执行单文件与请求总量限制。仅当进程内回执属于调用方组织、账号和模型时，网关才接受提供方文件引用；缺少回执会使原生适配器将缓存置为无效，并执行一次有界重新上传。旁路观察器会用非缓存输入、缓存输入、输出、reasoning（推理）、总 token、文件上传维度、人民币价格快照和分项成本结算完整用量；不完整或无效用量保留为显式待对账。平台分析公开协议、模态、上传、失败和对账维度，同时保留旧 Chat 记录。[插件审核路由](src/plugins.ts) 分离源码扫描、AI（人工智能）审核、人工批准和发布签名。

网关与[原生模型提供方](../electrobun/src/gateway-provider.ts) 共享 Zod 请求／目录 schema。API 在不消费、存储或重建响应字节的前提下观察 Chat 与 Responses SSE 用量；Responses reasoning-summary 记录属于有效帧，但计量器不保留其文本。原生提供方独立校验 DSH 所需的所选协议流。缺少用量、格式错误、超限、中断、非 SSE 和非 2xx 响应仍会透明中转，并进入待对账而不是 settled 用量。计量或数据库失败不会改变中转响应。

平台管理员可以调用 `POST /v1/platform/organizations/:organizationId/usage/:id/reconcile` 处理 `pending_reconciliation` 记录。接口要求平台权限和明确的 settled 或 failed 结果。人民币占用会保留三项价格快照，并接受输入、缓存输入、输出和 reasoning token 总量以重建分项成本；兼容占用继续使用原有的 billed 微单位路径。核对操作会在同一事务中更新账本并追加审计记录。

</details>

-----

<a id="verification"></a>
## 验证

[测试](tests/identity.test.ts) 在本项目 PostgreSQL 实例内创建随机命名的新数据库，并在删除该数据库前关闭连接池。测试覆盖授权、席位、邀请、运行时令牌、会话租约和审计。[Profile 冒烟测试](tests/profile-smoke.ts) 通过 DSH 运行构建产物，绑定操作系统分配的回环端口，并验证进程退出与监听关闭。测试需要独立的本地基础设施，不会静默跳过缺失的数据库。

<a id="limitations"></a>
## 限制

- 部门角色绑定可以保存，但部门委派授权尚未实现。组织级授权仍需显式检查。
- 取消仍只由本地上游 fixture 覆盖，尚未使用真实提供方验证；生产 HTTPS 与 DNS 传输已使用平台启用的 DeepSeek 模型手动验证流式与非流式请求。不返回有效 OpenAI 兼容 SSE 用量的提供方和路径仍可通过中转使用，并生成待对账记录；自动上游状态核对仍然缺失。
- 可信入口 IP 处理、账号暂停和完整安全审计仍未完成。配置 `ENTERPRISE_REDIS_URL` 时可使用 Redis 限流；未配置时使用明确的进程内开发回退实现。
- 企业桌面已组合原生模型提供方、共享 Files capability、附件存储和远程 SessionPersistence。会话导出／搜索、全量策略修订号强制检查、空闲期间周期续租及完整客户端插件验证仍然缺失。
- 发布签名尚未控制 DSH 插件激活或卸载。源码扫描不生成 SBOM，也不验证已安装的依赖闭包。
- 初始管理员初始化、邮件投递、GUI 登录和私有化部署验收仍需端到端验证。隔离数据库测试已组合覆盖原生回环客户端与实际 API 授权码交换；这不代表已验证打包后的桌面激活。

<a id="dev-note"></a>
## 开发备注

[身份提案](../../.agents/notes/proposed/architecture/2026-09-05-enterprise-identity-and-organization.zh.md) 仍为 proposed。[验收矩阵](../../docs/developer/discussion/enterprise-client-acceptance.zh.md) 区分后台证据与桌面交付。
