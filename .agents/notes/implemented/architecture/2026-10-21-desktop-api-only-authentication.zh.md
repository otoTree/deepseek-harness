# Agent Note: 桌面认证仅依赖 API

Status: implemented

[English](2026-10-21-desktop-api-only-authentication.md) | 中文

## 问题

随包桌面账号页面无需托管的管理界面，但单独配置 Portal 来源会把原生认证与另一个客户端的部署设置耦合。只配置 Admin 和 Portal 来源时，API 受 cookie 保护的组织写操作还会拒绝自身来源。

## 决策

桌面端只读取和嵌入 `ENTERPRISE_API_URL`。[LocalAccount](../../../../apps/electrobun/src/local-account.ts) 将账号请求发送到该 API，并以 API 来源作为 `Origin`；它不会连接 Admin 或 Portal。原生 PKCE 授权通过已认证的 API 会话直接接收 challenge、state 和 callback 字段，不构造 Portal URL。SSO 使用相同来源发起认证，在系统浏览器打开身份提供方，再通过 API 和校验 state 的回环回调返回。

[API 来源白名单](../../../../apps/api/src/config.ts) 在明确配置的 Admin 和 Portal 来源之外，加入配置的 API 来源。Better Auth 和受 cookie 保护的写操作共用此列表。凭据、一次性授权码、PKCE 校验、回环回调校验以及拒绝未知来源仍然是必要条件。现有 API 部署在发布此行为或显式将 Portal 来源配置为 API 来源后，才接受该桌面端。

[安装包决策](2026-10-19-local-desktop-installer-protection.zh.md) 负责部署地址固定及资源保护，仍保持有效；本决策负责原生账号来源和移除桌面端的 Portal 设置。管理及邀请服务保留各自的部署设置。

## 考虑过的替代方案

**在原生请求中复用 Admin 来源。** 这要求桌面发布人员知道第二个客户端地址，并把原生请求视为管理浏览器流量。

**移除来源校验或接受所有来源。** 这会削弱使用 cookie 认证的写操作；配置的 API 来源只增加一个精确条目。

## 影响

Admin 和 Portal 不可用时，随包桌面账号界面仍可注册、登录及授权团队。API 以及所配置的 SSO 身份提供方仍必须可访问。这不会修复 DNS、TLS 或云入口拦截。[启动测试](../../../../apps/api/tests/container-initialization.test.ts) 中的隔离 PostgreSQL 验收用例使用不可用的管理来源，对真实 API 执行原生注册、登录和进入团队；所属的[请求预期输出](../../../../apps/api/tests/expected/desktop-account.json) 只保留方法、URL、来源、状态和原生完成标记。同一用例验证认证和组织写操作均拒绝未知来源。原生认证测试保留回调校验及取消覆盖；包内 profile 检查与生产登录验证仍各自独立。
