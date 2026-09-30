---
description: "Cordis activation helpers that install and dispose an enterprise plugin SDK."
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-runtime

English | [中文](README.zh.md)

## Summary

`bindPluginSdk` creates an installation-scoped SDK, cancels its in-flight calls, and invalidates it during disposal. `mountPluginTarget` isolates the SDK service, loads a standard Cordis target, and waits for target and provider fibers to stop. `installPluginSdk` supports callers that only need direct context attachment.

## Table of Contents

- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Composition

Load the runtime in the Host or Client target after the platform has verified the package and created its activation transport. The asynchronous disposer waits until registered effects have left the context and retained SDK handles have been invalidated. `mountPluginTarget` accepts an activation signal; cancellation requests target and provider disposal before rejecting, while a non-cooperative target may finish that disposal later.

## Model Experience

### Runtime model context

#### What the model sees

The runtime adds no prompt content. It only exposes the messages supplied through the `bindPluginSdk` transport.

#### Token effect

The bound transport associates model usage with the active installation and caller.

#### KV Cache effect

The runtime does not select or retain provider KV cache entries.


## Known Limitations and Deferred Work

- The runtime is cooperative and trusted. It does not isolate a plugin from Node.js or from another plugin in the same process.

### Dev Note

None.
