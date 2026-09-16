# Agent Note: Enterprise dialogue startup ownership

Status: implemented

English | [中文](2026-09-14-enterprise-dialogue-startup.zh.md)

## Problem

The enterprise desktop runtime can load models and acquire session leases while its API is still starting. Multiple desktop runtimes can also point at one organization home and fence each other's session writers.

## Decision

The enterprise stack waits for the API and admin health endpoints before starting the desktop process. Each organization home has a POSIX kernel lock held for the runtime lifetime, so a second runtime fails explicitly and process exit releases the lock.

## Alternatives considered

- Starting the desktop process concurrently with remote services: rejected because runtime initialization can reach unavailable model and session APIs.
- Detecting duplicate runtimes through a process-local map: rejected because separate coordinators would not share that state.

## Consequences

Desktop startup no longer races remote model and session services. A duplicate organization runtime reports an actionable ownership error instead of corrupting remote session lease state.

## Testing

The runtime lifecycle suite covers duplicate organization ownership and restart release. Runtime typecheck passes.
