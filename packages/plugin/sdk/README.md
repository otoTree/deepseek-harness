---
description: "Author-facing installation-scoped APIs for identity, text models, objects, database, and cache."
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-sdk

English | [中文](README.zh.md)

## Summary

`createPluginSdk(transport)` builds the SDK supplied to one activated plugin target. The facade exposes the current user, a unified text and media model catalog, durable objects, restricted SQL, disposable cache operations, and optional Host-only network, credential, authorization, MCP, Skill, and installation configuration operations.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The platform supplies an installation-scoped transport and keeps platform Runtime and model-provider tokens in the Host. Client facades expose no integration secrets. An authorized trusted Host package may read its own integration credentials; it must keep them out of logs and model results. SDK calls cannot select another user, organization, installation or data space, and disposed transports reject calls. Same-process Node plugins are trusted code, not a sandbox.

## Model Experience

### SDK model calls

#### What the model sees

The selected text model receives messages from `models.text()` or `models.textStream()`. `models.list({ operation })` filters the shared catalog. Media consumers use `previewTask`, `createTask`, `queryTask`, and `listTasks`; `uploadAsset` and `assetAccess` keep reference and result media under platform authorization. Requests use platform model IDs and structured parameters. [The model platform reference](../../../docs/developer/model-platform.md) defines durable execution, integer CNY prices, conditional billing, and delivery states.

#### Token effect

Text token usage and final CNY charges are attributed to the current account, organization, installation, and durable call ID. The stream emits canonical text deltas and its usage after relay consumption. Media reserves funds before background submission; task billing distinguishes actual usage, reservation fallback, and unpaid overage.

#### KV Cache effect

The SDK does not control provider KV caching; cache behavior follows the selected model gateway.


## Known Limitations and Deferred Work

- There is no general-purpose scheduler or Cloud target API. Media execution requires enabled platform operation configurations and the `models.media` permission.

### Dev Note

None.

**Runtime invariant:** No runtime invariant companion is published. The facade delegates persistence and authorization to its transport and owns only its activation lifetime.
