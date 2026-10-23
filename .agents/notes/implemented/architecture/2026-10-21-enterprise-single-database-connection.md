# Agent Note: Enterprise deployments use the supplied database credentials

Status: implemented

English | [中文](2026-10-21-enterprise-single-database-connection.zh.md)

## Problem

An operator may have only one PostgreSQL connection string, including a provider-supplied `postgres` login. Requiring additional roles or a second connection string prevents this deployment from initializing even when its existing account can perform every required database operation.

## Decision

`ENTERPRISE_DATABASE_URL` supplies the account and password for both automatic initialization and API execution. The initializer accepts custom account names, shared ownership, superusers and `BYPASSRLS`. It creates no roles, substitutes no credentials and changes no database passwords. Actual PostgreSQL DDL permissions determine whether schema creation and migrations can run; insufficient permissions stop startup.

An optional, nonempty `ENTERPRISE_MIGRATION_URL` selects a separate initialization account for the same host, port and database. An absent or empty value uses `ENTERPRISE_DATABASE_URL`. Migration grants target the application connection's actual `current_user`, with quoted identifiers and unchanged migration hashes.

This decision supersedes the account-separation requirement and schema-owner equality check in the [initialization decision](2026-10-20-enterprise-container-initialization.md). That note remains authoritative for installation markers, advisory locking, administrator bootstrap and restart preservation. Operators who require database-enforced isolation can supply separate non-privileged accounts.

## Alternatives considered

**Require separate non-privileged migration and application accounts.** This gives stronger database privilege separation but requires infrastructure credentials the operator may not have. It remains available through the optional migration URL.

**Automatically create another runtime role from the supplied superuser.** This violates the operator's requirement to use only the supplied account and would introduce generated credentials, role ownership and password rotation that the deployment has not configured.

## Consequences

A single connection string is sufficient when its account can create the database objects and apply migrations. A superuser or `BYPASSRLS` account bypasses PostgreSQL RLS, including forced policies. An API that owns its tables can alter permissions and policies and bypass policies that are not forced. Append-only grants are not an effective security boundary against a table owner or superuser. Application authorization remains required, and these deployments must not claim the database isolation guarantees of a separate non-privileged runtime account.

The installation marker and [schema-scoped collision checks](../bug-fix/2026-10-21-enterprise-platform-schema-initialization.md) protect against accidental adoption of existing application relations. They do not restrict the supplied account's underlying privileges.

## Testing

The isolated PostgreSQL startup tests cover one `postgres` URL without a migration override, a single custom database owner, separate custom accounts, incorrect passwords and insufficient schema permissions. They exercise compiled entrypoint startup, API profile launch and administrator preservation across restart. The amd64 image smoke exercises real HTTP administrator login and authenticated API reads before and after restart with only the supplied database URL.
