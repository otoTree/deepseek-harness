# Agent Note: Runtime cookie header recovery

Status: implemented

English | [中文](2026-09-20-runtime-cookie-header-recovery.zh.md)

## Problem

Each random loopback port minted a distinct authority-bound browser cookie. A browser that opened many Runtime generations sent all unexpired cookies to the next loopback port, and Node rejected plugin bundle requests with HTTP 431 before the application could authenticate them.

## Decision

The host WebServer and the native desktop account entry server accept a 64 KiB request-header budget. A successful process-token exchange expires every stale `dsh-auth-*` cookie presented by the browser, while the account entry expires those cookies while serving its HTML page. The current authority-bound cookie is retained. Cleanup uses repeated `Set-Cookie` headers and remains scoped to the host-only Harness cookie prefix.

## Alternatives considered

**Keep Node's default header limit.** The request would be rejected before the authentication layer could remove stale cookies.

**Remove authority binding from cookies.** This would reduce accumulation but would weaken the existing protection against presenting one Runtime's cookie to another loopback authority.

**Clear cookies only in the desktop host.** The Web authentication layer also serves CLI and browser launches, so cleanup belongs at the shared token exchange; the desktop entry still needs a header budget and early cleanup so it can reach that page.

## Consequences

Existing stale cookies are removed when the user next opens a fresh account or token URL. The larger header budget is limited to local servers and does not authorize requests; the existing Host, Origin, token, signature, and authority checks remain in force.

## Verification

WebServer and account-entry tests accept a 20 KiB stale-cookie header; BrowserAuth tests verify repeated stale-cookie expiration. The focused WebServer, BrowserAuth, and account-entry suites pass.
