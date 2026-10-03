---
description: "安装和释放企业插件 SDK 的 Cordis 激活辅助函数。"
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-runtime

[English](README.md) | 中文

## 概述

`bindPluginSdk` 创建安装作用域 SDK，在释放时取消在途调用并使其失效。`mountPluginTarget` 隔离 SDK service、装载标准 Cordis target，并等待 target 与 provider fiber 停止。`ClientWindowRegistry` 管理声明式窗口定义和临时实例，`createClientWindowService` 只向 Client target 暴露按 contribution ID 执行的打开、关闭、聚焦和列表操作。

## 目录

- [组合](#composition)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="composition"></a>
## 组合

在平台校验包并创建激活 transport 后，于 Host 或 Client target 加载 runtime。异步 disposer 会等待已注册 effect 离开上下文，并使保留的 SDK 句柄失效。`mountPluginTarget` 接受激活 signal；取消时先请求释放 target 和 provider 再拒绝，非协作 target 可能稍后才完成释放。

Host registry 为每个规范化的 window contribution 注册一次定义。`singleton` contribution 会聚焦已有实例，`many` contribution 会创建新实例。registry 不接受插件传入的 URL、脚本路径或原生窗口参数。关闭或释放一个实例只移除该实例；插件禁用或升级时使用 `closePlugin` 排空该插件的全部实例。

<a id="model-experience"></a>
## 模型体验

### 运行时模型上下文

#### 模型看到的内容

运行时不添加提示词，只暴露插件通过 SDK transport 提供的消息。

#### Token 影响

绑定的 transport 将模型用量关联到当前安装和调用方。

#### KV Cache 影响

运行时不选择或保留模型提供方的 KV 缓存条目。

runtime 不增加模型提示词，只绑定由企业网关记录模型调用的 SDK transport。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 运行时采用协作式受信任模型，不隔离插件与 Node.js 或同进程中的其他插件。

<a id="dev-note"></a>
### 开发备注

None.
