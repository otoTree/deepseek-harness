# Agent Note: 分离企业媒体输入与响应限制

Status: implemented

[English](2026-09-22-enterprise-media-input-limit.md) | 中文

## Problem

企业桌面网关读取视频、音频和文档附件时错误地使用了模型响应字节上限。因此，媒体文件即使低于模型和 API 请求限制，也可能先因更小的响应限制在本地失败。

## Decision

企业网关分别使用 `maxMediaBytes` 和 `maxResponseChars`。生成的桌面 profile 允许媒体达到平台校验的 512 MiB 上限，同时保留 16 MiB 的响应安全上限。媒体读取使用 `maxMediaBytes`；模型流式输出和网关元数据继续使用 `maxResponseChars`。

## Alternatives considered

**为所有 payload 提高 `maxResponseChars`：** 放弃，因为模型响应和元数据会失去独立的内存上限。

**移除桌面媒体保护：** 放弃，因为客户端在构造提供方上传请求前仍需要有界读取。

## Consequences

模型目录和 API 请求体限制仍然是提供方调用的最终限制。桌面 profile 不会再仅因为附件大于响应上限而拒绝附件。部署仍须配置所选模型的单文件和请求限制，并确保 API 请求体上限足以容纳目标媒体。

## Testing

Profile 测试会检查两个限制分别生成，网关 fixture 提供新的媒体设置。桌面提供方类型检查和聚焦测试覆盖了更新后的配置约定。
