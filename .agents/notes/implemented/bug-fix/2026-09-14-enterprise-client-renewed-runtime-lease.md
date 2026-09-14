# Agent Note: Use the server Runtime lease for enterprise client requests

Status: implemented

English | [中文](2026-09-14-enterprise-client-renewed-runtime-lease.zh.md)

## Problem

The enterprise dashboard, model settings, and plugin catalog share one Host RPC bridge. The bridge rejected the Keychain credential after the `leaseUntil` value captured during login passed, even though the native heartbeat had renewed the Runtime lease on the server. All three settings pages therefore became unavailable together after one initial lease period.

## Decision

The Host bridge validates the stored API origin, organization ID, Runtime ID, and Keychain account binding before every enterprise request. It does not use the login response's `leaseUntil` snapshot as current liveness state. The enterprise API remains authoritative: every authenticated request resolves the Runtime token and rejects an expired, revoked, or mismatched server record. The native heartbeat continues to renew that server record and stops the managed Runtime after renewal fails.

## Alternatives considered

**Rewrite the Keychain credential after every heartbeat.** Rejected because lease renewal already commits on the server, while repeated secret-store writes create a second state update that can fail after a successful renewal and leave the same disagreement.

**Keep rejecting the initial lease snapshot locally.** Rejected because that timestamp cannot represent renewals and deterministically invalidates a healthy long-running desktop session.

**Remove all Host credential checks.** Rejected because the bridge must still prevent a credential for another deployment, organization, or Runtime from being used by the generated profile.

## Consequences

Enterprise account, model, and plugin settings remain available while the server accepts the heartbeating Runtime. Revocation, lease expiry, organization mismatch, and deployment mismatch still fail through the authoritative API or the Host binding checks. A server outage continues to render the affected page unavailable and can be retried.

## Testing

The Host bridge test stores an already-passed initial `leaseUntil` value and verifies that authenticated dashboard, model, Runtime, usage, and plugin requests still succeed. A separate case verifies that a mismatched deployment origin remains rejected before a request is sent.
