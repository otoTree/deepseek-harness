# Agent Note: Transparent enterprise model relay

Status: implemented

English | [中文](2026-09-15-transparent-model-relay.zh.md)

## Problem

The enterprise model route rebuilt a narrow chat-completions request and response, which discarded provider-specific fields and prevented callers from selecting another compatible upstream path.

## Decision

The native DSH adapter requests streaming token usage and validates the stream it consumes. The model route authenticates the desktop runtime and resolves an enabled platform model, then forwards the requested path, method, JSON body, request headers, and response bytes. It replaces only the body `model` value with the configured upstream model and replaces `Authorization` with the encrypted platform credential. Model grants, policy revisions, budget admission, rate limiting, and response reconstruction are outside this relay path. Before dispatch, the route atomically claims the organization and request idempotency key; a duplicate receives a conflict without another upstream call. A bounded side-channel observer inspects successful OpenAI-compatible SSE without consuming, storing, or altering the bytes. The last valid usage event followed by `[DONE]` settles the claim before forwarding completion. [CNY usage analytics](../feature/2026-09-16-cny-model-usage-analytics.md) owns the stored token and cost semantics. Incomplete, invalid, oversized, non-SSE, and non-2xx responses release the claim without a usage entry. A settlement-storage failure retains the pending claim for explicit reconciliation without changing the model response. The HTTPS transport resolves all IPv4 answers once per connection attempt, rejects the answer set if any entry is invalid or private, and returns the single-address or address-array callback form requested by Node. Request failures, response-stream failures, upstream error statuses, and metering failures log only non-sensitive request identity and the applicable error classification; request setup failures return a generic 502.

## Alternatives considered

**Keep gateway-owned OpenAI request assembly.** Rejected because a fixed field list and endpoint suffix cannot carry provider extensions or alternate compatible APIs.

**Forward the upstream credential to the desktop.** Rejected because platform credentials must remain in the API process and Keychain credentials identify only the desktop runtime.

**Parse and reconstruct upstream SSE in the API.** Rejected because protocol-specific parsing changes the response and makes non-chat-compatible upstreams unusable.

**Keep metering entirely outside the relay.** Rejected because the API already has the authenticated organization, runtime, model pricing, and unmodified response stream needed to record complete OpenAI-compatible usage without controlling request admission.

## Consequences

Compatible providers can receive their own request options and paths without API changes. Completed OpenAI-compatible streams populate the existing usage views, while other providers and paths remain usable without platform metering. Accounting is post-response observation rather than an admission control: a budget value never blocks a call, and no reservation is created. Runtime authentication and public HTTPS/DNS safety checks remain in force.

## Testing

TypeScript checks pass for the API and Electrobun packages. Focused transport tests cover both Node DNS callback forms, empty and unsafe answer sets, redacted diagnostics, fragmented usage events, invalid UTF-8, malformed and oversized streams, and missing completion. The PostgreSQL integration overlaps native calls, verifies settled token and cost records despite an exhausted budget, leaves truncated calls unrecorded, and proves concurrent duplicate idempotency keys cannot dispatch or record a second call. The native gateway suite passes with the relay request envelope and still validates the DSH chat stream at the client adapter. Manual streaming and non-streaming requests through the production HTTPS and DNS transport receive successful structured responses from an enabled DeepSeek model.
