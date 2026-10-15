# Agent Note: Reference-aligned organization directory

Status: implemented

English | [中文](2026-10-06-enterprise-organization-directory-reference-refresh.zh.md)

## Problem

The organization directory was rendered with generic resource components and did not match the four reference views for structure, organization overview, member detail, and account detail. Account detail also lacked a single view of membership, roles, devices, sessions, usage, and audit history.

## Decision

Organization routes now render a dedicated directory workspace with its own top bar, tabs, metric cards, tree, tables, detail panels, and operation buttons. The workspace consumes platform organization, node-member, account, account-membership, runtime, session, usage, and history APIs. Account detail merges the account list status with the detail response and renders empty API results as an em dash. Usage cards read settled CNY `totalCostMicrosCny` values from the account usage endpoint. The structure route requests the complete organization and unit tree, and unit rows report active assigned members. A platform organization overview endpoint supplies aggregate organization, active member, administrator, runtime, and recent usage cost counts.

## Alternatives considered

- **Keep the generic resource components** — this preserves implementation reuse but cannot present the four directory views or their cross-resource account details clearly.
- **Duplicate account and organization data in the client** — this would make detail metrics stale and would invent values when an API returns no records.

## Consequences

The four organization views have fixed desktop proportions and responsive mobile behavior without depending on the generic resource table or organization tree components. Account detail no longer fabricates devices, roles, costs, audit counts, or activity timestamps. Existing organization and account APIs remain the mutation source for create, invite, edit, and password operations.
