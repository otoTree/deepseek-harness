---
description: "面向适配器作者的提供方无关 Files API 上传协调：复用、取消和刷新提供方文件引用，同时不持久化提供方标识符。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-files

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-llm-files` 让 LLM 适配器只上传一次持久附件字节，并在并发请求和后续请求间复用提供方文件引用。缓存键包含提供方、账号、模型和内容摘要，而提供方文件标识符只存在于进程内，绝不进入 Session 数据。调用方为每次解析提供所有随部署变化的过期、刷新、超时、重试和配额恢复设置。本包只协调生命周期；提供方插件仍拥有凭据、协议请求、响应校验和上游删除。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本服务与注册提供方实现的 LLM 适配器一起挂载，然后在序列化提供方原生媒体时调用 `ctx.llmFiles.ensureUploaded()`。

### 何时选择

当提供方接受文件标识符，而且重复模型请求应共享一个有界上传生命周期时选择本包。当所选模型明确声明内联 Base64 策略时，仍应由适配器执行序列化；不要把本缓存用于永久对象存储 URL，也不要把它当作持久附件存储。

### 最小组合

本服务没有配置；提供方插件拥有其设置和注册：

```yaml
- name: '@deepseek-ai/dsh-llm-files'
- name: './gateway-provider.js'
```

企业桌面 profile 从打包后的插件路径挂载第二行；其他适配器在共享服务之后挂载各自的提供方插件。

提供方传入已校验附件及其字节、账号命名空间、所选模型和显式策略。成功结果会报告当前调用方是否拥有这次物理上传，因此用量统计不会重复计算并发等待方。

### 失败与取消

每个等待方可以独立取消。只有全部等待方离开后才会取消共享上传；超时和重试受调用方策略限制；无效字节数或过期元数据会关闭式失败；提供方特定的配额错误可以触发一次有界回收。模型端点拒绝文件标识符后，`invalidate()` 会移除一个精确缓存代次；是否执行有界重传由适配器决定。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

运行时对已校验字节计算摘要，并按提供方、账号、模型和摘要索引一个进程内映射。并发解析共享一个 promise，但只有一个等待方收到 `uploaded: true`；有效映射会立即返回，进入配置刷新余量的条目会被替换。聚合计数器公开上传数、字节数、失败数、刷新数和拒绝字节数，但不公开提供方文件标识符。

不发布运行时 invariant companion；缓存条目、上传、等待方取消和提供方删除均由同一个服务实例拥有，并由其生命周期测试直接观察，因此该包没有可供独立报告器交叉检查的关系。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis 服务、提供方注册表、singleflight 缓存、重试、失效与清理 |
| [`src/types.ts`](src/types.ts) | 品牌标识符、提供方接口、请求策略、结果与指标 |
| [`tests/runtime.spec.ts`](tests/runtime.spec.ts) | 并发、取消、身份、刷新、重试、配额、清理与校验覆盖 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [LLM 服务](../llm/README.zh.md)——提供方无关消息、模型能力和适配器分发。
- [附件服务](../../attachment/attachment/README.zh.md)——持久附件引用和已校验字节读取。
- [LLM 流式子系统](../../../docs/subsystems/llm-streaming.zh.md)——请求组装和流式协议。
- [提供方无关多模态输入](../../../.agents/notes/implemented/architecture/2026-09-17-provider-neutral-multimodal-inputs.zh.md)——已接受的媒体、Files API 与企业网关设计。

-----

<a id="model-experience"></a>
## 模型体验

间接影响：适配器会在模型请求中用临时提供方文件标识符替换持久媒体引用；本包自身不添加提示词文本或 Session 内容。

#### KV Cache 影响

当提供方把文件身份纳入缓存键时，复用同一提供方文件标识符会保留请求中的媒体部分；刷新或失效会改变该后缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制把提供方行为和持久存储保留在可复用上传协调器之外。

- **缓存只存在于进程内**——重启后会重新上传附件，多进程部署不会共享提供方文件标识符。
- **删除取决于提供方**——清理会移除本地条目，但只有已注册提供方实现删除时才会删除上游文件。
- **模型调用恢复由适配器拥有**——`invalidate()` 可供使用，但适配器必须识别过期提供方文件响应，并限制任何重放次数。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
