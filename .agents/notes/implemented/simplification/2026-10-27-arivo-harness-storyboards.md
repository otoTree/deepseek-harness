# Agent Note: Harness owns storyboard prompt authoring

Status: implemented

English | [中文](2026-10-27-arivo-harness-storyboards.zh.md)

## Problem

A separate storyboard generator asks users to prepare a saved script, select another model and manage another production record while the conversation already owns the creative task. This duplicates orchestration and prevents direct shot authoring.

## Decision

The original Harness conversation writes complete shot prompts through the existing [creative tools](../../../../apps/electrobun/src/distribution/arivo-shell/host/studio-tools.ts). The creative plugin accepts an unbound first shot by atomically associating an immutable empty script. The model reads the board revision, writes shots in order and uses each returned revision for its next write. It rereads after conflict instead of overwriting newer edits. Explicit source binding remains optional.

The independently published plugin owns persistence, UUID receipts, fixed materials and UI observation. Its storyboard editor provides direct creation and manual editing; standalone single/multi-episode generator creation is retired. Original Harness model access, tool policy, logging and billing remain authoritative.

## Alternatives considered

Keeping the generator and adding conversation shortcuts retains two orchestration owners. Creating an empty script with several model tool calls introduces a partially prepared state and unnecessary version commands. A new Agent loop in the creative plugin duplicates existing cancellation, tool and Session behavior.

## Consequences

Each successful shot is immediately durable and independently editable. Existing script drafts and saved content remain intact; fixed sources and materials retain their identities. Model-visible tool guidance explains empty-source initialization, sequential revisions and continuity. No automatic paid retry, media generation or new cloud command is introduced by writing a shot. Historical local production data remains available to its original recovery protocol.

## Testing

The creative plugin's released-Worker tests cover sequential native writes, empty-source initialization, invalid-material rollback, replay, stale revisions and reopen. Built-profile browser acceptance covers removal of generation controls, direct creation, Agent-write observation, dirty input protection and Host restart. The [registry tests](../../../../apps/electrobun/tests/arivo-studio-tools.test.ts) retain Session command identity, folder authority and effect cleanup. The [recorded native-Agent scenario](../../../../snapshots/session/arivo-native-agent/snapshot.yml) pins the model-visible tool descriptions without paid calls. These checks do not establish native-window or real-Provider acceptance.
