# Agent Note: Align loopback API and browser hosts for sessions

Status: implemented

English | [中文](2026-09-14-loopback-session-cookie-host-alignment.zh.md)

## Problem

The enterprise admin page can be opened as `localhost` while its build-time API URL uses `127.0.0.1`. Browsers treat those loopback names as different cookie hosts. A successful Better Auth sign-in can therefore leave the following `/v1/me` request without the session cookie, which the console reported as a generic 401.

## Decision

The admin client detects the current browser hostname and, when both the page and configured API use loopback names, sends requests to the matching `localhost` or `127.0.0.1` host. Public API URLs are unchanged. Credentialed requests continue to use `credentials: 'include'`, and the API accepts both loopback aliases for CORS and authentication origins.

## Alternatives considered

**Require users to open the exact printed loopback hostname.** Rejected because bookmarks and browser address completion commonly switch between `localhost` and `127.0.0.1`, and the two names address the same local service.

**Set cross-site cookies with `SameSite=None`.** Rejected because browsers require `Secure` for that mode, which does not work for the default HTTP development stack.

**Proxy all API calls through the Next.js server.** Rejected because it adds a second credentialed transport and deployment path for a problem solved by choosing the matching loopback hostname in the existing client request.

## Consequences

Local development sessions remain on one cookie host regardless of which supported loopback alias the user enters. Deployed public origins retain their configured API URL. The adjustment does not change authentication authority or allow non-loopback origins.

## Testing

`apps/admin/tests/client-api.test.ts` covers both loopback directions and leaves public API URLs unchanged. The admin and API TypeScript checks pass.
