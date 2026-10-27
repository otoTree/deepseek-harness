# Agent Note: ZhiyuOS desktop branding and stable installation identity

Status: implemented

English | [中文](2026-10-21-zhiyu-desktop-brand.zh.md)

## Problem

Desktop application names, installer filenames and platform icons identify the product independently of its localized interface. Rebranding these visible names can disconnect installed credentials or invalidate authenticated update metadata if technical identity changes with them.

## Decision

The [desktop brand](../../../../apps/electrobun/src/brand.ts) names the application 智域OS and installer artifacts `zhiyu-os`. The native build uses that name for application bundles, Windows Setup metadata and DMG volumes. The [prepared PNG](../../../../apps/web/public/favicon.png) extracts the silver mark from the [product artwork](../../../../logo.png), excluding its wordmark and presentation examples. Desktop builds copy it into the Windows PNG and native iconset, while Admin carries the same PNG. Account-page image requests are restricted to the public favicon file; privileged account operations retain token and Origin checks. Official client build titles use 智域OS.

Released application identifiers, signing-key trust, launch-agent labels and data directories remain stable. [Credential service migration](2026-10-23-enterprise-upgrade-and-administration.md) preserves matching account credentials. Upstream package names and license attribution retain their technical and legal meanings. The Windows verifier accepts explicitly named current and legacy installer packages, requires their metadata names to match their executable names, and retains the application-identifier check.

The [installer protection decision](2026-10-19-local-desktop-installer-protection.md) retains construction and obfuscation rationale, and the [signed update decision](2026-10-20-signed-desktop-updates.md) retains native update authentication and handoff rationale. Neither decision is superseded by presentation names. [Neutral client chrome](../simplification/2026-09-17-neutral-enterprise-client-chrome.md) independently retains the text-only sidebar and New Session hero decision.

## Alternatives considered

**Replace every upstream identifier and storage path.** This disconnects existing account credentials and workspaces, and changes the identity authenticated by deployed update clients. Visible product naming does not require that migration.

**Change interface text alone.** Finder, the Dock, Windows Setup and downloaded filenames still expose separate build metadata and icon assets, so interface text cannot complete the product rebrand.

## Consequences

The first macOS branded install creates `智域OS.app` alongside a differently named legacy application. Users quit the old app, install and verify the branded app, then remove the old bundle. Old Windows updaters require a manual branded installation because their verifier fixes the legacy package name. Subsequent branded Windows clients accept both explicitly supported package names without weakening signature, identity or byte verification.

Installer verification checks the mounted application names. Windows fixtures cover branded packages, legacy packages and mismatched names or identities. Desktop data-path tests retain released locations. A renamed installer still needs a greater semantic version and a freshly signed release manifest; Apple notarization and Windows publisher trust remain separate release requirements.
