# Agent Note: Enterprise plugin upgrades converge browser Client targets

Status: implemented

English | [中文](2026-09-28-enterprise-plugin-upgrade-client-convergence.zh.md)

## Problem

An enabled plugin upgrade revokes the old activation and changes the installation release, but the browser Client runtime is reconciled only when the connection generation changes. The Host can finish loading the new release while the browser still holds the old Client contribution, leaving device targets in `preparing` and the market card stuck in a changing state.

## Decision

The enterprise Client upgrade action waits for the control-plane upgrade call and then invokes the browser Client runtime reconciler. The existing Host-side reconcile remains part of the enterprise RPC upgrade endpoint. The browser reconciler unloads the old activation, loads the new Client target, and reports its active or failed heartbeat before the upgrade action returns to the market UI.

## Alternatives considered

**Rely on the next connection-generation event.** Rejected because a release switch does not require a new connection generation, so the old browser contribution can remain mounted indefinitely.

**Refresh only the plugin market data.** Rejected because catalog and installation reads do not unload or mount Client contributions and cannot update the device heartbeat.

**Add a separate upgrade-specific browser loading path.** Rejected because it would duplicate target replacement, cleanup, activation deadlines, and heartbeat handling already owned by the Client runtime reconciler.

## Consequences

An upgrade from the plugin market now converges Host and browser Client targets before the UI reports completion. Failed Client loading is recorded through the existing heartbeat path and remains visible as an activation error. The market UI still reflects the server's observed state and does not claim success when the browser target has not mounted.

## Testing

The enterprise Client tests verify that an upgrade invokes `plugin-runtime-targets` reconciliation after the upgrade request. The Client runtime tests cover release replacement, cleanup, and active heartbeat behavior; the enterprise package typecheck passes.
