# Agent Note: Directory synchronization uses canonical pages and sampled previews

Status: implemented

English | [中文](2026-10-02-enterprise-directory-sync-pagination.zh.md)

## Problem

The directory script previously returned one unbounded object. Administrators could not see how enterprise fields became organization and account records, and a large directory would be materialized in the worker, database preview, and browser at once.

## Decision

Directory scripts accept the existing array response and a canonical paged response. A paged entity has `items`, an optional `nextCursor`, and an optional `total`. The standard entities are `organizations`, `users`, and `memberships`; each record uses a stable `externalId`, and relationships use the corresponding external IDs. Preview accepts at most 1,000 records per entity page, stores counts, cursor metadata, and a small sample, and records at most that page's bounded diffs. The administrator advances the source cursor page by page; each page can be previewed, approved, retried, and rolled back independently.

The admin script dialog provides REST, LDAP, and table/database templates with an enterprise-field conversion example, sample input, output fields, and the cursor workflow. Existing array-returning scripts remain executable.

## Alternatives considered

- **Keep returning the complete result** — this retains the memory and browser limits that make large directories unsafe.
- **Invent an asynchronous generator API in the sandbox** — the current worker contract executes one function call and does not provide a durable network or scheduler capability.
- **Use array indexes as identifiers** — indexes change between pages and would create duplicate accounts or organizations.

## Consequences

- Enterprise source connectors must fetch a page, call the script with that page, and continue with `nextCursor`.
- Preview is intentionally sampled; it does not expose all page records in the browser.
- Applying a page creates or updates organizations, users, and memberships through the existing approval workflow. Unsupported source fields remain in the record for review but are not silently applied.

## Verification

Admin and API typechecks, API sync-runner tests, and `git diff --check` pass.
