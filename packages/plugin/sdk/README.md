---
description: "Author-facing installation-scoped APIs for identity, text models, objects, database, and cache."
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-sdk

English | [中文](README.zh.md)

## Summary

`createPluginSdk(transport)` builds the SDK supplied to one activated plugin target. The facade exposes the current user, authorized text models, durable objects, restricted SQL, disposable cache operations, and optional Host-only network, credential, authorization, MCP, Skill, and installation configuration operations.

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

The selected text model receives the messages supplied to `models.text()` or `models.textStream()` by the plugin.

#### Token effect

Input and output tokens are recorded against the current user, organization, installation, and model call.

#### KV Cache effect

The SDK does not control provider KV caching; cache behavior follows the selected model gateway.


## Known Limitations and Deferred Work

- There is no scheduler, queue, worker, background task, image generation, video generation, or Cloud target API.

### Dev Note

None.
