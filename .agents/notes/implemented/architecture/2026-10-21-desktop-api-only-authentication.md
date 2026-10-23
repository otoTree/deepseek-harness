# Agent Note: Desktop authentication depends only on the API

Status: implemented

English | [中文](2026-10-21-desktop-api-only-authentication.zh.md)

## Problem

A bundled desktop account page needs no hosted management UI, but a separately configured Portal origin couples native authentication to deployment settings for another client. The API's cookie-protected organization mutations also reject its own origin when only Admin and Portal origins are configured.

## Decision

The desktop reads and embeds only `ENTERPRISE_API_URL`. [LocalAccount](../../../../apps/electrobun/src/local-account.ts) sends account requests to that API with the API origin as `Origin`; it never contacts Admin or Portal. Native PKCE approval receives challenge, state and callback fields directly through the authenticated API session instead of manufacturing a Portal URL. SSO uses the same origin to start authentication, opens the identity provider in the system browser, and returns through the API and a state-checked loopback callback.

The [API origin allowlist](../../../../apps/api/src/config.ts) includes the configured API origin alongside the explicit Admin and Portal origins. Better Auth and cookie-protected mutations share this list. Credentials, single-use authorization codes, PKCE verification, loopback callback validation and rejection of unknown origins remain required. Existing API deployments accept the desktop after deploying this behavior or explicitly configuring their Portal origin equal to the API origin.

The [installer decision](2026-10-19-local-desktop-installer-protection.md) owns deployment pinning and resource protection. It remains active; this decision owns native account origins and the removal of the desktop's Portal setting. Management and invitation services retain their own deployment settings.

## Alternatives considered

**Reuse the Admin origin in native requests.** This requires the desktop release operator to know a second client address and treats native requests as management browser traffic.

**Remove origin validation or accept every origin.** This would weaken cookie-authenticated mutations; the configured API origin is an exact additional entry.

## Consequences

The bundled desktop account UI can register, sign in and authorize a team while Admin and Portal are unavailable. The API and any configured SSO identity provider must remain reachable. This does not repair DNS, TLS or cloud-ingress blocking. The isolated PostgreSQL acceptance case in [startup tests](../../../../apps/api/tests/container-initialization.test.ts) exercises native registration, login and team entry against the real API with unavailable management origins; its owner-local [expected requests](../../../../apps/api/tests/expected/desktop-account.json) retain only methods, URLs, origins, statuses and native completion markers. The same case verifies that unknown origins are refused by both authentication and organization mutations. Native auth tests retain callback validation and cancellation coverage; packaged profile checks remain separate from production login verification.
