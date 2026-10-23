# Agent Note: Enterprise initialization preserves platform schemas

Status: implemented

English | [中文](2026-10-21-enterprise-platform-schema-initialization.zh.md)

## Problem

A provisioned PostgreSQL database can contain monitoring or account-management relations before an application creates its first table. A database-wide relation scan rejects this database as nonempty even when its enterprise schemas and public business tables are absent. Requiring an operator to remove platform objects makes automatic initialization unsuitable for managed databases.

## Decision

Before creating an installation marker, the [initializer](../../../../apps/api/src/initialize.ts) checks relations in `enterprise`, `enterprise_auth`, `drizzle` and `public`. Every relation in an enterprise or migration schema blocks an unmarked installation. A public relation blocks initialization unless PostgreSQL records it as an extension member through `pg_depend`. The error identifies the conflicting schema and relation.

Objects in other schemas are outside this check. Their names, owners and contents remain intact during initialization and restart. The initializer uses PostgreSQL extension membership rather than relation names to distinguish public extension objects from business data.

This decision supersedes the database-wide empty check in the [container initialization decision](../architecture/2026-10-20-enterprise-container-initialization.md). That note retains installation-marker validation, migration locking and administrator preservation. The [supplied-credential decision](../architecture/2026-10-21-enterprise-single-database-connection.md) continues to own database account selection.

## Alternatives considered

**Require the entire database to contain no user relations.** Platform provisioning can populate schemas before application startup, so this rejects an otherwise usable deployment database.

**Ignore named provider schemas or every public object.** Provider-specific names require an expanding exception list. Ignoring all public objects would also accept unrelated public business tables. Namespace scope plus extension membership preserves that rejection without depending on a provider's naming conventions.

**Remove the installation and collision checks.** An unmarked application schema may contain customer data or an incompatible migration history. Initialization must not silently adopt it or create a replacement administrator.

## Consequences

A deployment can initialize alongside platform schemas and public extension views without deleting those objects. Existing business relations in the checked schemas still stop startup before the installation marker is created. The check does not establish that the entire database is dedicated to this application: business data in other schemas is also outside its scope. Operators remain responsible for selecting the intended database and provisioning permissions.

## Testing

The isolated PostgreSQL fixture reproduces rejection with monitoring tables and views, an account-management table and a public `pg_stat_statements` extension. The regression verifies initialization and restart while preserving relation identifiers, ownership and platform data. Separate entrypoint cases verify that unmarked data in each checked schema prevents application launch, names the conflict, preserves the data and leaves the installation marker absent; the public case also contains extension views.
