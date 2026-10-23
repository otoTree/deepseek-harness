# Agent Note: Restore desktop login after application exit

Status: implemented

English | [中文](2026-10-21-desktop-login-restoration.zh.md)

## Problem

A fresh native process has neither the saved credential locator nor an API account cookie. Always opening login ignores an existing protected credential.

## Decision

[DesktopSession](../../../../apps/electrobun/src/desktop-session.ts) stores the selected locator under a deployment-origin hash in platform credential storage. Ordinary stop preserves both records. Startup restores the account without contacting the API. Logout removes both records even after stop, while preserving local files. API account cookies stay in memory. The [local-session decision](../architecture/2026-10-22-local-desktop-sessions.md) supersedes online renewal as a startup prerequisite.

## Alternatives considered

**Persist account cookies and repeat PKCE on launch.** This stores another secret and creates a new login identity when a protected credential already exists.

## Consequences

Reopening restores account-scoped local storage. Cloud expiry requires login for cloud operations, while network outages permit local recovery.

## Verification

Real-process [desktop tests](../../../../apps/electrobun/tests/desktop-session.test.ts) verify offline restore, stable identity, logout after stop, deployment separation and credential-store failure cleanup.
