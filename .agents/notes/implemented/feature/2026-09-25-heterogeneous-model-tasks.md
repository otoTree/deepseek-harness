# Agent Note: Heterogeneous model tasks and external plugin consumers

Status: implemented

English | [中文](2026-09-25-heterogeneous-model-tasks.zh.md)

## Problem

Image, video, audio, and embedding providers expose different request, status, result, and usage fields. Browser-owned polling cannot reliably advance or settle provider tasks.

## Decision

The Enterprise API shares Providers, platform model UUIDs, wallet transactions, and the public catalog across text and media. Text retains its protocol relay; media creation commits a reservation and immutable operation snapshot before returning. A leased PostgreSQL Worker submits and polls without a connected Client. Submission uncertainty requires documentary reconciliation because an automatic retry can create a second billable generation. Client queries only read platform state. HTTP status diagnostics omit supplier bodies; a submission error retains its hold until documentary reconciliation establishes a free failure or an accepted task.

Versioned adapters resolve parameters and reference-price conditions before reservation. Missing final usage can settle the reservation with an explicit estimate basis; zero usage remains valid. Supplier-completed output validation errors retain their billable usage; delivery failure alone cannot justify releasing a hold. Execution, asset persistence, and billing remain distinct so a failed download cannot regenerate or recharge an accepted result. Owned asset IDs survive supplier URL expiry. Overage debt and audited corrections append financial facts instead of rewriting history. [The model platform reference](../../../../docs/developer/model-platform.md) owns configuration and recovery procedures.

Media plugins are independently maintained and packaged outside the Harness source workspace. The Enterprise runtime loads their declared Host and Client targets through the public Plugin SDK and module system. Disablement disposes contributions, invalidates module records, and removes owned styles before the same id can be enabled again. Client and Host target failures are isolated during reconciliation, and cleanup retries run before the next Host reconciliation. Workbench exposes generic panel and tab slots; no media plugin source or build reference belongs in the platform repository.

## Alternatives considered

**Put media operations in the text LLM stream.** Rejected because asynchronous provider tasks and typed media results need a separate execution and billing lifecycle.

**Infer failure or final cost from elapsed time.** Rejected because a tracking deadline cannot establish supplier failure or actual usage. Unknown submissions retain their hold; reservation fallback is an explicit pricing policy with an auditable basis.

**Call providers or change wallet balances from the canvas plugin.** Rejected because the Enterprise API owns provider credentials, task snapshots, reservations, and settlement.

## Consequences

External plugins and Agents consume the provider-neutral task API through the Plugin SDK. Plugin-owned storage and presentation remain outside the platform repository. Marketplace device operations update all declared targets in one transaction; runtime leases remain target-specific, and a failed target revokes sibling leases on that device. Uninstall revokes target leases immediately, and the next device-target read marks expired stopping rows disabled so a lost runtime cannot hold an installation forever. Activation errors remain visible on the marketplace card. Adapter configuration and version publication are restricted to the platform administration console.
