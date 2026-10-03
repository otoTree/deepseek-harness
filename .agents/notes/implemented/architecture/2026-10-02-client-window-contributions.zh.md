# Agent Note：声明式 Client contribution 与窗口实例

状态：已实现

[English](2026-10-02-client-window-contributions.md) | 中文

## 问题

企业插件和动态 Cordis package 需要让一个 Client artifact 同时为所有主窗口贡献 UI，并在不创建额外 Host target 或 lease 的情况下打开受控的独立窗口。

## 决策

Client manifest 使用结构化的 `slot` 和 `window` contribution。协议校验唯一 contribution ID、声明的 surface、locale key、shell 选项、multiplicity 和有界默认尺寸。Host 上的 `ClientWindowRegistry` 保存规范化定义和临时实例。`singleton` 打开操作会聚焦已有实例，`many` 打开操作会创建新实例。`ClientWindowService` 只通过现有 SDK transport 暴露按 contribution ID 执行的操作，因此插件代码不能传入 URL、脚本路径或原生窗口参数。

Enterprise Client target reconciliation 只注册一次窗口定义，并在 target 释放前关闭该插件的窗口实例。Host 所有的 SDK transport 仍由 target 共享。Client shell 在暴露窗口操作时，把受限 service 安装到各自隔离的 Client Context。窗口实例失败作为窗口级错误发布，不改变 target lease 状态。

## 结果

企业插件和动态 Cordis runner 可以使用同一套 contribution 模型。Host 生命周期仍按安装作用域管理，窗口状态是临时且隔离的。原生桌面适配器仍需提供 `ClientWindowPlatform` 回调；没有平台时 runtime 会拒绝创建窗口，不会静默创建后备窗口。

## 备选方案

- **每个窗口创建新的 Host target** —— 会重复 lease 和 SDK transport，并让升级清理依赖原生窗口数量。
- **接受 Client 代码提供的任意 URL 或脚本** —— 会绕过 manifest 校验，使插件脱离已注册 artifact。
- **让所有窗口更新一个全局 Client heartbeat** —— 一个窗口的渲染或断线失败会错误地把共享 Client target 标为失败。

## 验证

协议、API package 解析、runtime registry 和 enterprise runtime 测试覆盖结构化 contribution、重复 ID 拒绝、singleton 聚焦、many 实例隔离、未声明 contribution 拒绝、升级清理和 target 生命周期。protocol、plugin runtime 与 enterprise Client package 的 TypeScript 检查通过。
