# Agent Note: Enterprise plugin target rows follow the current installation revision

Status: implemented

English | [中文](2026-10-04-enterprise-plugin-target-coordination.zh.md)

## Problem

Device target rows and activation leases from an older release or permission revision could remain visible during reconciliation. The desktop runtime could then make a lifecycle decision from stale rows, while an activation id could be associated with a different release than the row being displayed. A target activation failure during window registration could also leave its row in `preparing` because registration occurred outside the failure reporting path.

## Decision

The device-target API returns only rows whose release and permission revision match the installation, and it binds returned activation ids to the same release and revision. The desktop runtime applies the same filter when deciding whether an installation has an enabled target. Client window registration is performed inside guarded activation cleanup so duplicate or invalid definitions report `failed` and revoke their lease. Lease revocation and failed-start reporting use a fresh bounded cleanup signal, so superseding preparation cannot cancel cleanup for a lease that was already issued.

## Alternatives considered

**Trust the latest device target row without matching its release.** Rejected because an older row can make the desktop runtime skip activation for the installed release or associate the wrong activation lease with it.

**Let window registration fail outside activation cleanup.** Rejected because a registration error would leave the server lease and target row active after the local target had already failed.

## Consequences

Old device rows no longer delay or advance current target activation. A target that cannot register its window contribution reaches a terminal failed state and does not remain indefinitely in preparation. A superseded activation is still revoked even when its preparation signal is aborted.

## Testing

The enterprise runtime suite covers stale device rows from an older release, superseded activation lease cleanup, and the existing activation timeout and failure reporting paths. API and package type checks are run for the changed surfaces.
