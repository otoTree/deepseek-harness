---
description: "Reference Host and Client plugin for exercising every first-release SDK capability."
kind: "package-reference"
---

# Enterprise plugin acceptance fixture

English | [中文](README.zh.md)

## Summary

This fixture is a standard Cordis plugin source used by integration tests and by the two immutable manifests in this directory. The Host contribution calls identity, text models, objects, the restricted database, and cache through the injected SDK. The Client contribution exposes the same snapshot data to a page adapter without receiving credentials.

`manifest-v1.json` and `manifest-v2.json` use the same plugin identity. Version 2 adds the database transaction permission and one migration so an installation upgrade can verify permission confirmation, migration, and data retention.

Run `pnpm --filter @deepseek-ai/dsh-plugin-acceptance build` to compile both targets and create the two `.dsh-plugin.zip` files in `dist/`. Packaging records the current repository lockfile digest. `test:package` reparses both archives and checks every integrity entry.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

### Dev Note

Use the manifests as immutable release inputs; do not edit a version after publication.

## Model Experience

### SDK model calls

#### What the model sees

The selected text model receives the messages supplied by `models.text()` in the acceptance probe. The Host contribution registers `enterprise_plugin_acceptance` with the standard tool service. Its returned model text is persisted by the existing `tool/call` and `tool/result` Session events and is reconstructed by Session projection before the next Agent model request.

#### Token effect

Input and output tokens are recorded against the current user, organization, installation, and model call.

#### KV Cache effect

The fixture does not control provider KV caching; cache behavior follows the selected model gateway.

## Known Limitations and Deferred Work

- The fixture does not provide a background task, Cloud target, or image/video capability.
