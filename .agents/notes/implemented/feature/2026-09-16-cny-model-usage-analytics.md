# Agent Note: CNY model usage analytics

Status: implemented

English | [中文](2026-09-16-cny-model-usage-analytics.zh.md)

## Problem

The administration usage page read the signed-in account's latest raw rows, so a platform administrator could see an empty page while other accounts consumed models. Model prices and ledger amounts used ambiguous micro-unit names that the console interpreted as USD. The ledger discarded cached-input and reasoning counters that compatible providers already reported, and a model price edit could make a historical cost impossible to explain without an immutable price snapshot.

## Decision

Model configuration accepts ordinary input, cached input, and output prices as CNY per million tokens. The API converts those decimal values to integer micro-CNY, where one CNY equals 1,000,000 stored units. Each completed OpenAI-compatible SSE call stores prompt, cached, uncached, completion, reasoning, and total token counts; copies all three active prices; and records ordinary-input, cached-input, output, and total costs. Reasoning tokens remain a completion subdivision and do not increase total tokens. Each cost component rounds to the nearest micro-CNY before the total is added.

The platform usage API reads settled rows and provides a bounded summary range, Asia/Shanghai daily series, model/account/organization/purpose breakdowns, and stable cursor-paged records. Rows whose currency is `CNY` contribute their snapshot cost; compatibility rows still contribute calls and available token totals but are explicitly unpriced. The administration page defaults to the latest 30 days, offers the same filters, and exposes component costs and price snapshots from each priced call. The compatibility micro-USD model and subscription columns remain separate and do not contribute to CNY cost or model-call admission.

The [transparent relay](../architecture/2026-09-15-transparent-model-relay.md) remains responsible for authenticated forwarding and side-channel observation. It claims each idempotency key before dispatch so repeated requests cannot incur an unrecorded second cost. Usage persistence completes after a successful stream reports usage and reaches `[DONE]`; a persistence failure retains the claim for reconciliation without changing the relayed response.

## Alternatives considered

**Relabel the existing micro-USD fields as CNY.** Rejected because it would silently change the currency of stored values and make existing rows impossible to interpret.

**Resolve every historical row against the model's current prices.** Rejected because an administrator must be able to edit a model price without rewriting the meaning of completed calls.

**Aggregate the latest 200 rows in the browser.** Rejected because a partial page cannot produce platform totals or stable time-series results.

**Add budget admission with the analytics ledger.** Rejected because reporting is retrospective; a missing price, observer failure, or exhausted subscription budget must not prevent a model response.

## Consequences

Platform administrators can attribute CNY cost by time, organization, account, model, purpose, and call while retaining the provider's cached and reasoning subdivisions. Every priced settled row is self-explanatory after later price edits. Providers that do not return a completed OpenAI-compatible SSE usage event remain usable but absent from analytics. Existing compatibility rows without `currency = 'CNY'` remain visible as unpriced token usage instead of being assigned an invented exchange rate.

PostgreSQL integration tests apply the migration to a fresh database and verify detailed settlement, pre-dispatch idempotency, no budget admission, platform authority, summary, daily series, grouping, and cursor paging. Focused observer tests retain cached-input and reasoning counters, cost tests pin component rounding, timezone-independent range tests pin Asia/Shanghai date boundaries, and the administration production build validates the dashboard client bundle.
