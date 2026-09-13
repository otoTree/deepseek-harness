# 企业身份与组织设计

[English](enterprise-identity-and-organization.md) | 中文

## 概要

每个经过认证的人或服务都是一个 `Account`。每项业务操作都发生在一个 `Organization` 中。新注册的人必须加入已有组织或创建团队组织；产品不建立第二套个人数据模型。团队是成员较少、绑定团队套餐的组织。企业是具有更丰富策略、组织单元和管理控制的组织。

本设计支持两种部署模式。`open` 部署服务公有云，可以支持个人创建团队、创建企业组织、邀请成员和可配置的自注册。`private` 部署服务一个客户组织，关闭公开创建组织，并通过管理员、企业 SSO 或 SCIM 配置成员。两种模式使用相同实体、授权规则和数据归属链。

## 目录

- [核心模型](#core-model)
- [组织层级](#organization-hierarchy)
- [注册与成员关系](#registration-and-membership)
- [部署模式](#deployment-modes)
- [套餐与权益](#plans-and-entitlements)
- [授权与运行时身份](#authorization-and-runtime-identity)
- [数据归属与生命周期](#data-ownership-and-lifecycle)
- [协议要求](#protocol-requirements)
- [首期交付](#initial-delivery)
- [延伸阅读](#further-exploration)

-----

<a id="core-model"></a>
## 核心模型

模型将人员、租户、层级节点、成员关系、权限和商业套餐分开。不能把这些记录合并成 `user.department_id` 或账号类型标记。

| 实体 | 含义 | 必需关系 |
|---|---|---|
| `Account` | 可以认证的人或服务身份 | 可以拥有多个成员关系 |
| `Organization` | 租户、团队或企业的计费与数据边界 | 拥有会话、插件、用量和审计 |
| `OrgUnit` | 组织内部的节点 | 除根节点外都有一个父节点 |
| `Membership` | 一个账号与一个组织的关系 | 拥有独立生命周期 |
| `RoleBinding` | 在组织作用域内授予成员的角色 | 指向组织或组织单元 |
| `Subscription` | 组织绑定的套餐和计费状态 | 生成服务端权益 |
| `RuntimeInstallation` | 已注册的浏览器或桌面执行身份 | 属于账号和组织上下文 |

一个账号可以加入多个组织，并在每个组织拥有不同角色。个人使用表示为只有一个 Owner 的 `Organization(kind: team)`，不建立特殊的会话或插件表。

-----

<a id="organization-hierarchy"></a>
## 组织层级

`OrgUnit` 是通用树节点。初始目录可以包含 `root`、`subsidiary`、`branch`、`department`、`team`、`project` 和 `cost_center`，客户也可以定义其他类型。节点保存 `organization_id`、`parent_id`、`unit_type`、名称、状态和适合查询后代的祖先表示。

一个账号可以通过成员分配加入多个组织单元。没有部门的用户仍然挂在根节点下。成员从一个单元移动到另一个单元只改变分配和策略作用域，不改变账号或历史会话归属。

```text
Organization
└── Root OrgUnit
    ├── Subsidiary A
    │   ├── Research
    │   └── Finance
    └── Subsidiary B
        └── Support
```

组织树是授权作用域，同时也可用于成本中心、项目和数据域，不需要增加更多硬编码字段。

-----

<a id="registration-and-membership"></a>
## 注册与成员关系

注册先创建 `Account`。账号拥有有效成员关系前，不能创建会话、安装插件或消耗配额。

```text
Register → Verify → Join or create → Membership → Plan → Runtime
```

邀请包含组织、可选组织单元、初始角色、到期时间和邀请人。接受邀请只创建一条成员关系；已有身份不会因此创建第二个账号。没有邀请时，用户创建团队组织并成为 Owner。创建团队是公有云用户的默认引导路径。

自注册是部署策略，取值为 `open`、`domain_restricted`、`invite_only` 和 `disabled`。邮箱验证、速率限制、反滥用、域名所有权和管理员审批由身份服务负责。匹配邮箱域名可以提示组织，但不能静默授予成员或管理员权限。

成员状态为 `invited`、`active`、`suspended`、`removed` 和 `expired`。账号状态为 `pending`、`active`、`suspended`、`deactivated` 和 `deleted`。移除成员会撤销其组织访问，同时保留账号身份和历史记录。

-----

<a id="deployment-modes"></a>
## 部署模式

部署模式改变策略，不改变数据模型或协议。

| 模式 | 组织 | 注册 | 成员来源 |
|---|---|---|---|
| `open` | 个人团队和企业组织 | 可配置；公有 SaaS 可以默认开放 | 自注册、邀请、SSO 或 SCIM |
| `private` | 一个客户企业组织 | 关闭公开注册 | 初始管理员、SSO、邀请或 SCIM |

私有化部署初始化一个企业组织、一个根节点、一个 Owner 和一个私有套餐。之后的账号只能加入该组织，不能创建第二个组织或个人空间。公有部署可以允许一个账号创建多个组织，但每次请求必须选择一个当前组织上下文。

服务端必须拒绝缺少组织上下文、无权访问、已暂停，或与认证账号和 Runtime 不一致的请求。客户端可以显示当前组织，但服务端必须在每次敏感操作前重新计算授权。

-----

<a id="plans-and-entitlements"></a>
## 套餐与权益

套餐绑定组织，包括只有一个成员的团队。套餐控制能力限制，不改变身份或存储表。

```text
team_free → team_pro → business → enterprise → private
```

权益可以限制席位、Runtime、模型用量、云端插件调用、会话保留、存储、自定义插件、企业连接器、审计保留和支持等级。服务端根据套餐、购买的附加项、组织覆盖配置和当前用量计算有效权益。积分用于展示和预算；用量账本仍是资源与币种的权威来源。

邀请成员、创建 Runtime、安装插件或发起模型请求时，都由所属服务执行权益检查。客户端检查只是体验提示。团队超过套餐限制时，服务按套餐策略拒绝操作或要求升级。

-----

<a id="authorization-and-runtime-identity"></a>
## 授权与运行时身份

角色绑定到成员和作用域。初始角色为 `Owner`、`Administrator` 和 `Member`；后续可以增加安全审核、插件发布、财务和数据访问角色，而不改变成员关系。

```text
RoleBinding(
  membership_id,
  scope_type: organization | org_unit,
  scope_id,
  role_id
)
```

每个浏览器或桌面客户端都注册一个 `RuntimeInstallation`，包含账号、组织、运行时类型、客户端版本、能力声明、策略修订、租约和撤销状态。用户可以切换组织，但 Runtime 会收到新的策略视图，每个 Agent、会话、插件调用、用量事件和审计事件都记录所选组织与操作者。

撤销账号、成员关系或 Runtime 会阻止新工作。客户端拥有的自动化按本地取消策略结束，并在重新连接时报告结果。服务账号拥有自己的凭据和 Runtime 身份，不能继承交互式用户的浏览器会话。

-----

<a id="data-ownership-and-lifecycle"></a>
## 数据归属与生命周期

数据归属链为：

```text
Organization → OrgUnit → Membership → Runtime → Agent → Session → Tool Call → Usage → Audit
```

每条持久化业务记录都带有 `organization_id`、适用时的 `actor_account_id` 和创建时间。会话内容、插件源码、用量记录和审计记录分别拥有保留、导出、删除和法律保全策略。删除账号或移除成员不会删除组织审计或计费所需的记录。

组织状态为 `pending`、`active`、`suspended`、`archived` 和 `deleted`。暂停组织会拒绝新工作，但允许获授权管理员访问数据和审计。删除组织是受控流程，必须先检查保留策略和法律保全，再执行不可逆删除。

-----

<a id="protocol-requirements"></a>
## 协议要求

身份服务必须提供语言无关的账号认证、注册策略、邀请、组织创建、成员变更、组织单元分配、角色绑定、套餐权益、Runtime 注册、心跳和撤销操作。每个操作都必须从认证凭据推导租户作用域，并在服务边界验证不透明 ID。

首批线路记录应包含认证操作者、组织上下文、成员修订、策略修订、Runtime 身份、请求追踪和有副作用操作的幂等键。授权失败应指出缺失的组织、成员、角色、作用域或权益，但不能泄露其他租户是否存在。

-----

<a id="initial-delivery"></a>
## 首期交付

按以下顺序实现共享模型：

1. 账号认证、邮箱验证、会话和可配置注册策略。
2. 组织创建、单成员团队引导、邀请和私有化初始化。
3. 成员生命周期、通用组织树和带作用域的 Owner/Administrator/Member 角色。
4. 组织订阅、权益、配额和服务端组织上下文检查。
5. 浏览器与桌面 Runtime 注册、心跳、策略刷新和撤销。
6. 会话、插件、用量和审计记录的组织与操作者归属。
7. OIDC/SAML、SCIM、服务账号和企业目录同步。

验收要求：公有云用户可以创建团队，被邀请用户可以加入组织，私有化部署拒绝创建个人组织，一个账号可以加入多个组织，被撤销的 Runtime 不能执行新的授权操作。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [企业 Agent 平台蓝图](enterprise-agent-platform.zh.md)——运行时、插件、治理和商业架构总览。
- [当前身份包](../../../packages/identity/README.zh.md)——现有 Harness 主目录匿名身份及其限制。
- [API 包组](../../../packages/api/README.zh.md)——当前 Client 到 Host 的能力传输。
- [会话控制器](../../../packages/api/session-controller/README.zh.md)——当前会话归属和 Remote 操作。
- [Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-enterprise-identity-and-organization.zh.md)——决策理由和替代方案。
