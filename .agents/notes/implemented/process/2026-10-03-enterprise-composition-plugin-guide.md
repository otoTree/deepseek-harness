# Agent Note: Enterprise composition plugins have a dedicated authoring path

Status: implemented

English | [中文](2026-10-03-enterprise-composition-plugin-guide.zh.md)

## Problem

The independent-plugin guide describes ordinary Cordis package development, but enterprise plugins add a second delivery and runtime contract: immutable `.dsh-plugin.zip` releases, schema-versioned manifests, Host and Client targets, installation-scoped SDK permissions, archive integrity, activation leases, migrations, and desktop unload behavior. Existing enterprise references describe those mechanisms separately without giving plugin authors one composition workflow.

## Decision

The repository keeps [`docs/cookbook/developing-an-enterprise-composition-plugin.md`](../../../../docs/cookbook/developing-an-enterprise-composition-plugin.md) as the enterprise composition plugin guide. It uses `packages/plugin/acceptance` as the concrete Host/Client archive reference and links the enterprise model, lifecycle reference, SDK reference, protocol, verifier, and loader owners. The development index has a dedicated runtime-path row for enterprise composition plugins.

The guide treats the manifest as the reviewable declaration of targets, contributions, permissions, resources, migrations, dependencies, and build provenance. It separates ordinary workspace package registration from enterprise archive publication and requires archive, target, lifecycle, and release tests together.

## Alternatives considered

**Extend the ordinary independent-plugin guide.** Enterprise archives and activation leases have different authorship, publication, and runtime boundaries. Combining them would make the general guide depend on enterprise-only details and hide the distinction between a workspace package and a marketplace release.

**Use only `enterprise-plugins.md`, `plugin-installation-lifecycle.md`, and `plugin-data-sdk.md`.** Those references are authoritative for architecture, lifecycle, and SDK behavior, but they do not order author tasks or identify the acceptance fixture and archive verification path. The new guide links them without replacing their ownership.

**Document only the Host target.** Enterprise releases can contain Client and Host targets, and a linked plugin must keep their credentials and lifecycle boundaries explicit. The guide therefore treats both target kinds and their composition as one release workflow.

## Consequences

Enterprise plugin authors have one development entry for target selection, manifest design, archive packaging, SDK use, activation cleanup, acceptance testing, and index updates. Changes to the manifest parser, package verifier, runtime loader, lifecycle API, SDK, or acceptance fixture require a corresponding guide review. The guide does not replace the protocol types, implementation READMEs, or enterprise API contracts.
