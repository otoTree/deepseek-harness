# Agent Note: Scriptless storyboard workspace

Status: implemented

English | [中文](2026-10-26-arivo-scriptless-storyboard.zh.md)

## Problem

Requiring a saved script before manual shots prevents users from starting with visual ideas. Episode management inside the narrow Workbench competes with the editor.

## Decision

The [startup shell](../../../../apps/electrobun/src/distribution/arivo-shell/client/index.ts) binds both script and storyboard panels to the existing [episode sidebar contribution](../../../../apps/electrobun/src/distribution/arivo-shell/client/story-rail.ts). The plugin publishes an explicit editor kind. The sidebar forwards episode creation, selection, rename, deletion and storyboard source-binding intents; the original editor owns all dialogs, save admission and persistence. Frame, origin, project and binding identities remain mandatory, and replacing the panel removes its contribution.

The independently built creative plugin creates the episode, empty script version and storyboard source in one SQLite transaction with one replayable outer command. Adding the first manual shot to an unbound episode freezes its current draft and creates the source in the shot transaction. Existing sources and shot snapshots remain immutable unless the user explicitly rebinds future shots. Harness consumes only the built release.

## Alternatives considered

Nullable shot sources would spread a second provenance model through production and backups. Sequential renderer requests could leave an episode without a usable board after a partial failure. Atomic local transactions retain the existing fixed-version model and allow drawing before writing.

## Consequences

Both editors refer to the same episode identity and title. Deletion hides the episode while retaining historical scripts and production references. Unknown mutation replies retain their original command and block departure. Dirty shot edits disable sidebar actions. No paid execution, automatic cloud request or database schema change is introduced.

## Testing

The [packaged product replay](../../../../apps/web/tests/arivo-workbench-direct.e2e.ts) uses recorded conversation history and checks scriptless creation, lost-reply retry, manual shots, dirty-edit admission, sidebar management, script identity, panel replacement and empty state. Plugin Worker tests cover atomic rollback, CAS, immutable versions, folder routing and backup recovery. Native-window, paid Provider and release acceptance remain separate from browser fixtures.
