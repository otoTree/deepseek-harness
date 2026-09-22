---
description: "Remote commands for the Session-following Workbench, including terminal sessions, workspace-relative files, and shared browser state."
kind: "package-reference"
---
# @deepseek-ai/dsh-api-workbench-controller

English | [中文](README.zh.md)

## Summary

The Workbench Controller exposes one `workbench` Remote namespace for the Client's terminal, workspace-file, and browser panels. Mount it when a Web or desktop Client needs Session-owned operations with one request vocabulary. File reads and writes stay inside the Session workspace, writes carry an expected version, and terminal/browser calls delegate to their existing capability providers. Recognized DOCX, PPTX, XLSX, and CSV files return bounded payloads for Client rendering; DOCX, PPTX, and XLSX accept guarded binary replacement. It is a Host package and does not replace the terminal, filesystem, or browser services.

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

Mount the Controller beside the Session, filesystem, terminal, browser, gateway, and Remote client packages that make up a Workbench composition.

### When to choose it

Choose this package when a Client needs one Host Remote for Workbench panels. Use the lower-level capability package directly when no Client Remote is required.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-api-workbench-controller'
```

The optional `maxFileBytes` setting bounds decoded text returned by `fileRead`; the default is `2000000` bytes. `maxMediaBytes` separately bounds browser-native media, document reads, and editable Office replacement payloads and defaults to `32000000` bytes. Other limits belong to the terminal and browser capability providers.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`WorkbenchController` resolves the requested Session to its exact `Agent`, then dispatches terminal operations through `TerminalSessionService`, workspace paths through `ctx.fs`, and browser operations through `ctx.browsers`. Terminal clients can write raw keyboard data without reserving a model-facing send operation, resize the PTY, read retained raw output, and follow a baseline plus monotonic raw deltas; ANSI and cursor-control sequences remain intact for the renderer. Browser Remotes accept native semantic observations and provide provider navigation, automation, snapshot, and screenshot operations. File paths are normalized as workspace-relative POSIX paths; valid UTF-8 files return versioned text for guarded replacement, recognized images, audio, video, and PDF files return a bounded Base64 payload and an allowlisted browser media type, and DOCX, PPTX, XLSX, and CSV files return a bounded document payload. Text writes use `ctx.fs.writeText`; DOCX, PPTX, and XLSX replacements must be canonical Base64, fit `maxMediaBytes`, begin with the ZIP signature, match the requested file extension, and use `ctx.fs.writeBytes`. Both paths pass the resolved Session sandbox policy to `ctx.fs`, so `workspace-write` is evaluated against the Session workspace rather than the deployment fallback root. The source map is [`src/index.ts`](src/index.ts) and [`src/types.ts`](src/types.ts).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-client-ui-workbench`](../../client/ui-workbench/README.md) — Client panels and Session-scoped layout.
- [`dsh-browser`](../../browser/browser/README.md) — shared browser context and provider seam.
- [`dsh-terminal`](../../terminal/terminal/README.md) — owner-scoped PTY service.
- [`dsh-fs`](../../fs/fs/README.md) — workspace filesystem capability.

-----

<a id="model-experience"></a>
## Model Experience

### Remote Workbench results

#### What the model sees

None directly: `workbench` Remote calls serve the Client, while model-facing terminal, filesystem, and browser tools own any model-visible schemas and results.

#### Token effect

Zero tokens unless a separate model-facing consumer renders a capability result into a request.

#### KV Cache effect

The Controller does not mutate model request prefixes or provider cache state.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The Controller requires each requested Session to have the corresponding capability mounted; it does not create terminal or filesystem providers.
- Binary replacement accepts `.docx`, `.pptx`, and `.xlsx`; PDF, CSV, media, and unrecognized binary files remain read-only through this Remote.
- Browser screenshots remain available as bounded Remote payloads for model and automation consumers; the Workbench UI renders its native WebView or Web iframe instead of those payloads.
- The Controller synchronizes native observations with Session browser state but does not make the native WebView and Playwright provider one browser engine.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
