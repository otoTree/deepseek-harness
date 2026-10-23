# Agent Note: Use server authorization for enterprise requests

Status: implemented

English | [中文](2026-09-14-enterprise-client-renewed-runtime-lease.zh.md)

## Problem

A timestamp captured during login cannot represent subsequent server renewal. Local rejection based on that snapshot makes all enterprise settings unavailable together.

## Decision

The Host validates API origin, organization ID, Runtime ID and credential-store binding before cloud requests. It does not reject the saved `expiresAt` snapshot. The API checks current authorization. [Local desktop sessions](../architecture/2026-10-22-local-desktop-sessions.md) owns request-driven renewal and local lifetime; this note retains credential binding and server authority.

## Alternatives considered

**Rewrite credentials on each renewal.** This creates a second state update that can fail after the server commits.

**Remove Host binding checks.** This permits credentials for another deployment or organization to reach the generated profile.

## Consequences

Cloud pages work while the server accepts the token. Revocation and expiry fail at the API; local history remains readable.

## Verification

Host tests accept a passed saved timestamp and refuse a mismatched deployment before sending a request.
