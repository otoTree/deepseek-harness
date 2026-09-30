# Agent Note: 智域OS product name

Status: implemented

English | [中文](2026-09-29-zhiyu-os-product-name.zh.md)

## Problem

The user-facing product identity was still rendered as `AgentOS` across the Web title, PWA metadata, client sidebar, locale dictionaries, and official-brand documentation.

## Decision

The product name is `智域OS`. Web document titles, PWA `name` and `short_name`, official-brand locale values, local-build labels, tests, snapshots, and brand documentation use this name. Package names, environment variables, profile ids, API identifiers, and internal implementation names remain unchanged.

## Alternatives considered

- **Keep `AgentOS` in English locales** — this would leave the product identity inconsistent between locale dictionaries and the requested brand.
- **Rename package and protocol identifiers** — this would expand a product-copy change into an API and distribution migration without a requirement to change technical identifiers.

## Consequences

The browser title, installed application label, sidebar brand, and test expectations present one product name. Technical integrations continue to use their existing stable identifiers.
