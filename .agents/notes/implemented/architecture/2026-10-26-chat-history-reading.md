# Agent Note: Automatic Chat history reading

Status: implemented

English | [中文](2026-10-26-chat-history-reading.zh.md)

## Problem

Long conversations expose a paged suffix of the Session log. Requiring a button press at each page interrupts upward reading. A global incomplete-history check also keeps complete closed Turns expanded, increasing visible process content until the entire conversation loads.

## Decision

Reader-driven upward scrolling within one viewport of the loaded head requests an earlier page through the existing anchored pager. The pager preserves a semantic reading anchor. After a successful prepend, a short page can request another page while the reader remains in the buffer. Downward reading, returning to the live tail, and Turn navigation disarm that refill. Opening a conversation alone does not trigger history loading. Each head receives at most one automatic attempt; a failed or empty page retains the explicit `Load earlier` recovery control without a request loop.

Compact folding checks each closed Turn's loaded `turn/start` while earlier history exists. Complete Turns use the collapsed default immediately; the partial boundary Turn remains expanded so its process summary does not imply complete evidence. Loading its start enables folding and preserves manually expanded generations. Stable Seats retain tool state and searchable content.

The [official Chat renderer](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx) also decides process readiness from Turn-local presentation facts. Its grouped process renderer and scroll hooks require a separate coordinated integration. This implementation keeps the current contiguous-window pager and keyed Seat ownership.

Mounted Seats use natural flow without `content-visibility: auto`. The [deferred-rendering decision](2026-10-25-chat-offscreen-rendering.md) owns segment placeholders and their coordinated anchor compensation. Paint containment remains excluded because it can clip wide tables and move the floor during keyboard End.

The [process-folding](../feature/2026-08-14-web-turn-process-folding.md) decision retains final-answer, focus, and manual-expansion semantics; this decision replaces its global history-completeness requirement. The [outline-navigation](../feature/2026-08-30-web-turn-rail-outline-jump.md) and [incremental-rendering](2026-10-25-chat-offscreen-rendering.md) decisions remain active because they own separate navigation and rendering guarantees.

While following the live tail, Chat disables browser scroll anchoring on its active scroll owner. Browser adjustments during process collapse or offscreen rendering can otherwise look like reader motion and release follow ownership. Away from the tail, native anchoring remains enabled alongside the semantic prepend anchor. The [upstream stylesheet](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-chat/src/client/chat/ChatView.module.css) uses the same conditional ownership rule.

## Alternatives considered

**Load every event at open.** This removes the page boundary at the cost of eager transport, projection, DOM, and memory work for history the reader may never visit.

**Fold the partial boundary Turn.** This can present incomplete process counts. Waiting for that Turn's start establishes coverage while allowing complete later Turns to fold independently.

**Replace Seats with the upstream grouped renderer in isolation.** Group ownership, scroll restoration, navigation, subscriptions, and tool-state lifetime must agree. A partial replacement can remount tools or invalidate anchors; the current change keeps those owners stable.

## Consequences

Normal upward reading advances history without repeated button presses. Loading remains sequential and loaded history still grows in memory. Unit coverage exercises failure recovery, reader intent, and Turn-local completeness; assembled browser coverage exercises automatic paging, native find, keyboard tool expansion, copy, branching, and continuation in Chromium and WebKit. WebKit coverage does not establish the performance of a protected native DMG build.
