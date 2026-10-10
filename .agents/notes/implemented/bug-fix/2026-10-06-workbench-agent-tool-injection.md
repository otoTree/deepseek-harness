# Agent Note: Workbench Agent tool injection

Status: implemented

English | [中文](2026-10-06-workbench-agent-tool-injection.zh.md)

## Problem

The Workbench mounted the persistent terminal service and backend for its Agent runtime, but the standard Agent preset did not mount the model-facing terminal tool plugin. The UI could operate a terminal while the Agent request contained no `terminal_*` schemas.

## Decision

The standard preset mounts `@deepseek-ai/dsh-tool-terminal` inside the same isolated `persistent-shell` group as `@deepseek-ai/dsh-terminal` and its shell backends. The Web bundle declares the plugin as a runtime dependency, so desktop and Web profile installations resolve the row. The shipped Web composition test reads the mounted Agent catalog and asserts all six terminal tools.

## Alternatives considered

**Mount the tool at the host root.** This would expose the tool globally and make it resolve a different or missing terminal registry instead of the Agent's isolated PTY service.

**Mount the tool outside `persistent-shell`.** Cordis injection cannot resolve a child group's isolated `terminals` service from a sibling row, so the tool would remain pending or fail during composition.

## Consequences

Agents using the standard preset can use persistent terminal sessions through the same owner-isolated registry shown by Workbench. The terminal tool remains opt-in to presets; minimal and other presets do not receive it unless they mount the row. The runtime dependency keeps packaged enterprise profiles closed over the new plugin.

## Testing

The shipped Web composition test mounts the standard preset and checks the six `terminal_*` schemas in `ctx.tools.schemas(agent)`. Focused Web composition, terminal tool, and type checks verify the plugin loads and executes against the isolated PTY service.
