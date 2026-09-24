# Agent Note: 企业触发器能力

Status: implemented

English | [中文](2026-09-24-enterprise-triggers.md)

## Problem

企业桌面需要文件和定时自动化，并能投递到稳定的已有会话或新建会话，同时保留事件身份、队列顺序和离线行为。

## Decision

Trigger 能力将事件来源与投递目标分离。定时事件使用 `queue-each`，本地文件和云盘文件使用稳定去抖和批量窗口。批次保存规则版本和资源版本历史；已有会话通过 Session Controller 队列投递；新会话使用 `(ruleId, batchId)` 生成幂等身份。凭据、监听器、云盘游标和 Agent 创建均由 Host 持有，浏览器只调用企业 RPC。

## Alternatives considered

**按时间合并所有来源。** 否决，因为定时事件必须保持独立且有序。

**重放离线期间积累的文件和云盘事件。** 否决，因为受管桌面没有权威的本地事件日志，重放可能重复外部变化；重启时建立新基线并显示跳过状态。

**把会话最后一条回答当作触发器完成。** 否决，因为 `prompt` 只确认 inbox 接受，不代表 Agent 轮次结束；触发器因此区分 delivered、processing、failed 和 unknown。

## Consequences

批次保存规则快照，因此规则更新不会改变已排队工作。已有会话按目标串行，不同新会话可受限并行。权限和目标失败保持可见并支持人工重试。企业客户端增加侧边栏入口和独立 Surface，但不向 WebView 暴露 Runtime 能力。

企业桌面现在通过侧边栏和独立主 Surface 暴露 Trigger 能力。Runtime 在本地持久化带版本规则、来源事件、批次和 Provider 状态。定时规则使用 `queue-each`；文件规则使用稳定去抖和批量窗口，并保留最新资源版本及被合并的版本身份。

已有会话投递使用持久化 Session ID，并通过 Session Controller 队列处理，不打断正在运行的 Agent 轮次。新会话投递根据 `(ruleId, batchId)` 生成确定性会话身份，重试时复用同一会话。只有会话 inbox 接受消息后才确认投递；Runtime 恢复时无法确认的进行中批次标记为 `unknown`，仍可人工重试。

本地文件和云盘 Provider 在 Runtime 重启后建立新基线。云盘事件使用版本提交和游标读取；桌面端不维护离线云盘事件积压。企业客户端将凭据、文件监听器和 Agent 创建保留在 Host，仅通过 RPC 向浏览器 Surface 提供规则和历史视图。

验证命令包括 Trigger、企业客户端 Host/Client、API 的 TypeScript 检查，以及 `git diff --check`。
