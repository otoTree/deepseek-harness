# Agent Note: Enterprise Client mounts renew their target lease

Status: implemented

English | [中文](2026-10-04-enterprise-client-heartbeat.zh.md)

## Problem

The desktop Host marked a Client target as locally active after receiving the browser mount report, but the report only updated an in-memory diagnostic map. The enterprise API therefore kept the Client device target and the installation in `preparing` until a later Host lease renewal, or indefinitely when the renewal did not run.

## Decision

`plugin-client-window-state` awaits the Host runtime's Client heartbeat. An `active` browser mount reports `active` with a renewed lease, and a failed mount reports `failed` with its error. A `disconnected` report remains local-only because the API has no disconnected target state. The browser passes its activation deadline signal through the Connection RPC so an unresponsive heartbeat cannot hold Client reconciliation past that deadline.

## Consequences

An installation reaches `active` as soon as both Host activation and browser Client mounting succeed. The API receives Client activation failures at the point they occur and can revoke the failed target. Browser window diagnostics remain available even when the heartbeat request fails. Multiple windows may report `active`; a failed report follows the API's existing target-level failure semantics.

## Testing

The Host runtime suite verifies that a Client mount sends an `active` heartbeat, that a failed mount sends its error, and that a disconnect sends no heartbeat. The browser runtime suite continues to exercise the real Connection RPC path for successful and failed Client mount reports.

## Alternatives considered

**Wait for the five-minute Host lease renewal.** Rejected because a successful browser mount must complete installation activation promptly and a renewal timer is not a Client lifecycle acknowledgment.

**Mark the Client target active when the Host creates its activation lease.** Rejected because the browser bundle may still fail to load or mount after the lease is created.

**Map `disconnected` to `failed`.** Rejected because closing a page does not prove that the Client target failed, and the API would revoke a healthy target based on a transport lifecycle event.
