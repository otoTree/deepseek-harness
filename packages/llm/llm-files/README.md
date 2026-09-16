---
description: "Provider-neutral Files API upload coordination for adapter authors who need deduplicated, cancellable, expiring provider file references without persisting provider identifiers."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-files

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-llm-files` lets an LLM adapter upload durable attachment bytes once and reuse the provider file reference across concurrent and later requests. The cache key includes provider, account, model, and content digest, while the provider file identifier remains process-local and never enters Session data. Callers supply all deployment-varying expiry, refresh, timeout, retry, and quota-recovery settings for each resolution. The package coordinates lifecycle only; provider plugins still own credentials, wire requests, response validation, and upstream deletion.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the service beside an LLM adapter that registers a provider implementation, then call `ctx.llmFiles.ensureUploaded()` while serializing provider-native media.

### When to choose it

Choose this package when a provider accepts file identifiers and repeated model requests should share one bounded upload lifecycle. Keep inline Base64 serialization in the adapter when the selected model explicitly declares that policy; do not use this cache for permanent object-storage URLs or as durable attachment storage.

### Minimal composition

The service has no configuration; the provider plugin owns its settings and registration:

```yaml
- name: '@deepseek-ai/dsh-llm-files'
- name: './gateway-provider.js'
```

The enterprise desktop profile mounts the second row from its packaged plugin path; other adapters mount their own provider plugin after the shared service.

The provider passes a verified attachment, its bytes, an account namespace, the selected model, and an explicit policy. A successful result reports whether this caller owns the physical upload so usage accounting does not count concurrent waiters twice.

### Failure and cancellation

Each waiter can cancel independently. The shared upload is cancelled only after every waiter leaves, timeouts and retries are bounded by the caller policy, invalid byte counts or expiry metadata fail closed, and a provider-specific quota error may trigger one bounded reclamation attempt. `invalidate()` removes one exact cached generation after a model endpoint rejects its file identifier; the adapter decides whether to perform a bounded re-upload.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The runtime hashes verified bytes and indexes a process-local mapping by provider, account, model, and digest. Concurrent resolutions share one promise, but only one waiter receives `uploaded: true`; live mappings return immediately, and entries inside the configured refresh margin are replaced. Aggregate counters expose uploads, bytes, failures, refreshes, and rejected bytes without exposing provider file identifiers.

No runtime invariant companion is published; cache entries, uploads, waiter cancellation, and provider deletion are owned by one service instance and observed directly through its lifecycle tests, so the package has no independently reported relation to cross-check.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis service, provider registry, singleflight cache, retry, invalidation, and cleanup |
| [`src/types.ts`](src/types.ts) | Branded identifiers, provider interface, request policy, results, and metrics |
| [`tests/runtime.spec.ts`](tests/runtime.spec.ts) | Concurrency, cancellation, identity, refresh, retry, quota, cleanup, and validation coverage |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [LLM service](../llm/README.md) — provider-neutral messages, model capabilities, and adapter dispatch.
- [Attachment service](../../attachment/attachment/README.md) — durable attachment references and verified byte reads.
- [LLM streaming subsystem](../../../docs/subsystems/llm-streaming.md) — request assembly and stream protocol.
- [Provider-neutral multimodal inputs](../../../.agents/notes/implemented/architecture/2026-09-17-provider-neutral-multimodal-inputs.md) — the accepted media, Files API, and enterprise gateway design.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through an adapter that replaces a durable media reference with an ephemeral provider file identifier in the model request; this package adds no prompt text or Session content itself.

#### KV Cache effect

Reusing the same provider file identifier preserves the media portion of a provider request when the provider includes file identity in its cache key; refresh or invalidation can change that suffix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits keep provider behavior and durable storage outside the reusable upload coordinator.

- **The cache is process-local** — a restart re-uploads attachments, and multi-process deployments do not share provider file identifiers.
- **Deletion depends on the provider** — cleanup removes local entries, but upstream deletion occurs only when the registered provider implements it.
- **Model-call recovery is adapter-owned** — `invalidate()` is available, but the adapter must recognize a stale provider file response and bound any replay.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
