# Agent Note: Enterprise settings assign one page to each task

Status: implemented

English | [中文](2026-10-09-enterprise-settings-task-ownership.zh.md)

## Problem

Account settings duplicate the model catalog and personal usage, while plugin settings duplicate the marketplace without its installation controls. Users must infer which page owns an action. A bounded usage page also cannot establish a full monthly total.

## Decision

Account owns organization identity, subscription, roles, and devices. Models owns default-model selection and the capability catalog. Directory owns members, invitations, and privileged member usage. Billing owns the shared wallet, redemption, recent personal usage, and ledger, with recent personal usage explicitly labeled as partial. Plugin settings retain a discoverable link that closes settings and opens the marketplace; the marketplace remains the sole catalog and installation interface.

The [team wallet](../feature/2026-09-18-team-cny-wallet.md) and [marketplace](../feature/2026-09-19-enterprise-plugin-marketplace.md) decisions retain ownership of authorization, billing, and package lifecycle. This decision concerns settings navigation and presentation only.

## Alternatives considered

Keeping summary copies on Account would preserve competing destinations and require users to reconcile different reporting windows. Removing the plugin settings entry entirely would reduce discoverability for users who look for plugin management in Settings.

## Consequences

Users visit one destination for each task. Models expose capability limits beside the default selector, and an empty catalog disables selection. Plugin settings perform no catalog read. Recent personal usage uses the existing Host summary rather than a second browser calculation. Component snapshots and interaction tests cover page allocation, model selection, empty models, device confirmation, wallet redemption, and the marketplace transition; native desktop acceptance remains separate.
