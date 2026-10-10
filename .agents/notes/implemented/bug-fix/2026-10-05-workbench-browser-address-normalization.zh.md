# Agent Note: Workbench 浏览器地址规范化

状态：已实现

[English](2026-10-05-workbench-browser-address-normalization.md) | 中文

## 问题

Workbench 地址栏会把 `baidu.com` 这类裸域名直接传给原生 WebView。WebView 要求绝对 URL，因此导航可能停留在空白页且没有可见错误。

## 决定

浏览器面板在原生导航或 provider 导航前统一规范化去除首尾空白后的地址栏输入。裸域名补上 `https://`，`http://`、`https://` 和 `about:blank` 继续支持。无效或不支持的地址显示本地化提示，而不是静默忽略。

## 备选方案

**要求用户输入完整 URL。** 这会保留下层 API 的要求，但常见的地址栏输入仍会无提示地失效。

**放宽 BrowserService 的 URL 策略。** 这会把展示层便利性移入共享 capability，并削弱其他消费者依赖的绝对 URL 约束。

## 结果

桌面原生导航和 Web fallback 使用相同的规范化值。裸域名提交成功后，地址栏会显示 HTTPS URL；不支持的协议会在调用 WebView 或 Host provider 前失败。

## 测试

浏览器面板 Client spec 覆盖原生 WebView 的裸域名规范化，以及不支持协议的可见拒绝。包类型检查和 `ui-workbench` bundle 均已通过。
