---
description: "Cloud workspace lifecycle service and injectable remote sandbox backend."
---

# Enterprise cloud workspace service

English | [中文](README.zh.md)

## Summary

The [router](src/index.ts) exposes organization-scoped workspace lifecycle operations: create, list, start, stop, lease, and destroy. The default in-memory backend is for contract tests only; production deployments inject the E2B-backed workspace provider. No route silently falls back to unconfined execution.

## Table of Contents

- [Development](#development)
- [Limitations](#limitations)
- [Dev Note](#dev-note)

<a id="development"></a>
## Development

`pnpm --filter @deepseek-ai/dsh-enterprise-sandbox test` checks workspace lifecycle and organization isolation. There is no standalone Node application launcher in this directory.

<a id="limitations"></a>
## Limitations

The memory backend does not provide process containment or remote execution. E2B integration, tenant authentication, lease persistence, quotas, and file/process adapters remain deployment work. A missing remote backend must fail closed.

<a id="dev-note"></a>
## Dev Note

The [acceptance matrix](../../docs/developer/discussion/enterprise-client-acceptance.md) records the required native sandbox tests.
