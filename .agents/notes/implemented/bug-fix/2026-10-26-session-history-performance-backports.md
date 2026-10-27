# Agent Note: Bounded Session history work on the v2 runtime

Status: implemented

English | [中文](2026-10-26-session-history-performance-backports.zh.md)

## Problem

Long Sessions and large local histories repeat work proportional to already-retained data. Settled Assistant streams allocate per-token state that final content immediately replaces, terminal appends rescan retained output, list rows serialize unused projections, requests traverse frozen history again, and metadata observations copy unused events. Serial header reads and uninterrupted summary construction also delay other Host requests. Both 智域OS and Arivo consume these shared packages.

## Decision

Backport the upstream performance mechanisms to the existing v2 runtime without changing Session generations or product-specific authorization and hidden-session rules.

| Operation | Owned work | Upstream fix |
|---|---|---|
| Settled Assistant | Read final content directly; scan compact records for timing, usage, visibility, images, or text; retain failed-attempt presentation | [`165cc31eb8`](https://github.com/deepseek-ai/deepseek-harness/commit/165cc31eb8) / [`84c11c7243`](https://github.com/deepseek-ai/deepseek-harness/commit/84c11c7243) |
| Terminal retention | Incremental byte and newline counts, bounded chunks, code-point-safe eviction, owned backing storage, and status getters without text assembly | [`cea837e065`](https://github.com/deepseek-ai/deepseek-harness/commit/cea837e065) / [`68f9708e02`](https://github.com/deepseek-ai/deepseek-harness/commit/68f9708e02) |
| Session list | Select registered summary views, excluding `turnOutline`, `sessionStats`, `todos`, and `imageLimits`; keep full follow/control baselines | [`92f9e79fac`](https://github.com/deepseek-ai/deepseek-harness/commit/92f9e79fac) / [`8e2dd67de8`](https://github.com/deepseek-ai/deepseek-harness/commit/8e2dd67de8) |
| Client list reconciliation | Index listed ids once per snapshot; prune cached rows and check selection membership without rescanning the list; retain unchanged row identities | [`53046b21b4`](https://github.com/deepseek-ai/deepseek-harness/commit/53046b21b4) |
| Request freezing | Track successfully deep-frozen message identities per Agent in a `WeakSet`; freeze each header and new identity completely | [`73edce1ae7`](https://github.com/deepseek-ai/deepseek-harness/commit/73edce1ae7) |
| Listing scheduling | Share `listConcurrency` across backend listing I/O, default 3; yield between complete summary rows after `listWorkSliceMs`, default 16 | [`6aa157a05a`](https://github.com/deepseek-ai/deepseek-harness/commit/6aa157a05a) / [`4402fa47e4`](https://github.com/deepseek-ai/deepseek-harness/commit/4402fa47e4) |
| Live observation | Capture the cursor at acquisition; materialize and share its fixed event prefix on first `events` access | [`5b91dbfba0`](https://github.com/deepseek-ai/deepseek-harness/commit/5b91dbfba0) |
| History jump | Buffer successful jump pages and publish one prepend at settlement; preserve live appends and discard buffered pages on replacement | [`3d360e7fdb`](https://github.com/deepseek-ai/deepseek-harness/commit/3d360e7fdb) |
| Turn navigation | Virtualize fixed-pitch marks with TanStack React Virtual 3.14.9; retain focused neighbors and pointer/focus previews | [`f89cd786aa`](https://github.com/deepseek-ai/deepseek-harness/commit/f89cd786aa) / [`d53c305224`](https://github.com/deepseek-ai/deepseek-harness/commit/d53c305224) |
| Active-Turn lookup | Binary-search natural-flow outer rows; retain zero-height boxes for empty Seats | [`19e5af7ded`](https://github.com/deepseek-ai/deepseek-harness/commit/19e5af7ded) |
| Tool and command rows | Reuse unchanged props, localized terminal models, and callbacks; create expanded content and dispatch image slots only while open | [`bcd14d776c`](https://github.com/deepseek-ai/deepseek-harness/commit/bcd14d776c) |

The compact readers require validated records. Durable Session admission still validates stream records; the strict expanding decoder retains indexed diagnostics. The cancellation signal remains mutable. Failed freezing never enters the identity set, and replacement message identities receive a fresh traversal.

The existing partial `SessionProjectionHints` wire representation carries summary keys through the registry's `wire.summary` policy. Client list refresh applies individual projection keys and retains an opened Session's full store. No Session event, storage generation, or projection state version changes.

The [v2 stream decision](../architecture/2026-09-01-v2-embedded-assistant-streams.md), [immutable-message decision](../architecture/2026-07-28-identified-immutable-message-values.md), [observation ownership decision](../architecture/2026-08-25-session-observations-and-projection-owned-client-state.md), and [cache storage decision](../architecture/2026-08-19-projection-cache-per-session-files.md) retain their independent format, identity, read-cut, and durability rationale. These optimizations refine their implementations without superseding those decisions.

The compatible core algorithms follow upstream `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`. Factory-slot and grouped-renderer APIs from that revision require a separate interface migration; this adaptation retains the current Conversation definitions, Arivo palette, locale dictionaries, and simplified chrome. Message DOM remains mounted for browser search, disclosure state, semantic anchors, and wide-table layout; virtualization applies to the navigation rail only. The [history-reading](../architecture/2026-10-26-chat-history-reading.md) and [offscreen-rendering](../architecture/2026-10-25-chat-offscreen-rendering.md) decisions retain their scroll and search rationale.

## Alternatives considered

**Replace whole upstream files or upgrade Session formats.** The newer controller, persistence backend, and client types have additional APIs. Replacing them would also change generation migration and product-specific behavior unrelated to repeated history work.

**Discard failed attempts with settled-stream replay.** v2 uses retained attempt content for interrupted replies and retry presentation. Compact-record assembly preserves those replies while avoiding per-token state churn.

**Skip every object that passes `Object.isFrozen`.** A shallow-frozen message can contain mutable descendants. Only successful complete traversal proves an identity safe to reuse; weak references avoid retaining replaced history.

**Send every projection and filter in the browser.** That retains Host validation, serialization, transport, and cold-client storage costs. Summary selection happens before view materialization and validation, while exact openings keep complete baselines.

## Consequences

History work follows newly admitted messages, compact records, incoming terminal text, and selected summary fields. Concurrency and work-slice budgets are validated deployment settings. Live observation leases preserve one cursor even when their first event read occurs after additional appends. Filesystem results are consumed in traversal order, and cancelling one listing does not clear another listing's shared queue.

The regression suites cover packed/scalar presentation, retries and interruptions, Unicode retention, request identity reuse and cancellation, lazy observation cuts, excluded-view work, concurrent listings, deterministic scheduler yields, and bounded cached-row reads during selection. The [manual browser benchmark](../../../../apps/web/tests/complex-history.perf.ts) separates first opening from repeated Session switches with 256 sidebar Sessions and 24 or 500 loaded Turns. Timing measurements are diagnostics; ordinary tests assert output and bounded work rather than machine-dependent speed thresholds.
