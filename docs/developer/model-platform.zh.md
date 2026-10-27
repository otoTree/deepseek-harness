---
description: "共享供应商、持久化媒体操作、人民币结算及向前修复的部署恢复。"
kind: "reference"
---

# 企业模型平台

[English](model-platform.md) | 中文

## 摘要

供应商保存不可变的凭据和连接版本。平台模型 UUID 标识文本与媒体能力；操作版本保存参数、映射和人民币价格。文本使用计量转发，媒体使用持久化任务。[SDK](../../packages/plugin/sdk/README.zh.md) 通过同一目录提供两类能力。

## 目录

- [配置与 API](#configuration-and-apis)
- [账务与交付](#accounting-and-delivery)
- [Seedance 配置](#seedance-configuration)
- [部署与恢复](#deployment-and-recovery)
- [验收证据](#acceptance-evidence)

<a id="configuration-and-apis"></a>
## 配置与 API

平台管理员管理 `/v1/platform/model-providers`、`/v1/platform/models` 和 `/v1/platform/model-adapters`。供应商更新追加版本；更新时省略密钥则保留加密凭据。模型更换供应商时保留 UUID。模型更新与删除要求显示的 `expectedPublicationRevision`；过期写入失败，成功修改递增版本并追加不含凭据的审计。删除模型会禁用模型。发布操作使前一版本停止接收新请求；已接受任务保留其加密连接、价格、参数和参考条件快照。

团队端点提供模型目录、任务预览／创建／查询及授权资产。创建先提交幂等接纳记录，再返回排队任务。GET 读取平台状态，不访问供应商。任务历史分页（`GET model-tasks/page`、SDK `listTaskPage`）支持服务端状态与模型名称筛选，并按创建时间和 ID 使用有界游标。游标保留数据库微秒精度。便捷方法 `listTasks` 返回调用者最近 100 项任务。插件能力重新验证安装、发布、权限版本、设备及激活；任务和资产还检查团队、账号与安装归属。

操作配置支持 `template-v1` 和 `crl-seedance-v1`。默认值与约束在接纳前解析。引用使用平台资产 ID 和明确映射；视频引用要求确认价格。平台不执行任意 TypeScript，也不导入 Kinelyx 脚本。

[配置补丁](../../apps/api/cordis.patch.yml) 将受校验的环境设置映射到运行配置。默认值为：`ENTERPRISE_MODEL_TASK_ACCEPTING=true`，扫描间隔 1,000 ms，并发 4，租约 120,000 ms，最长跟踪时间 86,400,000 ms，重试上限 1,800,000 ms，资产上限 536,870,912 字节。对应名称以 `ENTERPRISE_MODEL_TASK_` 开头，后接 `SCAN_INTERVAL_MS`、`CONCURRENCY`、`LEASE_MS`、`MAX_AGE_MS`、`RETRY_MAX_MS` 或 `ASSET_MAX_BYTES`。供应商超时与可重试 HTTP 状态为版本化设置。Seedance 轮询默认 30,000 ms，调用超时默认 300,000 ms。

<a id="accounting-and-delivery"></a>
## 账务与交付

金额均为整数微元：1 元等于 1,000,000 微元。文本保留原有取整规则。媒体将各配置用量的费用向上取整到微元后相加。Token 单价为每百万 token 的微元数；其他价格为每声明单位的微元数。预览返回预估、解析后参数、选中的条件、价格和结算分母；创建会再次校验。

当前媒体任务按团队／幂等键记录一次接纳，不预扣资金；冲突参数被拒绝。完整供应商用量按价格快照结算，零用量同样有效。用量缺失、提交不明及取消不明保留待核对；Worker 不重发可能已被接纳的 POST。输出不可用不抹除供应商费用。历史任务引擎保留已保存的预占和回退行为。

文字与当前媒体任务在结算后完整扣款，允许产生负余额。不可变账本保留调整。[团队管理](enterprise-team-governance.zh.md)负责月预算、接纳归属、部门报表和保留容量。`model_usage` 视图合并最终文字／媒体用量，不重复计算账本流水。

供应商执行、资产保存和账务分别记录在任务字段中。下载要求公网 HTTPS 地址，拒绝重定向与含凭据 URL，核验 MIME 和大小并记录校验和。每个保存结果具有自有资产 ID 与对象键。签名访问 URL 为临时地址。资产失败独立重试，不重新生成或收费；交付跟踪期限结束后停止自动重试并进入核对。外部画布存储版本 2 接受版本 1 记录，保留历史 URL 可读，新结果写入资产 ID。

<a id="seedance-configuration"></a>
## Seedance 配置

CRL 驱动提交 `/videos/generations`，查询 `/tasks/{id}`。提交允许仅返回 ID，按 `id`、`task_id`、`data.id` 的顺序选择。查询映射完成、失败、取消、过期和处理中状态。成功状态缺少有效 HTTPS 视频 URL 时变为 `provider_output_invalid`。驱动仅使用 `usage.completion_tokens`，不叠加 `total_tokens`；保留 `duration=-1`，且 `withAudio` 优先于 `generate_audio` 和默认的 `true`。

用户提供的官方价目按每元 15 积分换算：Seedance 2.0 和 `doubao-seedance-2-0-260128` 按每秒 1 元估算，自动时长数量为 15，官方单价为每百万 token 46 元；Seedance 2.5 按每秒 1.5 元估算，自动数量为 30，官方单价为 70 元。官方视频参考价为每百万 token 28 元与 42 元。这些是参考价格，**并非已核实的 CRL 收费**。实际费率必须经账户级确认后配置。图片生成（包括 Seedream 5.0 Pro）在获得 API 文档前不发布。图片参考字段与角色须在启用前获得文档。视频付费验收前须经账户级确认 CRL 实际费率；不预设较低参考价格。

[Seedance 发布模板](model-platform-seedance.examples.json) 包含三个方案，必须替换平台模型 ID 并填写已确认的价格。所提供的 CRL 指南明确视频参考使用 `video_url: { url }` 和 `role=reference_video`；独立发布补丁要求先确认视频参考费率，再启用该能力。图片参考字段仍缺文档。2.0 和 2.5 参数包含 `ratio=adaptive`，xu 保留固定画幅。

所提供的 2026-10-17 排查记录显示，Seedance 2.5 在 720p、自适应画幅、自动时长、视频参考和关闭音频组合下，被 CRL 以 HTTP 400 定价范围错误拒绝。具体拒绝字段尚未确认；该组合须经供应商确认和真实测试后才能通过验收。编辑请求必须保留 `duration=-1` 和 `ratio=adaptive`，不能静默改成固定时长生成。

<a id="deployment-and-recovery"></a>
## 部署与恢复

1. 备份 PostgreSQL 与对象存储；验证恢复权限、加密密钥可用性、应用角色授权和已有待处理任务。保留前一应用产物及兼容新版本的 Worker 产物。
2. 使用现有迁移入口应用日志直至[迁移 0040](../../apps/api/migrations/0040_team_governance.sql)。迁移日志使重复应用不再执行。既有文本 UUID、任务快照、流水金额和 Session JSONL 保持原值；历史任务保留执行引擎版本 1。为应用授予新表和用量视图访问权，不授予流水修改权。
3. 分别构建 API、管理端、协议、SDK 和外部插件。核验 ZIP 清单、完整性、SDK 版本与双目标入口。仅通过受支持的 `dsh --profile enterprise-api` 启动 API。
4. 初始设置 `ENTERPRISE_MODEL_TASK_ACCEPTING=false`；核验目录、凭据、存储签名、迁移映射、读取权限和待处理任务恢复。该设置拒绝新任务，已接受任务与幂等读取继续工作。检查通过后再启用接收。
5. 通过 `GET /v1/platform/model-tasks` 查看待核对任务。使用 `POST /v1/platform/model-tasks/:taskId/resolve` 处理，提供 `expectedVersion` 和文档证据 `evidence`。操作包括关联已确认的供应商任务 ID、确认免费失败、重试资产、收取欠款或追加费用调整。不得仅凭耗时推断免费失败，也不得重发不确定提交。
6. 恢复时停止新任务接收，继续处理已接受任务，并部署兼容的向前修复版本。不得降级数据库、重写流水、替换已提交的 Session 代次，也不得用旧数据库覆盖正在发生的扣费。备份恢复仅用于协调后的灾难恢复，并须与供应商和账务对账。

<a id="acceptance-evidence"></a>
## 验收证据

无密钥测试使用独立 PostgreSQL 数据库、显式供应商桩、可控时钟推进、提交同步屏障与内存对象存储。验证覆盖迁移保留、并发幂等与 Worker 领取、重启续跑、缺失和零用量、参考价快照、迟到结果隔离、欠款、审计调账及已安装插件能力。桩参考字段使用明确的测试名称，不充当 CRL 文档。

生产就绪还需要在本地正式应用完成外部插件安装流程、录制 Agent 工具场景，并执行获授权的真实供应商调用。视频验收范围记录文本普通与流式、三个 Seedance 方案、自动时长、已有文档的视频参考、重启恢复、最终用量、价格、流水、校验和及媒体播放。图片生成与图片参考待文档齐备后再验收。仅在无密钥检查通过后索取密钥与任务数、金额额度。提交结果不确定或额度耗尽时停止新增付费任务。报告与 GIF 隐去凭据、签名 URL 和素材地址。本地验收不代表远端生产部署。
