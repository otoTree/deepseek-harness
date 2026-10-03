# Agent Note: Independent plugin development has one guided entry

Status: implemented

English | [中文](2026-10-03-independent-plugin-development-guide.zh.md)

## Problem

Plugin development guidance is distributed across package creation, plugin classification, extension patterns, package READMEs, and testing policy. A contributor can find individual rules but lacks one ordered path for deciding independence, choosing Service Definition / Provider / Consumer boundaries, mounting a real composition, proving disposal, and updating the development index.

## Decision

The repository keeps [`docs/cookbook/developing-an-independent-plugin.md`](../../../../docs/cookbook/developing-an-independent-plugin.md) as the independent-plugin development guide. It is a cookbook: the guide orders design, package topology, public contracts, entry points, composition, lifecycle tests, package documentation, index maintenance, and verification. It links to existing owners rather than copying package contracts or generated catalogs.

The development index has a dedicated runtime-path row for a new independent plugin or capability. The root `AGENTS.md` already requires agents to use that index before implementation, so the guide becomes discoverable through the same required navigation step. The guide and index have bilingual counterparts and consistency records.

## Alternatives considered

**Add the guidance to `adding-a-package.md`.** That page owns workspace package creation and compiler registration. Adding lifecycle design, composition, and index maintenance would make its package checklist responsible for a broader plugin contract and would make readers scan unrelated setup detail.

**Add the guidance to `extension-cookbook.md`.** That page is a pattern reference for tools, hooks, UI plugins, and protocol drivers. It does not own the ordered package and release workflow needed for an independent plugin, so the new guide links to it indirectly through the extension patterns and keeps the two scopes distinct.

**Put the guidance only in the development index.** The index is a lookup map, not a procedure. A separate cookbook provides one actionable path while the index keeps one short change-to-file entry.

## Consequences

Contributors have one document for the independent-plugin workflow, and the index identifies it when a new capability or plugin is the change type. The guide must be updated when the package checklist, composition rules, lifecycle testing policy, or index maintenance contract changes. It does not replace package READMEs, subsystem pages, generated references, or source-level JSDoc.
