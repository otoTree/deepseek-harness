# Agent Note: Automatic Arivo project conversation models

Status: implemented

English | [中文](2026-10-26-arivo-project-model-defaults.zh.md)

## Problem

Global workspace, billing project and model forms interrupt project conversations and can suggest a billing scope unrelated to the open folder.

## Decision

The [startup shell](../../../../apps/electrobun/src/distribution/arivo-shell/client/index.ts) registers no global model settings surface. Its Host exposes no manual global selection RPC. The native creative plugin resolves the folder's immutable cloud binding and verifies a saved project preference, or chooses the first tool-capable model in its live catalog without saving a preference. The original conversation menu handles explicit changes.

The [Session Controller](../../../../packages/api/session-controller/src/agent.ts) accepts one deployment-owned default resolver. First-prompt admission records its exact result only for a Session without a pending choice or previous request model. It rechecks cancellation, registration ownership, live Agent identity and durable choices after discovery. Existing choices and concurrent user selections win. The ordinary deployment policy applies when no resolver exists.

This partially supersedes the global controls paragraph of the [native adapter decision](../architecture/2026-10-23-arivo-language-adapter.md). Its request, tool, stop, recovery and billing policies remain active.

## Alternatives considered

A collapsed global configuration form retains the duplicate billing choice. Mutating the global default when switching projects can charge a new Session to a different folder. Rewriting request routes inside the Agent loop bypasses the durable selection owner. The project resolver uses the original Session command and request path instead.

## Consequences

Account replacement, unavailable catalogs and changed project preferences fail before model execution. Automatic discovery creates no generation or reservation. Existing accepted model calls keep their original routes. The independently built plugin remains the native data owner; Harness consumes only its published release. No database migration or second Agent loop is added.

## Testing

[Session tests](../../../../packages/api/session-controller/tests/session-models.host.spec.ts) cover first-prompt admission without a global provider, concurrent explicit selection, duplicate resolution, existing requests, cancellation and resolver removal. Native plugin tests exercise real Worker storage, pagination past text-only models, account changes and revision conflicts. The [packaged project flow](../../../../apps/web/tests/arivo-project-creation.e2e.ts) opens a conversation without model configuration and checks its named model, enabled composer, absent settings entry and restart. [Recorded Agent replay](../../../../apps/electrobun/tests/arivo-language-snapshot.mjs) asserts that project discovery and requests preserve the deployment default. Product fixtures make no real paid Provider calls; native-window and release acceptance remain separate.
