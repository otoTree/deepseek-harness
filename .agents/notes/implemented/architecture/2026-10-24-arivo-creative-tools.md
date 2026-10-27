# Agent Note: Arivo creative tools in the original Harness

Status: implemented

English | [中文](2026-10-24-arivo-creative-tools.zh.md)

## Problem

Arivo conversations need to edit the same local scripts and storyboards as the creative workspace. A separate Agent runtime or direct database access would bypass the OS tool policy and local revision checks.

## Decision

The [startup tool adapter](../../../../apps/electrobun/src/distribution/arivo-shell/host/studio-tools.ts) registers creative tools in the original Harness registry. The verified plugin supplies a version-one native handle over its scoped Worker use cases. Session and tool-call identities derive stable command UUIDs; the Worker owns durable replay and CAS. Each tool releases its captured account handle. Errors expose bounded codes without local diagnostics. Text reads paginate and outputs have a byte limit. The [canvas tools](../../../../apps/electrobun/src/distribution/arivo-shell/host/canvas-tools.ts) read versioned pages and edit titles, prompts and connections through the same Worker receipts and reversible history; they cannot submit generated outputs or start paid media tasks.

The [Client adapter](../../../../apps/electrobun/src/distribution/arivo-shell/client/index.ts) contributes an ordinary closable Workbench panel and retains the rail pages, conversations, Skills/MCP, presets and marketplace. Both creative panes read the same local project storage. The Arivo theme maps conversation actions to the published neutral palette. The shared context meter accepts an optional tool-color token with its original enterprise fallback.

## Alternatives considered

A second Agent loop duplicates history, cancellation and permissions. Browser database access bypasses native account selection. Provider keys in the client bypass Arivo identity and billing. These approaches are excluded; models execute through the existing cloud language adapter.

## Consequences

Creative tools mutate local content without model dispatch or credits; the conversation model remains authenticated and metered in Arivo cloud. Local IDs never stand in for cloud billing IDs. Editing existing shots retains fixed material references unless the existing Host use case explicitly changes them. Market service adaptation and complete native login remain separate acceptance requirements.

## Testing

[Registry tests](../../../../apps/electrobun/tests/arivo-studio-tools.test.ts) cover stable commands, anonymous rejection, safe errors and disposal. The independent plugin exercises real Worker persistence, CAS, account fencing and reopen. The [recorded-session scenario](../../../../snapshots/session/arivo-native-agent/snapshot.yml) pins the creative model schemas while retaining its original file-effect task. [Product acceptance](../../../../apps/web/tests/arivo-studio-acceptance.ts) checks Agent-created script and shot data through Workbench and after a complete Host restart; its live Provider run is explicitly enabled and billed only to an isolated test account. Browser evidence does not establish native-window acceptance.
