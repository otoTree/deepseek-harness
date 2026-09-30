# Agent Note: Enterprise trigger capability

Status: implemented

English | [中文](2026-09-24-enterprise-triggers.zh.md)

## Problem

The enterprise desktop needed file and timer automation that could target either a stable existing Session or a newly created Session, while preserving event identity, queue order, and offline behavior.

## Decision

The Trigger capability separates source providers from delivery targets. Timer occurrences use `queue-each`; local and cloud files use stable debounce and a batch window. Batches persist the rule revision and resource version history. Each batch renders the rule prompt as an ordinary queued user message that starts an Agent turn; it does not modify the system prompt. Existing-session delivery uses the Session Controller queue. New-session delivery derives an idempotent identity from `(ruleId, batchId)`. Host code owns credentials, watchers, cloud cursors, and Agent creation; the browser surface uses enterprise RPC only.

## Alternatives considered

**Merge every source by time.** Rejected because timer occurrences must remain individually observable and ordered.

**Replay file and cloud events accumulated while offline.** Rejected because the managed desktop has no authoritative local event log and replay could duplicate external changes; restart establishes a fresh baseline and reports skipped state.

**Treat the last Session response as trigger completion.** Rejected because `prompt` acknowledges inbox admission, not a complete Agent round; the trigger state therefore distinguishes delivered, processing, failed, and unknown.

## Consequences

Rules can evolve without changing already queued work because each batch stores its rule snapshot. Existing Sessions are serialized by target identity, while unrelated new Sessions can run within the configured parallel limit. Permission and target failures remain visible and manually retryable. The enterprise client keeps rules, the execution queue, and run history in the main view; create and edit operations use a dialog. The browser never receives Runtime capabilities.

The enterprise desktop now exposes a Trigger capability through the sidebar and a dedicated main surface. The Runtime persists versioned rules, source events, batches, and provider status locally. Timer rules use `queue-each`; file rules use stable debounce and a batch window, retaining the latest resource version and merged version identities.

Existing-session delivery addresses the persisted Session id and uses the Session Controller queue, so an active Agent round is not interrupted. New-session delivery derives a deterministic session identity from `(ruleId, batchId)` and reuses it across retries. Delivery is acknowledged only after the Session inbox accepts the prompt; recovered in-flight work is `unknown` and remains manually retryable.

Local and cloud file providers establish a fresh baseline after Runtime restart. Cloud events use version commits and a cursor feed; the desktop does not maintain an offline cloud backlog. The enterprise client keeps credentials, file watchers, and Agent creation on the Host and exposes only RPC-backed rule and history views to the browser surface.

Validation: `pnpm exec tsc -p packages/trigger/trigger/tsconfig.json --noEmit`, enterprise Host and Client TypeScript checks, API TypeScript check, and `git diff --check`.
