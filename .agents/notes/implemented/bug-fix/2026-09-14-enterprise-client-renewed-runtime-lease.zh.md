# Agent Note: 企业请求使用服务端授权

Status: implemented

[English](2026-09-14-enterprise-client-renewed-runtime-lease.md) | 中文

## Problem

登录时记录的时间戳无法代表后续服务端续期。根据该快照在本地拒绝请求，会使所有企业设置同时不可用。

## Decision

Host 在云端请求前验证 API 来源、组织 ID、Runtime ID 与凭据存储绑定，不以保存的 `expiresAt` 快照拒绝请求。API 检查当前授权。[桌面本地会话](../architecture/2026-10-22-local-desktop-sessions.zh.md)负责按请求续期和本地生命周期；本记录保留凭据绑定与服务端权威原则。

## Alternatives considered

**每次续期重写凭据。** 这会新增一次状态写入，且可能在服务端提交后失败。

**移除 Host 绑定检查。** 这会允许其他部署或组织的凭据进入生成的 profile。

## Consequences

服务端接受令牌期间，云端页面可用。撤销与到期由 API 拒绝；本地历史仍可读取。

## Verification

Host 测试接受已过期的保存时间戳，并在请求发送前拒绝不匹配的部署。
