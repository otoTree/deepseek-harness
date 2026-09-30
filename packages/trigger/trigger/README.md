---
description: "Managed timer, local-file, and cloud-file triggers for durable Session delivery."
kind: "package-reference"
---

# @deepseek-ai/dsh-trigger

English | [中文](README.zh.md)

## Summary

`dsh-trigger` normalizes timer, local-file, and cloud-file events into durable batches. Timer rules queue every occurrence; file rules debounce and merge a short window while retaining resource and version identities. The Runtime persists immutable rule snapshots, routes batches to an existing Session or an idempotently created Session, and reports uncertain recovered work as `unknown` for manual retry.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Load `TriggerService` in the managed desktop composition and register a cloud provider when the enterprise API exposes a version cursor. The service owns source lifecycle, local persistence, batching, target serialization, and cleanup.

## Understand the implementation

The service separates source providers, immutable rule snapshots, batching, and Session delivery. Local providers establish a startup baseline; cloud providers advance a cursor. Delivery targets are serialized facts so recovered work can be reported as `unknown` without replaying an event that may already have been delivered.

| File | Role |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Trigger service, source contracts, and durable state. |
| [`tests/`](tests/) | Deterministic provider and delivery coverage. |

## Further Exploration

The enterprise desktop composition supplies the authorized file roots, cloud cursor, and Session delivery target. See the [Agent Note](../../../.agents/notes/implemented/feature/2026-09-24-enterprise-triggers.md) for the integration record.

## Dev Note

The capability design and enterprise integration are recorded in [the Agent Note](../../../.agents/notes/implemented/feature/2026-09-24-enterprise-triggers.md).

## Model Experience

### Trigger delivery

#### What the model sees

One ordinary user prompt containing the rendered rule template and structured resource summary for the accepted batch. The Session queues this message and starts an Agent turn; the prompt does not modify the system prompt.

#### Token effect

The rendered prompt and resource summary consume input tokens in the target Agent request.

#### KV Cache effect

Trigger prompts are ordinary queued user messages and do not alter provider cache policy.

##### Trigger request

```markdown
Trigger batch: {{batch.id}}
Resources: {{resources.json}}
```

## Known Limitations and Deferred Work

Offline file and cloud changes are intentionally not replayed. Runtime restart establishes a new file baseline and advances cloud cursors. Workflow actions, shared execution identities, and explicit fork/template context inheritance remain deferred.

- Offline file and cloud changes are skipped after Runtime restart.
- Workflow actions and shared execution identities remain deferred.

The Runtime owns watchers, timers, cloud cursors, queue state, and permission checks. File sources establish a baseline on startup and use stable debounce windows; timer occurrences remain individual queue items. Runtime shutdown does not replay offline file or cloud changes, and recovered in-flight batches are reported as `unknown` for manual retry.
