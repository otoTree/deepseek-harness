# Agent Note: Enterprise plugin reconciliation owns one active release

Status: implemented

English | [中文](2026-09-24-enterprise-plugin-lifecycle-reconciliation.zh.md)

## Problem

The enterprise market treated each immutable plugin release as a separate installation, and failed activation reporting could leave a Cordis contribution mounted after its lease was revoked. The same plugin could therefore activate two versions on one device and register the same Agent tool twice.

## Decision

An installation is selected by plugin identity and owner, while immutable releases are switched through the upgrade operation. The market groups published releases by plugin identity and offers upgrade for a newer release. The API rejects a second enabled installation of the same plugin on one device and target, regardless of owner kind. Runtime reconciliation releases a target before retrying activation when its active heartbeat fails. Deactivation folds device state back into the installation so a completed stop is observed as disabled.

## Alternatives considered

**Allow multiple releases and rely on Cordis scopes:** Rejected because Agent tools are global to the Host tool layer and same-named contributions cannot coexist.

**Keep a failed target mounted until the next reconciliation:** Rejected because revoked SDK leases and live Cordis contributions would disagree during that interval.

## Consequences

Upgrades preserve the installation and data space while replacing its release and permission revision. A device has at most one active installation of a plugin target. A failed activation reports failure only after its local disposer has run, so retrying cannot inherit the failed contribution. The market now exposes one card per plugin identity and uses the existing permission-confirmed upgrade endpoint. The Host bridge sends only the fields accepted by that endpoint. When a user switches between stale personal installations of the same plugin on one device, the device target is revoked before the new installation is enabled; organization-owned or other-user targets remain protected by the conflict response.

## Testing

Client runtime tests cover disposer execution after heartbeat failure and reactivation. Client and API checks cover upgrade request validation, stale personal-target switching, installing two releases of one plugin returning the same installation, standard activation and upgrade, and retained-data recovery. Host and Client type checks, package tests, and enterprise API tests pass.
