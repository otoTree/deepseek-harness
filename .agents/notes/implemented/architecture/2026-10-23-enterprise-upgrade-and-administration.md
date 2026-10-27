# Agent Note: Preserved enterprise upgrades and platform plan administration

Status: implemented

English | [中文](2026-10-23-enterprise-upgrade-and-administration.zh.md)

## Problem

A new attribution-only monthly summary can omit retained costs, and unregistered desktop bearer routes or mismatched pagination limits can make valid data inaccessible. A free-text subscription cannot support catalog maintenance. A renamed application can still expose a supplier name in Keychain.

## Decision

[Migration 0041](../../../../apps/api/migrations/0041_subscription_catalog.sql) preserves existing subscriptions and usage, imports their plan codes and fills missing admission attribution from retained timestamps. Historical departments remain unknown rather than adopting current assignments. New attribution remains immutable. Platform plan CRUD uses displayed revisions, reasons and audit; referenced plans and provisioning defaults cannot be deleted. Assignment applies resource defaults explicitly and preserves funds, spending and assets. Catalog edits and disabling do not rewrite existing subscriptions. Prices are reference amounts, not automatic charges.

Desktop bearer authorization explicitly includes capability reads and task pagination. Usage summary consumers respect the API page limit. Settings retains a visible disabled update control with recovery guidance when its native bridge is unavailable. Admin identity revalidation retains mounted forms and uploads during loading and temporary failures; HTTP 401/403 clears the retained identity, and an explicit non-platform identity removes management controls. Remounting the page on each focus would discard browser-owned file selections and abort upload cleanup. Installer publication reports prerequisites and stable failure codes; retrying identical signed metadata reuses a draft, while published releases remain immutable.

The macOS credential helper uses the 智域OS label and `com.zhiyu.os.enterprise` service. Reading or writing a matching legacy item moves its service while retaining its access-control record. Logout removes both names for the selected account. Released application identifiers, update authentication and workspace directories retain their existing values. This partially supersedes Keychain service preservation in the [branding decision](2026-10-21-zhiyu-desktop-brand.md); its update identity, artifact naming and workspace rationale remains active. [Team governance](2026-10-23-team-resource-admission-and-recovery.md) retains authorization, admission and capacity decisions.

## Alternatives considered

**Reset databases to obtain new defaults.** This discards independent wallet, membership and asset history without fixing route or consumer defects. Recorded migrations preserve those facts.

**Apply catalog edits to every assigned team.** This silently changes negotiated seats and resource settings. Explicit assignment provides a reviewable change and audit reason.

**Rename all technical identities or create a second credential without moving the first.** The former breaks deployed update trust and workspace paths; the latter retains duplicate private data and can restore a stale credential. Moving the matching Keychain item preserves its access controls.

## Consequences

Historical month attribution uses Asia/Shanghai and does not reconstruct unavailable department history. Plan assignment never credits wallets. Existing teams can retain a disabled plan until explicitly changed. Signed publication still requires deployment trust configuration and HTTPS; a missing signing key does not authorize unsigned installers.

## Verification

Isolated PostgreSQL tests cover upgrade from journal 0040 with retained usage and subscriptions, platform-only CRUD, stale edits, referenced deletion, disabled assignment, bearer reads and cross-team rejection. Installer acceptance covers failed storage and repeated draft preparation. Client tests and keyless browser replay cover billing, task recovery and native update availability. Real supplier execution and production installer handoff require release credentials and remain separate acceptance work.
