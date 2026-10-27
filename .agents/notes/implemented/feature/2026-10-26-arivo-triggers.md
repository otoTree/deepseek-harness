# Agent Note: Arivo managed triggers

Status: implemented

English | [中文](2026-10-26-arivo-triggers.zh.md)

## Problem

Arivo creators need the original desktop trigger controls in the permanent Rail, while their account and project models remain independent of the enterprise product.

## Decision

The [startup Host](../../../../apps/electrobun/src/distribution/arivo-shell/host/triggers.ts) mounts the original trigger runtime with a native-supervisor-selected account store. Its authenticated RPC captures the native account, rejects cloud sources, resolves the target project folder and freezes the project's model for new Sessions. Existing Sessions retain their model and the normal Arivo model admission. The [shared editor](../../../../packages/client/ui-enterprise/src/client/triggers.tsx) serves both products; the existing Client apply entry accepts a trigger-only composition without installing enterprise account pages. Arivo hides cloud sources and uses the shipped standard Agent preset.

## Alternatives considered

Copying the trigger editor and scheduler would create competing owners. Booting the enterprise plugin would introduce its account and cloud service dependencies into Arivo. The [enterprise trigger decision](2026-09-24-enterprise-triggers.md) remains active: this addition changes only product composition and fixes metadata passed during enable changes.

## Consequences

Rule state belongs to the account's Harness home and stays outside project exports. Original permission, Session delivery, batching, recovery and billing owners remain in place. A stopped desktop does not run timers or wake the operating system. The runtime strips version and timestamps before publishing an enable revision, so strict authoring validation accepts it.

## Testing

Native RPC tests cover account expiry, project/model selection, forbidden cloud sources, matching, enable and removal. Runtime tests cover file events, merged batches, deterministic retry and rule revisions after restart. Client tests retain enterprise controls and verify the local-only product form. Packaged browser evidence and broader GUI failures are recorded in the Arivo cloud workspace; this note does not close native, Windows, real Provider or release acceptance.
