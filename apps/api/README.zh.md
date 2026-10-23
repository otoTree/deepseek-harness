---
description: "企业身份、租户授权、模型计量与会话 API 的开发说明。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-enterprise-api

[English](README.md) | 中文

## 概述

开发中的 API 支持已验证账号、组织成员关系、管理操作、运行时注册和平台控制的模型选择。它还提供权限目录、自定义组织角色、版本化身份提供商和目录同步脚本生命周期接口；执行 worker 接入前，脚本测试只记录未执行的预览状态。平台启用的模型对所有已认证组织可用。它使用 Better Auth、Hono、Zod、Drizzle 以及独立 PostgreSQL 数据库。它不是完整的企业 agent（智能体）产品，也不是桌面运行时。

[模型平台参考](../../docs/developer/model-platform.zh.md) 定义共享供应商、操作版本、持久化后台任务、平台资产、人民币结算以及部署恢复。

## 目录

- [本地开发](#local-development)
- [容器镜像](#container-images)
- [客户端版本发布](#desktop-releases)
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

`pnpm run enterprise:api` 构建组合包、准备独立 Harness home，然后启动 `dsh --profile enterprise-api`。未初始化的部署会在打开 HTTP 监听之前报错退出。[初始化脚本](scripts/provision.ts) 只会在不存在部署时创建新部署。`enterprise:start` 使用的 `--if-needed` 模式会检查部署根组织、成员关系、Owner 角色、订阅和钱包，并在不替换账号或组织的情况下修复本地缺失记录；已有部署没有平台管理员时会明确失败。设置 `ENTERPRISE_BOOTSTRAP_EMAIL` 和 `ENTERPRISE_BOOTSTRAP_PASSWORD`，或在 TTY 中运行 `pnpm run enterprise:provision` 并回答两个问题。这是开发环境初始化器，接受简单的本地密码，但只保存 Better Auth 哈希。非交互运行必须提供两个变量。真实部署初始化尚未验证。不要替换成其他项目的数据库凭据。

本地开发栈默认关闭邮箱验证，因此注册不需要 SMTP。设置 `ENTERPRISE_REQUIRE_EMAIL_VERIFICATION=true` 可强制邮箱验证；该模式需要配置 `ENTERPRISE_SMTP_URL` 和 `ENTERPRISE_MAIL_FROM`。

使用 `pnpm run enterprise:start` 可以启动完整本地栈。该命令会先重建 Host 和 Client 库；添加 `--desktop` 时还会重建 Electrobun 前端和插件，然后检查并启动本项目的基础设施，执行迁移，幂等地初始化部署，再启动 API 和管理后台。首次运行时设置两个 `ENTERPRISE_BOOTSTRAP_*` 变量；后续运行会复用已有部署。添加 `--desktop` 可同时启动 Electrobun 开发客户端；不支持的参数会在构建开始前报错。按 Ctrl-C 会停止应用进程，但保留本项目的基础设施供下次启动使用。如果旧栈仍占用 8787 或 4000 端口，请先停止旧进程再重试。

本地栈运行后，执行 `pnpm run enterprise:plugins:publish-local` 会校验 `/Users/hjr/Desktop/plugins` 下选定的 20 个插件 ZIP，使用平台管理员登录，上传缺少的版本，批准平台审核中的版本，并确认所有版本已发布。可在执行环境中设置 `ENTERPRISE_BOOTSTRAP_EMAIL` 和 `ENTERPRISE_BOOTSTRAP_PASSWORD`，也可写入仓库根目录中被 Git 忽略、仅所有者可读的 `.env.enterprise.admin` 文件；只发布部分插件目录时设置逗号分隔的 `DSH_PLUGIN_IDS`。命令不会打印密码。插件摘要未变化时可以重复执行。

经过校验的插件上传会保留可选的内嵌清单图标，组织目录将其返回给有权限的客户端。发布和目录校验共用[插件协议图标规则](../../packages/plugin/protocol/README.zh.md#use-this-package)；公开版本仍不可覆盖。

[配置](src/config.ts) 与[组合包补丁](cordis.patch.yml) 定义启动设置。启用邮件流程前需配置 SMTP 和发件人。`ENTERPRISE_MODEL_REQUEST_BODY_BYTES` 控制经过认证的模型请求体上限（默认 64 MiB，校验上限 512 MiB）；启用大媒体时应将它设为高于编码后大小的值。模型地址可使用任意公网 HTTPS 地址；网关会拒绝携带凭据的地址、字面 IP 地址，以及包含任何非法或内网地址的完整 DNS 应答集合。模型密钥加密保存。只有平台管理员模型 API 会返回配置的 base URL 和上游模型名；组织与 Runtime 目录只公开平台模型 ID、展示元数据、能力和限制。模型目录在旧图片标记之外保存协议、声明的输入模态、视频内嵌音轨模式和文件输入策略；默认值保持现有的纯文本 OpenAI 兼容模型行为，并保守地把缺失的视频音轨元数据视为只理解画面。API 默认绑定 `127.0.0.1`。容器部署必须设置 `ENTERPRISE_API_HOST=0.0.0.0`，并在服务前配置安全入口。`/model/*` 数据面 namespace 是经过设备认证的中转：它只移除 namespace 前缀，保留剩余路径、方法、查询参数、提供方 JSON 字段、请求头和安全响应头，并且只替换配置的模型 ID 与 Authorization 请求头。重定向、服务身份、cookie、报告及提供方 CORS 响应头不会到达调用方。文本响应会替换精确匹配的提供方 origin、hostname 与上游模型名，同时保留协议帧；二进制响应仍按原字节传输。JSON 请求体与 `X-DSH-Model` 请求头同时存在时必须选择同一个已启用的平台模型 UUID；提供方模型名或未知 UUID 不会到达上游。请求失败、响应流失败、上游错误状态和响应后的计量失败日志包含平台模型 ID、中转路径、方法及相应的错误分类，不包含配置的端点、凭据、请求头、查询参数或请求体内容。`ENTERPRISE_MODEL_USAGE_MAX_EVENT_CHARS` 限制计量器检查 SSE 记录时使用的内存。

桌面账号请求使用配置的 API 来源进行认证及受 cookie 保护的组织操作。API 将自身来源加入明确的来源白名单；桌面端只需 `ENTERPRISE_API_URL`，不依赖 Admin 或 Portal 可用。现有 API 部署需包含此白名单行为，或显式设置 `ENTERPRISE_PORTAL_ORIGIN` 为 API 来源，才能接受更新后的桌面端。其他浏览器来源仍需明确配置，使用 cookie 认证的写操作会拒绝未知来源。

-----

<a id="desktop-releases"></a>
## 客户端版本发布

部署迁移 `0036_desktop_releases`，并将 `ENTERPRISE_DESKTOP_UPDATE_PUBLIC_KEY` 设置为客户端安装包内置的 base64 SPKI Ed25519 公钥。API 使用已配置的 MinIO 存储桶保存私有安装包对象，在校验期间使用本地临时文件。签名私钥保持离线。`ENTERPRISE_DESKTOP_INSTALLER_MAX_BYTES` 默认为 1 GiB；每个并发上传至少预留相应的临时磁盘空间，并调整入口代理的请求体大小和上传超时限制。

平台管理员在 Admin `/platform/desktop-releases` 选择安装包及其签名 `.update.json` 文件。API 在发布前验证签名、应用标识、平台、版本、HTTPS 下载地址、签名大小和 SHA-256。签名地址必须为 `ENTERPRISE_API_URL/desktop/updates/<target>/<version>/installer`，其中 target 为 `darwin-arm64` 或 `win32-x64`。上传失败时保留草稿；重新选择文件会创建新草稿。若服务器已经提交发布，取消请求仍可能发布成功，因此重试前应刷新版本列表。

匿名只读订阅地址 `/desktop/updates/<target>/latest` 返回语义版本最高的已发布签名文件；首次发布前返回 204。安装包通过 API 的 HTTPS 流式下载，已发布内容保持不可变。发布操作按平台串行处理，拒绝相同或更低版本；现有已发布安装包不能覆盖。数据库提交结果丢失时保留已上传对象，避免删除可能已发布的安装包；无引用对象需要由存储维护清理。[客户端发布说明](../electrobun/README.zh.md#desktop-updates) 负责密钥创建和签名命令。

<a id="implementation"></a>
## 实现

<details>
<summary>实现细节</summary>

注册策略控制账号创建；部署模式控制组织访问。开放团队要求明确成员资格，私有公司的成员资格可沿公司层级继承。席位限额按所选组织计算；登录授权没有设备限额。设备撤销不能跨组织操作。部门变更要求组织权限，并拒绝外部父级、循环及删除仍被占用的单元。参见[团队隔离决策](../../.agents/notes/implemented/bug-fix/2026-10-22-open-registration-team-isolation.zh.md)。

桌面登录授权使用可撤销的不透明令牌，服务端仅保存其哈希。`ENTERPRISE_LOGIN_SESSION_SECONDS` 配置闲置到期时间，默认为 30 天。已认证请求验证成员资格和到期时间，并在有效期后半段延长仍有效的授权。已到期或撤销的令牌不能续期。设备没有心跳或限额；授权记录表示云端访问资格，不表示在线状态。[登录续期](src/login-session.ts)独立于本地进程生命周期。

[授权逻辑](src/security.ts) 先解析成员关系，再选择事务内租户上下文。当应用账号既不是超级用户也没有 `BYPASSRLS` 时，强制 RLS 保护组织数据。组织锁保护席位变更、树结构编辑及最后 Owner 检查。平台管理权限不隐含客户会话访问权。

[application.ts](src/application.ts) 与 [admin-governance.ts](src/admin-governance.ts) 中的管理工作流路由持久化同步差异和补偿回滚、身份字段映射和脱敏登录失败、会话审批、Runtime 详情读取以及明确的健康状态。这些记录会检查权限、写入审计、按租户隔离，并由 `0033_admin_workflows` 迁移。 同步预览要求外部 ID 为非空字符串或数字；无效记录会生成失败的运行记录，不持久化差异。

[Session 路由](src/sessions.ts)保留租户隔离的云端存档和带隔离令牌的远程写租约。桌面会话保存在本地。显式上传通过 `POST sessions/:id/archive` 每批最多传输 500 条事件：每个事务锁定存档，校验不可变元数据和重叠事件，仅追加连续后缀，不获取写租约。活跃的远程写入者会拒绝上传；分歧历史返回冲突。相同重试和较短的一致上传会保留已有历史。下载通过分页列表与事件读取当前账号的存档。读取他人内容要求组织所有者或管理员权限，并追加审计记录。

[模型调用](src/gateway.ts) 验证设备并解析平台启用的模型，校验声明模态与媒体位置，替换配置的上游模型 ID 和 Authorization，然后在不重构响应的情况下中转 Chat Completions 或 Responses。每个模型拥有上游调用超时；桌面传输会在该截止时间后继续等待自身配置的请求超时时长，使 API 超时响应能够到达调用方。提供方文件请求使用服务端凭据上传已校验字节，拒绝永久媒体 URL，并在分发前执行单文件与请求总量限制。仅当进程内回执属于调用方组织、账号和模型时，网关才接受提供方文件引用；缺少回执会使原生适配器将缓存置为无效，并执行一次有界重新上传。旁路观察器会用非缓存输入、缓存输入、输出、reasoning（推理）、总 token、文件上传维度、人民币价格快照和分项成本结算完整用量；不完整或无效用量保留为显式待对账。平台分析公开协议、模态、上传、失败和对账维度，同时保留旧 Chat 记录。[插件审核路由](src/plugins.ts) 分离源码扫描、AI（人工智能）审核、人工批准和摘要校验发布。

插件目录读取两种 manifest schema 的产品 target，并提供声明的分类、说明和配置方式。HTTP 授权结合包域名白名单与已保存 URL 字段的精确主机名；只有经过校验的配置元数据明确标记 `network: true` 的字段才授予主机权限。其他字符串和非 HTTP URL 不授予网络访问。配置地址由 API 服务器访问，因此 loopback 指向服务器本机。

[团队钱包](src/wallet.ts) 初始余额为零，仅在当前组织余额为正时允许发起模型调用。兑换操作以原子方式消费一个按 HMAC 索引的兑换码、为选中组织入账并追加不可变账本记录；明文兑换码只出现在平台批次创建响应中。已结算的人民币用量会锁定用量行与钱包，追加一条以 usage ID 唯一的扣款记录；并发调用结算后可以产生小额负余额。待对账、失败、未定价和仅上传文件的记录不会扣款。后续兑换会先抵扣负余额，只有余额重新大于零时才恢复下一次模型调用。

网关与[原生模型提供方](../electrobun/src/gateway-provider.ts) 共享 Zod 请求／目录 schema。API 在不消费、存储或重建响应字节的前提下观察 Chat 与 Responses SSE 用量；Responses reasoning-summary 记录属于有效帧，但计量器不保留其文本。原生提供方独立校验 DSH 所需的所选协议流。缺少用量、格式错误、超限、中断、非 SSE 和非 2xx 响应仍会透明中转，并进入待对账而不是 settled 用量。计量或数据库失败不会改变中转响应。

平台管理员可以调用 `POST /v1/platform/organizations/:organizationId/usage/:id/reconcile` 处理 `pending_reconciliation` 记录。接口要求平台权限和明确的 settled 或 failed 结果。人民币占用会保留三项价格快照，并接受输入、缓存输入、输出和 reasoning token 总量以重建分项成本；兼容占用继续使用原有的 billed 微单位路径。核对操作会在同一事务中更新用量、团队钱包账本与审计日志，并保证同一个 usage ID 不会重复扣款。

</details>

-----

[云盘](src/drive.ts)将个人所有权与组织内分享分开。文件或文件夹可以向指定成员、指定部门或所选组织的全体有效成员授予查看或编辑权限；部门授权必须明确是否包含下级部门。子节点继承最近的显式权限。新建根节点默认为私有；组织文件的创建者及组织管理员保留管理权限。已有组织根节点保留已保存的组织可见范围。个人文件分享后仍留在所有者的空间；共享视图展示获准访问的入口，不开放所有者的其他文件。

数据库权限函数在分页前过滤列表、搜索、回收站和变更通知，并检查按 ID 读取文件、描述、版本及下载的请求。上传提交会在权限变化后重新检查写入者和目标目录。移动节点需要管理权限，并保留其有效分享范围。分享变更写入审计；撤权会停止签发新的下载链接，已签发的链接在配置的到期时间前仍然有效。[隔离 HTTP 测试](tests/drive-sharing.test.ts)验证部门调岗、继承授权、跨组织拒绝以及撤权后的上传提交。

<a id="verification"></a>
## 验证

[测试](tests/identity.test.ts)分配私有 PostgreSQL 容器，在关闭连接池后移除容器。测试覆盖授权、席位、邀请、登录令牌、存档写租约和审计。[Profile 冒烟测试](tests/profile-smoke.ts)通过 DSH 运行构建产物并验证监听关闭。测试要求 Docker，不会静默跳过缺失的数据库。

<a id="limitations"></a>
## 限制

- 部门角色绑定不授予组织管理权限。文件分享范围独立于管理角色，按部门成员关系计算。
- 取消仍只由本地上游 fixture 覆盖，尚未使用真实提供方验证；生产 HTTPS 与 DNS 传输已使用平台启用的 DeepSeek 模型手动验证流式与非流式请求。不返回有效 OpenAI 兼容 SSE 用量的提供方和路径仍可通过中转使用，并生成待对账记录；自动上游状态核对仍然缺失。
- 可信入口 IP 处理、账号暂停和完整安全审计仍未完成。配置 `ENTERPRISE_REDIS_URL` 时可使用 Redis 限流；未配置时使用明确的进程内开发回退实现。
- 桌面会话保存在本地；云端模型、云盘操作和插件管理仍使用数据库事务。移除设备心跳不会移除插件激活续租或触发器轮询。云端并发仍需有界连接池与请求容量规划。
- 市场安装记录尚未激活或卸载 DSH 插件。源码扫描不生成 SBOM，也不验证已安装的依赖闭包。
- 初始管理员初始化、邮件投递、GUI 登录和私有化部署验收仍需端到端验证。隔离数据库测试已组合覆盖原生回环客户端与实际 API 授权码交换；这不代表已验证打包后的桌面激活。


<a id="container-images"></a>
## 容器镜像

登录腾讯云容器镜像服务后，在仓库根目录执行 `pnpm run image:push`。命令会构建并推送 `linux/amd64` 镜像，名称为 `ccr.ccs.tencentyun.com/imags/admin` 和 `ccr.ccs.tencentyun.com/imags/backend`，使用当前提交生成不可变标签，并同时更新 `latest`。在容器启动时配置 [Admin API 地址](../admin/README.zh.md#development)。设置 `REGISTRY_PREFIX` 和 `IMAGE_TAG` 可以覆盖镜像仓库前缀或标签。

Backend 运行镜像包含编译后的 CLI 和 API、迁移、bundle 补丁、初始化入口、已准备的 profile，以及 pnpm 部署的生产依赖。[部署钩子](../../infra/enterprise/docker/api-deploy.pnpmfile.cjs)将受支持的 `dsh` 启动器纳入这组依赖。两个工作区 `link:` 覆盖包以编译后的库、清单和许可证形式复制。开发依赖、工作区源码和桌面构建产物不进入运行镜像。

Backend 镜像在启动受支持的 `dsh --profile enterprise-api` 进程前初始化数据库。通过 `ENTERPRISE_DATABASE_URL` 提供独立 PostgreSQL 数据库；初始化和 API 使用该 URL 中的账号和密码，也接受提供的 `postgres` 账号。该账号需要创建 Schema 和执行迁移的权限。初始化器创建企业 Schema 和安装标记，在数据库咨询锁保护下执行待应用的迁移，并创建首个平台管理员。没有安装标记时，`enterprise`、`enterprise_auth`、`drizzle` 或 `public` 中已有关系会阻止初始化；`public` 中的 PostgreSQL 扩展成员可以保留。其他 Schema 中的对象，包括平台监控和账号管理 Schema，保持不变。拒绝信息会指出冲突的关系。

在 Backend 部署中，除 API、认证、Redis 和对象存储设置外，再添加这些变量：

```ini
ENTERPRISE_DATABASE_URL=postgres://YOUR_ACCOUNT:YOUR_PASSWORD@DATABASE_HOST:5432/dsh_enterprise
ENTERPRISE_BOOTSTRAP_EMAIL=owner@example.com
ENTERPRISE_BOOTSTRAP_PASSWORD=REPLACE_WITH_A_PASSWORD_OF_AT_LEAST_12_CHARACTERS
```

用户名与密码中的特殊字符需要进行 URL 编码。可选的 `ENTERPRISE_MIGRATION_URL` 为同一主机、端口和数据库选择单独的初始化凭据；未设置或为空时使用 `ENTERPRISE_DATABASE_URL`。初始化授权使用实际连接的业务账号；初始化器不创建角色，也不修改数据库密码。仅当部署不存在时才需要初始化账号变量。初始化完成后，打开 Admin 地址，使用初始化邮箱和密码登录。重复启动会执行待应用的迁移，并保留已有账号、密码、注册策略和成员关系；修改初始化变量不会重置账号。已有部署缺少管理员或与 `ENTERPRISE_MODE` 不匹配时，API 启动前会明确失败。并发启动会串行执行初始化。应用进程不继承迁移 URL 或初始化凭据。容器直接读取部署变量，无需挂载 `.env.enterprise` 文件。

超级用户或拥有 `BYPASSRLS` 的账号会绕过数据库行级权限。API 共用表所有者账号也会削弱基于所有权和仅追加权限的保护。需要数据库强制隔离的部署应使用两个独立的非特权账号；[凭据策略决策](../../.agents/notes/implemented/architecture/2026-10-21-enterprise-single-database-connection.zh.md)记录这一取舍。

<a id="dev-note"></a>
## 开发备注

[身份提案](../../.agents/notes/proposed/architecture/2026-09-05-enterprise-identity-and-organization.zh.md) 仍为 proposed。[验收矩阵](../../docs/developer/discussion/enterprise-client-acceptance.zh.md) 区分后台证据与桌面交付。
