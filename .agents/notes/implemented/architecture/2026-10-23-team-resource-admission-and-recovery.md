# Agent Note: Team resource admission and retained recovery

Status: implemented

English | [中文](2026-10-23-team-resource-admission-and-recovery.zh.md)

## Problem

Hierarchy inheritance can grant authority in another team's data, while platform recovery can accidentally impersonate its members. Reservation-based media billing and partial overage collection conflict with post-settlement text billing. Counting only live file heads permits retained versions, trash and concurrent uploads to exceed storage limits without an explainable ledger.

## Decision

Each team requires an exact membership in both deployment modes. Departments organize one team's members and sharing; they grant no implicit team administration. Platform identity uses separate reasoned, audited operations and grants no content access. Effective team permissions subtract denials and share final-effective-Owner protection across interactive administration, directory sync and lifecycle operations. Team selection stops the preceding desktop runtime and never falls back to another team.

Paid admission checks the team's positive balance and the initiating member's settled monthly spending. Current media tasks and text debit the entire actual charge after settlement; already-admitted requests can exceed both limits. Owners bypass only their personal budget. Admission fixes account, membership, budget month, time zone and department IDs. Role changes and restoration preserve spending. Unknown supplier usage remains pending reconciliation. Historical task engines keep their durable billing semantics.

Team storage counts retained versions, trash and upload reservations. Admission serializes on the team record. Publication copies staging bytes into a separate immutable version key, and durable physical cleanup releases occupancy only after deletion succeeds. Same-team moves recheck destination ownership and sharing; copies consume additional bytes. Offboarding custody grants management metadata without content access. Submitted tasks retain restricted background authority for querying, settlement and saving after suspension; saving retries preserve generation and billing identity.

[Team administration](../../../../docs/developer/enterprise-team-governance.md) owns operational details. This decision supersedes private-company inheritance in [team isolation](../bug-fix/2026-10-22-open-registration-team-isolation.md) and universal visibility in the [platform catalog](2026-09-14-platform-wide-model-catalog.md). Those notes retain useful explicit-query/RLS and single-publication-source rationale. The [identity proposal](../../proposed/architecture/2026-09-05-enterprise-identity-and-organization.md) retains independent unfinished scope.

## Alternatives considered

**Pre-reserve media funds or collect only available balance.** These mechanisms reject concurrent work on a different rule from text or discard part of an actual supplier charge. Estimates remain informational; full debits preserve financial history.

**Use child teams for private-company departments.** Ancestor memberships and roles make independently funded teams share authority. Team-local departments preserve organizational structure without cross-team access.

**Give platform operators or asset custodians member/content authority.** Recovery requires narrowly selected changes and a reason; implicit content access exceeds that purpose. Explicit sharing remains necessary for reads.

**Release storage at logical deletion or count only file heads.** Retained objects still consume capacity, and failed object deletion can remain indefinitely. Durable deletion confirmation keeps accounting tied to owned bytes.

## Consequences

Resource policies and configuration revisions are explicit; stale writes fail. Shrinking capacity preserves data. In-flight calls can produce a negative wallet or overspent member, and new paid admission stops thereafter. Suspension, closure, top-ups and restoration retain bills and assets and never replay failed paid tasks. Migration 0040 is append-only; application startup never rebuilds databases or rewrites released Session generations.

## Verification

Isolated PostgreSQL HTTP tests exercise exact membership, denials, Owner protection, concurrent admission, monthly attribution, immutable upload commits, durable cleanup, custody and compensating directory changes. Desktop Host/Client tests and keyless browser/Session scenarios exercise the shared SDK and account flows. Real supplier execution, production email delivery and the real-service/model GIF require deployment credentials; fixture evidence does not establish those results.
