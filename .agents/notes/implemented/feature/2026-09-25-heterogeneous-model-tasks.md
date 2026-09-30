# Agent Note: Heterogeneous model tasks and external plugin consumers

Status: implemented

English | [中文](2026-09-25-heterogeneous-model-tasks.zh.md)

## Problem

Image, video, audio, and embedding providers expose different request, status, result, and usage fields. Browser-owned polling cannot reliably advance or settle provider tasks.

## Decision

The Enterprise API owns provider-neutral media tasks, versioned adapter snapshots, price snapshots, CNY wallet reservations, final settlement, and the thirty-minute reconciliation scan. Client task queries use the same API path as the scan. The scan selects old, due, unsettled tasks and settles only when a provider query returns a terminal state with complete usage.

Media plugins are independently maintained and packaged outside the Harness source workspace. The Enterprise runtime loads their declared Host and Client targets through the public Plugin SDK and module system. Disablement disposes contributions, invalidates module records, and removes owned styles before the same id can be enabled again. Client and Host target failures are isolated during reconciliation, and cleanup retries run before the next Host reconciliation. Workbench exposes generic panel and tab slots; no media plugin source or build reference belongs in the platform repository.

## Alternatives considered

**Put media operations in the text LLM stream.** Rejected because asynchronous provider tasks and typed media results need a separate execution and billing lifecycle.

**Settle every task when it reaches the thirty-minute scan age.** Rejected because age only triggers a provider query; processing tasks retain their reservation, and terminal tasks without complete usage remain unresolved.

**Call providers or change wallet balances from the canvas plugin.** Rejected because the Enterprise API owns provider credentials, task snapshots, reservations, and settlement.

## Consequences

External plugins and Agents consume the provider-neutral task API through the Plugin SDK. Plugin-owned storage and presentation remain outside the platform repository. Marketplace device operations update all declared targets in one transaction; runtime leases remain target-specific, and a failed target revokes sibling leases on that device. Uninstall revokes target leases immediately, and the next device-target read marks expired stopping rows disabled so a lost runtime cannot hold an installation forever. Activation errors remain visible on the marketplace card. Adapter configuration and version publication are restricted to the platform administration console.
