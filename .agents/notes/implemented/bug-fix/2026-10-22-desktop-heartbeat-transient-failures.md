# Agent Note: Retain enterprise settings context through failures

Status: implemented

English | [中文](2026-10-22-desktop-heartbeat-transient-failures.zh.md)

## Problem

Flattened settings navigation hides task groups, and replacing a failed page with an error removes its heading and recovery context.

## Decision

The [settings shell](../../../../packages/client/ui-settings-general/src/client/SettingsRoot.tsx) groups preferences, account management and extensions. Enterprise pages retain headings and descriptions during reads and failures, with localized retry guidance. Registrants supply icons through existing slot options. The [local-session decision](../architecture/2026-10-22-local-desktop-sessions.md) supersedes this note’s native heartbeat handling: local process lifetime is independent of cloud authorization.

## Alternatives considered

**Replace the page with a generic error.** Users lose the page identity and cannot tell which operation retry affects.

## Consequences

A cloud failure leaves the selected settings page visible and retryable. It does not close the local workspace.

## Verification

The [recorded-session browser case](../../../../snapshots/web/enterprise-settings/snapshot.yml) exercises grouped navigation, unavailable reads, retry recovery and narrow layouts.
