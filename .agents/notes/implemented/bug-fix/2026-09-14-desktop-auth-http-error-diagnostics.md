# Agent Note: Surface desktop authorization exchange failures

Status: implemented

English | [中文](2026-09-14-desktop-auth-http-error-diagnostics.zh.md)

## Problem

The desktop client reduced every non-successful `/desktop/token` response to `Desktop authorization exchange refused`. The message did not distinguish a rejected authorization code from an exhausted organization runtime quota, so operators had to inspect server logs or the database before choosing a remedy.

## Decision

The desktop client reads unsuccessful token responses through the same 8 KiB bounded reader used for successful credentials. It reports the HTTP status and a non-secret `message` field (or bounded plain text) in the thrown error, while retaining the generic status when an intermediary body is absent, oversized, or unreadable. Credential responses remain bounded and are never included in the returned device metadata.

## Alternatives considered

**Keep one generic error string.** Rejected because it hides the actionable distinction between authorization failures (403) and runtime quota exhaustion (409).

**Expose the complete response body.** Rejected because an intermediary could return an unbounded body or include data that is not appropriate for a desktop error message; parsing is bounded and only the service message is preferred.

**Resolve the failure by changing runtime records automatically.** Rejected because quota and authorization state are server-owned, and deleting or revoking a runtime without operator intent would be destructive.

## Consequences

Terminal logs now identify the HTTP class and API message, such as `Desktop authorization exchange refused (409): Runtime limit reached`. The client still does not receive a platform token in thrown errors or result metadata. Operators can choose account reauthentication, code-flow investigation, or quota administration from the first failure report.

## Testing

`apps/electrobun/tests/desktop-auth.test.ts` verifies that 403 and 409 JSON messages appear in the bounded error. The desktop authorization test and TypeScript checks pass.
