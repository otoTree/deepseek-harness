# Agent Note: Shared team CNY wallet

Status: implemented

English | [中文](2026-09-18-team-cny-wallet.zh.md)

## Problem

CNY usage analytics could explain model cost but did not hold spendable funds. The compatibility subscription budget used another currency and semantics, and assigning separate budgets to members or to several teams would make redemption and ownership ambiguous. The product needs one auditable balance per organization, one-time platform credits, fail-closed admission, and member-level attribution without exposing another member's Session content.

## Decision

Each organization owns one `organization_wallet` whose integer micro-CNY balance starts at zero. All active members share it. A model request may start only while the balance is positive; the API returns `402 INSUFFICIENT_TEAM_BALANCE` before upstream dispatch otherwise. The gateway does not reserve a worst-case amount. Concurrent admitted requests can therefore settle to a small negative balance, and later requests remain blocked until a credit makes the balance positive again.

`wallet_ledger` is the immutable money history. A positive `redemption_credit` references one redemption code, and a non-positive `model_usage_debit` references one usage row. Unique constraints on those references make redemption, automatic settlement, retry, and manual reconciliation idempotent. Settled CNY usage locks the usage and wallet rows, writes the debit for exactly `totalCostMicrosCny`, records the resulting balance, and marks usage settled in one transaction. Pending, failed, unpriced, and upload-only records do not debit the wallet. The legacy subscription micro-USD fields remain stored for compatibility but do not participate in CNY admission or the wallet UI.

Platform administrators create batches of 1–1000 redemption codes from a decimal fixed-point CNY amount. The database stores an HMAC and a non-reversible hint, never plaintext. Plaintext codes appear once in the creation response for immediate export. An unredeemed, unexpired, non-revoked code can be redeemed exactly once by any active member into the explicitly selected organization; the transaction marks the code, credits the wallet, writes the ledger entry, and returns the new balance. Codes cannot move after redemption.

The enterprise client shows every member the current team balance, redemption input, personal monthly usage, and personal ledger activity. Owners and administrators can read the team directory, server-aggregated usage for a calendar range, cursor-paged member records, and pending invitations. An administrator can invite a member; only an Owner can invite an administrator. Ordinary members cannot access team totals, the directory, or invitation operations. The API computes the default natural month in the configured reporting timezone and never derives organization totals from a bounded client page.

## Alternatives considered

**Reuse `subscription.budgetMicros`.** Rejected because those columns represent compatibility micro-USD accounting and reservations. Reinterpreting them as CNY would corrupt existing meaning and preserve an unwanted worst-case reservation model.

**Allocate a wallet to each member or divide funds among teams.** Rejected because a team is the billing identity. Per-member allocation would add transfer and rebalancing workflows without improving usage attribution, which already records the account and Runtime.

**Reserve the maximum possible call cost.** Rejected because token completion is unknown, reservations can strand funds after interrupted streams, and a shared positive-balance admission rule provides the intended simple control. The accepted cost is bounded concurrent overspend.

**Store redeemable plaintext or return it from list APIs.** Rejected because database or read-API access would become direct monetary access. One-time display and HMAC lookup limit that exposure.

**Aggregate a recent usage page in the client.** Rejected because a partial page cannot produce team totals, calendar ranges, or stable per-member results.

## Consequences

Teams redeem CNY without assigning internal budgets, and every settled debit remains attributable to organization, account, Runtime, model usage, and resulting balance. A negative balance is visible and consumes later credits before calls resume. A provider stream without valid usage remains pending and temporarily uncharged; reconciliation is the explicit path that later applies a unique debit. Platform operators can create, list by hint/status/batch, export once, and revoke unused codes, while team members cannot enumerate the platform code inventory.

## Testing

PostgreSQL integration applies the migration to an isolated database and covers zero-balance rejection, positive admission, concurrent overspend, negative-balance recovery, one-time and concurrent redemption, expiry, revocation, cross-organization isolation, automatic and manual debit idempotency, role-restricted summaries, paged member records, and invitation permissions. Client tests cover member-only wallet views, redemption errors, Owner and administrator controls, date ranges, member paging, and invitation revocation. Admin tests cover fixed-point batch input, one-time plaintext export, status/batch paging, and unused-code revocation.
