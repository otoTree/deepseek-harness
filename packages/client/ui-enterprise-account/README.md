---
description: "Validated account actions and the browser account entry used by the enterprise Electrobun host."
kind: "package-library"
---

# @deepseek-ai/dsh-client-ui-enterprise-account

English | [中文](README.zh.md)

## Summary

Enterprise Electrobun code can share one validated set of login, registration, organization, and logout actions between its native host and account page. The package exports Zod records from its main entry and a browser account entry from `./client`. It does not own API credentials or transport.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to use it

Use the main entry when native account handlers need the shared action and display-state records. Load `./client` only as the dedicated Electrobun account-page entry; it is not a Cordis plugin or a profile layer.

### Entry point

```text
import { accountAction } from '@deepseek-ai/dsh-client-ui-enterprise-account'

const action = accountAction.parse(input)
```

Successful parsing returns an allow-listed account command. Invalid fields fail before the native host dispatches an API request.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The main entry exports browser-independent Zod records. The client entry renders the account document and calls only the native host endpoint supplied by the Electrobun shell.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Enterprise desktop](../../../apps/electrobun/README.md) — native account transport and credential ownership.
- [Enterprise API](../../../apps/api/README.md) — authentication and organization operations.

-----

<a id="model-experience"></a>
## Model Experience

None, as the account page and action records register no model-facing input.

#### KV Cache effect

The package never creates a model request, so it does not affect prompt prefixes or cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The browser entry requires the Electrobun account host; it cannot authenticate or persist credentials by itself.
- The package exposes account and organization entry actions only; platform administration remains in the separate admin application.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
