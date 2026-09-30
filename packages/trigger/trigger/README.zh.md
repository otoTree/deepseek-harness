---
description: "受管定时器、本地文件和云盘文件触发器，为会话提供持久化投递。"
kind: "package-reference"
---

# @deepseek-ai/dsh-trigger

English | [中文](README.md)

## 概述

`@deepseek-ai/dsh-trigger` 提供受管桌面 Trigger 能力，统一处理定时器、本地文件和云盘文件事件，按来源应用投递策略，持久化不可变规则快照，并把批次投递到已有会话或幂等创建的新会话。

## 目录

- [使用本包](#use-this-package)
- [实现方式](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

Runtime 负责监听器、定时器、云盘游标、队列状态和权限检查。文件来源在启动时建立基线并使用稳定去抖窗口；定时事件始终作为独立队列项。Runtime 停止期间不补放文件或云盘变化，恢复时把无法确认的投递标记为 `unknown`，供人工重试。

<a id="use-this-package"></a>
## 使用本包

在受管桌面组合中加载 `TriggerService`，并在企业 API 提供版本游标时注册云盘 Provider。服务负责来源生命周期、本地持久化、批处理、目标串行化和清理。

<a id="understand-the-implementation"></a>
## 实现方式

服务把来源 Provider、不可变规则快照、批处理和 Session 投递分开。Runtime 启动时为本地来源建立基线，云盘来源推进游标；投递目标保存为事实，因此恢复时可以报告 `unknown`，不会重复投递已经可能送达的事件。

| 文件 | 作用 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Trigger 服务、来源接口和持久状态。 |
| [`tests/`](tests/) | Provider 与投递的确定性测试。 |

<a id="further-exploration"></a>
## 延伸阅读

企业桌面组合提供授权目录、云盘游标和 Session 投递目标。集成记录见 [Agent Note](../../../.agents/notes/implemented/feature/2026-09-24-enterprise-triggers.zh.md)。

<a id="dev-note"></a>
## 开发备注

触发器设计和企业客户端接线记录在[Agent Note](../../../.agents/notes/implemented/feature/2026-09-24-enterprise-triggers.zh.md)。

<a id="model-experience"></a>
## 模型体验

### 触发器投递

#### 模型看到的内容

每个已接受批次产生一条包含渲染后规则模板和结构化资源摘要的普通用户提示词。Session 将该消息排入队列并启动一轮 Agent；该提示词不会修改系统提示词。

#### Token 影响

渲染后的提示词和资源摘要会消耗目标 Agent 请求的输入 token。

#### KV Cache 影响

触发器提示词是普通的排队用户消息，不改变 Provider 缓存策略。

##### 触发器请求

```markdown
Trigger batch: {{batch.id}}
Resources: {{resources.json}}
```

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- Runtime 重启后跳过离线期间的本地和云盘变化。
- 工作流动作、共享执行身份和显式 fork/template 上下文继承仍待实现。
