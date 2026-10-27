---
description: "Validated account actions and the browser account entry used by the enterprise Electrobun host."
kind: "package-library"
---

# @deepseek-ai/dsh-client-ui-enterprise-account

English | [中文](README.zh.md)

## Summary

Enterprise Electrobun code can share one validated set of login, registration, organization, and logout actions between its native host and account page. The package exports Zod records from its main entry and a browser account entry from `./client`. The account page consumes the shared `ui-theme` visual roles in its fixed dark presentation. It does not own API credentials or transport.

The dedicated host serves the shared product icon at `/favicon.png`; the account header renders it alongside the locale-owned product name.

Saved team choices are revalidated. Switching stops the old runtime and clears its credentials; failed validation never selects the first team. Public invitation and password-recovery links use the [account page](../../../apps/admin/app/account/page.tsx).

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

Use the main entry when native account handlers need the shared action and display-state records. Load `./client` only as the dedicated Electrobun account-page entry; it is not a Cordis plugin or a profile layer. The dark account document places product context beside a bounded sign-in form; narrow windows stack both regions while keeping the form accessible.

### Entry point

```text
import { accountAction } from '@deepseek-ai/dsh-client-ui-enterprise-account'

const action = accountAction.parse(input)
```

The native Host supplies the public deployment policy from the API. Open deployments offer independent team creation; private deployments offer company selection and invitation entry. Disabled registration hides account creation. An invitation takes effect when the recipient submits it, without another administrator approval. Department and member management belongs to the [organization Directory](../ui-enterprise/README.md#mounting) in both modes.

Before sign-in, the page can display the native updater’s verified version in a closable floating notification. Reading, dismissal and installation dispatch use the per-launch token-protected account transport. Installation enters the native confirmation flow independently of account mutations; failed actions remain retryable. The native host owns discovery and launch-scoped dismissal.

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
- The package exposes account, organization and native update entry actions; platform administration remains in the separate admin application.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No runtime invariant companion is published. The package contains account records and presentation; the native Host owns authentication and transport.
