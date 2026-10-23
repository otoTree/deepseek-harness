# Agent Note: Anchor Workbench resize handles to grid borders

Status: implemented

English | [中文](2026-10-21-workbench-resize-handle-alignment.zh.md)

## Problem

The Workbench resize strip used a pixel offset calculated from the last observed frame width. CSS can resize the conversation track before ResizeObserver updates React, leaving the strip inside the conversation or outside its panel. A separate transition on that offset also gives the strip a position independent of the rendered grid.

## Decision

[AppFrame](../../../../packages/client/ui-layout/src/client/AppFrame.tsx) renders each resize strip as an absolutely positioned grid child. Its CSS grid column anchors it to the corresponding panel border; its grid row limits the hit area to content below the top bar. The grid owns animated position. JavaScript retains width preferences, concession solving and pointer deltas, without supplying a second horizontal coordinate or transition.

The [enterprise shell decision](../architecture/2026-09-29-enterprise-client-workbench-shell.md) continues to own column composition and narrow overlays. The [details lifecycle decision](2026-07-29-web-details-session-lifecycle.md) continues to own Session-dependent visibility. Neither decision is superseded by strip positioning.

## Alternatives considered

**Observe more elements or synchronously update a pixel offset.** This adds another measurement path while retaining two independent owners of the same visible border.

**Place the handle inside the panel.** Panel overflow clips the centered hit strip; a sibling grid child retains the full hit area without changing content clipping.

## Consequences

Container width changes and column transitions preserve strip alignment in the same layout pass. Pointer capture, drag clamping and Workbench visibility retain their existing semantics. Narrow overlay mode has no resize strip.

## Verification

The [recorded-session browser regression](../../../../apps/web/tests/details-session-lifecycle.e2e.ts) opens Workbench, checks both strips against actual panel rectangles, changes the container width before observer delivery and drags both panels. The resize assertion fails with a 400px offset under the independent-coordinate implementation. The [handle snapshot](../../../../snapshots/web/details-session-lifecycle/handles.expected.md) records both strips and their alignment without platform-specific coordinates. Layout unit tests retain the width, pointer and visibility checks.
