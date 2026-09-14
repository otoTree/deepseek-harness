# Agent Note: Enterprise console uses one organization and account control plane

Status: implemented

English | [中文](2026-09-13-enterprise-console-organization-directory.zh.md)

## Problem

The administration console mixed tenant units, platform organizations, accounts, and model settings in one page. A platform administrator could not inspect the global organization tree or an account's cross-organization resources, and model grants lacked default and priority state.

## Decision

The console exposes global organization, account, audit, and model configuration pages while retaining the existing organization-scoped pages. Organization tree reads are root-first and load direct children on expansion; selecting a node sets the current context and never implicitly includes descendants. Account details load organizations, roles, runtimes, sessions, usage, and history by tab. Model grants store enabled, priority, and default state in the shared organization model and enforce one enabled default per organization.

Platform administrator reads set a transaction-local platform flag for RLS-protected resources. Writes continue to require an explicit organization and preserve audit records. Open and private deployments therefore use the same organization, membership, role, resource, and grant tables.

## Alternatives considered

- Keeping platform data in the tenant overview: rejected because it hides the global scope and couples unrelated request failures.
- Returning the full organization tree on every request: rejected because large enterprises need bounded root and child queries.
- Creating a separate platform-only account or model schema: rejected because it would diverge from private deployments and break shared authorization.

## Consequences

Administrators see an explicit global context and can move between organization and account views. The browser performs additional tab requests for account resources, and model assignment requires an enabled, explicitly granted model before it can be the default. Existing tenant routes remain compatible while platform routes gain pagination and filters incrementally.

## Verification

Enterprise API and admin typechecks pass; both packages build successfully. The local enterprise API serves the organization tree, account directory, account resource tabs, model directory, and model assignment endpoints. A real local browser run captured these states in `.playwright-mcp/super-admin-refactor.gif`.
