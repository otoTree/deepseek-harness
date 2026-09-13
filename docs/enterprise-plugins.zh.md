# 企业插件模型

[English](enterprise-plugins.md) | 中文

本文定义三种企业插件类型，以及每种类型适用的运行时边界。

## 插件类型

### 服务端插件

服务端插件只包含 Host 或服务端代码。平台在 WebView 外加载它，提供受约束的 SDK，并在企业权限和沙箱策略下运行业务方法。服务端插件不能增加 Client 页面，也不能读取浏览器状态。

### 客户端插件

客户端插件只包含 Client bundle。它在 Web profile 中运行，通过 Client slot、locale 和 Connection 约定增加页面或控件。它不能读取 Runtime token、Keychain 数据、Provider 密钥或任意本地文件。

### 联动插件

联动插件同时发布一个服务端 bundle 和一个 Client bundle。服务端 bundle 在平台沙箱中运行，并获得平台分配的服务 origin。客户端 bundle 通过受约束的 SDK 调用该服务，不会获得 Runtime token 或服务端凭据。身份和模型访问权限由平台以显式的最小权限能力提供。

## 共享发布规则

企业 API 保存插件 manifest、artifact、权限、摘要、组织 id、签名、发布状态和策略版本。只有状态为 published 且组织匹配的版本才会进入企业目录。Electrobun 在加载版本前校验这些字段。

当前目录接口是 `GET /v1/organizations/:organizationId/plugins/catalog`。企业 Client 展示目录记录，但不负责安装、激活或热替换插件。

## 客户端扩展模型

现有 Client 扩展点是标准 Web slot 系统。插件注册 locale 字典，并使用显式注入属性贡献 `settings.section` 条目。`ui-enterprise` 用这个机制提供企业账户、模型和插件页面，同时复用公共基础组件和 Connection RPC。

## 当前实现边界

仓库已经实现发布记录、签名校验、Host 加载辅助、企业沙箱基础能力、Client slot、locale 注册和 Connection RPC。仓库尚未提供面向用户的对话式插件编写流程、通用插件 SDK、联动 bundle 服务路由、子域名分配，或平台托管的身份和模型能力注入。

## 设计约束

服务端代码负责数据访问和特权操作。客户端代码负责界面展示和用户交互。联动插件只能通过声明、认证且受大小限制的 RPC 在两侧通信。每项请求能力都必须写入 manifest，并在执行前校验。

三种类型应在 manifest 和构建产物中保持独立：`server` 只发布服务端 bundle，`client` 只发布 Client bundle，`linked` 同时发布两者并声明关联关系。这个分类能防止 Client bundle 变成未声明的特权 Provider，并让审核、签名、部署和撤销分别作用于每个可执行部分。

## 延伸阅读

- [API Gateway](api-gateway.md)
- [企业 Client 包](../packages/client/ui-enterprise/README.md)
- [企业插件 API](../apps/api/src/plugins.ts)
- [Electrobun 插件校验](../apps/electrobun/src/plugin-verifier.ts)

## Dev Note

本文记录当前架构和三种插件类型的术语。对话式编写流程和联动插件能力注入仍属于设计工作，不是当前产品行为。
