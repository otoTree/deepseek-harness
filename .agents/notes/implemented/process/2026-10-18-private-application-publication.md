# Agent Note: Private application publication

Status: implemented

English | [中文](2026-10-18-private-application-publication.zh.md)

## Problem

Enterprise services, administration, desktop and sandbox applications have container or desktop distribution paths. Treating every `apps/*` directory as an npm release member requires publication metadata and payloads for applications whose deployment is owned elsewhere.

## Decision

The dsh npm family includes `apps/cli`, `apps/web` and non-experimental harness packages. Other applications remain private. All private applications and packages share the root version and participate in version bumps without release tags. Workspace constraints reject a non-private application outside the npm publish set.

This narrows application membership in the [release sequences decision](2026-08-10-npm-release-sequences.md); that note continues to own independent families, tags and publication ordering.

## Alternatives considered

Publishing every application would introduce unsupported npm launch paths and duplicate the deployment owners. Excluding private applications from version bumps would make the workspace version-coherence gate reject the next release.

## Consequences

Adding an npm application requires an explicit release-family and payload-policy change. Package manifests expose built declarations, and packed payloads must contain every exported runtime file. Container and desktop releases retain their own delivery workflows.
