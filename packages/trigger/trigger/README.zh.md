# @deepseek-ai/dsh-trigger

English | [中文](README.md)

## Summary

`@deepseek-ai/dsh-trigger` 提供受管桌面 Trigger 能力，统一处理定时器、本地文件和云盘文件事件，按来源应用投递策略，持久化不可变规则快照，并把批次投递到已有会话或幂等创建的新会话。

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

Runtime 负责监听器、定时器、云盘游标、队列状态和权限检查。文件来源在启动时建立基线并使用稳定去抖窗口；定时事件始终作为独立队列项。Runtime 停止期间不补放文件或云盘变化，恢复时把无法确认的投递标记为 `unknown`，供人工重试。

## Use this package

在受管桌面组合中加载 `TriggerService`，并在企业 API 提供版本游标时注册云盘 Provider。服务负责来源生命周期、本地持久化、批处理、目标串行化和清理。

## Dev Note

触发器设计和企业客户端接线记录在[Agent Note](../../../.agents/notes/implemented/feature/2026-09-24-enterprise-triggers.zh.md)。

## Model Experience

### Trigger delivery

#### What the model sees

每个已接受批次产生一条包含规则模板和结构化资源摘要的指令。

#### Token effect

渲染后的指令和资源摘要会消耗目标 Agent 请求的输入 token。

#### KV Cache effect

触发器指令是普通排队提示，不改变 Provider 缓存策略。

##### Trigger request

```markdown
Trigger batch: {{batch.id}}
Resources: {{resources.json}}
```

## Known Limitations and Deferred Work

- Runtime 重启后跳过离线期间的本地和云盘变化。
- 工作流动作、共享执行身份和显式 fork/template 上下文继承仍待实现。
