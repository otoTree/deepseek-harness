# Agent Note: Enterprise directory sync workspace

Status: implemented

English | [中文](2026-10-06-enterprise-directory-sync-reference-alignment.zh.md)

## Problem

The administration directory sync routes used a generic resource table, so operators could not edit a script, inspect a run, review a batch, or roll back from a reference-aligned workspace.

## Decision

The admin uses one sync workspace with four route tabs: scripts, tasks and Webhooks, diff approval, and history and rollback. Each view reads the existing sync resources and derives its metrics in the client. Script saves use a version-incrementing `PATCH /v1/organizations/:organizationId/sync-scripts/:id` endpoint, and run responses include the script name and version for detail panels. The tasks and Webhooks view exposes explicit trigger management; `POST` creates a trigger, `PATCH` edits it, and `DELETE` archives it while preserving its run history.

## Consequences

Operators keep the existing preview, approval, publish, batch approval, and rollback operations while gaining a consistent two-column layout and responsive mobile presentation. Webhook counts remain zero until a persisted webhook configuration is created; existing run triggers are shown in the configuration panel. Archived triggers no longer appear in the management list, while their historical runs remain available.
