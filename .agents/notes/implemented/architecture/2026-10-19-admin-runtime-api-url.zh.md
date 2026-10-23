# Agent Note: Admin API 地址使用运行时配置

Status: implemented

[English](2026-10-19-admin-runtime-api-url.md) | 中文

## Problem

将企业 API 地址内嵌到 Admin JavaScript 包中，会导致每个部署环境都需要单独构建镜像。运维需要复用同一份 Admin 镜像，并在部署时调整公开 API 地址。

## Decision

Admin 服务端通过 Next.js `connection()` 将根布局切换为请求时渲染后，读取 `ADMIN_API_URL`。它校验 HTTP(S) 地址，默认使用开发环境的本地 API，并仅将该公开地址写入由 React 转义的 meta 元素。JSON 和二进制请求读取 meta 值，同时保留携带凭据的请求和回环 Cookie 主机名对齐。浏览器配置缺失或无效时，在发送凭据前失败。

本决策取代[容器发布决策](2026-10-17-enterprise-container-images.zh.md)中的 API 地址构建参数；原记录继续负责独立镜像、镜像仓库发布和受支持的 API 启动器。静态构建变体仍由[客户端构建环境决策](2026-08-18-client-build-environment.zh.md)管理。

## Alternatives considered

**在构建时内嵌 `NEXT_PUBLIC_*`。** Next.js 将这些值替换进客户端 JavaScript，使部署地址与发布的镜像耦合。

**在容器启动时重写已编译 JavaScript。** 文本替换依赖打包输出和转义规则；请求时渲染可以显式暴露一个公开值，无需修改产物。

## Consequences

发布镜像无需 API 地址。修改部署变量后，需要重启 Admin 服务并刷新页面；浏览器必须能访问所配置的地址，API 的浏览器来源设置必须允许 Admin 来源。动态页面渲染需要运行 Next.js 服务，并放弃静态 HTML 缓存。API 和模型凭据不会进入 meta 配置。验证覆盖 JSON 和二进制请求目标、无效配置拒绝，以及同一次生产构建使用不同运行时值提供页面。
