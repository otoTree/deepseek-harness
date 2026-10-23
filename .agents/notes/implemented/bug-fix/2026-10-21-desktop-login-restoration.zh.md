# Agent Note: 应用退出后恢复桌面登录

Status: implemented

[English](2026-10-21-desktop-login-restoration.md) | 中文

## Problem

新的原生进程既没有已保存凭据的定位信息，也没有 API 账号 cookie。始终打开登录页会忽略已有的受保护凭据。

## Decision

[DesktopSession](../../../../apps/electrobun/src/desktop-session.ts)在系统凭据库中按部署来源哈希保存所选定位记录。普通停止保留两项记录。启动不联系 API 即可恢复账号。即使已停止，退出登录也会移除两项记录，同时保留本地文件。API 账号 cookie 仅保存在内存中。[本地会话决策](../architecture/2026-10-22-local-desktop-sessions.zh.md)替代了以在线续期作为启动前提的要求。

## Alternatives considered

**持久化账号 cookie 并在启动时重复 PKCE。** 已有受保护凭据时，这会额外保存秘密并创建新的登录身份。

## Consequences

重新打开恢复账号隔离的本地存储。云端到期要求云端操作重新登录，而网络故障不阻止本地恢复。

## Verification

真实进程[桌面测试](../../../../apps/electrobun/tests/desktop-session.test.ts)验证离线恢复、稳定身份、停止后退出登录、部署隔离及凭据库失败清理。
