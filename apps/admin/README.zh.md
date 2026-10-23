---
description: "本地企业管理界面、认证表单和共享 Web 主题。"
---

# 企业管理后台

[English](README.md) | 中文

## 概述

Next.js 16.3.4 控制台通过[企业 API](../api/README.zh.md) 提供管理登录和企业管理页面。用户注册、组织入驻、密码重置和桌面授权由独立 Portal 负责。控制台使用共享 `ui-theme` 语义角色，保留深色导航栏，并为紧凑表格和管理工作流采用浅色工作画布；紧凑组件和导航仍由此应用维护。它的目标视觉与交互方向见[企业级客户端与 Admin 视觉设计系统](../../docs/visual-design-system.zh.md)。它不是 DSH 聊天界面。

浏览器标题使用词典中的「智域OS」。[`app/icon.png`](app/icon.png) 与[共享产品图标](../web/public/favicon.png)保持一致。

## 目录

- [开发](#development)
- [限制](#limitations)
- [开发备注](#dev-note)

<a id="development"></a>
## 开发

`pnpm --filter @deepseek-ai/dsh-enterprise-admin build` 构建控制台。`pnpm run enterprise:admin` 在 `http://127.0.0.1:4000` 启动回环开发服务器。启动 Admin 服务或容器时，将 `ADMIN_API_URL` 设置为浏览器可访问的 HTTP(S) API 地址；默认值为 `http://127.0.0.1:8787`。服务端在每次渲染页面时校验这个公开值并传给浏览器，不将其内嵌到构建产物中。无效值会使页面请求失败。使用新值重启容器并刷新页面，即可用同一镜像切换环境。此变量中不得填写模型密钥。用户注册、组织关系、密码重置和桌面授权由桌面端账户界面负责。

容器复制 Next.js standalone 服务和静态资源，并通过 Node 启动。工作区源码、开发依赖和构建缓存保留在构建阶段。[容器运行产物决策](../../.agents/notes/implemented/architecture/2026-10-21-enterprise-container-runtime-payloads.zh.md)负责产物选择。

[领域壳层](app/admin-shell.tsx) 包含根节点优先的全局组织树、跨组织账号详情、全平台模型目录、组织单元、成员状态、设备、同步、权限、身份源、健康、审计和平台设置。模型编辑器拥有 OpenAI 协议、输入模态、原生视频是否同时理解内嵌音轨、文件策略、模型调用与上传超时、单文件与请求限制、文件 TTL 与刷新余量、重试、配额清理和人民币 token 价格；无效的跨字段组合无法保存。模型未启用视频输入时不能声明内嵌音轨理解，独立 `audio` 输入仍是另一项能力。模型配置页还可发布向量、图片、视频和音频操作的供应商无关适配器。适配器密钥、请求模板、状态映射、用量提取、价格和预扣金额只由平台超级管理员维护；客户端只读取已发布的模型目录。兑换码页面可创建 1–1000 个使用十进制定点人民币金额的批次，只在创建结果中显示一次明文以便立即导出，后续按提示和状态分页查询，并且只能撤销未使用的兑换码。用量看板默认展示最近 30 个 Asia/Shanghai 自然日，并提供平台汇总、每日趋势、协议／模态筛选、文件上传维度、待对账原因、分组明细和分页记录。启用的模型对所有组织可用；控制台不提供按组织分配模型，也不提供用户注册或桌面授权。

领域壳层为 `/organizations`、`/accounts`、`/sync`、`/permissions`、`/models`、`/identity` 和 `/platform` 提供可分享路由。同步预览保留差异记录，审批使用版本检查，回滚创建补偿运行。身份映射、登录失败、会话审批、Runtime 详情和健康探针拥有独立视图与按租户隔离的 API owner。

在 `/platform/plugins`，平台管理员可以一次选择多个标准 `.dsh-plugin.zip` 文件。每个上传版本经过摘要校验的平台代理批准后，页面才报告发布成功；批准失败的版本保留在审核列表，供人工恢复。已发布的平台版本在刷新后出现在各组织的桌面插件目录中。

平台管理员在 `/platform/desktop-releases` 上传完整安装包及离线签名的 `.update.json` 文件。发布需要已配置的发布公钥、匹配的大小与哈希值，以及该平台更高的版本号。页面支持取消上传，并列出已发布版本及上传草稿。使用前部署 [API 发布配置](../api/README.zh.md#desktop-releases)；已安装客户端需要内置匹配的更新地址和公钥。

设备视图显示可撤销的云端登录授权及其服务端到期时间，不设设备限额。授权有效不代表设备在线。订阅表单管理席位与预算；桌面会话保存在用户电脑中。

Admin 面板随内容增高，并在每一行顶部对齐。[布局决策](../../.agents/notes/implemented/bug-fix/2026-10-16-admin-content-heights-and-spacing.zh.md) 规定共用的控件与指标卡最小尺寸、卡片内边距、区块间距、阅读字号，以及可独立滚动的 sticky 导航。浏览器布局证据归 Admin 所有，保存在 `output/playwright/admin-layout/`，不进入 Session snapshots。

<a id="limitations"></a>
## 限制

- 管理功能需要已初始化的 API 部署。用户注册和组织关系在独立 Portal 中完成；仅当设置 `ENTERPRISE_REQUIRE_EMAIL_VERIFICATION=true` 时本地注册才需要 SMTP。
- 部分高级操作仍仅提供 API，包括作用域单元移动／删除和邀请撤销；全局组织与账号主流程已在控制台提供。
- 管理文案由中文词典维护；Portal 提供中文和英文用户文案。
- 这些页面不能替代原生 Keychain 存储、设备管理、Web 聊天或本地执行服务。

<a id="dev-note"></a>
## 开发备注

分发此开发构建前请先阅读[验收矩阵](../../docs/developer/discussion/enterprise-client-acceptance.zh.md)。
