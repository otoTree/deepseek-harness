---
description: "Non-executing Hono sandbox prototype and its fail-closed response."
---

# Enterprise sandbox prototype

English | [中文](README.zh.md)

## Summary

This prototype does not execute code. Its [router](src/index.ts) returns HTTP 503 for readiness and execution requests, with `accepted: false` for execution. Importing it does not open a network listener.

## Table of Contents

- [Development](#development)
- [Limitations](#limitations)
- [Dev Note](#dev-note)

<a id="development"></a>
## Development

`pnpm --filter @deepseek-ai/dsh-enterprise-sandbox test` checks that the prototype cannot acknowledge nonexistent execution. There is no standalone Node application launcher in this directory.

<a id="limitations"></a>
## Limitations

Enterprise desktop tools must connect to the existing [local sandbox provider](../../packages/sandbox/sandbox-local/README.md), not this prototype. No Seatbelt execution, process containment, or enterprise policy is established by these HTTP responses.

<a id="dev-note"></a>
## Dev Note

The [acceptance matrix](../../docs/developer/discussion/enterprise-client-acceptance.md) records the required native sandbox tests.
