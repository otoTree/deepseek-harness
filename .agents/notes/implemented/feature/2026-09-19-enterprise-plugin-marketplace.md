# Agent Note: Enterprise desktop plugin marketplace

Status: implemented

English | [中文](2026-09-19-enterprise-plugin-marketplace.zh.md)

## Problem

Enterprise desktop users need a portable, reviewable way to install Client and Host plugins across devices. Source files must stay out of release artifacts, and public visibility requires administrator approval.

## Decision

The first marketplace release accepts only `.dsh-plugin.zip` packages with `client` and/or `host` targets. The API validates ZIP paths, limits, manifest fields, target entrypoints, SHA-256 integrity records, and package digests before writing an immutable object-storage key. `cloud` and unknown targets fail validation.

Release visibility is `private`, `organization`, or `platform`. Private releases publish immediately for their creator. Organization releases enter organization review; platform releases enter platform review. Catalog responses expose published, non-revoked releases visible to the requesting organization. Account-level installation records preserve the selected release, configuration, target state, and enabled flag.

The desktop layout owns `MainNavigation` and the `main.surface` slot. The enterprise plugin contributes a sidebar footer action and a marketplace page without coupling marketplace state to Session lifecycle. Installation is separate from enablement; the Client requests package upload and account operations through the authenticated Host bridge.

## Consequences

Packages can be downloaded and verified on another device without transferring Keychain or operating-system permissions. Public publication remains an explicit administrative decision. Existing JSON plugin records remain readable through the legacy API and verifier fields.

## Verification

The package parser has focused tests for dual-target packages, cloud rejection, traversal rejection, and integrity coverage. TypeScript checks cover the API, Electrobun verifier, layout, and enterprise client packages.

## Alternatives considered

Keeping ZIP files as ordinary JSON artifacts would lose the integrity data required for cross-device installation, so the implementation uses a standard ZIP, an immutable object-storage key, and package and entry digests. Release signing would require users or deployments to manage a publication key without changing who may upload, review, download, or install a release, so the first marketplace phase omits it. Immediate publication would bypass organization and platform administrator responsibility, so public uploads retain an approval status.
