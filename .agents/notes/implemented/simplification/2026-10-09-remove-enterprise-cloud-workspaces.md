# Agent Note: Remove the enterprise cloud workspace settings surface

Status: implemented

English | [中文](2026-10-09-remove-enterprise-cloud-workspaces.zh.md)

## Problem

The desktop enterprise client exposed a Cloud workspace settings page and matching RPC operations even though this deployment does not provide that capability.

## Decision

The enterprise client no longer registers the Cloud workspace settings section or sends its workspace RPC operations. The shared local workspace feature remains available through its own package.

## Alternatives considered

**Hide only the settings entry** — this would leave unsupported RPC operations and wire types in the enterprise client.

**Keep the page disabled by configuration** — this would preserve an unsupported product surface and make availability depend on deployment configuration.

## Consequences

The enterprise settings navigation contains account, models, team, and plugins only. The enterprise client has no Cloud workspace labels, schema, or transport dispatch. Reintroducing the capability requires an explicit client and API decision.

## Verification

The enterprise client test now asserts that the workspace settings entry is absent. Focused typecheck and client tests cover the removal.
