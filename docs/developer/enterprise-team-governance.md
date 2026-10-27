---
description: "Exact-team authorization, monthly budgets, retained storage and enterprise recovery."
kind: "reference"
---

# Enterprise team administration

English | [中文](enterprise-team-governance.zh.md)

## Summary

Platform administrators provision teams, configure resources and recover access in Admin. Employees select a team in the desktop client to work, manage permitted team resources and recover retained files or media results. Teams own funds, storage and business data; departments organize members and sharing inside one team.

## Table of Contents

- [Identity and onboarding](#identity-and-onboarding)
- [Authorization and administration](#authorization-and-administration)
- [Monthly accounting](#monthly-accounting)
- [Storage and result recovery](#storage-and-result-recovery)
- [Lifecycle and deployment](#lifecycle-and-deployment)
- [Verification](#verification)

## Identity and onboarding

Both deployment modes require an explicit active membership in the exact team. Private deployments create one company; departments use its organization units. Memberships and roles do not traverse parent organizations. Platform administration is an independent identity and grants no implicit conversation or file access. Initial provisioning explicitly grants platform administration and team ownership to the bootstrap account once; repeated provisioning does not reconstruct revoked grants.

Team creation requires an explicit default member budget: a nonnegative amount or unlimited. Admin creation selects an existing Owner account and the team/personal storage policy. Readiness reports Owner, recovery channel, published models, funding, budget, capacity and installer publication. An incomplete resource policy prevents model admission.

Invitation mail opens the public Admin `/account` page. This page supports sign-in, allowed registration, verification mail, password recovery/reset and invitation acceptance. Published installers are available from the public account page. The installed desktop resumes through its existing sign-in and explicit team selector. Invitation persistence and mail delivery have independent outcomes; failed deliveries can be resent, and revoked or expired links cannot admit members. Repeated acceptance reuses the original membership. Inactive memberships require an authorized restoration rather than a new invitation relationship.

## Authorization and administration

Effective permissions combine enabled team-wide fixed/custom roles and subtract explicit denials. Department roles confer no team-wide administration. Member, budget, billing, storage, identity, audit, plugin and content permissions remain distinct. Every new model call rechecks current membership, team state, permissions and model audience. Catalog visibility also checks an all-teams or selected-team audience; accepted supplier tasks retain their connection and price snapshots.

Admin uses platform endpoints for global teams, resource allocation, balance adjustments, subscription/seats, ownership recovery and lifecycle. Its team directory searches and pages on the server and requires explicit team selection. Versioned governance mutations require a reason and append an audit record. Account identity/password recovery names the target, requires its displayed revision and a reason, records no password in audit, and revokes browser sessions, pending desktop codes and existing device credentials. An email correction clears verification unless explicitly confirmed. Desktop team management uses membership endpoints, with separate permissions for budgets, capacities, roles, identity providers and audit. Role and identity configuration edits reject stale versions. Audit and ledger records page from server results. Desktop management navigation follows current capabilities. Focus and visible-page polling refresh resource views; the desktop `activityRefreshMs` and Admin `ADMIN_ACTIVITY_REFRESH_MS` configure a 30-second default.

Private deployments also expose [enterprise SSO and directory synchronization in Admin](../../apps/admin/README.md#development). Platform administration, explicit active team membership and the corresponding team permission are all required. Ordinary team members cannot enter the Admin shell; open/SaaS deployments do not load its enterprise configuration resources.

The platform [plan catalog](../../apps/api/src/subscription-plans.ts) stores versioned names, reference monthly prices, seat defaults and optional resource defaults. Admin `/platform/plans` manages it; team subscription actions select an enabled catalog code and revision. Assignment preserves funds, bills and assets. Editing a plan does not rewrite assigned teams. Deletion requires no references and excludes provisioning defaults; disabling prevents new assignments while preserving existing subscriptions.

Team switching stops the old runtime and clears its credential before selecting another team. Restoring a saved choice validates membership again; a failed selection never falls back to the first team. Member deactivation, Owner denial/revocation, directory sync and ownership transfer share final-effective-Owner protection. Directory sync preserves global account identity and creates departments within the team. Approved changes capture their preceding values for explicit compensating runs. Directory imports require an existing account with a login channel; they never create a credentialless global identity.

## Monthly accounting

Amounts use integer micro-yuan and immutable wallet movements. Paid requests check positive team balance and the initiator's settled monthly spending at admission. Members inherit the current team default, use an individual amount, or are unlimited; zero prevents new paid requests. Owners bypass only the personal budget. Role changes, restoration, top-ups and budget changes preserve consumption. Free prices still require authorization and publication but do not require funds or budget.

Text and current media tasks debit their entire actual charge after settlement. Concurrent admitted work can exceed budgets and make the wallet negative. Subsequent paid calls stop once settled spending reaches the member budget or team balance is nonpositive. Quotes are estimates, without a spendable reservation balance. Missing or uncertain supplier usage remains pending reconciliation; cancellation and timeout do not establish free usage. Historical task engines retain their stored settlement semantics.

Admission records fix membership, account, month, time zone and department IDs. The initial budget time zone is Asia/Shanghai; a requested change starts at the next complete month. Settlement across a month boundary updates the admission month. Owner spending remains recorded and applies when ownership is removed. Monthly billing separates settled costs, pending request counts, media estimates, posting-month refunds and adjustments. Department totals can overlap for multi-department members; the team total counts each call once. Team billing, wallet balance, funding and full-team ledger access require `billing.read`; personal reads cannot select another account and omit team balances. Text reconciliation requires supplier evidence and complete usage for a charge. CSV export reads every server ledger page.

## Storage and result recovery

A team's total includes personal workspaces and the team space. Personal caps apply only to each member's personal workspace, including Owners. Every retained version and recycled object consumes storage. Valid or not-yet-cleaned upload reservations reduce available space. Sharing adds no bytes; copying does. Same-team moves recheck destination ownership and personal capacity and require explicit sharing confirmation. Direct cross-team moves fail.

Upload creation holds the team lock while reserving capacity. Commit checks current authorization, expected metadata and the captured base version. A temporary upload key is copied to a separate immutable retained-version key; a late signed upload cannot overwrite the published version. Failed, cancelled and expired uploads remain reserved until durable cleanup confirms deletion. The configured staging sweep removes late writes after the original signing period. Permanent deletion schedules durable jobs; capacity is released after physical object deletion succeeds. Cleanup retries order by the last attempt so a failing object cannot indefinitely block other jobs. Unconfigured resource policies reject new retained bytes. Shrinking limits preserves bytes and blocks new occupancy while allowing authorized reads and cleanup.

Media temporary results consume platform infrastructure storage. Saving to a workspace applies team capacity and an idempotent import ID. Execution, settlement and saving remain independent. Desktop exposes cancellation, bounded temporary downloads, save retries and workspace import; retries retain generation and billing identity. The configured temporary retention defaults to seven days. Recovery displays the actual deadline and fails when the retained result is unavailable; provider URLs alone do not guarantee recovery.

Storage recovery displays version, trash and upload totals, paged trash and assigned offboarding custody. Custody grants metadata management and explicit cleanup, without download or sharing privileges. Handover requires an inactive source member and an active target. File copying and moving use an explicit target-space/folder picker.

## Lifecycle and deployment

Deactivation and team suspension block new work and request cancellation of outstanding media tasks. Submitted tasks retain background authority for supplier queries, settlement and result persistence. Member restoration retains the original membership, budget history and assets. Leaving records removal and stops the local team runtime. Restoration, expansion and top-ups never replay failed paid tasks.

Closing a team requires explicit review of tasks, money, assets and exports. Closing preserves balances, bills and data; refunds and adjustments are manual platform operations with reasons. Permanent file cleanup is separate and explicit. Automatic deletion is disabled. Team recovery requests remain available to authorized management while suspended or closed. Subscription expiry blocks new execution while retaining authorized history and cleanup. Seat and capacity reductions limit additions without deleting history; platform-created members use the same seat check as invitations and restoration.

Apply the append-only migration journal, including [0040](../../apps/api/migrations/0040_team_governance.sql), without clearing the database. Stop new admissions during coordinated API/client rollout, retain accepted-task processing, verify readiness and reopen admission. Repair forward on failure. Released Session generations remain untouched. Development database rebuilds require an explicit operation outside application startup.

Migration [0041](../../apps/api/migrations/0041_subscription_catalog.sql) imports existing plan codes and backfills missing billing attribution from retained usage timestamps in Asia/Shanghai. Historical department lists remain empty because present assignments cannot establish past membership. The migration preserves usage rows and wallet balances; it never merges financial records by overwriting them.

## Verification

[Governance HTTP regressions](../../apps/api/tests/team-governance.test.ts) use isolated real PostgreSQL, dynamic ports, controlled clocks and admission barriers. They cover overshoot, immutable monthly attribution, effective denials, final Owner protection, invitation delivery, storage races, cleanup retry, custody/content separation and directory rollback. [Model-task regressions](../../apps/api/tests/model-platform.test.ts) cover worker claims, unknown supplier outcomes and independent settlement/save recovery. The desktop unit and Host tests and [browser workflow](../../apps/web/tests/enterprise-settings.e2e.ts) use explicit keyless fixtures. The [current SDK Session scenario](../../snapshots/session/team-settlement-sdk/snapshot.yml) records actual-usage billing and recovery; the historical SDK scenario retains legacy task billing.

Real supplier calls and a real-service/model browser GIF require deployment credentials and remain unverified when those credentials are absent. Keyless fixtures do not establish supplier prices, deliverability or production readiness.
