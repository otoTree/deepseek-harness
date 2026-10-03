# Agent Note: Enterprise administration foundations

Status: implemented

English | [中文](2026-09-30-enterprise-admin-foundations.zh.md)

## Problem

Enterprise administration needs a durable permission catalog, organization-scoped roles, identity-provider records, and directory-sync records without breaking existing role bindings.

## Decision

Enterprise administration now has a versioned permission catalog, organization-scoped custom roles, identity-provider records, and directory-sync script/run records. Existing fixed role bindings remain compatible. The sandbox package exposes an organization workspace lifecycle contract with an injectable backend; its memory backend is test-only and does not claim remote execution.

## Consequences

Admin can inspect permissions, custom roles, identity providers, and sync scripts through stable organization routes. Sync script test requests remain explicit previews until a separately isolated execution worker is deployed. Production cloud execution still requires an E2B-backed implementation and tenant-aware API integration.

## Alternatives considered

- **Keep only fixed role bindings** — this would not provide a versioned permission catalog or organization-owned custom roles.
- **Execute directory scripts inline during a request** — this would couple administrative requests to script execution; previews remain explicit until an isolated worker is deployed.
