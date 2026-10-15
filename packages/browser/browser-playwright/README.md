---
description: "Playwright provider that gives each Session an isolated browser context with tab actions, snapshots, screenshots, and cleanup."
kind: "package-reference"
---
# @deepseek-ai/dsh-browser-playwright

English | [中文](README.zh.md)

## Summary

This package registers `playwright` for `dsh-browser`. It can launch isolated Chromium contexts or attach automation to the desktop’s exact native Chromium pages. Both modes expose navigation, input, ARIA snapshots, and screenshots to Session consumers; browser identities and model tool schemas belong to other packages.

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

Mount `dsh-browser` and this provider in the same composition, then let browser consumers select the `playwright` provider.

### When to choose it

Choose it for automated navigation and interaction, including a desktop whose embedded Chromium exposes a loopback CDP endpoint.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-browser'
- name: '@deepseek-ai/dsh-browser-playwright'
```

Without `desktopCdpEndpoint`, the provider launches Playwright’s full Chromium with modern headless mode; install it with `pnpm --filter @deepseek-ai/dsh-browser-playwright exec playwright install chromium`. With that endpoint, the desktop owns rendering, storage, and process lifetime; launch and context options below apply only to launch mode.

| Field | Default | Meaning |
|---|---|---|
| `desktopCdpEndpoint` | Unset | Attach to native Chromium over loopback HTTP instead of launching a browser. |
| `desktopTimeoutMs` | `30000` | Positive attachment, action, and navigation timeout in milliseconds. |
| `channel` | `chromium` | Full Playwright Chromium, or installed `chrome` / `msedge`; an unavailable distribution fails without fallback. |
| `headless` | `true` | Run without a separate browser window. |
| `locale` | `zh-CN` | Language and locale-sensitive formatting. |
| `timezoneId` | `Asia/Shanghai` | IANA time zone. |
| `viewport` | `1440 × 900` | Page viewport in pixels. |
| `userAgent` | Browser default | Optional deployment-specific user agent. |
| `extraHTTPHeaders` | Unset | Additional deployment request headers. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Launch mode lazily shares one browser process and creates an isolated context per Session. Desktop mode issues a unique blank-page attachment URL, waits for the native view to expose that exact CDP target, and navigates it once. It never selects another page by destination URL or creates a second page. Concurrent actions await attachment readiness. Each tab connects after HTTP discovery publishes its guest, because existing CEF CDP connections may not announce new pages. Teardown disconnects Playwright; native views own page destruction and the desktop retains its Chromium process. See [`src/index.ts`](src/index.ts) and [`src/attached.ts`](src/attached.ts).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-browser`](../browser/README.md) — provider-neutral capability state.
- [`dsh-tool-browser`](../tool-browser/README.md) — model-facing tools.
- [Playwright](https://playwright.dev/) — upstream browser automation API.

-----

<a id="model-experience"></a>
## Model Experience

### Provider results

#### What the model sees

The provider contributes tab metadata, accessibility snapshot text, or bounded PNG bytes to [`dsh-tool-browser`](../tool-browser/README.md), which renders those values as model tool results.

#### Token effect

Navigation metadata and snapshot text consume tokens only when the model-facing tool returns them; screenshots consume the provider result budget instead of text tokens.

#### KV Cache effect

The provider does not alter the request prefix; each returned tool result is appended by the owning tool consumer.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Chromium must be available to Playwright at runtime; this package does not download or manage browser binaries.
- Desktop attachment requires a mounted native view and an HTTP CDP endpoint on `127.0.0.1`; missing or ambiguous targets fail explicitly.
- Launch contexts use temporary Session storage. Desktop partitions retain site storage under desktop ownership. Websites may still request human verification.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
