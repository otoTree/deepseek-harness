# Agent Note: Enterprise plugin leases converge after restart and upgrade

Status: implemented

English | [中文](2026-10-05-enterprise-plugin-lease-reconciliation.zh.md)

## Problem

The browser Client target probe could cancel the Host reconciliation that issued its activation lease. A same-version Host target could also remain local after the server had revoked or rotated its activation. Separately, the upgrade transaction exposed a disabled installation as `preparing`, leaving the market controls locked after restart.

## Decision

Client target probes queue behind an in-flight Host reconciliation. The Host compares its active activation id with the server target row and reactivates when the server no longer recognizes that lease. Every activation endpoint refreshes the device lease. Upgrades preserve `preparing` only for enabled installations; disabled installations converge to `disabled`, and reads repair the stale disabled/preparing state left by older transactions. A failed device target remains failed after its activation is revoked, and its installation retains the error until a later enable or disable clears it.

## Alternatives considered

**Reload only when an enable request returns.** Rejected because the request may return before Host activation completes, leaving the intermediate preparation state visible indefinitely.

**Cancel Host reconciliation whenever a Client asks for targets.** Rejected because the probe is a read of Host-owned state and must not revoke a lease that is still being prepared.

**Treat every same-version local target as active forever.** Rejected because the API can revoke or expire its activation independently of the desktop process.

**Require users to reinstall a disabled installation stuck in preparation.** Rejected because the API can repair this invalid state without deleting plugin data.

## Consequences

The market observes a plugin revision published after each background reconciliation settles and reloads installation and device-target state. Request generations discard obsolete responses, and unmount invalidates pending reads. Preparing installations permit disablement and retained-data uninstall.

Restart and workspace reload no longer rotate a valid Client lease or strand a target in preparation. Expired or replaced leases are reacquired without requiring a client restart. A disabled installation remains actionable after an upgrade; failed activation revocation preserves its diagnosis, and explicit disablement clears that diagnosis.

## Testing

The enterprise Host runtime, Client runtime, API identity lifecycle, and package typecheck suites cover the changed paths, including preservation of failure details after heartbeat failure and lease revocation. Client component regressions verify active and failed states without manual refresh, available preparation controls, obsolete-read rejection, and disposal.
