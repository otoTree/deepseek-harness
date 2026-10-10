# Agent Note: Rail plugin icon and label metadata

Status: implemented

English | [中文](2026-10-04-rail-plugin-icons-and-labels.zh.md)

## Problem

Rail slot entries need a stable icon and label presentation when the sidebar is collapsed. Independent plugins currently render their own content without receiving registration metadata, so a text-only contribution can overflow the 56px rail and cannot participate in the host tooltip convention.

## Decision

List registrations accept an optional `icon` renderer alongside their existing `label`. The React slot renderer supplies the mounted entry's id, resolved label, and icon as `slotEntry` metadata. The sidebar rail supplies a default plugin icon through the owner props, while each contribution chooses whether to use that default or its registered icon. Rail actions render icon-only buttons in the collapsed column and expose their localized label through hover/focus tooltip or native title behavior and the accessible name.

## Alternatives considered

**Wrapping every rail contribution in the renderer:** Rejected because the renderer does not own the visual contract of arbitrary contribution components and would need to wrap unknown button or menu structures.

**Requiring every plugin to import a shared rail button component:** Rejected because independent plugins would acquire a feature-package dependency and lose control over their action behavior.

## Consequences

The slot registry carries a small React icon function type and the renderer adds one optional metadata prop to registered components. Existing components remain source-compatible because the metadata prop is optional. Rail contribution authors must consume `slotEntry` when they want host-provided labels or icons; the shell continues to own the default icon and compact rail geometry.
