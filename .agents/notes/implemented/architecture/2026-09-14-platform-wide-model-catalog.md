# Agent Note: Use a platform-wide model catalog

Status: implemented

English | [中文](2026-09-14-platform-wide-model-catalog.zh.md)

## Problem

Model availability was represented by a per-organization grant with organization-specific enablement, default selection, and priority. The extra administration surface did not match the product rule that a model published by the platform is usable by every organization.

## Decision

The platform model directory is the availability source. An enabled row in `enterprise_auth.model` appears in every authenticated organization's model catalog and can be admitted by the gateway. Platform administrators control publication by creating, editing, enabling, disabling, or deleting the row. The API and console do not expose organization model grants, defaults, or priorities. Migration `0009_platform_wide_models` drops the obsolete `enterprise.model_grant` table.

Organization authentication, Runtime leases, policy revisions, budgets, rate limits, and model endpoint validation remain required. Disabling a platform model removes it from every organization catalog and rejects new calls.

## Alternatives considered

**Keep organization grants and make them automatic.** Rejected because it preserves redundant state and the per-organization administration flow that the product does not need.

**Keep grants as an override layer for exceptions.** Rejected because it makes availability depend on two sources and reintroduces defaults, priorities, and organization-specific failure modes.

**Remove model enablement and publish every stored row.** Rejected because platform operators still need one global switch to stop a model for all organizations.

## Consequences

The model catalog is smaller and deterministic: platform publication is the only model availability decision. Existing deployments must apply the destructive table-drop migration; old grant rows are not interpreted as compatibility data. Organization access controls continue to protect tenant data and spending even though model availability is platform-wide.

## Testing

The API integration suite verifies that an enabled model with no grant row appears for two organizations and that disabling it removes it from the catalog. Gateway metering tests call an enabled model without inserting organization grant data. Desktop and client tests use platform-availability terminology and continue to reject unknown model IDs.
