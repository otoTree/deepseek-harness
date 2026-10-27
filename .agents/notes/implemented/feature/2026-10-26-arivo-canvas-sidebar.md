# Agent Note: Canvas management below conversations

Status: implemented

English | [中文](2026-10-26-arivo-canvas-sidebar.zh.md)

## Problem

Workbench canvas creation and selection occupy the editing pane while episode management already belongs below conversations. A second management area interrupts the shared workspace layout.

## Decision

The startup shell registers a dedicated [canvas list](../../../../apps/electrobun/src/distribution/arivo-shell/client/canvas-rail.ts) through `sidebar.footer.action`. The independently built creative editor publishes project-scoped metadata and retains all creation, saving and switching authority. The shell verifies the loaded frame, exact origin, project and random binding ID; only the newest binding can publish state or send actions. Panel teardown removes its contribution.

## Alternatives considered

Embedding creative code or database access in Harness duplicates persistence ownership. A shared episode/canvas wire format confuses different entities and commands. Keeping the canvas library inside the Workbench editor duplicates navigation; standalone creation still uses that library.

## Consequences

The editor hides its duplicate library and Back controls, opens the first canvas and owns the new-canvas dialog. Cancellation writes nothing; uncertain replies preserve the original command UUID. Drafts, composition, gestures and dialogs prevent switching or departure. The sidebar forwards create/open/rename/delete intents; the creative plugin owns their persistence and confirmations. Existing release and native acceptance requirements remain open.

## Testing

[Bridge tests](../../../../apps/electrobun/tests/arivo-canvas-rail.test.ts) reject foreign sources, origins, projects, bindings and stale callbacks. [Packaged Workbench acceptance](../../../../apps/web/tests/arivo-workbench-direct.e2e.ts) replays a recorded conversation beside canvas creation, canceled creation, lost-reply recovery, switching, IME protection and slot teardown. Plugin standalone canvas acceptance covers the original library and editing flow. Browser evidence does not establish native-window acceptance.

Canvas rows expose rename and delete intents through the same exact-frame bridge. The creative Worker owns CAS, immutable command recovery and logical deletion; the sidebar receives metadata only. Deleted canvases retain protected originals and history, and existing cloud calls retain their original lifecycle. Bridge tests reject unknown canvas IDs and stale bindings for these actions.
