# Agent Note: Arivo bundled product acceptance

Status: implemented

English | [中文](2026-10-23-arivo-bundled-image-acceptance.zh.md)

## Problem

Standalone creative-plugin tests can pass while the desktop bundle loads another plugin manifest or loses the original Agent when its creative pane opens. Composition acceptance must exercise the verified release and the normal OS navigation together.

## Decision

[Packaged browser acceptance](../../../../apps/web/tests/arivo-startup.e2e.ts) starts the complete Arivo bundle through its native supervisor in a disposable home. It reads the bundle’s manifest pin, uses the native credential helper and opens the original OS shell in Chrome. The creative pane uses the normal rail and project controls. The language catalog is selected through the ordinary model settings; the fixture rejects any language generation request.

The test’s private loopback fixture supplies explicit unpaid cloud responses. It checks one image creation, a lost reconciliation reply, durable recovery across full Host replacement, the original reconciliation UUID and decoded local output. Returning to the original Agent preserves its draft before restart. A separate unconfigured-shell case verifies that the composer remains disabled without an available model.

[Packaged tool recovery](../../../../apps/web/tests/arivo-tool-recovery.e2e.ts) exercises the original Bash tool and Session JSONL. After a local effect appears, it verifies Host ancestry and process-group ownership, then sends SIGKILL to the Host group and the separately detached tool group. Reopening the ordinary history item records `TOOL_OUTCOME_UNKNOWN` without automatically repeating the tool or model request. An explicit follow-up carries the correlated unknown result; the file effect remains unique. Auxiliary title calls receive their own text-only fixture responses. The test does not claim that killing the Host alone terminates detached tool processes.

[Real image product acceptance](../../../../apps/web/tests/arivo-images.e2e.ts) consumes an opt-in private desktop grant from the isolated cloud orchestrator. Normal project, upload, quote, history, download and backup controls exercise the packaged Host. Preflight creates no paid task; the paid run has a two-credit ceiling and one Provider submission. Lost acceptance replies recover by the original command, and failed downloads never regenerate. Offline reopens and restored backups scroll results into view before checking their lazily loaded thumbnails. OS and creative-frame accessibility trees are recorded separately from native screenshots.

An explicit poll-only reconstruction accepts a private, configuration-matched handle from a completed paid run. It never calls Provider submission, uses a fresh isolated local Generation and test ledger, and labels the reconstructed receipt accordingly. It verifies the remaining product path with the same remote result; it does not turn an interrupted original acceptance run into a clean end-to-end pass.

## Alternatives considered

**Standalone plugin coverage alone:** it cannot verify the bundled manifest pin, the original OS composition or rail ownership. It remains useful for plugin failure cases but does not replace this test.

**Repeat paid Provider calls for each assembly check:** network and billing variability obscure composition failures and add cost. Existing real-Provider evidence remains separately required; this fixture makes no real model or settlement claim.

## Consequences

The regression checks the assembled product without replacing the installed application or changing enterprise configuration. It requires a matching local macOS bundle, Chrome and usable native credentials. Headless browser evidence does not establish native-window, installer, Windows, notarization or final release acceptance.
