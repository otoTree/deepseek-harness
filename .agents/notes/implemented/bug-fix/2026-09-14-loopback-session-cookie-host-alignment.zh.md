# Agent Note: 对齐回环 API 与浏览器主机以保持会话

Status: implemented

[English](2026-09-14-loopback-session-cookie-host-alignment.md) | 中文

## 问题

企业管理页面可能通过 `localhost` 打开，而构建时的 API 地址使用 `127.0.0.1`。浏览器会将这两个回环名称视为不同的 Cookie 主机。Better Auth 登录成功后，后续 `/v1/me` 请求可能因此没有携带会话 Cookie，控制台最终显示笼统的 401。

## 决策

管理端客户端读取当前浏览器主机名；当页面和配置的 API 都使用回环名称时，请求会切换到匹配的 `localhost` 或 `127.0.0.1` 主机。公网 API 地址保持不变。带凭据的请求继续使用 `credentials: 'include'`，API 的 CORS 和认证来源继续同时接受两个回环别名。

## 备选方案

**要求用户严格使用启动日志打印的回环主机名。** 不予采用，因为书签和浏览器地址补全经常在 `localhost` 与 `127.0.0.1` 之间切换，而两个名称指向同一本地服务。

**使用 `SameSite=None` 的跨站 Cookie。** 不予采用，因为浏览器要求该模式同时使用 `Secure`，而默认 HTTP 开发栈无法满足这一要求。

**让 Next.js 服务端代理所有 API 请求。** 不予采用，因为这会为现有客户端请求增加第二套带凭据的传输和部署路径；在客户端选择匹配的回环主机即可解决问题。

## 影响

无论用户输入哪个受支持的回环别名，本地开发会话都保持在同一个 Cookie 主机上。部署到公网的来源仍使用配置的 API 地址。该调整不会改变认证权限，也不会放行非回环来源。

## 测试

`apps/admin/tests/client-api.test.ts` 覆盖两个回环方向，并验证公网 API 地址保持不变。管理端和 API 的 TypeScript 检查均通过。
