# Agent Note: 企业级组合插件有专用作者流程

Status: implemented

[English](2026-10-03-enterprise-composition-plugin-guide.md) | 中文

## 问题

独立插件指南描述普通 Cordis 包开发，但企业插件还增加了第二套交付和运行时约定：不可变 `.dsh-plugin.zip` release、带 schema version 的 manifest、Host 和 Client target、安装作用域 SDK 权限、归档完整性、激活 lease、迁移以及桌面卸载行为。现有企业参考资料分别描述这些机制，却没有为插件作者提供一条组合开发流程。

## 决策

仓库在 [`docs/cookbook/developing-an-enterprise-composition-plugin.md`](../../../../docs/cookbook/developing-an-enterprise-composition-plugin.zh.md) 维护企业级组合插件指南。该指南使用 `packages/plugin/acceptance` 作为具体的 Host/Client 归档参考，并链接企业模型、生命周期参考、SDK 参考、protocol、verifier 和 loader 所有者。开发索引为企业级组合插件设置专门的运行时路径行。

该指南把 manifest 视为 target、贡献、权限、resource、迁移、依赖和构建来源的可审核声明。它区分普通工作区包注册和企业归档发布，并要求同时覆盖归档、target、生命周期和 release 的测试。

## 曾考虑的替代方案

**扩展普通独立插件指南。** 企业归档和激活 lease 有不同的作者、发布和运行时边界。合并两者会让通用指南依赖企业专属细节，并掩盖工作区包与市场 release 的区别。

**只使用 `enterprise-plugins.md`、`plugin-installation-lifecycle.md` 和 `plugin-data-sdk.md`。** 这些参考资料分别是架构、生命周期和 SDK 行为的权威来源，但没有排列作者任务，也没有指出验收 fixture 和归档校验路径。新指南链接这些文档，但不替代其所有权。

**只记录 Host target。** 企业 release 可以包含 Client 和 Host target，关联插件必须明确二者的凭据和生命周期边界。因此指南把两种 target 及其组合作为一条 release 流程处理。

## 后果

企业插件作者有一个入口来完成 target 选择、manifest 设计、归档打包、SDK 使用、激活清理、验收测试和索引更新。manifest parser、包 verifier、runtime loader、生命周期 API、SDK 或验收 fixture 变化时，必须同步审阅本指南。本指南不替代 protocol 类型、实现 README 或企业 API 约定。
