# Agent Note: Renew enterprise Session write leases while handles are idle

Status: implemented

English | [中文](2026-09-14-enterprise-session-lease-renewal.zh.md)

## Problem

Enterprise Session write ownership expires on the server when a handle is idle. The native provider previously renewed only during append and flush, so the next user write after a quiet period was fenced with `write ownership was lost` even though the desktop Runtime remained active.

## Decision

Each remote write handle schedules its next renewal from the server-provided `leaseUntil`, halfway through the remaining lease. Renewals use the handle's serialized operation queue, and timer failures fence the handle so the next write reports the stable ownership error. Closing a handle cancels its timer and still releases the server lease.

## Alternatives considered

**Use a fixed renewal interval.** Rejected because the API owns the lease duration and deployments may configure different values.

**Reopen a handle automatically after it loses ownership.** Rejected because a new writer could overlap another owner and silently change the single-writer guarantee; callers must close and reopen explicitly.

## Consequences

An idle open Session retains its write lease while the authenticated Runtime remains active. A failed renewal does not revive a stale handle, and close remains responsible for releasing ownership.

## Testing

The complete Electrobun test suite passes with the provider's renewal timer active; gateway, desktop lifecycle, profile, and persistence integration paths remain covered.
