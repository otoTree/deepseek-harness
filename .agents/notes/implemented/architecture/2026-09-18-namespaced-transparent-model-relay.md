# Agent Note: Namespaced transparent enterprise model relay

Status: implemented

English | [中文](2026-09-18-namespaced-transparent-model-relay.zh.md)

## Problem

The enterprise gateway must preserve provider protocol paths and extension fields without turning every OpenAI-compatible operation into a platform endpoint. A terminal catch-all relay, however, would make every miss in the control-plane router an authenticated egress path. Accepting an upstream model name would also let a caller choose a model outside the enabled platform catalog and avoid the platform price and usage identity.

## Decision

The API owns one data-plane namespace, `/model/*`. Only this positive route enters the relay. The gateway removes `/model`, appends the remaining path and query to the configured provider base URL, and preserves the incoming method, provider JSON fields, response status, and safe response headers. It removes redirect, service-identity, cookie, reporting, and provider CORS response headers. A protocol-independent streaming filter replaces the configured provider origin, hostname, and upstream model name in textual responses, including literals split across chunks; binary responses remain byte-preserving. The filter decodes standard HTTP compression before replacement without reconstructing Chat, Responses, or Files records. The gateway does not maintain an endpoint list and does not select a URL from the model's protocol metadata. Control-plane and unknown paths never fall through to model egress.

Every relay request authenticates a live Runtime token and derives its account and organization from that token. A JSON request selects an enabled platform model UUID through `body.model`; a bodyless Files request uses `X-DSH-Model`. When both exist, they must match. Provider model names, malformed identifiers, unknown UUIDs, and disabled models fail before dispatch. The gateway then replaces the JSON `model` value with the catalog's `upstreamModel`, replaces `Authorization` with the encrypted platform credential, and removes host, cookie, hop-by-hop, and `X-DSH-*` headers. Organization and Runtime catalogs omit the provider base URL, upstream model name, and credential; only the platform-administrator API returns the first two. `X-DSH-Purpose` attributes usage but cannot select an upstream URL or model.

The Runtime, organization, account, and platform-model identity also scope process-local provider-file authority. File status, deletion, and model inputs accept a provider file identifier only while that exact authority is live. An upload that reports a processing state remains inside the shared upload operation while the adapter polls the native file resource at a configurable interval; the upload timeout and cancellation signal bound both polling waits and status requests. A process restart invalidates the authority and lets the adapter perform one bounded upload and model-call replay. Provider file identifiers never enter Session data, database rows, or diagnostics.

The native adapter requests OpenAI-compatible usage and validates the protocol stream it consumes. The API claims a billable request by organization and idempotency key before dispatch. It writes every upstream chunk to the caller before the bounded side-channel observer processes it. A complete legal usage record settles the claim; missing, invalid, oversized, or truncated usage remains `pending_reconciliation`; an upstream error records a failed claim. Metering or database failure cannot remove bytes already relayed. The HTTPS transport rejects credential-bearing endpoints, literal IP hosts, and DNS answer sets containing any private or invalid address. Diagnostics omit the configured endpoint, credentials, request headers, queries, bodies, media data, Base64, and provider file identifiers.

## Alternatives considered

**Use a terminal catch-all outside a namespace.** Rejected because a newly misspelled or removed control-plane route would silently become provider egress. A positive namespace makes the data-plane decision explicit without enumerating provider operations.

**Create separate platform routes for Chat, Responses, and Files.** Rejected because endpoint-specific handlers recreate the compatibility layer that transparent forwarding removes. Providers can add a compatible path without an API release.

**Trust the body model or an upstream model name.** Rejected because platform model identity owns enablement, credentials, prices, limits, usage attribution, and wallet debit. Only the server can map that identity to an upstream name.

**Forward the provider credential to the desktop.** Rejected because the Runtime credential authenticates one device and organization; it must not reveal a platform-owned provider secret.

**Parse and reconstruct SSE in the API.** Rejected because rebuilding a protocol stream can delay or lose model output. Identity redaction matches exact byte literals without interpreting protocol records; usage observation remains bounded and downstream of each write.

## Consequences

The desktop and internal plugin review call `/model/chat/completions`, `/model/responses`, and `/model/files`, while providers receive `/chat/completions`, `/responses`, and `/files`. Other provider paths work under the same prefix with no protocol-specific server route. Clients cannot turn an API route miss into egress or substitute a cheaper platform model identity while sending a different upstream model. The fixed namespace is visible in transport configuration, but request and response bodies remain free of a platform envelope.

## Testing

PostgreSQL integration covers Runtime binding, namespace rejection, arbitrary method/path/query forwarding, provider field preservation, platform-ID validation, body/header mismatch, enabled-model resolution, upstream model replacement, internal-header removal, response-header filtering, cross-chunk identity redaction, idempotency, file ownership, SSE completion and truncation, settlement failure after response delivery, and wallet debit. Transport tests cover public DNS enforcement, redacted diagnostics, cancellation, timeout, malformed streams, and bounded observation. The Electrobun provider tests exercise the namespaced Chat, Responses, and Files requests, including processing-to-active polling, failed and unknown file states, upload timeout, cancellation, and single-upload reuse, while continuing to validate the native provider streams.
