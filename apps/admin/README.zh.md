---
description: "本地企业管理界面、认证表单和共享 Web 主题。"
---

# 企业管理后台

[English](README.md) | 中文

## 概述

Next.js 控制台通过[企业 API](../api/README.zh.md)提供平台管理登录及部署／团队管理。公开账号流程使用 `/account`；原生授权与显式团队选择使用桌面账号界面。控制台使用共享主题及独立管理布局；[视觉设计系统](../../docs/visual-design-system.zh.md)定义其方向。

浏览器标题使用词典中的「智域OS」。[`app/icon.png`](app/icon.png) 与[共享产品图标](../web/public/favicon.png)保持一致。

公开的 `/account` 页面独立于仅限平台管理员的 Admin 外壳，处理邀请接受、验证与密码恢复。[团队管理](../../docs/developer/enterprise-team-governance.zh.md)定义双端职责及权限。

平台消费明细使用服务端游标；导出读取所选期间的全部分页。模型、供应商／任务恢复、设备、平台设置与安装包资源在配置的可见页面刷新时重新读取状态。

[Figma 改版设计](https://www.figma.com/design/oIEgfoHtGZUcZ2WhMBijP0)定义四组导航、页面层级和操作表单。[本地资源](public/admin)包含品牌、附许可证的 Lucide 图标和自托管字体子集。[页面验收](tests/admin-pages.test.ts)负责无需密钥的[页面输出快照](tests/admin-pages.expected.md)、路由覆盖、弹窗焦点及保留版本的交互。

## 目录

- [开发](#development)
- [限制](#limitations)
- [开发备注](#dev-note)

<a id="development"></a>
## 开发

`pnpm --filter @deepseek-ai/dsh-enterprise-admin build` 构建控制台。`pnpm run enterprise:admin` 在 `http://127.0.0.1:4000` 启动回环开发服务器。启动 Admin 服务或容器时，将 `ADMIN_API_URL` 设置为浏览器可访问的 HTTP(S) API 地址；默认值为 `http://127.0.0.1:8787`。服务端在每次渲染页面时校验这个公开值并传给浏览器，不将其内嵌到构建产物中。无效值会使页面请求失败。使用新值重启容器并刷新页面，即可用同一镜像切换环境。此变量中不得填写模型密钥。用户注册、组织关系、密码重置和桌面授权由桌面端账户界面负责。

容器复制 Next.js standalone 服务、`.next/static` 和 `public` 资源，包括品牌图片、导航图标和字体，并通过 Node 启动。工作区源码、开发依赖和构建缓存保留在构建阶段。[容器运行产物决策](../../.agents/notes/implemented/architecture/2026-10-21-enterprise-container-runtime-payloads.zh.md)负责产物选择。

[管理外壳](app/admin-shell.tsx)管理部署政策、服务端分页团队、显式 Owner／资源开通、套餐／席位、带审计的余额调整及生命周期恢复。平台资源包括模型供应商、操作版本、全部／指定团队发布、插件审核与签名安装包。团队角色、部门及团队审计使用桌面成员接口。

[企业工作区](app/enterprise-workspace.tsx)在私有化部署提供身份连接、字段映射、登录失败、同步脚本、运行、差异决定及补偿回滚历史。Admin 要求平台管理身份、显式有效团队成员关系及 `identity.manage` 或 `directory.sync`；不隐式选择首个团队。开放／SaaS 部署不加载这些团队资源。OIDC 和 OAuth2 支持网页登录；SAML 和 LDAP 配置存储不代表登录集成可用。同步使用手动输入预览及显式审批；控制台不提供定时任务或 Webhook 管理控件。

可见资源页面在聚焦时及 `ADMIN_ACTIVITY_REFRESH_MS` 周期内刷新（默认 30000，范围 1000–3600000）。后台身份检查保留已挂载表单、已选文件和进行中的上传；暂时失败显示行内错误，授权过期或撤销则移除管理控件。账号搜索与分页使用服务端结果。指定账号恢复要求显示的版本和审计原因，并撤销已有登录凭据。套餐表单提供到期时间，留空表示长期有效。旧角色和部门路由提示授权桌面入口。平台身份本身不能进入团队或查看其内容。

在 `/platform/plugins`，平台管理员可以一次选择多个标准 `.dsh-plugin.zip` 文件。每个上传版本经过摘要校验的平台代理批准后，页面才报告发布成功；批准失败的版本保留在审核列表，供人工恢复。已发布的平台版本在刷新后出现在各组织的桌面插件目录中。

在 `/platform/plans`，平台管理员创建、编辑、停用和删除未使用套餐。团队管理选择目录项及其显示的修订号、席位覆盖值和到期时间。分配应用套餐的资源默认值，不充值或重置消费；目录编辑不修改已有团队。已引用和开通所需套餐不能删除。

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
