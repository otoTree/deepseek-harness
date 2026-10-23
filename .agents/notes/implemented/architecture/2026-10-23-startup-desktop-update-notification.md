# Agent Note: Startup desktop update discovery and notification

Status: implemented

English | [中文](2026-10-23-startup-desktop-update-notification.zh.md)

## Problem

Users need to learn that a desktop release is available without opening Settings. Discovery must remain available before sign-in, avoid delaying account restoration and preserve release authentication and explicit installation consent.

## Decision

The [native updater](../../../../apps/electrobun/src/desktop-updates.ts) performs one silent discovery per application launch alongside account restoration. Only a signed, matching-platform release with a greater semantic version produces an available-version record. Missing configuration, current versions, empty feeds and discovery failures produce no progress or error prompt. Startup discovery does not download an installer.

The native process owns the available version and dismissal for the launch. The [workspace Client](../../../../packages/client/ui-enterprise/src/client/enterprise.tsx) renders a persistent floating notification through `shell.overlay`; the [account page](../../../../packages/client/ui-enterprise-account/src/client/account.tsx) renders the same actions through its token-protected loopback transport before sign-in. Both read native state on entry and on availability events, so navigation and window replacement preserve the result. Closing the notification clears native state across windows. Restart permits discovery again; manual checks remain available after dismissal.

Install update enters the existing native confirmation, verified download and installer handoff. Manual checks wait for active startup discovery and share one manual interaction. Quit aborts discovery, drains active I/O and prevents late notifications. Account update dispatch does not await installer completion because installation stops that same account server; native lifecycle owns completion and errors.

This partially supersedes the manual-only discovery policy in the [signed desktop update decision](2026-10-20-signed-desktop-updates.md), which retains independent authentication, key rotation and installer-handoff rationale. [Admin publication](2026-10-21-admin-desktop-release-publication.md) retains offline signing and immutable publication ownership.

## Alternatives considered

**Only manual checks.** Users who do not visit Settings or the native menu cannot discover releases promptly.

**A modal startup prompt or automatic download.** A closable notification preserves access to login and ongoing work while leaving installer transfers and task shutdown under explicit user control.

**Browser-owned discovery and polling.** A single native discovery keeps signing keys, feed settings and release validation in their existing owner and avoids repeated requests across pages and windows. Each launch provides another opportunity without background polling.

## Consequences

A failed startup check waits until the next launch or a manual request. Dismissal is not a permanent version preference. Notification installation rechecks the signed feed, so it can present a newer release published since startup. Existing platform installer confirmations and manual macOS replacement remain unchanged.

Focused native tests cover silent outcomes, once-per-launch discovery, signature rejection, overlapping manual requests and shutdown. Client tests cover localized notification output, stale reads, dismissal, retry and disposal. Browser expectations cover the real account transport and the workspace overlay, narrow layouts, navigation and installation dispatch. Interactive OS installation remains platform-host acceptance work.
