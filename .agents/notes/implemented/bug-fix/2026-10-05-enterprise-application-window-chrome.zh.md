# Agent Note: 企业窗口使用应用自绘标题栏

Status: implemented

[English](2026-10-05-enterprise-application-window-chrome.md) | 中文

## Problem

不同桌面环境中的原生标题栏关闭行为并不一致，可能绕过企业窗口和独立插件窗口需要的生命周期处理。独立窗口桥接安装完成前也必须保持控件不可用。

## Decision

受信任的工作区窗口和声明式独立插件窗口隐藏原生标题栏，渲染共享的 Web 自绘标题栏。工作区使用 `dshWindowChrome=1` 标记；插件窗口使用已有的 `dshPluginWindow=1` 标记和窄权限 `__dshWindowChrome` 桥接。三个控件只调用原生关闭、最小化和最大化／还原操作，并在对应桥接 ready 事件前保持禁用。

账号窗口加载未认证页面且不接收任一桥接，因此继续使用系统标题栏。

## Alternatives considered

**保留系统标题栏。** 这样可以使用平台默认行为，但关闭和窗口状态操作会脱离企业 Host 生命周期，并且在不同桌面环境中表现不一致。

**向插件页面暴露完整原生桥接。** 这样会让独立加载的插件内容调用无关的 Host 能力，而不是只获得所需的三个窗口操作。

## Consequences

窗口生命周期操作现在通过 Host 所有的显式 RPC handler 传递。工作区和插件窗口共用一套标题栏实现，不受信任的账号页面继续使用平台窗口框架。
