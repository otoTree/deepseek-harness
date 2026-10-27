# Agent Note: Arivo native language adapter

Status: implemented

English | [中文](2026-10-23-arivo-language-adapter.zh.md)

## Problem

Arivo needs its own authenticated, metered model transport while retaining the original OS Agent loop, tool permissions and durable Session history. A second conversation runtime would duplicate those owners and make recovery ambiguous.

## Decision

The [startup Host](../../../../apps/electrobun/src/distribution/arivo-shell/host/index.ts) registers an Arivo LlmAdapter over the verified creative release’s version-one Host operation. The original OS assembles requests, executes tools and records results. The adapter maps ordered structured messages and streams; it never receives native credentials or calls a Provider directly.

Each command derives from the persisted Session and open step sequence. Changing a model route cannot mint another command for that step: the plugin’s immutable request journal rejects conflicting input. Cloud call IDs namespace Provider tool IDs. Reasoning remains display-only; text-only function input rejects unsupported media and generation options before admission.

Automatic paid retries are disabled. An uncertain response requires recovery of the original call. Explicit live Agent abort requests a durable native stop; plugin teardown only closes subscriptions and awaits generator cleanup. The Arivo profile disables the default official adapter and rejects non-Arivo Agent routes. Enterprise compositions retain their own model policy.

The [project default decision](../feature/2026-10-26-arivo-project-model-defaults.md) owns automatic directory-scoped model selection and removal of global manual controls. The original conversation menu retains explicit selection. Existing Session choices remain authoritative; browsing never submits or reserves a model call.

Known native billing, allowance and quote rejections retain their allowlisted codes through the original adapter. Built-in Chinese messages point to the account console’s project budget or team credits view. Arbitrary remote error text is never displayed; all other uncertain errors keep the original recovery guidance. No retry or permission policy changes.

## Alternatives considered

A separate Arivo Agent loop duplicates Session and tool owners. Direct official-Provider fallback bypasses Arivo billing. Random command IDs permit duplicate admission after transport loss. Reusing Provider tool IDs across calls breaks historical tool correlation. None is used.

## Consequences

The adapter preserves existing tool, permission, preset and Session mechanisms. Model routes require a real workspace/project/adapter triple and native catalog authorization. Official-model acceptance through real local Arivo HTTP and the packaged profile covers a local write and correlated follow-up. Native-window and packaged tool-crash acceptance remain separate D3 requirements; this implementation is not a completed release.

## Testing

[Focused bridge tests](../../../../apps/electrobun/tests/arivo-language.test.ts) exercise the real OS loop and a local file effect, unsupported inputs, stable commands, uncertainty and stop/disposal. The [recorded-session scenario](../../../../snapshots/session/arivo-native-agent/snapshot.yml) launches the shipped headless profile and replays recorded chunks through this adapter, with an independent final-workspace oracle. Its native bridge is a fixture, not evidence of a real Provider call. [Hard-crash verification](../../../../apps/electrobun/tests/fixtures/arivo-tool-crash.ts) kills the process after a checkpointed tool side effect but before its result. A fresh OS process persists `TOOL_OUTCOME_UNKNOWN`, leaves the effect untouched and makes no model call until an explicit follow-up; that follow-up preserves the tool ID and recovery instructions through this adapter.
