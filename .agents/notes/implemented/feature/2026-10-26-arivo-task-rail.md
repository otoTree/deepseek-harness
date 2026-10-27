# Agent Note: Project tasks and assets in the Arivo Rail

Status: implemented

English | [中文](2026-10-26-arivo-task-rail.zh.md)

## Problem

Creators need to inspect cloud tasks and local assets from the permanent Rail without navigating through account administration. Both pages use the project as their primary context.

## Decision

The [startup Client](../../../../apps/electrobun/src/distribution/arivo-shell/client/index.ts) registers Tasks and Assets after Studio through the original Rail and main-surface slots. The [Host](../../../../apps/electrobun/src/distribution/arivo-shell/host/index.ts) admits the fixed `tasks` and `assets` pages in the existing embedded-workbench request. Neither request carries cloud scope, account credentials or filesystem paths. The independently built creative plugin owns project selection, authorized cloud reads and local asset-folder storage.

## Alternatives considered

An account-only entry hides a creative activity inside administration. Importing creative components or cloud services into the Harness checkout duplicates plugin responsibility and bypasses the built-artifact boundary.

## Consequences

Conversations, departure guards, Workbench, folder ownership and the market retain their original owners. The shell installs the exact-origin folder listener as its iframe mounts, before the creative page sends its first folder query; departure preparation waits for the loaded page. The shell only selects a page; the plugin consumes published Web presentation and fences responses to the selected project. The asset page reads originals through the project-folder router and blocks project departure while an import remains unconfirmed. Native media originals remain an explicit authorized Web action. No Session format, Agent loop, database or enterprise composition changes.

## Testing

The [packaged startup test](../../../../apps/web/tests/arivo-startup.e2e.ts) opens Tasks and Assets from the real Rail, verifies their active entries and distinct icons and returns to Studio. Plugin built-profile tests cover multiple projects, delayed list/detail replies, cursor reset, scoped errors, keyboard menus and narrow layouts in Chromium and WebKit. Native-window screenshots and development-package validation remain separate evidence; a Rail test does not close release or Provider acceptance.
