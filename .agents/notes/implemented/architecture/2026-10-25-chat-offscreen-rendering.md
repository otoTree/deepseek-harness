# Agent Note: Deferred Chat history rendering

Status: implemented

English | [中文](2026-10-25-chat-offscreen-rendering.zh.md)

## Problem

A thousand-Turn conversation can contain thousands of Chat Seats, Markdown trees, and Tool views. Remounting the complete loaded transcript on a Session switch blocks the main thread even when the reader only needs its tail or a saved position. Session scopes and plugin registrations already survive these switches; renderer work requires a separate bound.

## Decision

Chat groups contiguous nodes into stable Turn segments and mounts the saved reading neighborhood plus the live tail. Deployment configuration controls Turns per segment, initial segment count, viewport overscan, and the estimated height of unmeasured Turns. Consecutive deferred segments share one height placeholder. Intersection observation binary-searches its measured or estimated offsets and mounts only the approaching segments; placeholder DOM therefore follows visited regions rather than total history length. A frame-coalesced scroll listener reveals the viewport neighborhood inside a tall placeholder even when its intersection status remains unchanged. Once mounted, a segment retains its Seats, subscriptions, DOM, and local Tool state until the view unmounts. Node membership remains stable when a running Tool settles. Mounted segments use natural flow without paint containment, preserving wide-table overflow.

The declared Session-scoped Chat store remembers measured segment heights and nested anchor identities across view remounts. Measurements from the same viewport width seed placeholders; other segments use estimates. Segment height reads are batched after deferred content is hidden, and one observer updates measured sizes. Layout cleanup saves the current reader anchor before row refs detach, including navigation during pending scroll sampling. Mounting preserves the reader's visible anchor; pinned readers continue following the live floor. Loaded-Turn navigation requests the target segment before landing, while unloaded navigation retains the contiguous-window pager. The [history-reading decision](2026-10-26-chat-history-reading.md) owns automatic paging and follow attribution.

Idle tasks extract payload search text and publish it after indexing completes; browsers without idle callbacks use timer tasks. Deferred segments contain searchable text leaves from node payloads under `hidden="until-found"`. A browser `beforematch` mounts the matching deferred range synchronously while retaining its leading reveal container; that explicit search can materialize a large range. The standard Find shortcut materializes the complete loaded rich transcript, including when invoked from the composer. Select All does the same outside editable fields; selection inside an editor stays local. Browsers without searchable-hidden support rely on the keyboard Find path for deferred history. Native menu find, custom renderer text absent from node payloads, and selection spanning untouched deferred segments retain browser-dependent limitations.

Chat resolves the latest human key when node order changes and publishes `data-actions-reveal`; CSS does not search later human siblings. The navigation index updates touched previews rather than copying unchanged history. The [process-folding](../feature/2026-08-14-web-turn-process-folding.md), [stable-ordering](../bug-fix/2026-08-26-stable-turn-process-order.md), and [viewport-highlighting](2026-08-31-viewport-activated-syntax-highlighting.md) decisions retain their separate interaction and cache ownership.

## Alternatives considered

**Unmount visited segments when they leave the viewport.** This bounds DOM memory but discards local Tool state and breaks selections spanning visited messages. Keeping visited segments mounted bounds the initial renderer work while preserving those interactions within one visit.

**Keep every Session React tree hidden.** Inactive subscriptions and DOM would grow across visited Sessions. Deferred remounting keeps the existing Session isolation and caches only geometry in the viewing store.

**Apply paint containment to every row.** Containment clips wide-table overflow and estimate-driven floor changes can interfere with keyboard End. Explicit segment materialization coordinates geometry changes with scroll ownership.

## Consequences

Session switching mounts a reading neighborhood rather than every loaded message. Event storage, node projection, searchable text extraction, and outline size still scale with loaded history; this is not history eviction. A single enormous Turn or rich renderer can still dominate its segment. Explicit Find and Select All can perform history-sized work. The opt-in benchmark defaults to 1,000 Turns and accepts `DSH_PERF_HISTORY_TURNS` for larger histories in multiples of 100. It checks loaded cardinality independently from mounted rows, and reports trusted-click-to-visible-answer frames separately from Playwright command overhead. Protected Client bundles can be measured independently of the native window shell; a sub-100-ms target requires measurements on the actual deployment and host.
