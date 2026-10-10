# Agent Note: 独立插件窗口使用插件自有外壳

Status: implemented

[English](2026-10-04-independent-plugin-window-shell.md) | 中文

## Problem

独立 Client 窗口复用了 Web 应用的文档和全局外壳样式。URL 虽然标识了插件窗口，但父窗口的导航、会话布局和主题展示仍然包围着插件 contribution。

## Decision

原生窗口 broker 为每个声明式插件窗口添加 `dshPluginWindow=1`。Web 启动内核要求该标记与声明式插件身份和实例字段同时存在，清空启动文档，标记文档为插件窗口内容，并把渲染交给已挂载的 Client target。插件窗口内容在挂载后拥有自己的标题和局部展示样式。

## Alternatives considered

**保留父 Web 外壳并隐藏选定面板。** 这样会让插件窗口继续耦合父窗口布局和样式，父外壳的新增变化也会泄漏到独立 surface。

**为每个插件创建第二个应用入口。** 这样会复制模块启动和 Client target 生命周期，并绕过现有的 manifest 作用域窗口服务。

## Consequences

独立窗口仍使用共享的认证 Web runtime 和 Client target 激活流程，但插件 contribution 渲染前会清空其文档。插件必须为声明的窗口 surface 提供视觉外壳；Host 只提供窗口 frame 和认证页面传输。
