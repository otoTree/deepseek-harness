# Agent Note: Workbench 开始标签与 Runtime 所有权

Status: implemented

[English](2026-10-02-workbench-start-and-runtime.md) | 中文

## Problem

Workbench 通过浮层菜单提供面板入口，原生 WebView 可能覆盖该菜单；普通聊天 Session 也不能稳定提供终端、浏览器和文件能力。

## Decision

Workbench 保留永久存在的 `start` 标签和面板定义注册表。内建定义与插件定义统一投影到开始页，点击入口会激活或恢复对应标签。包括 `results` 在内的可关闭标签关闭后回到开始页；插件 dispose 会移除定义和 keyed body。

每个聊天 Workbench 都使用聊天 `SessionId` 作为唯一归属 key 和 Remote 地址。没有选中聊天时打开 Workbench 会先创建并选中一个真实空白聊天 Session，发送首条消息时继续使用该 identity。Host 可以为该归属单飞创建一个隐藏 Runtime Session 作为能力资源，并在内部把聊天地址对应的终端与浏览器操作解析到隐藏资源。UI 状态、文件与成果仍保存在聊天 Session 上。进程稳定的 Session 分类器会从 live 与持久化的列表和搜索投影中过滤生成的资源 namespace。释放 Runtime 会调用 `AgentHandle.dispose()`；分类器继续把持久化资源 identity 保持为内部状态。

原生浏览器视图在非活动或面板 dispose 时保持隐藏并启用指针穿透。标签切换和 readiness 事件都会重新应用可见性；不能用 CSS z-index 覆盖原生合成层。

## Alternatives considered

- **保留添加面板浮层：** 原生 WebView 合成层可能无视 CSS z-index 位于 DOM 之上，浮层无法保证导航控件可操作。
- **使用聊天 Agent 作为能力资源：** 空白聊天和未挂载标准 preset 的 Session 仍会缺少终端能力，切换聊天也可能复用进程状态。聊天 Session 仍是归属 key，但能力资源隔离在隐藏 Runtime Session 中。
- **把 Runtime Session 注册为普通聊天：** Runtime identity 会污染导航和搜索，并可能被用户直接打开。

## Consequences

开始页成为稳定导航入口，成果数据仍保存在聊天 Session 中。Runtime 资源按聊天隔离，Workbench owner 切换或 dispose 时必须释放。Runtime 元数据由进程管理，不成为模型可见工具输入。

## Verification

Workbench 客户端和 Host Controller focused 测试通过；Web 恢复 replay 会通过隐藏 Runtime Session 创建替代浏览器与终端资源。Workbench 客户端和 Controller 两个 TypeScript face 检查通过。真实模型 Web 与 Electrobun 录制仍依赖开发 API 和模型凭据。
