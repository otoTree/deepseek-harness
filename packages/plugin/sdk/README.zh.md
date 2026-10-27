---
description: "面向插件作者的安装作用域身份、文本模型、对象、数据库和缓存 API。"
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-sdk

[English](README.md) | 中文

## 概述

`createPluginSdk(transport)` 为一个已激活的插件目标创建 SDK。门面提供当前用户、统一的文本与媒体模型目录、持久对象、受限 SQL、临时缓存，以及可选的 Host 网络、凭据、授权、MCP、Skill 和安装配置操作。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

平台提供安装作用域传输，并将平台 Runtime 和模型 Provider token 保留在 Host。Client 门面不暴露集成密钥。获准的受信任 Host package 可以读取自身集成凭据，且必须避免将其写入日志或模型结果。SDK 调用不能选择其他用户、组织、安装或数据空间，传输释放后拒绝调用。同进程 Node 插件属于受信任代码，不构成沙箱。

<a id="model-experience"></a>
## 模型体验

### SDK 模型调用

#### 模型看到的内容

所选文本模型接收 `models.text()` 或 `models.textStream()` 提供的消息。`models.list({ operation })` 按操作筛选统一目录。媒体消费者使用 `previewTask`、`createTask`、`queryTask` 和 `listTasks` 和游标分页方法 `listTaskPage`；`uploadAsset` 与 `assetAccess` 让参考输入和生成结果始终经过平台授权。请求使用平台模型 ID 和结构化参数。[模型平台参考](../../../docs/developer/model-platform.zh.md) 定义持久化执行、整数人民币价格、条件计费和交付状态。

#### Token 影响

文本 token 用量和最终人民币费用归属于当前账号、组织、安装和持久化调用 ID。流式接口在中转消费完成后返回统一文本增量及用量。当前媒体任务检查接纳资格，并在结算后完整扣款。报价为预估；供应商用量不明需要核对。`cancelTask` 与 `retryTaskSave` 保留原生成和计费身份。

#### KV Cache 影响

SDK 不控制模型网关的 KV 缓存，缓存行为由所选模型网关决定。



<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 不提供通用调度器或 Cloud target API。媒体执行需要启用的平台操作配置和 `models.media` 权限。

<a id="dev-note"></a>
### 开发备注

None.

**运行时不变量：** 不发布运行时不变量伴随模块。门面将持久化与授权委托给传输层，只持有自身激活生命周期。
