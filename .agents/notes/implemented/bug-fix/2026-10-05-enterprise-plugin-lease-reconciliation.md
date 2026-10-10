# Agent Note: Enterprise plugin leases converge after restart and upgrade

Status: implemented

English | [中文](2026-10-05-enterprise-plugin-lease-reconciliation.zh.md)

## Problem

The browser Client target probe could cancel the Host reconciliation that issued its activation lease. A same-version Host target could also remain local after the server had revoked or rotated its activation. Separately, the upgrade transaction exposed a disabled installation as `preparing`, leaving the market controls locked after restart.

## Decision

Client target probes queue behind an in-flight Host reconciliation. The Host compares its active activation id with the server target row and reactivates when the server no longer recognizes that lease. Every activation endpoint refreshes the device lease. Upgrades preserve `preparing` only for enabled installations; disabled installations converge to `disabled`, and reads repair the stale disabled/preparing state left by older transactions.

## Alternatives considered

**Cancel Host reconciliation whenever a Client asks for targets.** Rejected because the probe is a read of Host-owned state and must not revoke a lease that is still being prepared.

**Treat every same-version local target as active forever.** Rejected because the API can revoke or expire its activation independently of the desktop process.

**Require users to reinstall a disabled installation stuck in preparation.** Rejected because the API can repair this invalid state without deleting plugin data.

## Consequences

Restart and workspace reload no longer rotate a valid Client lease or strand a target in preparation. Expired or replaced leases are reacquired without requiring a client restart. A disabled installation remains actionable after an upgrade.

## Testing

The enterprise Host runtime, Client runtime, API identity lifecycle, and package typecheck suites cover the changed paths.
