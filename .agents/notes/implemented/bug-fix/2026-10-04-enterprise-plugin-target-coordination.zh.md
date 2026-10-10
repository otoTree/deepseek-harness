# Agent Note：企业插件 target 行跟随当前安装修订

Status: implemented

English | [中文](2026-10-04-enterprise-plugin-target-coordination.md)

## Problem

旧 release 或权限修订的设备 target 行和 activation lease 可能在 reconcile 时仍然可见。桌面 runtime 会根据陈旧行作出生命周期判断，返回的 activation id 也可能与展示的 target 使用不同 release。窗口注册发生在失败上报范围之外时，注册异常还会让 target 永久停留在“准备中”。

## Decision

设备 target API 只返回 release 和权限修订都与 installation 一致的行，并且只把相同 release 与修订的 activation id 绑定到返回行。桌面 runtime 在判断安装是否存在启用 target 时使用相同过滤。Client 窗口注册放入受保护的 activation 清理范围，重复或无效定义会报告 `failed` 并撤销 lease。租约签发后，撤销和失败上报使用独立的有界清理 signal，因此新一轮准备不会取消旧租约的清理。

## Alternatives considered

**信任最新的设备 target 行而不匹配 release。** 否决，因为旧行可能让桌面 runtime 跳过已安装 release 的激活，或把错误的 activation lease 关联到当前安装。

**让窗口注册在 activation 清理之外失败。** 否决，因为注册错误会在本地 target 已经失败后仍留下服务端 lease 和活动 target 行。

## Consequences

旧设备行不会再延迟或提前当前 target 的激活。无法注册窗口 contribution 的 target 会进入明确的失败终态，不会无限停留在准备阶段。准备过程被中断时，已签发的 activation 仍会被撤销。

## Testing

企业 runtime 测试覆盖旧 release 的陈旧设备行、被新一轮 reconcile 中断时的租约清理，并保留 activation 超时和失败上报路径。针对修改范围运行 API 与 package 类型检查。
