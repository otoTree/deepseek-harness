# Agent Note: 企业设置失败时保留页面上下文

Status: implemented

[English](2026-10-22-desktop-heartbeat-transient-failures.md) | 中文

## Problem

平铺的设置导航隐藏任务分组，而以错误替换失败页面会移除标题与恢复上下文。

## Decision

[设置外壳](../../../../packages/client/ui-settings-general/src/client/SettingsRoot.tsx)将偏好设置、账号管理和扩展分组。企业页面在读取与失败期间保留标题和说明，并提供本地化重试指引。注册方通过现有插槽选项提供图标。[本地会话决策](../architecture/2026-10-22-local-desktop-sessions.zh.md)替代本记录的原生心跳处理：本地进程生命周期独立于云端授权。

## Alternatives considered

**用通用错误替换页面。** 用户会失去页面身份，无法判断重试影响哪项操作。

## Consequences

云端失败后，所选设置页面仍可见且可重试，不会关闭本地工作区。

## Verification

[录制会话浏览器用例](../../../../snapshots/web/enterprise-settings/snapshot.yml)验证分组导航、不可用读取、重试恢复和窄屏布局。
