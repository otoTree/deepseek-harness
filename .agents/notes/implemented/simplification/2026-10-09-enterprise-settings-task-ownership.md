# Agent Note: Enterprise settings assign one page to each task

Status: implemented

English | [中文](2026-10-09-enterprise-settings-task-ownership.zh.md)

## Problem

Account settings duplicate the model catalog and personal usage, while plugin settings duplicate the marketplace without its installation controls. Users must infer which page owns an action. A bounded usage page also cannot establish a full monthly total.

## Decision

Account owns organization identity, subscription, roles, and devices. Models owns default-model selection and the capability catalog. Directory opens on members, then exposes the selected member’s profile and a separate privileged usage tab; invitations have their own view. Billing separates personal period totals, call records, and shared-wallet transactions. Usage offers rolling 3-, 7-, and 30-day periods and custom dates. The Host aggregates all API pages for the requested period; unrelated settings reads omit usage. Settings is a main application page, parallel to Cloud Drive and Plugin Market. These pages show the permanent application rail and their own navigation; the conversation sidebar and Session controls stay hidden without rewriting the sidebar preference. Invite and redeem forms open in shared modals above it. A keyed `main.surface` registration gives each page its own owner; sidebar onboarding links and the Settings page share a section-selection store. Plugin settings link to the marketplace, which remains the sole catalog and installation interface.

The pages use subdued bordered sections and aligned controls. Model selectors display names; full IDs remain in catalog details. Financial values retain full precision. Content-width rules stack filters and financial summaries. Shared modals contain keyboard focus, restore the opener, and own Escape while above Settings.

The [team wallet](../feature/2026-09-18-team-cny-wallet.md) and [marketplace](../feature/2026-09-19-enterprise-plugin-marketplace.md) decisions retain ownership of authorization, billing, and package lifecycle. This decision concerns settings navigation and presentation only.

## Alternatives considered

A modal Settings shell would put operation dialogs inside another modal and obstruct application navigation. Keeping summary copies on Account would preserve competing destinations and require users to reconcile different reporting windows. Removing the plugin settings entry entirely would reduce discoverability for users who look for plugin management in Settings.

## Consequences

Users visit one destination for each task and open details or operations as needed. Models expose capability limits beside the default selector, and an empty catalog disables selection. Records load on entry and paginate independently; changing the period discards stale responses. Period totals require reading every API page, so large histories increase request latency. Component tests and session-driven browser snapshots cover navigation, filtering, pagination, single operation dialogs, and narrow layouts; native desktop acceptance remains separate.
