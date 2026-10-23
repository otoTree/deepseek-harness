# Agent Note: Local desktop conversations and request-driven cloud authorization

Status: implemented

English | [中文](2026-10-22-local-desktop-sessions.zh.md)

## Problem

A device heartbeat makes an open desktop generate database work even while idle. Cloud conversation writes also put local history and workspace availability behind the API. Device quotas count installations rather than scarce request capacity, and short online leases make ordinary network outages stop local work.

## Decision

The desktop mounts the standard local JSONL provider. Storage identity combines the normalized API origin, account ID and organization ID; it is stable across login-token replacement and separates accounts on one computer. Ordinary startup restores protected credentials and local storage without a cloud request. Logout stops local execution, attempts cloud revocation and deletes credentials while retaining local files. Remote revocation cannot prevent offline reading of files already stored on that computer.

The API issues opaque, hashed, revocable login authorizations without a device quota or heartbeat. `loginSessionSeconds` defines inactivity expiry, defaulting to 30 days. Real authenticated cloud requests verify membership and expiry, then extend a still-valid token during the second half of its lifetime. Expired tokens require login; a timestamp saved at login is not authoritative server state. The token is not rotated on renewal. Model usage, drive access and plugin control remain cloud-authorized operations. Plugin activation leases and remote archive writer leases retain their separate ownership semantics.

Account settings explicitly uploads all local conversations and downloads account-owned cloud archives for the same account and organization. Each upload page locks its archive in a short transaction, verifies immutable metadata and overlapping events, and appends only a contiguous suffix. This serializes concurrent uploads without a persistent writer lease or renewal traffic. An active legacy writer refuses uploads. Downloads validate a complete archive before local creation and extend only an identical durable prefix; an active local writer must close before extension. Either direction retains longer identical histories and refuses divergence. Completed pages remain durable after failure, so retries resume safely. Transfers perform no background synchronization and do not copy attachments or workspace files. Each archive is assembled in Host memory.

The [server-authority note](../bug-fix/2026-09-14-enterprise-client-renewed-runtime-lease.md) retains credential-binding rationale, and the [restoration note](../bug-fix/2026-10-21-desktop-login-restoration.md) retains deployment-scoped credential location. This decision supersedes their online-lease lifecycle. The [settings-recovery note](../bug-fix/2026-10-22-desktop-heartbeat-transient-failures.md) retains independent settings navigation and failure-recovery rationale. Device quota accounting is fully superseded.

## Alternatives considered

**Keep cloud persistence with a longer heartbeat.** This reduces write frequency but still ties local history and startup to network and database availability.

**Replace PostgreSQL heartbeats with Redis device leases.** This moves idle traffic to another service without a requirement for online-device admission.

**Keep a device cap.** A stored login does not reserve a database connection. Bounded database pools and request admission govern actual cloud concurrency.

**Automatically merge cloud and local history.** Divergent event logs require an explicit conflict policy. Prefix-only import preserves existing history and makes conflicts visible.

## Consequences

Local conversation persistence and idle desktop lifetime do not consume API database connections. Cloud requests still consume short transactions; plugin polling and activation renewal can generate idle traffic independently. Local files require backups, and computers do not share conversation changes automatically. Cloud authorization expiry does not terminate the local runtime. The storage namespace isolates application selection; it does not encrypt files or restrict the operating-system user.

## Verification

Real-process desktop tests cover offline reopen, expired saved credentials, stable account identity, account/deployment isolation, logout and failure cleanup. Real PostgreSQL tests cover unlimited registration through both entry paths, request renewal, expiry, revocation and suspended membership. Transfer tests use JSONL storage for pagination, repeated transfers, interrupted-upload recovery, second-device downloads, longer local histories, conflict refusal, cancellation and released-event validation. PostgreSQL upload tests cover bearer authorization, account and tenant isolation, idempotent pages, gaps, divergence and active-writer refusal. The recorded-session settings browser case covers upload, download and failure recovery through the Host bridge. The [desktop README](../../../../apps/electrobun/README.md#local-session-storage) owns operational storage details.
