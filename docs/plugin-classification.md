---
description: "Classification of DeepSeek Harness plugin groups by runtime role."
kind: "reference"
---

# Plugin Classification

English | [中文](plugin-classification.zh.md)

The package groups describe ownership; this page describes how a plugin participates in a deployed product. A package can contain several Cordis plugins, so classify the runtime contribution rather than the directory name.

| Class | Meaning | Groups |
|---|---|---|
| Built-in runtime | The default execution spine. Removing these rows leaves no standard agent runtime or durable session model. They remain replaceable through service contracts. | `core/`, `session/`, `llm/`, `identity/`, `settings/`, `credentials/`, `storage/`, `workspace/`, `interaction/`, `boot/` |
| Product capability | A user- or model-facing capability that can be enabled, replaced, or omitted while the spine still runs. | `goal/`, `schedule/`, `feedback/`, `subprocess/`, `shell/`, `terminal/`, `code-runtime/`, `sandbox/`, `fs/`, `lsp/`, `skill/`, `compaction/`, `context/`, `subagent/`, `jobs/`, `workflow/`, `webhook/`, `web/`, `attachment/`, `spill/`, `todo/`, `plan/`, `preset/`, `guard/`, `session-query/` |
| Composition and application | Packages that assemble or host a product surface. They are not domain capabilities and are not required by every profile. | `bundle/`, `api/`, `typert/`, `sdk/`, `acp/`, `host/`, `client/` |
| Plugin-system infrastructure | Packages that make plugins discoverable, loadable, observable, or integrable. They support the system rather than adding an agent capability by themselves. | `extensions/`, `hooks/`, `runtime-diagnostics/`, `util/` |
| Development-only or experimental | Packages excluded from the supported product contract, used for prototypes, fixtures, replay, or checks. | `experimental/`, `test-support/` |

`bundle/` is a patch-layer mechanism that selects built-in and capability plugins for a profile. `client/` and `host/` are the two application halves. `extensions/` is a runtime self-modification feature that operates on the plugin system itself. Release expectations remain defined by each group README; this page is a classification aid, not a second package inventory.
