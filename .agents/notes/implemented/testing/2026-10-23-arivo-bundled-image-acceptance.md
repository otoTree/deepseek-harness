# Agent Note: Arivo bundled image acceptance

Status: implemented

English | [中文](2026-10-23-arivo-bundled-image-acceptance.zh.md)

## Problem

Standalone creative-plugin tests can pass while the desktop bundle loads another plugin manifest or loses the original Agent when its creative pane opens. Composition acceptance must exercise the verified release and the normal OS navigation together.

## Decision

[Packaged browser acceptance](../../../../apps/web/tests/arivo-startup.e2e.ts) starts the complete Arivo bundle through its native supervisor in a disposable home. It reads the bundle’s manifest pin, uses the native credential helper and opens the original OS shell in Chrome. The creative pane uses the normal rail and project controls. The language catalog is selected through the ordinary model settings; the fixture rejects any language generation request.

The test’s private loopback fixture supplies explicit unpaid cloud responses. It checks one image creation, a lost reconciliation reply, durable recovery across full Host replacement, the original reconciliation UUID and decoded local output. Returning to the original Agent preserves its draft before restart. A separate unconfigured-shell case verifies that the composer remains disabled without an available model.

## Alternatives considered

**Standalone plugin coverage alone:** it cannot verify the bundled manifest pin, the original OS composition or rail ownership. It remains useful for plugin failure cases but does not replace this test.

**Repeat paid Provider calls for each assembly check:** network and billing variability obscure composition failures and add cost. Existing real-Provider evidence remains separately required; this fixture makes no real model or settlement claim.

## Consequences

The regression checks the assembled product without replacing the installed application or changing enterprise configuration. It requires a matching local macOS bundle, Chrome and usable native credentials. Headless browser evidence does not establish native-window, installer, Windows, notarization or final release acceptance.
