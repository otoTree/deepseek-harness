# Agent Note: Product plugin markets on the original Harness

Status: implemented

English | [中文](2026-10-26-product-plugin-market.zh.md)

## Problem

Arivo requires the existing plugin-market experience and Agent contributions with its own identity and publishing service. Composing the enterprise account plugin would introduce enterprise authority into a different product.

## Decision

The [Host adapter](../../../../packages/client/ui-enterprise/src/market-host.ts) accepts a native session supplier and product RPC path. The session captures account ownership and owns cancellation and credentials. The adapter reuses the original Cordis runtime, installer and cleanup; the optional runtime transport preserves existing enterprise defaults. One asynchronous disposal result owns concurrent account cancellation and shutdown.

The [Client adapter](../../../../packages/client/ui-enterprise/src/client/market.tsx) registers the original market through Rail and main.surface. Product text and publishing scopes are explicit. Revoked installations remain removable in a display-only projection; unavailable releases never enter the executable catalog. The Arivo builder registers the normally built market module factory without adding an enterprise boot row, preserving the original dependency table and stylesheet pipeline.

The [archive verifier](../../../../packages/plugin/protocol/src/archive.ts) is a public library entry. The [exporter](../../../../scripts/export-plugin-verifier.ts) packages a versioned artifact with source hashes for external consumers; products own publisher trust and permissions. Core creative startup remains independently bundled and does not require a market lease.

## Alternatives considered

A copied installer and market UI would duplicate lifecycle ownership. An enterprise boot row would also activate enterprise account and model consumers. A direct source alias would bypass the normal Client module table and stylesheet ownership.

## Consequences

The [Host adapter regression](../../../../packages/client/ui-enterprise/tests/market-host.test.ts) pins the canonical Client slot-report endpoint and single disposal. [Client regressions](../../../../packages/client/ui-enterprise/tests/client-runtime.spec.tsx) exercise the built factory and revoked display projection. Original runtime tests retain real Harness Tool/Skill/MCP coverage. Native macOS acceptance uses an authenticated local Arivo Admin and desktop, with a real ZIP providing a Tool, Skill and visible Workbench panel; Core owns screenshots and service evidence. Windows, formal publisher-signature trust and the full enterprise release matrix remain separate gates. Arivo rejects unimplemented cloud SDK capabilities at upload rather than claiming enterprise service compatibility.
