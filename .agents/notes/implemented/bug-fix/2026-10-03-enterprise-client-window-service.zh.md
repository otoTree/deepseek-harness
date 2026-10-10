# Agent Note: Enterprise Client target 获得窗口能力服务

Status: implemented

[English](2026-10-03-enterprise-client-window-service.md) | 中文

## 问题

Enterprise Client target 可以声明 `clientWindow`，但浏览器 target 协调器挂载它们时只提供了 `pluginSdk`。因此 Rail contribution 可以正常渲染，却会在点击时因为注入的窗口能力没有可调用的 `open` 方法而失败。共享的 target 挂载辅助函数还让 SDK 与窗口服务使用同一个 Cordis isolation label；两项服务同时提供时会发生冲突。

## 决策

Enterprise Client 协调器从 target 已有的认证传输创建受限窗口服务，并把它传给 `mountPluginTarget`。挂载辅助函数为 `pluginSdk` 与 `clientWindow` 分配独立的 isolation label，使两项服务可以同时提供给同一个 target，而不会共享 service store key。窗口操作仍然经过传输，并且只允许 manifest 声明的 contribution。

独立窗口 URL 现在仍会进入 Client target 启动路径，但会跳过主应用 renderer。因此 window contribution 可以用自己的 surface 替换挂载点，而不是显示第二份 DSH 外壳。

## 后果

声明 `clientWindow` 的 Client target 现在会收到与 Host 所有窗口 registry 相同的 open、close、focus 和 list 服务。不请求此能力的 target 仍保持原有的 SDK-only 组合。服务仍限定在一个 activation 内，并随 target 一起释放。

## 测试

Enterprise Client runtime 测试挂载一个调用 `ctx.clientWindow.open()` 的 target，并验证该操作经过 plugin SDK relay。Plugin runtime 测试挂载同时注入两项服务的 target，并验证两项服务都与父 context 隔离。

## 考虑过的替代方案

**让插件 bundle 直接调用窗口平台。** 否决，因为原生窗口创建属于 Host 所有的 registry，插件代码不应获得 URL、原生句柄或 broker 凭据。

**保留一个共享 isolation label，并在同一个 fiber 中提供两项服务。** 否决，因为 Cordis 使用 label 作为 service-store key；不同服务会互相覆盖，而不是共享 target 生命周期。
