---
description: "企业 Cordis 插件使用的共享协议、作者 SDK 和运行时绑定。"
kind: "package-group"
---

# 插件包组

[English](README.md) | 中文

## Summary

插件包组定义企业插件在平台安装和激活后的使用契约。`plugin-protocol` 管理清单和能力类型，`plugin-sdk` 创建安装作用域门面，`plugin-runtime` 将门面绑定到 Cordis 激活生命周期。

更完整的插件激活模型见[扩展子系统页面](../../docs/subsystems/extensions.zh.md)。

## Packages

| Package | Role |
|---|---|
| [`protocol/`](protocol/README.zh.md) | 清单、身份、生命周期、能力和错误契约 |
| [`sdk/`](sdk/README.zh.md) | 身份、模型、对象、数据库和缓存门面 |
| [`runtime/`](runtime/README.zh.md) | Host/Client 绑定和 disposer 辅助函数 |

## Known Limitations and Deferred Work

首版不提供后台任务 API、Cloud target 运行时或图片/视频生成门面。插件仍以受信任的 Cordis 代码运行在宿主进程中。

## Dev Note

None.
