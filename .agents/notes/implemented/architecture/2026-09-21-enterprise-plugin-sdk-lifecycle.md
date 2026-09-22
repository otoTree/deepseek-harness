# Agent Note: Enterprise plugins use installation-scoped capability leases

Status: implemented

English | [中文](2026-09-21-enterprise-plugin-sdk-lifecycle.zh.md)

## Problem

Enterprise plugin installation needs one identity and authorization record that remains valid across devices and releases while each runtime call can be revoked immediately. The existing account-level enabled flag does not express device state, activation leases, permission revisions, or data retention.

## Decision

Enterprise plugins keep the trusted Cordis execution model and receive a capability SDK through an activation lease. The lease binds the plugin release, installation, device target, account, organization, and permission revision. Runtime requests recheck those bindings against the control-plane records instead of trusting identifiers supplied by plugin code.

The public plugin packages are separate from the Agent JSON-RPC SDK. The protocol package owns branded identifiers and manifest declarations, the author SDK owns identity, text models, objects, database, and cache facades, and the runtime package owns Cordis injection and disposal. The SDK has no scheduler, queue, worker, or background-task API.

Manifest permissions use a closed capability vocabulary, and the runtime checks the required permission on every call in addition to the declared resource.

## Consequences

Personal and organization installations share the release format but differ in management authority. Uninstall revokes leases and retains the data space; export, deletion, and reauthorization are explicit operations. Cloud targets and non-text generation remain outside the published capability directory.

Host and Client contributions load through the same installation-scoped runtime. A heartbeat identifies its activation and is accepted only while its release and permission revision remain current. Replacing a device-target lease revokes its predecessor. SDK model output returned by an Agent tool uses the existing `tool/call` and `tool/result` Session events; Client-only SDK calls do not create Agent Session events.

## Verification

Manifest tests accept resource, SDK, and migration declarations and reject Cloud targets. API integration tests cover ZIP upload, installation, device activation, SDK identity access, permission-confirmed upgrade, stale activation rejection, uninstall, retained data, PostgreSQL migration, Redis isolation, and MinIO persistence. Runtime tests load real ZIP modules and verify Host and Client contribution removal. The acceptance Agent test reconstructs a plugin tool result from Session events before the next model request.

## Alternatives considered

- **Use the account `enabled` flag as runtime truth** — rejected because it cannot represent device activation, stale callbacks, or a revocable lease.
- **Give plugin code platform credentials** — rejected because credentials would allow identity and resource bindings to be forged.
- **Expose a generic background worker API** — rejected because scheduling and recovery belong to platform services rather than the author SDK.
