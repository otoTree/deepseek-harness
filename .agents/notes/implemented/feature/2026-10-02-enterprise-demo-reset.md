# Agent Note: Local enterprise demo reset and directory fixture

Status: implemented

English | [中文](2026-10-02-enterprise-demo-reset.zh.md)

## Problem

The local Enterprise database accumulated test accounts and organizations, while the administration directory needed a login-ready, multi-level enterprise example.

## Decision

`apps/api/scripts/reset-enterprise-demo.ts` performs a transaction-scoped local reset. It retains the two screenshot accounts, their organizations and tenant data, and the platform administrator. Other test users and tenant rows are removed in foreign-key order. The script then creates a deterministic Zhiyu Technology Group fixture with three business groups, nested departments and teams, memberships, role bindings, subscriptions, and wallets. Demo credentials use fixed IDs and a local-only migration URL guard so the script can be rerun without targeting a remote database.

## Consequences

The fixture can be recreated after local acceptance runs and provides a real Better Auth credential for browser verification. Existing retained accounts keep their credentials and runtime records. The demo password is printed only by the local seed command and is intended for development environments.
