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

Host and Client cleanup has a bounded ten-second default, configurable through `cleanupTimeoutMs`; a stalled disposer becomes a cleanup failure and cannot hold the serialized reconciliation queue indefinitely. The Host schedules another reconciliation at the failure's exponential-backoff deadline and repeats until target deactivation and uninstall completion converge.

Host and Client preparation has a bounded thirty-second default, configurable through `activationTimeoutMs`. The Host sends both lifecycle deadlines to the browser with its target snapshot. A timed-out target requests Cordis disposal, reports activation failure, and releases its lease so another plugin can finish in the same reconciliation round.

Standard Host bundles keep `@deepseek-ai/cordis` external so their services use the running Host's Cordis instance. The package loader parses module requests, links that import through the DSH installation anchor, leaves Node built-ins intact, and rejects other external or non-literal dynamic imports before evaluation. It evaluates each verified bundle from a private temporary package directory, rather than a `data:` URL, so `import.meta.url` remains a valid file location for bundled dependencies; the directory is removed after module evaluation.

The enterprise Client declares the Client module system as a Cordis injection before accessing it from its isolated context. It subscribes to Connection generation state and starts browser reconciliation only after a generation is ready, which covers both module activation orders without a polling timer.

Within one reconciliation round, independent installations and targets are processed with `Promise.allSettled`; a failed stop, start, lease renewal, or uninstall completion is logged for that plugin while other plugins continue. The market applies operation locks per installation or release, so a pending action cannot disable another plugin's controls.

The device-target directory uses typed timestamp comparisons when expiring leases. Installation state aggregation includes only targets with a current lease, so a stopped Runtime's expired `preparing` record cannot prevent active targets from making the installation active. If that directory is temporarily unavailable, the Host logs the directory failure and still reconciles the catalog and installation records, including uninstall completion for installations with no local contribution.

The Host bridge starts reconciliation after an uninstall request changes the server state, so revocation reaches the local Host and the retained installation can leave `stopping` without waiting for a later connection reset.

## Testing

Client runtime tests cover disposer execution after heartbeat failure and reactivation, stalled Host and Client cleanup, external Cordis linking from a file-backed package directory, Connection-generation startup, and independent Host and Client preparation timeouts. Client and API checks cover upgrade request validation, stale personal-target switching, expired Runtime leases during installation state aggregation, installing two releases of one plugin returning the same installation, standard activation and upgrade, and retained-data recovery. A real enterprise Host plus a Chromium Client activates both targets of the packaged `media.canvas` release and renders its Client contribution. Host and Client type checks, package tests, and enterprise API tests pass.
