# Agent Note: Keep enterprise browser origins and model capacities aligned

Status: implemented
Archived: 2026-09-14

English | [中文](2026-09-14-enterprise-browser-origin-and-model-capacity-validation.zh.md)

## Problem

The enterprise console and API are separate loopback origins. A developer can open the console as `localhost` while the configured origin uses `127.0.0.1`; browsers then block credentialed requests even though both names reach the local service. The model editor also accepted capacities that the API rejected: a 384,000-token output limit was valid for supported model catalogs but exceeded the API's 131,072-token administrative ceiling, producing an opaque 400 response.

## Decision

The API derives its credentialed browser allowlist from the configured admin and portal origins. It preserves configured origins, normalizes them to URL origins, and adds the `localhost`/`127.0.0.1` counterpart only for loopback hosts. Hono CORS, mutating-request origin checks, and Better Auth trusted origins use this same list. Public deployment origins are never expanded.

The platform model directory accepts context and output capacities up to 2,000,000 tokens, matching the existing context ceiling and models that advertise outputs such as 384,000 tokens. The admin form applies the same maximum to its numeric capacity fields so an invalid oversized value is rejected before submission.

The generated local enterprise environment explicitly allowlists `https://api.deepseek.com`, while deployments can add other HTTPS origins through `ENTERPRISE_MODEL_ORIGINS`. The server-side origin check remains mandatory for every saved model.

## Alternatives considered

**Require developers to use the configured hostname exactly.** Rejected because the shipped development command binds `127.0.0.1`, while browsers and bookmarks commonly use `localhost`; the mismatch is accidental and provides no security benefit for loopback-only aliases.

**Allow every origin or reflect the request Origin.** Rejected because credentialed CORS would become an ambient cross-site login surface; deployed origins must remain explicit.

**Keep the 131,072-token ceiling and reject 384,000.** Rejected because the harness already discovers models advertising 384,000 output tokens and the platform directory is intended to represent arbitrary configured OpenAI-compatible routes.

**Only raise the server limit without constraining the form.** Rejected because the browser should provide immediate feedback and keep its accepted range synchronized with the server contract.

**Permit all upstream origins by default.** Rejected because the model gateway makes outbound credentialed requests; the local convenience default is limited to the official DeepSeek origin and additional providers remain an explicit deployment choice.

## Consequences

Loopback admin and portal sessions work when either supported hostname is used, while non-loopback origins remain allowlisted by configuration. Model saves for capacities through 2,000,000 tokens pass schema validation; request budgeting still clamps each call to the stored model limit. The UI maximum is a client convenience, and the API remains authoritative for non-browser callers.
The local initializer supplies the official DeepSeek origin so a fresh development stack can save the endpoint shown by the console without weakening the deployment allowlist.

## Testing

`apps/api/tests/config.test.ts` covers loopback aliases, URL-origin normalization, and the absence of aliases for public origins. API and admin TypeScript checks cover the shared origin wiring and model-capacity changes.
