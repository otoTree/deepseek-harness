# Agent Note: Arivo settings visual ownership

Status: implemented

English | [中文](2026-10-26-arivo-settings-visual-ownership.zh.md)

## Problem

Arivo account, model and runtime sections share the fallback gear, while opaque settings columns and nested frame insets interrupt the product backdrop. A dialog-only screenshot hides the surrounding defects.

## Decision

Arivo registrations provide semantic icons through the existing slot icon option. The settings shell exposes stable data attributes; Arivo owns its background, navigation and frame spacing in the startup theme. Default settings styling remains owned by the generic shell. The account plugin supplies distinct navigation glyphs, a raised dialog and one field focus treatment.

## Alternatives considered

**Match product section identifiers inside the generic fallback.** This couples the shared settings shell to an individual distribution and bypasses the existing registration option.

**Use CSS Module class fragments.** Generated class names do not provide an explicit styling contract for product themes.

**Accept a blurred dialog capture.** It cannot establish that navigation icons, page surfaces or content spacing are correct.

## Consequences

The generic shell gains presentation attributes without new settings state or commands. Product verification covers the unobscured settings page and the dialog separately, with distinct navigation glyphs and transparent shell backgrounds checked in the built runtime. Native screenshots remain necessary to assess actual drawing.
