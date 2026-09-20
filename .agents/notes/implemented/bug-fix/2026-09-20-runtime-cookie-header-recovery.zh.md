# Agent Note: Runtime Cookie 请求头恢复

Status: implemented

[English](2026-09-20-runtime-cookie-header-recovery.md) | 中文

## 问题

每个随机回环端口都会生成一个不同的 authority-bound 浏览器 cookie。浏览器打开多个 Runtime 代次后，会把所有尚未过期的 cookie 发送给下一个回环端口，Node 在应用认证前拒绝插件 bundle 请求并返回 HTTP 431。

## 决策

宿主 WebServer 与原生桌面账号入口服务器都默认接受 64 KiB 的请求头预算。成功完成进程令牌交换后，认证层会让浏览器提交的所有旧 `dsh-auth-*` cookie 失效；账号入口在返回 HTML 页面时也会让这些 cookie 失效，同时保留当前 authority-bound cookie。清理使用重复的 `Set-Cookie` 响应头，并限制在宿主专用的 cookie 前缀内。

## 考虑过的替代方案

**保留 Node 默认请求头上限。** 请求会在认证层有机会清理旧 cookie 前被拒绝。

**移除 cookie 的 authority 绑定。** 这可以减少累积，但会削弱现有机制对一个 Runtime cookie 被提交给另一个回环 authority 的防护。

**只在桌面宿主清理 cookie。** Web 认证层也服务 CLI 与浏览器启动流程，因此清理应放在共享的令牌交换处；桌面入口仍需提高请求头预算并提前清理，才能打开该页面。

## 后果

用户下次打开新的账号或 token URL 时，已有的旧 cookie 会被清除。更大的请求头预算仅适用于本地服务器，不会授予请求权限；现有 Host、Origin、token、签名和 authority 检查保持不变。

## 验证

WebServer 与账号入口测试接受 20 KiB 的旧 cookie 请求头，BrowserAuth 测试验证重复的旧 cookie 失效；WebServer、BrowserAuth 与账号入口聚焦测试套件均通过。
