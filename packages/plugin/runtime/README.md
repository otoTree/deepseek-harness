---
description: "Cordis activation helpers that install and dispose an enterprise plugin SDK."
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-runtime

English | [中文](README.zh.md)

## Summary

`bindPluginSdk` creates an installation-scoped SDK, cancels its in-flight calls, and invalidates it during disposal. `mountPluginTarget` isolates the SDK service, loads a standard Cordis target, and waits for target and provider fibers to stop. `ClientWindowRegistry` owns declarative window definitions and ephemeral instances, while `createClientWindowService` exposes only contribution-ID based open, close, focus, and list operations to a Client target.

## Table of Contents

- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Composition

`installPluginSdk` and `installClientWindow` return Promise-based disposers. Await disposal before replacing an activation or reading the Context after removal.

After package verification, `CordisPluginManager` loads product Host entries into an SDK-isolated Loader group. Its package fibers own registrations; group removal drains effects and remains retryable after failure. Preparation cancellation removes incomplete groups. `mountPluginTarget` provides the corresponding fiber lifecycle for Client modules, and `bindPluginSdk` cancels calls and invalidates retained SDK handles on disposal. Trusted non-cooperative code may require a Host restart.

Register each normalized window contribution once on the Host registry. A `singleton` contribution focuses its existing instance, and a `many` contribution creates another instance. The registry never accepts a URL, script path, or native window options from plugin code. Closing or disposing one instance removes only that instance; `closePlugin` drains all instances owned by one plugin during disable or upgrade.

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

**Runtime invariant:** No runtime invariant companion is published. Activation and window registrations are owned by their disposers, which invalidate access and remove their records together.
