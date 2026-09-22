# 企业插件模型

[English](enterprise-plugins.md) | 中文

本文定义企业桌面插件 target，以及各自适用的运行时边界。

## 插件类型

### Host 插件

Host 插件只包含 Host 代码。桌面运行时在 WebView 外加载它，提供受约束的 SDK，并在企业权限和沙箱策略下运行业务方法。Host 插件不能增加 Client 页面，也不能读取浏览器状态。

### 客户端插件

客户端插件只包含 Client bundle。它在 Web profile 中运行，通过 Client slot、locale 和 Connection 约定增加页面或控件。它不能读取 Runtime token、Keychain 数据、Provider 密钥或任意本地文件。

### Cloud target

Cloud target 留到后续阶段设计。桌面市场首期拒绝 manifest 中的 `cloud`，也不提供 cloud 运行时、服务路由或 cloud 安装路径。

## 共享发布规则

企业 API 保存插件 manifest、artifact、权限、摘要、组织 id、发布状态和策略版本。只有状态为 published 且组织匹配的版本才会进入企业目录。Electrobun 在加载版本前校验这些字段。

桌面插件市场使用 `GET /v1/organizations/:organizationId/plugins/catalog` 读取可见版本，使用 `POST /plugins/packages` 上传标准 `.dsh-plugin.zip`，并通过账号级安装接口完成安装和启用。私有版本对创建者立即发布；组织和平台版本分别进入组织管理员和平台管理员审核队列。只有已发布且未撤销的版本可以安装。

包根目录包含 `manifest.json`、`integrity.json`，以及可选的 `client/entry.js`、`host/entry.js` 和 `assets/`。API 拒绝 `cloud` 与未知 target、不安全 ZIP 路径、重复条目、缺少完整性记录和摘要不匹配。对象使用不可变的内容寻址 key。Host 激活前，Electrobun 会将下载包、manifest、权限、插件 id 和版本与已发布的 release 元数据逐项比较。发布不需要签名私钥。

企业 Client 提供侧边栏市场入口和 `main.surface` 页面。安装会先下载并校验版本，再由用户启用 Client 或 Host target。账号同步保存版本、配置、target 状态、期望状态、实际状态和授权修订；Keychain 内容与操作系统权限只保留在设备本地。

## 客户端扩展模型

现有 Client 扩展点是标准 Web slot 系统。插件注册 locale 字典，并使用显式注入属性贡献 `settings.section` 条目。`ui-enterprise` 用这个机制提供企业账户、模型和插件页面，同时复用公共基础组件和 Connection RPC。

## 当前实现边界

仓库已经实现发布记录、包校验、资源和迁移声明、对象存储、摘要校验、Host 与 Client target 动态加载、Client slot、locale 注册、市场导航、安装和设备激活记录、短期运行租约及 Connection RPC。插件 protocol、作者 SDK 和 Cordis runtime binding 提供当前身份、文本模型、对象、受限 SQL 和命名空间缓存能力。本地企业基础设施会开通独立插件 PostgreSQL 服务、Redis 和 MinIO。Cloud target、联动 bundle 服务路由、子域名分配以及图片和视频生成仍不在首期运行时范围内。

## 设计约束

服务端代码负责数据访问和特权操作。客户端代码负责界面展示和用户交互。联动插件只能通过声明、认证且受大小限制的 RPC 在两侧通信。每项请求能力都必须写入 manifest，并在执行前校验。

桌面 manifest 使用 `client` 和 `host` target 描述。一个包可以只包含其中一个 target，也可以同时包含两者。这个分类能防止 Client bundle 变成未声明的特权 Provider，并让审核、安装和撤销分别作用于每个可执行部分。

## 延伸阅读

- [API Gateway](api-gateway.zh.md)
- [企业 Client 包](../packages/client/ui-enterprise/README.zh.md)
- [企业插件 API](../apps/api/src/plugins.ts)
- [Electrobun 插件校验](../apps/electrobun/src/plugin-verifier.ts)

## Dev Note

本文记录当前架构和三种插件类型的术语。对话式编写流程和联动插件能力注入仍属于设计工作，不是当前产品行为。
