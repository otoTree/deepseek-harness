# Cookbook: developing an independent plugin

English | [中文](developing-an-independent-plugin.zh.md)

This guide describes how to design, implement, compose, test, document, and index a Cordis plugin that can be mounted, replaced, or omitted without changing the agent loop. Use it for a product capability, provider, consumer, hook, UI contribution, or integration plugin. Start with [plugin classification](../plugin-classification.md) and the [workspace package checklist](adding-a-package.md); this guide joins those references into one development path.

## Table of Contents

- [Define the independent responsibility](#define-the-independent-responsibility)
- [Choose the package topology](#choose-the-package-topology)
- [Design the public contract](#design-the-public-contract)
- [Create the package and entry point](#create-the-package-and-entry-point)
- [Mount the plugin through a real composition](#mount-the-plugin-through-a-real-composition)
- [Test independent lifecycle and behavior](#test-independent-lifecycle-and-behavior)
- [Write the package contract](#write-the-package-contract)
- [Update the development index](#update-the-development-index)
- [Verification](#verification)

<a id="define-the-independent-responsibility"></a>
## 1. Define the independent responsibility

Write one sentence that names the plugin's current actor, input, output, and owner. A plugin is independent when its lifecycle and contract have a current owner, its contribution can be disposed with its Cordis fiber, and another composition can omit or replace it through a documented extension point.

Choose the runtime class before choosing a package name:

- A built-in runtime plugin belongs to the execution spine and still exposes a replaceable service contract.
- A product capability adds a user- or model-facing behavior while the spine remains usable without it.
- A composition or application plugin assembles or hosts other plugins; it does not become the capability owner merely because it loads the capability.
- A plugin-system infrastructure package discovers, loads, observes, or integrates plugins.

Do not call a package independent when it reaches into another package's private state, requires a particular sibling implementation, or changes the agent loop because no extension point exists. Move the missing behavior to a documented extension point or record an architecture decision before implementing it.

<a id="choose-the-package-topology"></a>
## 2. Choose the package topology

Keep one package when the definition, implementation, and consumer have one owner and do not need independent release or replacement. Split the Service Definition, Service Provider, and Consumer roles when they evolve independently; the shell package family is the reference topology. The [capability seam reference](../capability-seams.md) owns the role contract, and [adding a package](adding-a-package.md) owns package naming and compiler registration.

Use these boundaries:

| Role | Owns | Must not own |
| --- | --- | --- |
| Service Definition | Provider-neutral types, events, lifecycle obligations, and the service key. | Tool schema, UI transport, or one provider's protocol. |
| Service Provider | One implementation, its configuration, resource lifecycle, and external protocol adaptation. | Consumer-specific presentation or an alternate provider's policy. |
| Consumer | Tool, command, prompt, API, UI, or workflow contribution that uses the service. | Provider selection rules that belong to the service owner or provider catalog. |

Give each package one stable `ctx` key. Use `ctx.get(name)` for optional services and declared injection for required services. Register every effect through `ctx.effect()` or `ctx.on()` and return the registry disposer from `register()` so HMR and plugin disposal remove the contribution.

<a id="design-the-public-contract"></a>
## 3. Design the public contract

Read [architecture](../architecture.md), the owning subsystem page, and all current consumers before writing the service type. Keep the definition provider-neutral and design it for every current consumer. Name opaque cross-boundary ids with `Branded<B>`, use declaration merging for extensible event maps, and finish closed-union switches with `assertNever`.

Make defaults explicit. The owning implementation resolves `resolve(request): Spec`; `run()` receives the resolved specification and does not hide deployment choices behind `?? default`. Validate configuration at load, validate model/tool JSON and durable or wire data at their boundaries, and let TypeScript enforce typed same-process values.

If the plugin changes anything a model can see, make that input reconstructable from the session log and add the required session event. Keep UI presentation out of model results. Use the owning presenter, persisted result metadata, or client-derived presentation path described by the relevant subsystem page.

Document failure, cancellation, ownership, timing, disposal, and durability in public JSDoc. A service method with a non-void return documents `@returns`; every parameter has `@param`. The Typert and export-JSDoc checks consume these contracts.

<a id="create-the-package-and-entry-point"></a>
## 4. Create the package and entry point

Follow [the workspace package checklist](adding-a-package.md) for the manifest, TypeScript project, aggregate registration, README, and package tests. The package is one level below an existing group, uses the `@deepseek-ai/dsh-<name>` scope, and keeps ESM imports explicit.

Choose exactly one plugin export form:

- A service package default-exports its service class.
- A function plugin named-exports `name`, `inject`, `Config` when needed, and `apply`, with no default export.

Keep `src/types.ts` type-only. Keep implementation modules narrow: protocol parsing, service state, provider I/O, and consumer presentation should not become one untestable file. Add an `./invariant` entry only when independent observations can diverge; otherwise omit it and record the package-specific reason in its README.

<a id="mount-the-plugin-through-a-real-composition"></a>
## 5. Mount the plugin through a real composition

Add the plugin to the owning `cordis.yml`, profile patch, or bundle only after the service and consumer contracts are complete. A bare plugin in a `cordis.yml` resolver manifest must appear in that manifest's `dependencies`. Deployment-varying choices belong in validated `Config` fields; the composition supplies explicit values and `!!js` environment expressions where the loader permits them.

Use supported `dsh` profiles to launch applications. Do not add a package bin, demo launcher, or public SDK argv escape for a plugin. A bundle may select a plugin through a `dsh --profile` patch layer, but the bundle owns composition and the capability package owns runtime behavior.

Verify the mount with the Loader and the application entry path. A hand-built `ctx.plugin(...)` test does not prove that the shipped composition resolves the package, applies configuration, registers consumers, and disposes the fiber.

<a id="test-independent-lifecycle-and-behavior"></a>
## 6. Test independent lifecycle and behavior

Cover the plugin at the smallest level that proves its contract, then exercise its real composition:

1. Unit-test parsing, resolution, pure presentation, and provider-specific behavior without recreating Cordis lifecycle in every assertion.
2. Test registration and disposal through the package entry point. Observe that the service, event listener, registry contribution, or tool is removed after the owning fiber is disposed.
3. Boot a test-only `cordis.yml` through the Loader and application/process. Mock only external services or nondeterministic inputs. Assert model-visible, user-visible, durable, or wire output at the real boundary.
4. Add a recorded-session snapshot when the change reaches a model request, changes loop lifecycle, or changes product-visible transcript output. Update both TypeScript and Python SDK expected outputs when the loop or session contract changes.
5. For subprocesses, workers, ports, files, clocks, and global state, give the spec an owner and teardown. A test that passes only when run alone is not isolated.

Select focused checks from [the testing policy](../testing.md), the package README, and the [development index](../development-index.md). Do not claim a provider or platform behavior without running the documented operation or naming the verification owner.

<a id="write-the-package-contract"></a>
## 7. Write the package contract

Update the package README and JSDoc in the same change as the implementation. The README states what consumers can do, configuration, runtime semantics, failure behavior, extension points, model and token effects, KV-cache effects, and durable limitations. Link generated catalogs instead of copying event or tool tables. Add or update the owning subsystem page when a public type or service contract changes.

Add an Agent Note for a non-trivial new responsibility, topology, lifecycle rule, durable format, or testing decision. The note records the problem, shipped decision, alternatives, consequences, and verification; it does not replace the package README or this procedure.

<a id="update-the-development-index"></a>
## 8. Update the development index

Update [the development index](../development-index.md) in the same change when the plugin adds or moves a package, entry point, runtime path, test owner, generated artifact, or source-of-truth document. Add the package to its group row, add a runtime-path row when the plugin introduces a new kind of work, and link the package README, subsystem page, cookbook, and relevant generated catalog.

Check every path in the index against the working tree. Remove stale paths and do not list generated output as a hand-maintained source. Re-record both language files with `pnpm run verify-translation-pairing --write docs/development-index.md` after the English and Chinese index entries agree.

<a id="verification"></a>
## Verification

Run the package checks first, then the documentation checks that cover the changed surface:

```sh
pnpm run constraints
pnpm run typecheck
pnpm run lint
pnpm run test:docs
pnpm run doc-sync
git diff --check
```

Run `pnpm run build` and built-entry smokes when the package publishes runtime artifacts or the documented path consumes `lib/`. Run real-API e2e only for providers that require external credentials; keyless suites must self-skip according to [testing policy](../testing.md).

Independent means replaceable through a documented contract, observable through its owner, and removable without leaving registrations, durable records, or model-visible state unexplained. Keep those three properties true as the plugin grows.
