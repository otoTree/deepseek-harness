# Agent Note: Enterprise multimodal model capability metadata

Status: implemented

[English](2026-09-17-enterprise-multimodal-model-capabilities.md) | 中文

## Problem

企业模型目录此前只有布尔型图片标记，而共享 LLM seam 已经具备协议和输入模态元数据，因此平台模型无法声明自身协议，也无法在不依赖客户端特例的情况下作为图片模型路由。

## Decision

企业模型记录现在保存协议、声明的输入模态和文件输入策略，并提供向后兼容的默认值。平台与租户模型契约公开这些字段，Admin 模型编辑器负责配置。企业桌面网关继续通过现有 LLM adapter 插件消费目录，只保留共享词汇当前支持的模态，并通过附件服务读取持久化图片引用，再将经过只读校验的字节编码为 OpenAI `data:` URL。API 中继继续透明转发生成的请求，并显式拒绝当前尚不能流式解析和计量的协议。Ark 专用 Files API、视频、音频、文档投影和签名对象存储 URL 延后到独立的 provider capability，不进入 Agent Loop 或提供方无关的附件服务。

## Alternatives considered

**在 Agent Loop 或会话代码中增加 Ark 分支。** 不采用，因为协议选择和媒体投影属于 LLM adapter 与附件 seam；修改 loop 会耦合所有提供方并要求新的持久化表示。

**把永久对象存储 URL 直接发送给模型。** 不采用，因为 bearer URL 可能在授权失效后仍可访问并泄露存储拓扑；当前桌面路径读取已验证的附件字节，并生成请求范围内的 Data URL。

**让 API 重写所有多模态协议。** 不采用，因为中继的职责是协议透明，不应变成第二套提供方实现；在对应 adapter 和用量观察器就绪前，不支持的协议会明确失败。

## Consequences

通过 `openai-completions`、文本输入和无 provider Files API 的默认值，现有客户端保持兼容。Admin 可以发布未来路由所需的能力元数据，企业图片路由现在复用共享附件生命周期和 OpenAI 兼容的内联图片表示。Data URL 会增加请求体积，但受现有附件限制约束；诊断信息不会包含图片字节或凭据。视频、音频、文档、提供方文件生命周期和签名 URL 投影需要后续 capability seam。

## Testing

企业 API 与桌面端类型检查通过。API 契约和集成测试覆盖旧模型请求、能力字段默认值及新迁移。桌面网关测试验证持久化图片字节会变为 `data:image/...;base64,...` 内容项，并且现有中继、流式、取消和用量测试保持通过。
