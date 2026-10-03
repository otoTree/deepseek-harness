# Agent Note: Development index is the required code-navigation map

Status: implemented

English | [中文](2026-10-03-development-index.zh.md)

## Problem

The repository has architecture, package, subsystem, and generated graph documents, but an agent still needs a single lookup that connects a change type to the source owner, entry point, tests, and governing document. The root `AGENTS.md` also carried a partial package summary that could drift from the workspace.

## Decision

The repository keeps a manually curated, bilingual development index at [`docs/development-index.md`](../../../../docs/development-index.md). The index has four levels: repository roots, runtime paths, package groups, and file conventions. It records navigation and ownership facts only; package behavior remains in package READMEs, subsystem contracts, architecture documents, generated catalogs, and source.

The root `AGENTS.md` requires agents to read the relevant index layer before code, then read the target source, tests, package README, and applicable subtree instructions. A code or structure change updates the index in the same change when it alters a listed directory, package, entry point, owner, generated artifact, or development path. Documentation checks validate the paired index and its links; the index is not added to the generated graph pipeline because its change-to-file guidance requires maintained human judgment.

## Alternatives considered

**Keep the package summary in the root instructions.** The summary is required in every agent context but has no room for runtime paths, test ownership, or file-level guidance. Moving the detailed map to a linked document keeps the standing instructions concise and gives the map one owner.

**Use only the generated module and documentation graphs.** Those graphs answer dependency and documentation relationships, but they do not identify the first source files to read for a behavior change or the relevant test and snapshot owners. The index links to the generated graphs instead of duplicating their edges.

**Generate the index from directory names.** Directory discovery cannot infer ownership, launch paths, generated-source rules, or the correct tests. Manual curation is retained for those facts, with package inventory and link checks providing freshness evidence.

## Consequences

Agents have one documented navigation step before implementation, and the root instructions no longer duplicate a stale package-group summary. Maintainers must update the index when repository structure or development ownership changes. The client package inventory lists each current UI package, while `packages/model/` points at manifests and source because it has no group README; exact package contracts remain owned by the files named in each row.
