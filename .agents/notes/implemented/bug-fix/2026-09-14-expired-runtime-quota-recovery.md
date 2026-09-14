# Agent Note: Exclude expired runtimes from registration quota

Status: implemented

English | [中文](2026-09-14-expired-runtime-quota-recovery.zh.md)

## Problem

Runtime leases expire when a desktop client stops renewing its heartbeat, but quota admission counted every unrevoked row. A client could therefore lose access after an old device lease expired while the expired row continued to consume the entire organization runtime quota.

## Decision

Desktop authorization exchange and authenticated runtime registration count only rows whose `revokedAt` is null and whose `leaseUntil` is later than the admission timestamp. Expired rows remain durable for administration and audit, while an active client can still renew its lease through the heartbeat route. Newly issued leases use the same timestamp captured for the quota check.

## Alternatives considered

**Require an administrator to revoke every expired row manually.** Rejected because lease expiry is already the server's authoritative liveness signal; manual cleanup would turn a normal disconnect into a quota outage.

**Delete expired rows during admission.** Rejected because runtime history remains useful for administration and audit, and deletion is not needed to release capacity.

**Ignore lease expiry only for desktop authorization.** Rejected because the authenticated runtime-registration route would retain the same outage and expose inconsistent quota behavior across the two registration paths.

## Consequences

An organization can register a new desktop runtime after old leases expire without destructive cleanup. Expired rows remain visible and can still be explicitly revoked. A runtime must continue heartbeating to retain an active quota slot.

## Testing

`apps/api/tests/identity.test.ts` fills the organization's quota with two expired, unrevoked rows and verifies that both desktop authorization and cookie-authenticated runtime registration still register a new runtime. The API typecheck and focused identity suite cover the changed admission paths.
