# Agent Note: Backend containers initialize deployments before serving HTTP

Status: implemented

English | [中文](2026-10-20-enterprise-container-initialization.zh.md)

## Problem

A Backend image that only starts its API cannot serve a fresh database or create the administrator needed to sign in to Admin. Requiring operators to mount a local development environment file and invoke migration and provisioning scripts separately makes the container deployment incomplete.

## Decision

The Backend entrypoint runs compiled database initialization before executing the supported `dsh` profile. It reads deployment variables directly and requires a dedicated PostgreSQL database. The [single-connection credential decision](2026-10-21-enterprise-single-database-connection.md) owns account selection and DDL permissions. The initializer creates schemas and the installation marker after the [schema-scoped collision check](../bug-fix/2026-10-21-enterprise-platform-schema-initialization.md). That decision owns coexistence with platform schemas and PostgreSQL extensions; unmarked application relations still block startup.

The [migration runner](../../../../apps/api/src/migrations.ts) binds historical GRANT and REVOKE recipients to the actual connected application account with PostgreSQL identifier quoting. Drizzle retains ownership of migration transactions, ordering and journal writes, including the original migration file hashes. Schema grants use the configured application identity rather than development account names. This keeps existing migration journals valid without requiring extra database roles.

A private single-connection migration pool holds a session advisory lock across schema setup, Drizzle migrations and application-role provisioning. The provision transaction shares the development provisioner's transaction lock and initial-administrator helpers. Only a missing deployment accepts bootstrap credentials, with a password of at least 12 characters. Existing deployments retain account credentials, registration policy and membership state; a missing administrator or mismatched mode fails explicitly. The entrypoint removes migration and bootstrap variables before the API process starts and forwards termination during initialization.

The [container publication decision](2026-10-17-enterprise-container-images.md) owns image publication. The [local repair decision](../bug-fix/2026-10-04-enterprise-local-provisioning-repair.md) continues to own explicit development repairs; automatic container startup does not reactivate suspended memberships.

## Alternatives considered

**Require a separate manual migration and provisioning command.** Operators expect a newly started Backend to create its administrator and serve Admin without a second application command.

**Use the application role for schema upgrades.** Granting schema ownership or privileged bypass rights to the API process weakens the role separation that protects tenant data. The [credential decision](2026-10-21-enterprise-single-database-connection.md) governs deployments that select this trade-off.

**Reset the administrator or repair every root on each restart.** Bootstrap environment values must not replace an existing password or reactivate suspended access. Explicit repair remains a separate operation.

## Consequences

Backend startup waits for database upgrades; a failed initialization prevents HTTP serving. An optional separate migration credential is removed before the API process starts. PostgreSQL infrastructure, a database login and the object-storage bucket still need provisioning outside the Backend image. Redis and object-storage behavior are unchanged.

## Testing

An isolated PostgreSQL fixture exercises the real shell entrypoint and compiled initializer with custom account names, including quotes, dots and URL-encoded characters, and different passwords. It checks the supported API profile, administrator sign-in, original journal hashes, function grants, owner-local expected startup output, pending migration application, restart preservation, append-only permissions, concurrent startup locking and invalid database or credential rejection.
