# Agent Note: 跨引擎 JSON 容器识别

Status: implemented

[English](2026-09-16-cross-engine-json-containers.md) | 中文

## 问题

无损 JSON 校验通过检查内建构造函数来识别来自其他 JavaScript realm 的普通对象和数组。原生函数文本此前与 Node 的单行格式精确比较。JavaScriptCore 和 Bun 会为同一个内建函数输出换行，因此 Web 客户端会拒绝从 Remote 流收到的普通对象。即使持久流包含有效 JSON，Assistant 历史展开仍会在事件流订阅者内失败。

## 决策

内建构造函数识别会先规范化 `Function.prototype.toString` 输出中的空白，再与原生 `Object` 或 `Array` 格式比较。构造函数名称与 prototype identity 检查仍然必需。用户编写的函数体、在注释中包含 `[native code]` 的函数、名称不匹配的构造函数、class 实例、伪造 prototype 和带装饰的容器仍然无效。

企业开发启动会在 Host 图之后构建全部 Client 组合包。浏览器插件名册包含多个会嵌入 Client-safe 共享工具的独立组合包；只重建 session-controller 可能让 UI 订阅者继续使用旧实现。

## 考虑过的替代方案

**接受所有具有预期名称和 prototype 的构造函数。** 用户代码可以伪造这两个属性。保留原生函数源码检查，能够继续区分内建构造函数和用户编写的构造函数。

**只为 Assistant 流 chunk 增加特殊处理。** Remote 帧、持久事件、工具和其他浏览器输入共用同一个 JSON predicate。为单个流绕过校验会在其他位置保留跨引擎缺陷，并削弱该流的校验。

**只重建 session-controller Client 组合包。** UI chat、trajectory 和其他插件组合包可以各自嵌入 JSON 与 Assistant 流 helper。部分构建无法保证运行中的浏览器图使用当前代码。

## 后果

Node、JavaScriptCore 与 Bun 的普通容器会通过同一套无损 JSON 规则。允许的源码差异仅限空白，因此现有的 exotic 容器拒绝行为保持不变。企业启动会花费更多时间构建完整 Client 组合包集合，但动态提供的每个浏览器插件都会使用当前共享代码。
