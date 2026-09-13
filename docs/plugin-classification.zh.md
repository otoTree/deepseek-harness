---
description: "按运行时角色划分 DeepSeek Harness 插件组。"
kind: "reference"
---

# 插件分类

[English](plugin-classification.md) | 中文

包分组说明所有权；本页说明插件如何参与已部署的产品。一个包可以包含多个 Cordis 插件，因此应按运行时贡献分类，而不是按目录名称分类。

| 类别 | 含义 | 分组 |
|---|---|---|
| 内置运行时 | 默认执行主干。移除这些行后，标准 agent 运行时或持久会话模型无法组成；它们仍通过服务契约保持可替换。 | `core/`、`session/`、`llm/`、`identity/`、`settings/`、`credentials/`、`storage/`、`workspace/`、`interaction/`、`boot/` |
| 产品能力 | 面向用户或模型的能力；在主干仍运行时可以启用、替换或省略。 | `goal/`、`schedule/`、`feedback/`、`subprocess/`、`shell/`、`terminal/`、`code-runtime/`、`sandbox/`、`fs/`、`lsp/`、`skill/`、`compaction/`、`context/`、`subagent/`、`jobs/`、`workflow/`、`webhook/`、`web/`、`attachment/`、`spill/`、`todo/`、`plan/`、`preset/`、`guard/`、`session-query/` |
| 组合与应用 | 组装或承载产品界面的包。它们不是领域能力，也不是每个 profile 都必需。 | `bundle/`、`api/`、`typert/`、`sdk/`、`acp/`、`host/`、`client/` |
| 插件系统基础设施 | 让插件可发现、可加载、可观测或可集成的包；它们支持系统本身，不单独增加 agent 能力。 | `extensions/`、`hooks/`、`runtime-diagnostics/`、`util/` |
| 仅开发或实验 | 不属于受支持产品契约，用于原型、fixture、回放或检查的包。 | `experimental/`、`test-support/` |

`bundle/` 是为 profile 选择内置插件和能力插件的补丁层。`client/` 与 `host/` 是应用的两半；`extensions/` 是直接操作插件系统的运行时自修改功能。发布预期仍以各组 README 为准；本页是分类辅助，不是第二份包清单。
