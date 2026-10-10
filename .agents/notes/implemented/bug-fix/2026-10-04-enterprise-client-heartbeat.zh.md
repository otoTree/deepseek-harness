# Agent Note: Enterprise Client mounts renew their target lease

Status: implemented

[English](2026-10-04-enterprise-client-heartbeat.md) | 中文

## 问题

桌面 Host 收到浏览器挂载回报后，会在本地把 Client target 视为 active，但该回报之前只更新内存中的诊断表。企业 API 因此会继续把 Client device target 和安装记录保持在 `preparing`，直到下一次 Host lease 续期；如果续期没有运行，状态可能一直不变。

## 决定

`plugin-client-window-state` 等待 Host runtime 对 Client target 发送 heartbeat。浏览器挂载成功时以 `active` 回报并续租，挂载失败时以 `failed` 回报错误。`disconnected` 回报只保留在本地，因为 API 没有 disconnected target 状态。浏览器把 activation deadline signal 通过 Connection RPC 继续传入，使无响应的 heartbeat 不会让 Client 协调超过该截止时间。

## 结果

当 Host activation 和浏览器 Client 挂载都成功后，安装会立即进入 `active`。浏览器 Client 挂载失败会在发生时通知 API，API 可以撤销失败 target。即使 heartbeat 请求失败，浏览器窗口诊断仍然可用。多个窗口可以回报 `active`；失败回报遵循 API 现有的 target 级失败语义。

## 测试

Host runtime 套件验证 Client 挂载会发送 `active` heartbeat，失败挂载会发送错误，断开不会发送 heartbeat。浏览器 runtime 套件继续通过真实 Connection RPC 路径覆盖成功和失败的 Client 挂载回报。

## 备选方案

**等待五分钟的 Host lease 续期。** 否决，因为成功的浏览器挂载必须及时完成安装激活，续期计时器不是 Client 生命周期确认。

**Host 创建 activation lease 时直接把 Client target 标记为 active。** 否决，因为 lease 创建后浏览器 bundle 仍可能加载或挂载失败。

**把 `disconnected` 映射为 `failed`。** 否决，因为页面关闭不能证明 Client target 失败，API 不应因为传输生命周期事件撤销健康 target。
