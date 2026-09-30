---
description: "用于验证企业插件 SDK 首版全部能力的 Host 与 Client 参考插件。"
kind: "package-reference"
---

# 企业插件验收样例

[English](README.md) | 中文

## 概述

这是一个标准 Cordis 插件源码样例，用于集成测试以及本目录的两个不可变清单。Host 贡献通过注入的 SDK 调用身份、文本模型、对象、受限数据库和缓存；Client 贡献向页面适配器提供相同的状态数据，但不会接收凭据。

`manifest-v1.json` 和 `manifest-v2.json` 使用同一插件身份。第二版增加数据库事务权限和一次迁移，用于验证权限确认、迁移和数据保留。

运行 `pnpm --filter @deepseek-ai/dsh-plugin-acceptance build` 会编译两个 target，并在 `dist/` 中生成两个 `.dsh-plugin.zip` 文件。Client 产物使用标准模块表 bundle 格式，并注册每份清单声明的 `moduleId`。打包过程记录当前仓库 lockfile digest；`test:package` 会重新解析两个归档并检查每项完整性记录。

## 目录

- [模型体验](#model-experience)
- [已知限制和延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="dev-note"></a>
### 开发备注

清单作为不可变版本输入使用；发布后不要修改版本内容。

<a id="model-experience"></a>
## 模型体验

### SDK 模型调用

#### 模型看到的内容

选定的文本模型会收到验收探针通过 `models.text()` 提供的消息。Host 贡献通过标准工具服务注册 `enterprise_plugin_acceptance`。工具返回的模型文本由现有 `tool/call` 和 `tool/result` Session 事件持久化，并在下一次 Agent 模型请求前由 Session 投影重建。

#### Token 影响

输入和输出 token 会归属当前使用者、组织、安装和模型调用。

#### KV Cache 影响

样例不控制供应商 KV 缓存；缓存行为由所选模型网关决定。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和延期工作

- 样例不提供后台任务、Cloud target 或图片/视频能力。
